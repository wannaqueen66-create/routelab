const { createRoutePayload, storeRoute, cacheFragment, flushOfflineFragments } = require('./route-store');
const { formatDuration } = require('../utils/time');
const { calculateSegmentDistance, calculateTotalDistance } = require('../utils/geo');
const { DEFAULT_ACTIVITY_TYPE } = require('../constants/activity');
const { buildCampusDisplayName, normalizeSelection } = require('../constants/campus');

const DEFAULT_CAMPUS_SELECTION = normalizeSelection();
const DEFAULT_CAMPUS_LABEL = buildCampusDisplayName(DEFAULT_CAMPUS_SELECTION);

let locationChangeHandler = null;
let durationTicker = null;

const trackerSubscribers = new Set();

const trackerState = {
  active: false,
  paused: false,
  startTime: null,
  sessionId: null,
  durationBase: 0,
  points: [],
  latestPoint: null,
  pausePoints: [],
  stats: {
    distance: 0,
    duration: 0,
    speed: 0,
  },
  options: {
    privacyLevel: 'group',
    activityType: DEFAULT_ACTIVITY_TYPE,
    startCampusMeta: DEFAULT_CAMPUS_SELECTION,
    endCampusMeta: DEFAULT_CAMPUS_SELECTION,
    campusZone: DEFAULT_CAMPUS_LABEL,
    weight: 60,
    title: '',
    note: '',
    photos: [],
  },
};

function notifyTracker() {
  trackerSubscribers.forEach((callback) => {
    try {
      callback({ ...trackerState });
    } catch (err) {
      console.warn('RouteLab: tracker subscriber failed', err);
    }
  });
}

function startDurationTicker() {
  if (durationTicker) {
    return;
  }
  durationTicker = setInterval(() => {
    if (!trackerState.active || trackerState.paused || !trackerState.startTime) {
      return;
    }
    trackerState.stats.duration = trackerState.durationBase + (Date.now() - trackerState.startTime);
    trackerState.stats.speed = trackerState.stats.duration
      ? trackerState.stats.distance / (trackerState.stats.duration / 1000)
      : 0;
    notifyTracker();
  }, 1000);
}

function stopDurationTicker() {
  if (!durationTicker) {
    return;
  }
  clearInterval(durationTicker);
  durationTicker = null;
}

function resetState() {
  stopDurationTicker();
  trackerState.active = false;
  trackerState.paused = false;
  trackerState.startTime = null;
  trackerState.sessionId = null;
  trackerState.durationBase = 0;
  trackerState.points = [];
  trackerState.latestPoint = null;
  trackerState.pausePoints = [];
  trackerState.stats = {
    distance: 0,
    duration: 0,
    speed: 0,
  };
  trackerState.options = {
    privacyLevel: 'group',
    activityType: DEFAULT_ACTIVITY_TYPE,
    startCampusMeta: DEFAULT_CAMPUS_SELECTION,
    endCampusMeta: DEFAULT_CAMPUS_SELECTION,
    campusZone: DEFAULT_CAMPUS_LABEL,
    weight: 60,
    title: '',
    note: '',
    photos: [],
  };
}

function subscribe(callback) {
  if (typeof callback !== 'function') {
    return () => {};
  }
  trackerSubscribers.add(callback);
  callback({ ...trackerState });
  return () => {
    trackerSubscribers.delete(callback);
  };
}

function ensureLocationPermission() {
  return new Promise((resolve, reject) => {
    wx.getSetting({
      success(settingRes) {
        const authSetting = settingRes.authSetting || {};
        if (authSetting['scope.userLocationBackground']) {
          resolve({ scope: 'background' });
          return;
        }
        if (authSetting['scope.userLocation']) {
          resolve({ scope: 'foreground' });
          return;
        }
        const scopes = ['scope.userLocationBackground', 'scope.userLocation'];
        const request = (index) => {
          if (index >= scopes.length) {
            reject(new Error('RouteLab: user denied location authorization'));
            return;
          }
          const scope = scopes[index];
          wx.authorize({
            scope,
            success() {
              resolve({ scope: scope === 'scope.userLocationBackground' ? 'background' : 'foreground' });
            },
            fail(err) {
              const errMsg = (err && err.errMsg ? err.errMsg : '').toLowerCase();
              if (errMsg.includes('cancel')) {
                reject(err);
                return;
              }
              if (scope === 'scope.userLocationBackground') {
                request(index + 1);
                return;
              }
              reject(err);
            },
          });
        };
        request(0);
      },
      fail(err) {
        reject(err);
      },
    });
  });
}

