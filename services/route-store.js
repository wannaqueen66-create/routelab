const {
  saveRoute,
  getRoutes,
  updateRoute,
  removeRoute,
  enqueueOfflineFragment,
  clearOfflineQueue,
  getOfflineQueue,
} = require('../utils/storage');
const { calculateTotalDistance, estimateCalories } = require('../utils/geo');
const { buildCampusDisplayName, normalizeSelection } = require('../constants/campus');
const { generateRouteId } = require('../utils/id');
const { getActivityLevel } = require('./analytics');
const { formatDuration } = require('../utils/time');
const { ACTIVITY_TYPE_MAP, DEFAULT_ACTIVITY_TYPE } = require('../constants/activity');

const subscribers = new Set();

function notify() {
  const routes = getRoutes();
  subscribers.forEach((callback) => {
    try {
      callback(routes);
    } catch (err) {
      console.warn('RouteLab: route subscriber error', err);
    }
  });
}

function subscribe(callback) {
  if (typeof callback !== 'function') {
    return () => {};
  }
  subscribers.add(callback);
  try {
    callback(getRoutes());
  } catch (err) {
    console.warn('RouteLab: init subscriber failed', err);
  }
  return () => {
    subscribers.delete(callback);
  };
}

function normalizePhotoList(photos = []) {
  return photos.map((item) => {
    if (typeof item === 'string') {
      return { path: item, note: '' };
    }
    return {
      path: item.path,
      note: item.note || '',
    };
  });
}

function normalizePausePoints(points = []) {
  return points
    .filter((point) => point && point.latitude && point.longitude)
    .map((point) => ({
      latitude: Number(point.latitude),
      longitude: Number(point.longitude),
      timestamp: point.timestamp || Date.now(),
    }));
}

function createRoutePayload({
  points = [],
  title,
  startTime,
  endTime,
  privacyLevel = 'group',
  note,
  campusZone,
  campusMeta,
  startCampusMeta,
  endCampusMeta,
  activityType = DEFAULT_ACTIVITY_TYPE,
  photos = [],
  pausePoints = [],
  weight = 60,
}) {
  const startSelection = startCampusMeta
    ? normalizeSelection(startCampusMeta)
    : campusMeta
      ? normalizeSelection(campusMeta)
      : null;
  const endSelection = endCampusMeta ? normalizeSelection(endCampusMeta) : startSelection;

  const startLabel = startSelection
    ? buildCampusDisplayName(startSelection)
    : campusZone || '自定义起点';
  const endLabel = endSelection ? buildCampusDisplayName(endSelection) : startLabel;
  const effectiveWeight = weight || 60;
  const safePhotos = normalizePhotoList(photos);
  const safePausePoints = normalizePausePoints(pausePoints);

  const distance = calculateTotalDistance(points);
  const duration = Math.max(0, (endTime || Date.now()) - (startTime || Date.now()));
  const speed = duration ? distance / (duration / 1000) : 0;
  const calories = estimateCalories(distance, effectiveWeight, activityType);
  const steps = activityType === 'walk' ? Math.round(distance / 0.75) : 0;
  const pace = activityType === 'walk' && speed ? 1000 / speed : 0;
  const activityMeta = ACTIVITY_TYPE_MAP[activityType] || ACTIVITY_TYPE_MAP[DEFAULT_ACTIVITY_TYPE];
  const modeLabel = activityMeta ? `${activityMeta.label}记录` : '校园轨迹';

  return {
    id: generateRouteId(),
    title: title || modeLabel,
    startTime,
    endTime,
    privacyLevel,
    note: note || '',
    campusZone: startLabel,
    campusMeta: startSelection,
    points,
    stats: {
      distance,
      duration,
      speed,
      pace,
      steps,
      calories,
    },
    meta: {
      activityType,
      activityLevel: getActivityLevel({ stats: { distance, duration } }),
      durationText: formatDuration(duration),
      modeLabel,
      campus: startSelection,
      startCampus: startSelection,
      endCampus: endSelection,
      startLabel,
      endLabel,
      weight: effectiveWeight,
      pausePoints: safePausePoints,
    },
    photos: safePhotos,
    createdAt: Date.now(),
  };
}

function storeRoute(route) {
  const saved = saveRoute(route);
  notify();
  return saved;
}

function updateRoutePrivacy(id, privacyLevel) {
  const updated = updateRoute(id, {
    privacyLevel,
  });
  notify();
  return updated;
}

function deleteRoute(id) {
  removeRoute(id);
  notify();
}

function cacheFragment(fragment) {
  enqueueOfflineFragment(fragment);
}

function flushOfflineFragments() {
  const fragments = getOfflineQueue();
  if (!fragments.length) {
    return [];
  }
  clearOfflineQueue();
  return fragments;
}

module.exports = {
  subscribe,
  storeRoute,
  getRoutes,
  createRoutePayload,
  updateRoutePrivacy,
  deleteRoute,
  cacheFragment,
  flushOfflineFragments,
};