function handleLocation(location) {
  if (!trackerState.active || trackerState.paused) {
    return;
  }
  const point = {
    latitude: location.latitude,
    longitude: location.longitude,
    speed: location.speed,
    accuracy: location.accuracy,
    altitude: location.altitude,
    heading: location.heading,
    timestamp: Date.now(),
  };
  const previousPoint = trackerState.points[trackerState.points.length - 1];
  const segmentDistance = calculateSegmentDistance(previousPoint, point);
  trackerState.points.push(point);
  trackerState.latestPoint = point;
  trackerState.stats.distance += segmentDistance;
  trackerState.stats.duration = trackerState.durationBase + (trackerState.startTime ? point.timestamp - trackerState.startTime : 0);
  trackerState.stats.speed = trackerState.stats.duration
    ? trackerState.stats.distance / (trackerState.stats.duration / 1000)
    : 0;

  cacheFragment({
    type: 'location',
    point,
    sessionId: trackerState.sessionId,
  });

  notifyTracker();
}

function attachLocationListener() {
  if (locationChangeHandler) {
    return;
  }
  locationChangeHandler = (location) => handleLocation(location);
  if (wx.onLocationChange) {
    wx.onLocationChange(locationChangeHandler);
  }
}

function detachLocationListener() {
  if (!locationChangeHandler) {
    return;
  }
  if (wx.offLocationChange) {
    wx.offLocationChange(locationChangeHandler);
  }
  locationChangeHandler = null;
}

function startTracking(options = {}) {
  if (trackerState.active) {
    return Promise.resolve({ ...trackerState });
  }

  trackerState.active = true;
  trackerState.paused = false;
  trackerState.sessionId = Date.now();
  trackerState.startTime = trackerState.sessionId;
  trackerState.durationBase = 0;
  trackerState.points = [];
  trackerState.latestPoint = null;
  trackerState.pausePoints = [];
  trackerState.stats = {
    distance: 0,
    duration: 0,
    speed: 0,
  };

  const startSelection = options.startCampusMeta
    ? normalizeSelection(options.startCampusMeta)
    : options.campusMeta
      ? normalizeSelection(options.campusMeta)
      : DEFAULT_CAMPUS_SELECTION;
  const endSelection = options.endCampusMeta
    ? normalizeSelection(options.endCampusMeta)
    : startSelection;

  trackerState.options = {
    privacyLevel: options.privacyLevel || trackerState.options.privacyLevel,
    activityType: options.activityType || DEFAULT_ACTIVITY_TYPE,
    startCampusMeta: startSelection,
    endCampusMeta: endSelection,
    campusZone: buildCampusDisplayName(startSelection),
    weight: options.weight || trackerState.options.weight || 60,
    title: options.title || '',
    note: options.note || '',
    photos: Array.isArray(options.photos) ? options.photos : [],
  };

  notifyTracker();

  const startLocationUpdates = (preferBackground) =>
    new Promise((resolve, reject) => {
      const attachAndResolve = () => {
        attachLocationListener();
        startDurationTicker();
        notifyTracker();
        resolve({ ...trackerState });
      };

      const startForeground = (fallbackReason) => {
        if (typeof wx.startLocationUpdate !== 'function') {
          const error = fallbackReason || new Error('当前基础库不支持持续定位');
          trackerState.error = error;
          trackerState.active = false;
          notifyTracker();
          reject(error);
          return;
        }
        wx.startLocationUpdate({
          type: 'gcj02',
          isHighAccuracy: true,
          highAccuracyExpireTime: 3000,
          success: attachAndResolve,
          fail: (err) => {
            trackerState.error = err;
            trackerState.active = false;
            notifyTracker();
            reject(err);
          },
        });
      };

      if (preferBackground && typeof wx.startLocationUpdateBackground === 'function') {
        wx.startLocationUpdateBackground({
          type: 'gcj02',
          isHighAccuracy: true,
          highAccuracyExpireTime: 3000,
          success: attachAndResolve,
          fail: (err) => {
            const errMsg = (err && err.errMsg ? err.errMsg : '').toLowerCase();
            if (
              errMsg.includes('auth deny') ||
              errMsg.includes('denied') ||
              errMsg.includes('no permission') ||
              errMsg.includes('not support')
            ) {
              startForeground(err);
              return;
            }
            trackerState.error = err;
            trackerState.active = false;
            notifyTracker();
            reject(err);
          },
        });
        return;
      }

      startForeground();
    }).catch((err) => {
      trackerState.error = err;
      notifyTracker();
      return Promise.reject(err);
    });

  return ensureLocationPermission()
    .then((result) => startLocationUpdates(result && result.scope === 'background'))
    .then((state) => state)
    .catch((err) => {
      trackerState.error = err;
      trackerState.active = false;
      notifyTracker();
      return Promise.reject(err);
    });
}

function pauseTracking() {
  if (!trackerState.active || trackerState.paused) {
    return;
  }
  if (trackerState.latestPoint) {
    trackerState.pausePoints.push({
      latitude: trackerState.latestPoint.latitude,
      longitude: trackerState.latestPoint.longitude,
      timestamp: Date.now(),
    });
  }
  if (trackerState.startTime) {
    trackerState.durationBase += Date.now() - trackerState.startTime;
  }
  trackerState.startTime = null;
  trackerState.paused = true;
  stopDurationTicker();
  notifyTracker();
}

function resumeTracking() {
  if (!trackerState.active || !trackerState.paused) {
    return;
  }
  trackerState.startTime = Date.now();
  trackerState.paused = false;
  startDurationTicker();
  notifyTracker();
}

function stopTracking(meta = {}) {
  if (!trackerState.active) {
    return null;
  }
  stopDurationTicker();
  const endTime = Date.now();
  const options = {
    ...trackerState.options,
    ...meta,
  };
  detachLocationListener();

  if (wx.stopLocationUpdate) {
    wx.stopLocationUpdate({});
  }

  const offlineFragments = flushOfflineFragments();
  if (offlineFragments.length && trackerState.points.length === 0) {
    for (let index = offlineFragments.length - 1; index >= 0; index -= 1) {
      const fragment = offlineFragments[index];
      if (fragment && fragment.type === 'location' && fragment.point) {
        trackerState.points.push(fragment.point);
        trackerState.latestPoint = fragment.point;
        break;
      }
    }
  }
  if (trackerState.points.length > 1) {
    trackerState.stats.distance = calculateTotalDistance(trackerState.points);
  }
  const elapsedSinceResume = trackerState.startTime ? endTime - trackerState.startTime : 0;
  trackerState.stats.duration = trackerState.durationBase + elapsedSinceResume;
  trackerState.stats.speed = trackerState.stats.duration
    ? trackerState.stats.distance / (trackerState.stats.duration / 1000)
    : 0;

  const finalEndSelection = options.endCampusMeta
    ? normalizeSelection(options.endCampusMeta)
    : trackerState.options.endCampusMeta;
  trackerState.options.endCampusMeta = finalEndSelection;

  const route = createRoutePayload({
    points: trackerState.points,
    title: options.title,
    startTime: trackerState.sessionId || trackerState.startTime,
    endTime,
    privacyLevel: options.privacyLevel,
    note: options.note,
    campusZone: trackerState.options.campusZone,
    campusMeta: trackerState.options.startCampusMeta,
    startCampusMeta: trackerState.options.startCampusMeta,
    endCampusMeta: finalEndSelection,
    activityType: options.activityType || trackerState.options.activityType || DEFAULT_ACTIVITY_TYPE,
    photos: Array.isArray(options.photos) ? options.photos : trackerState.options.photos,
    weight: options.weight || trackerState.options.weight || 60,
    pausePoints: trackerState.pausePoints,
  });

  resetState();
  notifyTracker();
  return storeRoute(route);
}

function getTrackerState() {
  return {
    ...trackerState,
    durationText: formatDuration(trackerState.stats.duration),
    pausePoints: [...trackerState.pausePoints],
  };
}

module.exports = {
  subscribe,
  startTracking,
  pauseTracking,
  resumeTracking,
  stopTracking,
  getTrackerState,
};
