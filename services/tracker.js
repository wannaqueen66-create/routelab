const { createRoutePayload, storeRoute, cacheFragment, flushOfflineFragments } = require('./route-store');
const geocodeLocal = require('./geocode-local');
const { formatDuration } = require('../utils/time');
const { calculateSegmentDistance, calculateTotalDistance } = require('../utils/geo');
const { DEFAULT_ACTIVITY_TYPE, ACTIVITY_TYPE_MAP } = require('../constants/activity');
const { PURPOSE_MAP } = require('../constants/purpose');
const { inferActivityType } = require('../utils/activity');
const logger = require('../utils/logger');
const {
  getKeepScreenPreference: loadKeepScreenPreference,
  setKeepScreenPreference: persistKeepScreenPreference,
} = require('../utils/storage');
const {
  checkLocationAuthorization,
  requestLocationAuthorization,
  guideBackgroundLocationAuthorization,
} = require('../utils/permissions');

const MIN_DISTANCE_METERS = 3;
const MAX_SPEED_MPS = 10; // ~36 km/h, reject abnormal spikes
const SPEED_CLAMP_THRESHOLD_MPS = 8; // clamp path before hard rejection
const MAX_DISTANCE_JUMP_METERS = 250;
const BACKGROUND_RETRY_DELAY_MS = 60 * 1000;

const STILL_SPEED_THRESHOLD_MPS = 0.5;
const WALK_SPEED_MAX_MPS = 1.8;
const WALK_INTERVAL_MS = 5500;
const WALK_DISTANCE_THRESHOLD_METERS = 10;
const RUN_INTERVAL_MS = 2500;
const RUN_DISTANCE_THRESHOLD_METERS = 7;
const STILL_RESUME_DURATION_MS = 5000;

const MAX_ACCEPTED_ACCURACY_METERS = 20;
const WEAK_ACCURACY_THRESHOLD_METERS = 25;
const WEAK_ACCURACY_STREAK_LIMIT = 3;
const WEAK_SAMPLING_INTERVAL_PENALTY_MS = 2000;
const WEAK_SAMPLING_DISTANCE_PENALTY_METERS = 2;
const WEAK_INTERVAL_THRESHOLD_MS = 12 * 1000;
const WEAK_INTERVAL_STREAK_LIMIT = 2;
const SUSPENSION_GAP_THRESHOLD_MS = 20 * 1000;

const SENSOR_WINDOW_MS = 3000;
const SENSOR_MAX_SAMPLES = 200;
const SENSOR_ZERO_CROSSING_GAP_MS = 80;
const ACTIVITY_UPGRADE_DURATION_MS = 3000;
const ACTIVITY_DOWNGRADE_DURATION_MS = 5000;
const ACTIVITY_RIDE_DOWNGRADE_DURATION_MS = 7000;

const BATCH_MIN_POINTS = 5;
const BATCH_MAX_POINTS = 8;
const BATCH_FLUSH_TIMEOUT_MS = 8000;
const DEFAULT_UPLOAD_INTERVAL_MS = 5000;

const REPRESENTATIVE_SAMPLE_COUNT = 12;
const REPRESENTATIVE_MIN_SAMPLES = 8;
const REPRESENTATIVE_ACCURACY_THRESHOLD = 25;
const MAP_MATCHING_SEGMENT_METERS = 80;
const BUILDING_DISTANCE_TOLERANCE_METERS = 35;
const BUILDING_NAME_WHITELIST = [
  /教学楼/i,
  /ʵ��¥/i,
  /�ۺ�¥/i,
  /ѧԺ/i,
  /����/i,
  /��Ԣ/i,
  /ѧ����Ԣ/i,
  /��Ժ/i,
  /ͼ���/i,
  /ͼ����Ѷ����/i,
  /ͼ����Ϣ����/i,
  /ʳ��/i,
  /����/i,
  /�͹�/i,
  /����/i,
  /����¥/i,
  /�칫¥/i,
  /����/i,
  /������/i,
  /�˶�����/i,
  /auditorium/i,
  /library/i,
  /dining/i,
  /canteen/i,
  /administration/i,
  /office/i,
  /laboratory/i,
  /lab/i,
  /dormitory/i,
];
const FALLBACK_BUILDING_NAME_PRIORITY = ['building', 'poi', 'road', 'district', 'city'];
const AMAP_CAMPUS_PLACE_TYPES = '141200|141201|141202|141203|141204|050100|050300|120201|120202|120203|120302';
const AMAP_CAMPUS_PLACE_KEYWORDS = '��ѧ¥|����|ͼ���|��Ϣ����|ʳ��|����|����¥|ʵ��¥|ѧԺ|������|�˶�|�칫¥';
const ALLOWED_INTERP_METHODS = new Set(['linear', 'snap_road', 'spline', 'gap_fill']);

let locationChangeHandler = null;
let durationTicker = null;
let locationStreamActive = false;
let locationStreamMode = 'inactive';
let appInBackground = false;
let backgroundRetryLockUntil = 0;
let poorAccuracyStreak = 0;
let weakLocationActive = false;
let weakLocationSince = null;
let samplingSuspendedForStillness = false;
let stillStateStartedAt = null;
let movementResumeCandidateAt = null;
let lastAcceptedPointTimestamp = 0;
let accelerometerHandler = null;
let gyroscopeHandler = null;
let accelerometerActive = false;
let gyroscopeActive = false;
let accelerometerSamples = [];
let gyroscopeSamples = [];
let activityStabilizer = {
  current: DEFAULT_ACTIVITY_TYPE,
  candidate: DEFAULT_ACTIVITY_TYPE,
  candidateSince: 0,
  lastChangeAt: 0,
};
let pendingUploadBatch = [];
let lastBatchFlushAt = 0;
let nextUploadAllowedAt = 0;
let intervalWeakSignalActive = false;
let intervalWeakSignalStreak = 0;
let lastLocationCallbackAt = 0;
let suspensionTimer = null;
let suspensionActive = false;
let suspensionStartedAt = 0;
let suspensionLoggedIndex = -1;
let keepScreenPreferred = false;
let pendingBackgroundPermissionGuide = false;
let backgroundPermissionPrompted = false;
try {
  keepScreenPreferred =
    typeof loadKeepScreenPreference === 'function'
      ? !!loadKeepScreenPreference()
      : false;
} catch (_) {
  keepScreenPreferred = false;
}
let keepScreenAppliedState = null;
let backgroundVisibilityReason = 'background';

const trackerSubscribers = new Set();

const trackerState = {
  active: false,
  paused: false,
  startTime: null,
  sessionId: null,
  durationBase: 0,
  points: [],
  latestPoint: null,
  lastGpsPoint: null,
  pausePoints: [],
  stats: {
    distance: 0,
    duration: 0,
    speed: 0,
  },
  signalQuality: 'good',
  pausedAt: null,
  pauseReason: null,
  error: null,
  options: {
    privacyLevel: 'private',
    weight: 60,
    title: '',
    note: '',
    photos: [],
    purposeType: '',
    activityType: '',
  },
  detectedActivityType: DEFAULT_ACTIVITY_TYPE,
};

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function setSignalQuality(quality) {
  const normalized = quality === 'weak' ? 'weak' : 'good';
  if (trackerState.signalQuality === normalized) {
    return;
  }
  trackerState.signalQuality = normalized;
  notifyTracker();
}

function refreshSignalQuality() {
  if (weakLocationActive || intervalWeakSignalActive) {
    setSignalQuality('weak');
    return;
  }
  setSignalQuality('good');
}

function enterWeakLocationMode(context = {}) {
  if (weakLocationActive) {
    return;
  }
  weakLocationActive = true;
  weakLocationSince = Date.now();
  logger.info('Tracker weak location mode entered', context);
  refreshSignalQuality();
}

function exitWeakLocationMode() {
  if (!weakLocationActive) {
    return;
  }
  weakLocationActive = false;
  weakLocationSince = null;
  poorAccuracyStreak = 0;
  logger.info('Tracker weak location mode exited');
  refreshSignalQuality();
}

function trackAccuracySample(accuracyValue) {
  if (!isFiniteNumber(accuracyValue)) {
    return;
  }
  if (accuracyValue <= MAX_ACCEPTED_ACCURACY_METERS) {
    exitWeakLocationMode();
    return;
  }
  if (accuracyValue > WEAK_ACCURACY_THRESHOLD_METERS) {
    poorAccuracyStreak += 1;
    if (poorAccuracyStreak >= WEAK_ACCURACY_STREAK_LIMIT) {
      enterWeakLocationMode({ accuracy: accuracyValue, streak: poorAccuracyStreak });
    }
    return;
  }
  // Accuracy is between MAX_ACCEPTED and WEAK threshold: keep streak but do not escalate immediately.
  poorAccuracyStreak = Math.max(1, poorAccuracyStreak);
}

function markStillness(timestamp) {
  samplingSuspendedForStillness = true;
  stillStateStartedAt = stillStateStartedAt || timestamp;
  movementResumeCandidateAt = null;
}

function canResumeFromStillness(timestamp) {
  if (!samplingSuspendedForStillness) {
    return true;
  }
  movementResumeCandidateAt = movementResumeCandidateAt || timestamp;
  const duration = timestamp - movementResumeCandidateAt;
  if (duration >= STILL_RESUME_DURATION_MS) {
    samplingSuspendedForStillness = false;
    stillStateStartedAt = null;
    movementResumeCandidateAt = null;
    return true;
  }
  return false;
}

function resetStillnessState() {
  samplingSuspendedForStillness = false;
  stillStateStartedAt = null;
  movementResumeCandidateAt = null;
}

function trimSensorSamples(buffer, windowMs = SENSOR_WINDOW_MS) {
  if (!Array.isArray(buffer) || !buffer.length) {
    return;
  }
  const cutoff = Date.now() - windowMs;
  while (buffer.length && buffer[0].ts < cutoff) {
    buffer.shift();
  }
  if (buffer.length > SENSOR_MAX_SAMPLES) {
    buffer.splice(0, buffer.length - SENSOR_MAX_SAMPLES);
  }
}

function clearMotionBuffers() {
  accelerometerSamples = [];
  gyroscopeSamples = [];
}

function handleAccelerometerReading({ x = 0, y = 0, z = 0 } = {}) {
  const ts = Date.now();
  const magnitude = Math.sqrt(x * x + y * y + z * z);
  accelerometerSamples.push({ ts, magnitude });
  trimSensorSamples(accelerometerSamples);
}

function handleGyroscopeReading({ x = 0, y = 0, z = 0 } = {}) {
  const ts = Date.now();
  const magnitude = Math.sqrt(x * x + y * y + z * z);
  gyroscopeSamples.push({ ts, magnitude });
  trimSensorSamples(gyroscopeSamples);
}

function attachMotionListeners() {
  if (typeof wx.onAccelerometerChange === 'function' && !accelerometerHandler) {
    accelerometerHandler = (reading) => handleAccelerometerReading(reading || {});
    wx.onAccelerometerChange(accelerometerHandler);
  }
  if (typeof wx.onGyroscopeChange === 'function' && !gyroscopeHandler) {
    gyroscopeHandler = (reading) => handleGyroscopeReading(reading || {});
    wx.onGyroscopeChange(gyroscopeHandler);
  }
}

function detachMotionListeners() {
  if (accelerometerHandler && typeof wx.offAccelerometerChange === 'function') {
    wx.offAccelerometerChange(accelerometerHandler);
  }
  if (gyroscopeHandler && typeof wx.offGyroscopeChange === 'function') {
    wx.offGyroscopeChange(gyroscopeHandler);
  }
  accelerometerHandler = null;
  gyroscopeHandler = null;
}

function startMotionSensors() {
  attachMotionListeners();
  const tasks = [];
  if (typeof wx.startAccelerometer === 'function' && !accelerometerActive) {
    tasks.push(
      new Promise((resolve) => {
        wx.startAccelerometer({
          interval: 'game',
          success: () => {
            accelerometerActive = true;
            resolve(true);
          },
          fail: (err) => {
            accelerometerActive = false;
            logger.warn('startAccelerometer failed', err?.errMsg || err?.message || err);
            resolve(false);
          },
        });
      })
    );
  }
  if (typeof wx.startGyroscope === 'function' && !gyroscopeActive) {
    tasks.push(
      new Promise((resolve) => {
        wx.startGyroscope({
          interval: 'game',
          success: () => {
            gyroscopeActive = true;
            resolve(true);
          },
          fail: (err) => {
            gyroscopeActive = false;
            logger.warn('startGyroscope failed', err?.errMsg || err?.message || err);
            resolve(false);
          },
        });
      })
    );
  }
  if (!tasks.length) {
    return Promise.resolve(false);
  }
  return Promise.all(tasks)
    .then((results) => results.some(Boolean))
    .catch(() => false);
}

function stopMotionSensors({ clearBuffers = false } = {}) {
  detachMotionListeners();
  if (typeof wx.stopAccelerometer === 'function' && accelerometerActive) {
    try {
      wx.stopAccelerometer({ complete: () => {} });
    } catch (_) {
      // swallow
    }
  }
  if (typeof wx.stopGyroscope === 'function' && gyroscopeActive) {
    try {
      wx.stopGyroscope({ complete: () => {} });
    } catch (_) {
      // swallow
    }
  }
  accelerometerActive = false;
  gyroscopeActive = false;
  if (clearBuffers) {
    clearMotionBuffers();
  }
}

function computeVariance(values = []) {
  if (!Array.isArray(values) || values.length < 2) {
    return null;
  }
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance =
    values.reduce((sum, value) => {
      const delta = value - mean;
      return sum + delta * delta;
    }, 0) / values.length;
  return Number.isFinite(variance) ? variance : null;
}

function computeZeroCrossings(samples = [], mean = 0) {
  if (!Array.isArray(samples) || samples.length < 2) {
    return 0;
  }
  let lastSign = null;
  let lastTimestamp = 0;
  let crossings = 0;
  samples.forEach((item) => {
    if (!item) {
      return;
    }
    const centered = item.magnitude - mean;
    const sign = centered >= 0 ? 1 : -1;
    if (lastSign !== null && sign !== lastSign) {
      if (!lastTimestamp || item.ts - lastTimestamp >= SENSOR_ZERO_CROSSING_GAP_MS) {
        crossings += 1;
        lastTimestamp = item.ts;
      }
    }
    lastSign = sign;
  });
  return crossings;
}

function getMotionFeatureSnapshot() {
  trimSensorSamples(accelerometerSamples);
  trimSensorSamples(gyroscopeSamples);
  const now = Date.now();
  const accWindow = accelerometerSamples.filter((item) => item && now - item.ts <= SENSOR_WINDOW_MS);
  const gyroWindow = gyroscopeSamples.filter((item) => item && now - item.ts <= SENSOR_WINDOW_MS);
  const accValues = accWindow.map((item) => item.magnitude);
  const gyroValues = gyroWindow.map((item) => item.magnitude);
  const accVar = computeVariance(accValues);
  const gyroVar = computeVariance(gyroValues);
  const accMean = accValues.length
    ? accValues.reduce((sum, value) => sum + value, 0) / accValues.length
    : 0;
  const accZeroCrossings = accValues.length ? computeZeroCrossings(accWindow, accMean) : 0;
  const windowStartCandidate = Math.min(
    accWindow.length ? accWindow[0].ts : now,
    gyroWindow.length ? gyroWindow[0].ts : now
  );
  const windowMs = windowStartCandidate ? Math.max(0, now - windowStartCandidate) : 0;
  return {
    accVar: accVar !== null ? accVar : null,
    gyroVar: gyroVar !== null ? gyroVar : null,
    accZeroCrossings,
    accSampleCount: accWindow.length,
    gyroSampleCount: gyroWindow.length,
    windowMs,
  };
}

function resetIntervalWeakSignal() {
  intervalWeakSignalStreak = 0;
  intervalWeakSignalActive = false;
  lastLocationCallbackAt = 0;
  refreshSignalQuality();
}

function updateIntervalWeakSignal(now) {
  if (!trackerState.active || trackerState.paused) {
    lastLocationCallbackAt = now;
    intervalWeakSignalStreak = 0;
    if (intervalWeakSignalActive) {
      intervalWeakSignalActive = false;
      refreshSignalQuality();
    }
    return;
  }
  if (!lastLocationCallbackAt) {
    lastLocationCallbackAt = now;
    intervalWeakSignalStreak = 0;
    return;
  }
  const delta = now - lastLocationCallbackAt;
  lastLocationCallbackAt = now;
  if (delta > WEAK_INTERVAL_THRESHOLD_MS) {
    intervalWeakSignalStreak += 1;
    if (!intervalWeakSignalActive && intervalWeakSignalStreak >= WEAK_INTERVAL_STREAK_LIMIT) {
      intervalWeakSignalActive = true;
      logger.info('Tracker weak signal detected by sparse callbacks', { intervalMs: delta });
      refreshSignalQuality();
    }
  } else {
    intervalWeakSignalStreak = Math.max(0, intervalWeakSignalStreak - 1);
    if (intervalWeakSignalActive && intervalWeakSignalStreak === 0) {
      intervalWeakSignalActive = false;
      logger.info('Tracker callback interval recovered', { intervalMs: delta });
      refreshSignalQuality();
    }
  }
}

function determineSourceDetail() {
  if (weakLocationActive || intervalWeakSignalActive) {
    return 'weak_signal';
  }
  if (appInBackground) {
    return backgroundVisibilityReason === 'screen_off' ? 'screen_off' : 'background';
  }
  return 'foreground';
}

function normalizeInterpMethod(value) {
  if (typeof value !== 'string') {
    return null;
  }
  const method = value.trim().toLowerCase();
  if (!method) {
    return null;
  }
  if (ALLOWED_INTERP_METHODS.has(method)) {
    return method;
  }
  return null;
}

function isBackgroundPermissionError(error) {
  const code = Number(error?.errCode ?? error?.code ?? NaN);
  if ([2000, 2001, 2004, 2006, 2008, 10003].includes(code)) {
    return true;
  }
  const message = (error?.errMsg || error?.message || '').toLowerCase();
  if (!message) {
    return false;
  }
  return (
    message.includes('auth deny') ||
    message.includes('auth denied') ||
    message.includes('permission') ||
    message.includes('forbid') ||
    message.includes('always allow') ||
    message.includes('background location')
  );
}

function triggerBackgroundPermissionGuide() {
  if (!pendingBackgroundPermissionGuide) {
    return;
  }
  pendingBackgroundPermissionGuide = false;
  guideBackgroundLocationAuthorization()
    .then(() => checkLocationAuthorization())
    .then((status) => {
      if (status?.background) {
        backgroundPermissionPrompted = false;
      }
    })
    .catch(() => {});
}

function clearSuspensionMonitor() {
  if (suspensionTimer) {
    clearTimeout(suspensionTimer);
    suspensionTimer = null;
  }
}

function resetSuspensionState() {
  clearSuspensionMonitor();
  suspensionActive = false;
  suspensionStartedAt = 0;
  suspensionLoggedIndex = -1;
}

function handleSuspensionTimeout() {
  suspensionTimer = null;
  if (!trackerState.active || trackerState.paused || suspensionActive) {
    return;
  }
  if (!lastAcceptedPointTimestamp) {
    return;
  }
  suspensionActive = true;
  suspensionStartedAt = lastAcceptedPointTimestamp;
  intervalWeakSignalStreak = WEAK_INTERVAL_STREAK_LIMIT;
  intervalWeakSignalActive = true;
  const pausePoint = {
    latitude: trackerState.latestPoint?.latitude ?? null,
    longitude: trackerState.latestPoint?.longitude ?? null,
    timestamp: suspensionStartedAt,
    reason: 'suspension',
  };
  trackerState.pausePoints.push(pausePoint);
  suspensionLoggedIndex = trackerState.pausePoints.length - 1;
  logger.warn('Tracker detected suspension gap', {
    since: suspensionStartedAt,
    thresholdMs: SUSPENSION_GAP_THRESHOLD_MS,
  });
  refreshSignalQuality();
  notifyTracker();
}

function scheduleSuspensionMonitor() {
  clearSuspensionMonitor();
  if (!trackerState.active || trackerState.paused) {
    return;
  }
  if (!trackerState.latestPoint || !lastAcceptedPointTimestamp) {
    return;
  }
  suspensionTimer = setTimeout(handleSuspensionTimeout, SUSPENSION_GAP_THRESHOLD_MS);
}

function resolveSuspension(resumeTimestamp) {
  if (!suspensionActive) {
    return;
  }
  const resumedAt = resumeTimestamp || Date.now();
  const gapDuration = Math.max(0, resumedAt - suspensionStartedAt);
  if (suspensionLoggedIndex >= 0 && trackerState.pausePoints[suspensionLoggedIndex]) {
    trackerState.pausePoints[suspensionLoggedIndex] = {
      ...trackerState.pausePoints[suspensionLoggedIndex],
      resumeAt: resumedAt,
      gapDuration,
    };
  }
  logger.info('Tracker resumed after suspension', { gapMs: gapDuration });
  suspensionActive = false;
  suspensionStartedAt = 0;
  suspensionLoggedIndex = -1;
  notifyTracker();
}

function getDesiredKeepScreenOn() {
  if (!keepScreenPreferred) {
    return false;
  }
  if (!trackerState.active) {
    return false;
  }
  if (appInBackground) {
    return false;
  }
  return true;
}

function applyKeepScreenState({ force = false } = {}) {
  if (typeof wx.setKeepScreenOn !== 'function') {
    keepScreenAppliedState = null;
    return Promise.resolve(false);
  }
  const desired = getDesiredKeepScreenOn();
  if (!force && keepScreenAppliedState === desired) {
    return Promise.resolve(desired);
  }
  return new Promise((resolve) => {
    wx.setKeepScreenOn({
      keepScreenOn: desired,
      success: () => {
        keepScreenAppliedState = desired;
        logger.info('Keep screen state updated', { keepScreenOn: desired });
        resolve(desired);
      },
      fail: (err) => {
        logger.warn('Keep screen update failed', err?.errMsg || err?.message || err);
        keepScreenAppliedState = null;
        resolve(false);
      },
    });
  });
}

function setKeepScreenPreference(enabled) {
  keepScreenPreferred = !!enabled;
  try {
    if (typeof persistKeepScreenPreference === 'function') {
      persistKeepScreenPreference(keepScreenPreferred);
    }
  } catch (_) {
    // swallow storage errors
  }
  return applyKeepScreenState({ force: true });
}

function getKeepScreenPreference() {
  return keepScreenPreferred;
}

function getSamplingThresholds(speed) {
  if (!isFiniteNumber(speed) || speed <= STILL_SPEED_THRESHOLD_MPS) {
    return {
      intervalMs: Infinity,
      distanceMeters: Infinity,
    };
  }
  if (speed <= WALK_SPEED_MAX_MPS) {
    return {
      intervalMs: WALK_INTERVAL_MS,
      distanceMeters: WALK_DISTANCE_THRESHOLD_METERS,
    };
  }
  return {
    intervalMs: RUN_INTERVAL_MS,
    distanceMeters: RUN_DISTANCE_THRESHOLD_METERS,
  };
}

function getUploadIntervalMs() {
  const intervalSec = trackerState.options?.nextHint?.upload_interval_sec;
  if (isFiniteNumber(intervalSec) && intervalSec > 0) {
    return Math.max(1000, intervalSec * 1000);
  }
  return DEFAULT_UPLOAD_INTERVAL_MS;
}

function flushPendingBatch({ force = false } = {}) {
  if (!pendingUploadBatch.length) {
    return;
  }
  const now = Date.now();
  if (!force) {
    if (pendingUploadBatch.length < BATCH_MIN_POINTS && now - lastBatchFlushAt < BATCH_FLUSH_TIMEOUT_MS) {
      return;
    }
    if (now < nextUploadAllowedAt) {
      return;
    }
  }
  while (pendingUploadBatch.length && (force || pendingUploadBatch.length >= BATCH_MIN_POINTS)) {
    const size = Math.min(BATCH_MAX_POINTS, pendingUploadBatch.length);
    const batch = pendingUploadBatch.splice(0, size);
    if (!batch.length) {
      break;
    }
    const timestamp = Date.now();
    cacheFragment({
      type: 'location_batch',
      points: batch,
      sessionId: trackerState.sessionId,
      timestamp,
    });
    lastBatchFlushAt = timestamp;
    nextUploadAllowedAt = timestamp + getUploadIntervalMs();
    if (!force) {
      break;
    }
  }
}

function enqueueBatchPoint(point) {
  if (!point) {
    return;
  }
  pendingUploadBatch.push({
    latitude: point.latitude,
    longitude: point.longitude,
    altitude: point.altitude,
    speed: point.speed,
    accuracy: point.accuracy,
    heading: point.heading,
    timestamp: point.timestamp,
    source: point.source,
    source_detail: point.source_detail || null,
    interp_method: normalizeInterpMethod(point.interp_method),
  });
  if (pendingUploadBatch.length >= BATCH_MAX_POINTS) {
    flushPendingBatch();
    return;
  }
  const now = Date.now();
  if (now - lastBatchFlushAt >= BATCH_FLUSH_TIMEOUT_MS && pendingUploadBatch.length >= BATCH_MIN_POINTS) {
    flushPendingBatch();
  }
}

function sanitizePoint(previousPoint, point, segmentDistance) {
  if (point && isFiniteNumber(point.accuracy) && point.accuracy > MAX_ACCEPTED_ACCURACY_METERS) {
    trackAccuracySample(point.accuracy);
    logger.info('Tracker drop point due to accuracy', { accuracy: point.accuracy });
    return null;
  }
  trackAccuracySample(point?.accuracy);
  if (!previousPoint) {
    return { point, segmentDistance };
  }
  const timeDelta = point.timestamp - previousPoint.timestamp;
  if (timeDelta <= 0) {
    return { point, segmentDistance };
  }
  const timeDeltaSec = timeDelta / 1000;
  const clampDistance = SPEED_CLAMP_THRESHOLD_MPS * timeDeltaSec;
  if (
    SPEED_CLAMP_THRESHOLD_MPS > 0 &&
    clampDistance > MIN_DISTANCE_METERS &&
    segmentDistance > clampDistance
  ) {
    const ratio = clampDistance / segmentDistance;
    const adjustedLatitude = previousPoint.latitude + (point.latitude - previousPoint.latitude) * ratio;
    const adjustedLongitude = previousPoint.longitude + (point.longitude - previousPoint.longitude) * ratio;
    point = {
      ...point,
      latitude: adjustedLatitude,
      longitude: adjustedLongitude,
      filtered: true,
    };
    segmentDistance = calculateSegmentDistance(previousPoint, point);
  }
  return { point, segmentDistance };
}

function shouldKeepPoint(previousPoint, point, segmentDistance, previousGpsPoint) {
  if (!previousPoint) {
    resetStillnessState();
    return true;
  }
  const referencePoint =
    point.source === 'gps' && previousPoint.source === 'interp' && previousGpsPoint
      ? previousGpsPoint
      : previousPoint;
  const timeDelta = point.timestamp - referencePoint.timestamp;
  if (segmentDistance > MAX_DISTANCE_JUMP_METERS) {
    logger.info('Tracker drop point due to jump', { segmentDistance });
    return false;
  }
  if (timeDelta <= 0) {
    return segmentDistance >= MIN_DISTANCE_METERS;
  }
  const timeDeltaSec = timeDelta / 1000;
  const derivedSpeed = timeDeltaSec > 0 ? segmentDistance / timeDeltaSec : 0;
  const reportedSpeed = isFiniteNumber(point.speed) && point.speed >= 0 ? point.speed : null;
  const effectiveSpeed = reportedSpeed ?? derivedSpeed;
  if (effectiveSpeed > MAX_SPEED_MPS) {
    logger.info('Tracker drop point due to speed spike', {
      effectiveSpeed,
      derivedSpeed,
      reportedSpeed,
      segmentDistance,
      timeDelta,
    });
    return false;
  }
  if (effectiveSpeed <= STILL_SPEED_THRESHOLD_MPS) {
    markStillness(point.timestamp);
    return false;
  }
  if (!canResumeFromStillness(point.timestamp)) {
    return false;
  }
  const thresholds = getSamplingThresholds(effectiveSpeed);
  let intervalMs = thresholds.intervalMs;
  let distanceMeters = thresholds.distanceMeters;

  if (weakLocationActive) {
    if (Number.isFinite(intervalMs)) {
      intervalMs += WEAK_SAMPLING_INTERVAL_PENALTY_MS;
    }
    if (Number.isFinite(distanceMeters)) {
      distanceMeters += WEAK_SAMPLING_DISTANCE_PENALTY_METERS;
    }
  }

  if (Number.isFinite(intervalMs) && timeDelta < intervalMs && segmentDistance < distanceMeters) {
    return false;
  }

  if (segmentDistance < MIN_DISTANCE_METERS) {
    return false;
  }

  resetStillnessState();
  return segmentDistance >= MIN_DISTANCE_METERS;
}

function cloneLocationPoint(point) {
  if (!point) {
    return null;
  }
  return {
    latitude: Number(point.latitude),
    longitude: Number(point.longitude),
    altitude: Number.isFinite(point.altitude) ? Number(point.altitude) : null,
    speed: Number.isFinite(point.speed) ? Number(point.speed) : null,
    heading: Number.isFinite(point.heading) ? Number(point.heading) : null,
    accuracy: Number.isFinite(point.accuracy) ? Number(point.accuracy) : null,
    timestamp: point.timestamp || Date.now(),
    source: point.source || 'gps',
    source_detail: typeof point.source_detail === 'string' ? point.source_detail : null,
    interp_method: normalizeInterpMethod(point.interp_method ?? point.interpMethod),
  };
}

function clonePausePoint(point) {
  if (!point || typeof point.latitude !== 'number' || typeof point.longitude !== 'number') {
    return null;
  }
  return {
    latitude: Number(point.latitude),
    longitude: Number(point.longitude),
    timestamp: point.timestamp || Date.now(),
    reason: point.reason || 'unknown',
    resumeAt: point.resumeAt || null,
    gapDuration: Number.isFinite(point.gapDuration) ? Number(point.gapDuration) : null,
  };
}

function logSessionQualitySummary(points = [], pausePoints = []) {
  const totalPoints = points.length;
  let interpPoints = 0;
  let backgroundPoints = 0;
  let screenOffPoints = 0;
  let weakSignalPoints = 0;
  let backgroundDetailPoints = 0;
  points.forEach((point) => {
    if (!point) {
      return;
    }
    if (point.source === 'interp') {
      interpPoints += 1;
    }
    const detail = point.source_detail || point.sourceDetail || null;
    if (detail === 'background') {
      backgroundPoints += 1;
      backgroundDetailPoints += 1;
    } else if (detail === 'screen_off') {
      screenOffPoints += 1;
      backgroundPoints += 1;
    } else if (detail === 'weak_signal') {
      weakSignalPoints += 1;
    }
  });
  const suspensionResumes = pausePoints.filter((pause) => pause?.reason === 'suspension').length;
  logger.info('Tracker session quality summary', {
    totalPoints,
    interpPoints,
    backgroundPoints,
    screenOffPoints,
    weakSignalPoints,
    resumeSpikeCount: suspensionResumes,
    backgroundRatio: totalPoints ? Number((backgroundPoints / totalPoints).toFixed(3)) : 0,
    interpRatio: totalPoints ? Number((interpPoints / totalPoints).toFixed(3)) : 0,
    weakSignalRatio: totalPoints ? Number((weakSignalPoints / totalPoints).toFixed(3)) : 0,
  });
}

function updateDetectedActivityType() {
  const override = trackerState.options?.activityType;
  const now = Date.now();
  if (override && ACTIVITY_TYPE_MAP[override]) {
    trackerState.detectedActivityType = override;
    activityStabilizer = {
      current: override,
      candidate: override,
      candidateSince: now,
      lastChangeAt: now,
    };
    return trackerState.detectedActivityType;
  }
  const sensorStats = getMotionFeatureSnapshot();
  const detected = inferActivityType({
    distance: trackerState.stats.distance || 0,
    duration: trackerState.stats.duration || 0,
    speed: trackerState.stats.speed || 0,
    points: trackerState.points || [],
    sensorStats,
  });
  const stabilized = applyActivityHysteresis(detected || DEFAULT_ACTIVITY_TYPE, { now });
  trackerState.detectedActivityType = stabilized;
  return trackerState.detectedActivityType;
}

function getActivityPriority(activityType) {
  if (activityType === 'ride') {
    return 3;
  }
  if (activityType === 'run') {
    return 2;
  }
  return 1;
}

function applyActivityHysteresis(candidateType, { now = Date.now() } = {}) {
  const normalized = ACTIVITY_TYPE_MAP[candidateType] ? candidateType : DEFAULT_ACTIVITY_TYPE;
  const current = trackerState.detectedActivityType || activityStabilizer.current || DEFAULT_ACTIVITY_TYPE;
  if (!ACTIVITY_TYPE_MAP[current]) {
    activityStabilizer.current = DEFAULT_ACTIVITY_TYPE;
  }
  if (activityStabilizer.candidate !== normalized) {
    activityStabilizer.candidate = normalized;
    activityStabilizer.candidateSince = now;
  }
  const currentPriority = getActivityPriority(current);
  const candidatePriority = getActivityPriority(normalized);
  const isUpgrade = candidatePriority > currentPriority;
  const isDowngrade = candidatePriority < currentPriority;
  const requiredDuration = isUpgrade
    ? ACTIVITY_UPGRADE_DURATION_MS
    : current === 'ride' && isDowngrade
    ? ACTIVITY_RIDE_DOWNGRADE_DURATION_MS
    : isDowngrade
    ? ACTIVITY_DOWNGRADE_DURATION_MS
    : 0;
  const elapsed = now - (activityStabilizer.candidateSince || now);
  if (!requiredDuration || elapsed >= requiredDuration) {
    activityStabilizer.current = normalized;
    activityStabilizer.lastChangeAt = now;
    activityStabilizer.candidateSince = now;
    return normalized;
  }
  return activityStabilizer.current || normalized;
}

function notifyTracker() {
  updateDetectedActivityType();
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
  stopMotionSensors({ clearBuffers: true });
  activityStabilizer = {
    current: DEFAULT_ACTIVITY_TYPE,
    candidate: DEFAULT_ACTIVITY_TYPE,
    candidateSince: 0,
    lastChangeAt: 0,
  };
  clearMotionBuffers();
  flushPendingBatch({ force: true });
  pendingUploadBatch = [];
  lastBatchFlushAt = 0;
  nextUploadAllowedAt = 0;
  poorAccuracyStreak = 0;
  weakLocationActive = false;
  weakLocationSince = null;
  samplingSuspendedForStillness = false;
  stillStateStartedAt = null;
  movementResumeCandidateAt = null;
  lastAcceptedPointTimestamp = 0;
  resetIntervalWeakSignal();
  resetSuspensionState();
  keepScreenAppliedState = null;
  backgroundVisibilityReason = 'background';
  pendingBackgroundPermissionGuide = false;
  backgroundPermissionPrompted = false;
  const preserved = {
    privacyLevel: trackerState.options?.privacyLevel || 'private',
    weight: trackerState.options?.weight || 60,
  };
  trackerState.active = false;
  trackerState.paused = false;
  trackerState.startTime = null;
  trackerState.sessionId = null;
  trackerState.durationBase = 0;
  trackerState.points = [];
  trackerState.latestPoint = null;
  trackerState.lastGpsPoint = null;
  trackerState.pausePoints = [];
  trackerState.stats = {
    distance: 0,
    duration: 0,
    speed: 0,
  };
  trackerState.signalQuality = 'good';
  trackerState.pausedAt = null;
  trackerState.pauseReason = null;
  trackerState.error = null;
  trackerState.options = {
    privacyLevel: preserved.privacyLevel,
    weight: preserved.weight,
    title: '',
    note: '',
    photos: [],
    purposeType: '',
    activityType: '',
  };
  trackerState.detectedActivityType = DEFAULT_ACTIVITY_TYPE;
  locationStreamActive = false;
  locationStreamMode = 'inactive';
  backgroundRetryLockUntil = 0;
}

function subscribe(callback) {
  if (typeof callback !== 'function') {
    return () => {};
  }
  trackerSubscribers.add(callback);
  updateDetectedActivityType();
  try {
    callback({ ...trackerState });
  } catch (err) {
    console.warn('RouteLab: tracker subscriber failed', err);
  }
  return () => {
    trackerSubscribers.delete(callback);
  };
}

function ensureLocationPermission() {
  return checkLocationAuthorization().then((status) => {
    if (status.authorized) {
      return status;
    }
    return requestLocationAuthorization()
      .then((result) => {
        if (result?.authorized) {
          return result;
        }
        const fallback = { authorized: false, scope: 'none' };
        throw Object.assign(new Error('Location authorization denied'), {
          code: 'LOCATION_DENIED',
          result: fallback,
        });
      })
      .catch((err) => {
        logger.warn('Location authorization request failed', err?.errMsg || err?.message || err);
        throw err;
      });
  });
}

function handleLocation(location) {
  if (!trackerState.active || trackerState.paused) {
    return;
  }
  if (!location || typeof location.latitude !== 'number' || typeof location.longitude !== 'number') {
    return;
  }
  const now = Date.now();
  updateIntervalWeakSignal(now);
  if (suspensionActive) {
    resolveSuspension(now);
  }
  const sourceDetail = determineSourceDetail();
  addPoint(
    {
      latitude: location.latitude,
      longitude: location.longitude,
      speed: location.speed,
      accuracy: location.accuracy,
      altitude: location.altitude,
      heading: location.heading,
      timestamp: now,
      source: 'gps',
      source_detail: sourceDetail,
    },
    { applyFilters: true, notify: true }
  ) && scheduleSuspensionMonitor();
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

function startLocationStream({ mode = 'foreground', force = false } = {}) {
  attachLocationListener();
  const targetMode = mode === 'background' ? 'background' : 'foreground';
  const isBackground = targetMode === 'background';
  if (!force && locationStreamActive && locationStreamMode === targetMode) {
    return Promise.resolve({ mode: targetMode });
  }

  const startMethod = isBackground ? wx.startLocationUpdateBackground : wx.startLocationUpdate;
  if (typeof startMethod !== 'function') {
    const error = new Error(
      isBackground ? '��ǰ�����ⲻ֧�ֺ�̨������λ' : '��ǰ�����ⲻ֧�ֳ�����λ'
    );
    logger.warn(
      isBackground ? 'startLocationUpdateBackground unavailable' : 'startLocationUpdate unavailable',
      error.message
    );
    error.code = 'UNSUPPORTED';
    return Promise.reject(error);
  }

  const initiate = () =>
    new Promise((resolve, reject) => {
      const payload = isBackground
        ? { type: 'gcj02', isHighAccuracy: true, enableHighAccuracy: true }
        : { type: 'gcj02', isHighAccuracy: true, enableHighAccuracy: true, highAccuracyExpireTime: 12000 };
      startMethod({
        ...payload,
        success: () => {
          locationStreamActive = true;
          locationStreamMode = targetMode;
          if (isBackground) {
            backgroundRetryLockUntil = 0;
            backgroundPermissionPrompted = false;
            logger.info('Background location stream activated');
          } else {
            logger.info('Foreground location stream activated');
          }
          scheduleSuspensionMonitor();
          resolve({ mode: targetMode });
        },
        fail: (err) => {
          locationStreamActive = false;
          locationStreamMode = 'inactive';
          const message = err?.errMsg || err?.message || err;
          const errorMeta = {
            message,
            code: err?.errCode || err?.code || null,
            mode: targetMode,
          };
          if (isBackground) {
            logger.error('startLocationUpdateBackground failed', errorMeta);
          } else {
            logger.error('startLocationUpdate failed', errorMeta);
          }
          if (err && typeof err === 'object') {
            err.__targetMode = targetMode; // eslint-disable-line no-underscore-dangle
          }
          reject(err);
        },
      });
    });

  const needsRestart = force || (locationStreamActive && locationStreamMode !== targetMode);
  const prelude = needsRestart ? stopLocationStream().catch(() => {}) : Promise.resolve();
  return prelude.then(initiate);
}

function stopLocationStream() {
  if (!locationStreamActive || typeof wx.stopLocationUpdate !== 'function') {
    const previousMode = locationStreamMode;
    locationStreamActive = false;
    locationStreamMode = 'inactive';
    clearSuspensionMonitor();
    logger.info('Location stream already inactive', { previousMode });
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    const previousMode = locationStreamMode;
    wx.stopLocationUpdate({
      complete: () => {
        locationStreamActive = false;
        locationStreamMode = 'inactive';
        clearSuspensionMonitor();
        logger.info('Location stream stopped', { previousMode });
        resolve();
      },
    });
  });
}

function getDesiredLocationMode() {
  if (!trackerState.active) {
    return 'inactive';
  }
  if (trackerState.paused) {
    return 'inactive';
  }
  return appInBackground ? 'background' : 'foreground';
}

function ensureLocationStream({ force = false } = {}) {
  const desiredMode = getDesiredLocationMode();
  if (desiredMode === 'inactive') {
    return stopLocationStream();
  }
  if (
    desiredMode === 'background' &&
    backgroundRetryLockUntil &&
    backgroundRetryLockUntil > Date.now()
  ) {
    logger.info('Background location temporarily unavailable, using foreground stream');
    return startLocationStream({ mode: 'foreground', force });
  }
  return startLocationStream({ mode: desiredMode, force }).catch((error) => {
    if (desiredMode !== 'background') {
      throw error;
    }
    if (isBackgroundPermissionError(error) && !backgroundPermissionPrompted) {
      backgroundPermissionPrompted = true;
      pendingBackgroundPermissionGuide = true;
      if (!appInBackground) {
        triggerBackgroundPermissionGuide();
      }
    }
    backgroundRetryLockUntil = Date.now() + BACKGROUND_RETRY_DELAY_MS;
    logger.warn('Background location start failed, falling back to foreground stream', {
      message: error?.errMsg || error?.message || error,
      code: error?.errCode || error?.code || null,
    });
    return startLocationStream({ mode: 'foreground', force: true }).catch((fallbackError) => {
      logger.error('Foreground location fallback failed', fallbackError?.errMsg || fallbackError);
      throw fallbackError;
    });
  });
}

function addPoint(rawPoint, { applyFilters = true, notify = true } = {}) {
  if (!rawPoint || typeof rawPoint.latitude !== 'number' || typeof rawPoint.longitude !== 'number') {
    return null;
  }
  const rawSource =
    typeof rawPoint.source === 'string' ? rawPoint.source.toLowerCase() : 'gps';
  const source = rawSource === 'interp' ? 'interp' : 'gps';
  const rawSourceDetail =
    typeof rawPoint.source_detail === 'string'
      ? rawPoint.source_detail
      : typeof rawPoint.sourceDetail === 'string'
      ? rawPoint.sourceDetail
      : null;
  const sourceDetail = typeof rawSourceDetail === 'string' && rawSourceDetail.trim().length
    ? rawSourceDetail
    : null;
  const interpMethod =
    source === 'interp'
      ? normalizeInterpMethod(rawPoint.interp_method ?? rawPoint.interpMethod)
      : null;

  let point = {
    latitude: Number(rawPoint.latitude),
    longitude: Number(rawPoint.longitude),
    speed: isFiniteNumber(rawPoint.speed) && rawPoint.speed >= 0 ? Number(rawPoint.speed) : null,
    accuracy: isFiniteNumber(rawPoint.accuracy) ? Number(rawPoint.accuracy) : null,
    altitude: Number.isFinite(rawPoint.altitude) ? Number(rawPoint.altitude) : null,
    heading: Number.isFinite(rawPoint.heading) ? Number(rawPoint.heading) : null,
    timestamp:
      typeof rawPoint.timestamp === 'number' && Number.isFinite(rawPoint.timestamp)
        ? Number(rawPoint.timestamp)
        : Date.now(),
    source,
    source_detail: sourceDetail,
    interp_method: interpMethod,
  };

  const previousPoint = trackerState.points[trackerState.points.length - 1] || null;
  let segmentDistance = previousPoint ? calculateSegmentDistance(previousPoint, point) : 0;
  if (applyFilters) {
    const sanitized = sanitizePoint(previousPoint, point, segmentDistance);
    if (!sanitized) {
      return null;
    }
    point = sanitized.point;
    segmentDistance = sanitized.segmentDistance;
  }
  if (applyFilters && !shouldKeepPoint(previousPoint, point, segmentDistance, trackerState.lastGpsPoint)) {
    return null;
  }

  trackerState.points.push(point);
  trackerState.latestPoint = point;
  if (point.source !== 'interp') {
    trackerState.lastGpsPoint = point;
  }
  lastAcceptedPointTimestamp = point.timestamp;
  trackerState.stats.distance += segmentDistance;

  if (trackerState.startTime) {
    trackerState.stats.duration =
      trackerState.durationBase + Math.max(0, point.timestamp - trackerState.startTime);
  } else if (trackerState.points.length === 1) {
    trackerState.stats.duration = trackerState.durationBase;
  } else {
    const firstTimestamp = trackerState.points[0]?.timestamp || trackerState.sessionId || point.timestamp;
    trackerState.stats.duration = Math.max(trackerState.durationBase, point.timestamp - firstTimestamp);
  }
  trackerState.stats.speed = trackerState.stats.duration
    ? trackerState.stats.distance / (trackerState.stats.duration / 1000)
    : 0;

  enqueueBatchPoint(point);

  if (notify) {
    notifyTracker();
  }

  return point;
}

function startTracking(options = {}) {
  if (trackerState.active) {
    return Promise.resolve({ ...trackerState });
  }

  const normalizedPurpose =
    typeof options.purposeType === 'string' && PURPOSE_MAP[options.purposeType]
      ? options.purposeType
      : '';
  if (!normalizedPurpose) {
    const error = new Error('Purpose type is required');
    error.code = 'PURPOSE_REQUIRED';
    return Promise.reject(error);
  }

  trackerState.active = true;
  trackerState.paused = false;
  trackerState.pauseReason = null;
  trackerState.pausedAt = null;
  trackerState.sessionId = Date.now();
  trackerState.startTime = trackerState.sessionId;
  trackerState.durationBase = 0;
  trackerState.points = [];
  trackerState.latestPoint = null;
  trackerState.lastGpsPoint = null;
  trackerState.pausePoints = [];
  trackerState.stats = {
    distance: 0,
    duration: 0,
    speed: 0,
  };
  trackerState.signalQuality = 'good';
  trackerState.error = null;
  locationStreamActive = false;
  locationStreamMode = 'inactive';
  backgroundRetryLockUntil = 0;
  pendingUploadBatch = [];
  lastBatchFlushAt = 0;
  nextUploadAllowedAt = 0;
  poorAccuracyStreak = 0;
  weakLocationActive = false;
  weakLocationSince = null;
  samplingSuspendedForStillness = false;
  stillStateStartedAt = null;
  movementResumeCandidateAt = null;
  lastAcceptedPointTimestamp = 0;

  resetIntervalWeakSignal();
  resetSuspensionState();
  backgroundVisibilityReason = 'background';
  pendingBackgroundPermissionGuide = false;
  backgroundPermissionPrompted = false;
  applyKeepScreenState({ force: true }).catch(() => {});

  trackerState.options = {
    privacyLevel: options.privacyLevel || trackerState.options.privacyLevel || 'private',
    weight: options.weight || trackerState.options.weight || 60,
    title: options.title || '',
    note: options.note || '',
    photos: Array.isArray(options.photos) ? options.photos : [],
    purposeType: normalizedPurpose,
    activityType:
      typeof options.activityType === 'string' && ACTIVITY_TYPE_MAP[options.activityType]
        ? options.activityType
        : trackerState.options.activityType || '',
  };
  trackerState.detectedActivityType = DEFAULT_ACTIVITY_TYPE;

  notifyTracker();

  startMotionSensors().catch(() => {});

  return ensureLocationPermission()
    .then(() => ensureLocationStream({ force: true }))
    .then(() => {
      trackerState.startTime = Date.now();
      trackerState.sessionId = trackerState.sessionId || trackerState.startTime;
      startDurationTicker();
      scheduleSuspensionMonitor();
      notifyTracker();
      return { ...trackerState };
    })
    .catch((err) => {
      logger.error('startTracking failed', err?.errMsg || err);
      trackerState.error = err;
      trackerState.active = false;
      trackerState.paused = false;
      trackerState.startTime = null;
      trackerState.pausedAt = null;
      trackerState.pauseReason = null;
      stopLocationStream().catch(() => {});
      detachLocationListener();
      stopMotionSensors({ clearBuffers: true });
      notifyTracker();
      return Promise.reject(err);
    });
}

function pauseTracking(options = {}) {
  if (!trackerState.active || trackerState.paused) {
    return;
  }
  const { silent = false, reason = 'manual' } = options;
  if (!silent && trackerState.latestPoint) {
    trackerState.pausePoints.push({
      latitude: trackerState.latestPoint.latitude,
      longitude: trackerState.latestPoint.longitude,
      timestamp: Date.now(),
      reason,
    });
  }
  if (trackerState.startTime) {
    trackerState.durationBase += Date.now() - trackerState.startTime;
  }
  trackerState.startTime = null;
  trackerState.paused = true;
  trackerState.pausedAt = Date.now();
  trackerState.pauseReason = reason;
  flushPendingBatch({ force: true });
  clearSuspensionMonitor();
  stopDurationTicker();
  stopMotionSensors({ clearBuffers: true });
  notifyTracker();
  ensureLocationStream({ force: true }).catch((err) => {
    logger.warn('Pause tracking stopped location stream failed', err?.errMsg || err?.message || err);
  });
}

function resumeTracking(options = {}) {
  if (!trackerState.active || !trackerState.paused) {
    return;
  }
  const { gapDuration = 0, startTimestamp } = options;
  if (gapDuration > 0) {
    trackerState.durationBase += gapDuration;
  }
  trackerState.pausedAt = null;
  trackerState.pauseReason = null;
  const resumeAt =
    typeof startTimestamp === 'number' && Number.isFinite(startTimestamp) ? startTimestamp : Date.now();
  if (trackerState.pausePoints.length) {
    const lastPause = trackerState.pausePoints[trackerState.pausePoints.length - 1];
    if (lastPause && !lastPause.resumeAt) {
      lastPause.resumeAt = resumeAt;
    }
  }
  trackerState.startTime = resumeAt;
  trackerState.paused = false;
  startDurationTicker();
  startMotionSensors().catch(() => {});
  notifyTracker();
  ensureLocationStream({ force: true })
    .then(() => scheduleSuspensionMonitor())
    .catch((err) => {
      logger.warn('Resume tracking start location stream failed', err?.errMsg || err?.message || err);
    });
}

function handleAppHide(options = {}) {
  const reason = typeof options.reason === 'string' ? options.reason : 'background';
  appInBackground = true;
  backgroundVisibilityReason = reason === 'screen_off' ? 'screen_off' : 'background';
  logger.info('Tracker app hidden', {
    reason: backgroundVisibilityReason,
    tracking: trackerState.active,
  });
  applyKeepScreenState({ force: true }).catch(() => {});
  if (!trackerState.active) {
    return stopLocationStream();
  }
  return ensureLocationStream({ force: true }).catch((err) => {
    logger.warn('Switch to background location stream failed', err?.errMsg || err?.message || err);
  });
}

function handleAppShow(options = {}) {
  appInBackground = false;
  backgroundVisibilityReason = 'background';
  backgroundRetryLockUntil = 0;
  logger.info('Tracker app restored to foreground', {
    tracking: trackerState.active,
  });
  applyKeepScreenState({ force: true }).catch(() => {});
  if (!trackerState.active) {
    return Promise.resolve();
  }
  return ensureLocationStream({ force: true })
    .then(() => {
      scheduleSuspensionMonitor();
      triggerBackgroundPermissionGuide();
    })
    .catch((err) => {
      logger.warn('Restore foreground location stream failed', err?.errMsg || err?.message || err);
      triggerBackgroundPermissionGuide();
    });
}

function matchesBuildingWhitelistText(text = '') {
  if (!text) {
    return false;
  }
  return BUILDING_NAME_WHITELIST.some((regex) => regex.test(text));
}

function collectSegmentWindow(points = [], { fromStart = true, maxDistance = MAP_MATCHING_SEGMENT_METERS } = {}) {
  if (!Array.isArray(points) || !points.length) {
    return [];
  }
  const windowPoints = [];
  const length = points.length;
  const step = fromStart ? 1 : -1;
  let index = fromStart ? 0 : length - 1;
  let accumulated = 0;
  let previous = null;
  while (index >= 0 && index < length) {
    const current = points[index];
    if (!current) {
      index += step;
      continue;
    }
    if (!previous) {
      windowPoints.push(current);
      previous = current;
      index += step;
      continue;
    }
    const segment = calculateSegmentDistance(previous, current);
    accumulated += segment;
    windowPoints.push(current);
    previous = current;
    if (accumulated >= maxDistance) {
      break;
    }
    index += step;
  }
  if (!fromStart) {
    windowPoints.reverse();
  }
  return windowPoints;
}

function collectEndpointSamples(points = [], { fromStart = true } = {}) {
  if (!Array.isArray(points) || !points.length) {
    return [];
  }
  const strictThreshold = REPRESENTATIVE_ACCURACY_THRESHOLD;
  const relaxedThreshold = 40;
  const maxSamples = REPRESENTATIVE_SAMPLE_COUNT;
  const traverse = fromStart ? points : [...points].reverse();
  const collected = [];

  const pushSample = (sample) => {
    if (
      !sample ||
      typeof sample.latitude !== 'number' ||
      typeof sample.longitude !== 'number' ||
      collected.includes(sample)
    ) {
      return false;
    }
    collected.push(sample);
    return collected.length >= maxSamples;
  };

  for (let idx = 0; idx < traverse.length; idx += 1) {
    const sample = traverse[idx];
    const accuracy = isFiniteNumber(sample?.accuracy) ? sample.accuracy : null;
    if (accuracy !== null && accuracy > strictThreshold) {
      continue;
    }
    if (pushSample(sample)) {
      break;
    }
  }

  if (collected.length < REPRESENTATIVE_MIN_SAMPLES) {
    for (let idx = 0; idx < traverse.length; idx += 1) {
      const sample = traverse[idx];
      if (!sample || collected.includes(sample)) {
        continue;
      }
      const accuracy = isFiniteNumber(sample?.accuracy) ? sample.accuracy : null;
      if (accuracy !== null && accuracy > relaxedThreshold) {
        continue;
      }
      if (pushSample(sample)) {
        break;
      }
    }
  }

  if (!collected.length && traverse.length) {
    collected.push(traverse[0]);
  }

  if (!fromStart) {
    collected.reverse();
  }
  return collected;
}

function precisionWeight(accuracy) {
  if (!isFiniteNumber(accuracy) || accuracy <= 0) {
    return 1;
  }
  return 1 / Math.max(accuracy, 1);
}

function weightedMedian(items = []) {
  if (!Array.isArray(items) || !items.length) {
    return null;
  }
  const filtered = items
    .filter(
      (item) =>
        item &&
        isFiniteNumber(item.value) &&
        isFiniteNumber(item.weight) &&
        item.weight > 0
    )
    .sort((a, b) => a.value - b.value);
  if (!filtered.length) {
    return null;
  }
  const totalWeight = filtered.reduce((sum, item) => sum + item.weight, 0);
  let cumulative = 0;
  for (let idx = 0; idx < filtered.length; idx += 1) {
    cumulative += filtered[idx].weight;
    if (cumulative >= totalWeight / 2) {
      return filtered[idx].value;
    }
  }
  return filtered[filtered.length - 1].value;
}

function computePrecisionWeightedMedianPoint(samples = []) {
  if (!Array.isArray(samples) || !samples.length) {
    return null;
  }
  const latMedian = weightedMedian(
    samples.map((sample) => ({
      value: sample.latitude,
      weight: precisionWeight(sample.accuracy),
    }))
  );
  const lonMedian = weightedMedian(
    samples.map((sample) => ({
      value: sample.longitude,
      weight: precisionWeight(sample.accuracy),
    }))
  );
  if (!isFiniteNumber(latMedian) || !isFiniteNumber(lonMedian)) {
    return null;
  }
  const accuracyMedian = weightedMedian(
    samples.map((sample) => ({
      value: isFiniteNumber(sample.accuracy) ? sample.accuracy : REPRESENTATIVE_ACCURACY_THRESHOLD,
      weight: precisionWeight(sample.accuracy),
    }))
  );
  const timestampMedian = weightedMedian(
    samples.map((sample) => ({
      value: Number.isFinite(sample.timestamp) ? Number(sample.timestamp) : 0,
      weight: precisionWeight(sample.accuracy),
    }))
  );
  return {
    latitude: latMedian,
    longitude: lonMedian,
    accuracy: isFiniteNumber(accuracyMedian) ? accuracyMedian : REPRESENTATIVE_ACCURACY_THRESHOLD,
    timestamp: Number.isFinite(timestampMedian) ? timestampMedian : Date.now(),
  };
}

function refineRepresentativePoint(points = [], basePoint = null, { fromStart = true } = {}) {
  if (!basePoint) {
    return null;
  }
  const segmentPoints = collectSegmentWindow(points, { fromStart, maxDistance: MAP_MATCHING_SEGMENT_METERS });
  if (!segmentPoints.length) {
    return basePoint;
  }
  const sortedByAccuracy = segmentPoints
    .filter((item) => item && isFiniteNumber(item.accuracy))
    .sort((a, b) => a.accuracy - b.accuracy);
  const bestCandidate = sortedByAccuracy[0] || segmentPoints[segmentPoints.length - 1];
  if (!bestCandidate) {
    return basePoint;
  }
  const baseWeight = precisionWeight(basePoint.accuracy);
  const candidateWeight = precisionWeight(bestCandidate.accuracy);
  const totalWeight = baseWeight + candidateWeight || 1;
  const latitude =
    (basePoint.latitude * baseWeight + bestCandidate.latitude * candidateWeight) / totalWeight;
  const longitude =
    (basePoint.longitude * baseWeight + bestCandidate.longitude * candidateWeight) / totalWeight;
  const refinedAccuracy = Math.min(
    isFiniteNumber(basePoint.accuracy) ? basePoint.accuracy : REPRESENTATIVE_ACCURACY_THRESHOLD,
    isFiniteNumber(bestCandidate.accuracy) ? bestCandidate.accuracy : REPRESENTATIVE_ACCURACY_THRESHOLD
  );
  const segmentTimestamp = fromStart
    ? segmentPoints[0]?.timestamp
    : segmentPoints[segmentPoints.length - 1]?.timestamp;
  return {
    latitude,
    longitude,
    accuracy: refinedAccuracy,
    timestamp: Number.isFinite(segmentTimestamp) ? segmentTimestamp : basePoint.timestamp,
  };
}

function evaluateCandidate(candidate, basePoint) {
  if (!candidate) {
    return null;
  }
  const latitude = Number(candidate.latitude);
  const longitude = Number(candidate.longitude);
  if (!isFiniteNumber(latitude) || !isFiniteNumber(longitude)) {
    return null;
  }
  let distance = Number(candidate.distance);
  if (!isFiniteNumber(distance) || distance < 0) {
    distance =
      basePoint && isFiniteNumber(basePoint.latitude) && isFiniteNumber(basePoint.longitude)
        ? calculateSegmentDistance(basePoint, { latitude, longitude })
        : null;
  }
  return {
    name: candidate.name || '',
    type: candidate.type || '',
    typecode: candidate.typecode || '',
    latitude,
    longitude,
    distance,
    address: candidate.address || '',
    raw: candidate.raw || candidate,
    whitelist:
      matchesBuildingWhitelistText(candidate.name || '') ||
      matchesBuildingWhitelistText(candidate.type || ''),
    source: candidate.source || (candidate.raw && candidate.raw.source) || '',
  };
}

function pickBestCandidate(candidates = [], basePoint, { requireWhitelist = false, radius = 80, source = '' } = {}) {
  if (!Array.isArray(candidates) || !candidates.length) {
    return null;
  }
  let best = null;
  candidates.forEach((candidate) => {
    const normalized = evaluateCandidate(candidate, basePoint);
    if (!normalized) {
      return;
    }
    if (requireWhitelist && !normalized.whitelist) {
      return;
    }
    if (Number.isFinite(radius) && normalized.distance !== null && normalized.distance > radius) {
      return;
    }
    const distanceScore = normalized.distance !== null ? normalized.distance : 100000;
    const whitelistScore = normalized.whitelist ? 0 : 10000;
    const score = whitelistScore + distanceScore;
    if (!best || score < best.score) {
      best = {
        ...normalized,
        score,
        source: source || normalized.source || 'amap',
      };
    }
  });
  return best;
}

function extractRoadName(regeo) {
  if (!regeo) {
    return '';
  }
  if (Array.isArray(regeo.roads) && regeo.roads.length) {
    return regeo.roads[0]?.name || '';
  }
  const rawRoads = regeo?.raw?.regeocode?.roads;
  if (Array.isArray(rawRoads) && rawRoads.length) {
    return rawRoads[0]?.name || '';
  }
  const street = regeo?.raw?.regeocode?.addressComponent?.streetNumber?.street;
  return street || '';
}

function extractDistrictName(regeo) {
  if (!regeo) {
    return '';
  }
  const component = regeo?.raw?.regeocode?.addressComponent || {};
  return regeo.district || component.district || component.township || regeo.name || '';
}

function extractCityName(regeo) {
  if (!regeo) {
    return '';
  }
  const component = regeo?.raw?.regeocode?.addressComponent || {};
  const cityField = component.city ?? regeo.city;
  if (typeof cityField === 'string' && cityField) {
    return cityField;
  }
  if (Array.isArray(cityField) && cityField.length) {
    return cityField[0];
  }
  return component.province || regeo.province || '';
}

function resolveBuildingLocation(basePoint, { direction = 'start' } = {}) {
  if (!basePoint || !isFiniteNumber(basePoint.latitude) || !isFiniteNumber(basePoint.longitude)) {
    return Promise.resolve(null);
  }
  let detailed = null;
  let buildingCandidate = null;
  let fallbackPoiCandidate = null;

  const radius = direction === 'start' ? 60 : 65;

  return geocodeLocal
    .reverseGeocodeDetailed({
      latitude: basePoint.latitude,
      longitude: basePoint.longitude,
      radius,
    })
    .then((response) => {
      detailed = response || null;
      if (detailed) {
        const combinedCandidates = [
          ...(Array.isArray(detailed.aois) ? detailed.aois : []),
          ...(Array.isArray(detailed.pois) ? detailed.pois : []),
        ];
        buildingCandidate =
          pickBestCandidate(combinedCandidates, basePoint, {
            requireWhitelist: true,
            radius,
            source: 'amap-regeo',
          }) || null;
        if (!buildingCandidate) {
          fallbackPoiCandidate =
            pickBestCandidate(detailed.pois || [], basePoint, {
              requireWhitelist: false,
              radius: Math.max(radius, 70),
              source: 'amap-regeo',
            }) || null;
        }
      }
      return null;
    })
    .catch((error) => {
      logger.warn('Detailed reverse geocode failed', {
        endpoint: direction,
        message: error?.errMsg || error?.message || error,
      });
      detailed = null;
    })
    .then(() =>
      geocodeLocal
        .searchAmapPlaceAround({
          latitude: basePoint.latitude,
          longitude: basePoint.longitude,
          radius: 80,
          types: AMAP_CAMPUS_PLACE_TYPES,
          keywords: AMAP_CAMPUS_PLACE_KEYWORDS,
        })
        .then((pois) => {
          const normalizedPois = Array.isArray(pois) ? pois : [];
          if (!buildingCandidate) {
            buildingCandidate =
              pickBestCandidate(normalizedPois, basePoint, {
                requireWhitelist: true,
                radius: 80,
                source: 'amap-place',
              }) || null;
          }
          if (!fallbackPoiCandidate) {
            fallbackPoiCandidate =
              pickBestCandidate(normalizedPois, basePoint, {
                requireWhitelist: false,
                radius: 80,
                source: 'amap-place',
              }) || null;
          }
          return null;
        })
        .catch((error) => {
          logger.warn('Nearby place search failed', {
            endpoint: direction,
            message: error?.errMsg || error?.message || error,
          });
        })
    )
    .then(() => {
      const withinTolerance =
        buildingCandidate &&
        (buildingCandidate.distance === null || buildingCandidate.distance <= BUILDING_DISTANCE_TOLERANCE_METERS);

      const hierarchy = {
        building: withinTolerance ? buildingCandidate?.name || '' : '',
        poi: '',
        road: extractRoadName(detailed),
        district: extractDistrictName(detailed),
        city: extractCityName(detailed),
      };

      if (!withinTolerance && (buildingCandidate?.name || fallbackPoiCandidate?.name)) {
        hierarchy.poi = buildingCandidate?.name || fallbackPoiCandidate?.name || '';
      } else if (fallbackPoiCandidate?.name) {
        hierarchy.poi = fallbackPoiCandidate.name;
      }

      const level = hierarchy.building
        ? 'building'
        : hierarchy.poi
        ? 'poi'
        : hierarchy.road
        ? 'road'
        : hierarchy.district
        ? 'district'
        : hierarchy.city
        ? 'city'
        : 'unknown';

      const preferredName =
        hierarchy[level] ||
        buildingCandidate?.name ||
        fallbackPoiCandidate?.name ||
        detailed?.displayName ||
        detailed?.name ||
        '';

      return {
        name: preferredName,
        displayName: preferredName || detailed?.displayName || '',
        address: detailed?.address || null,
        raw: {
          regeo: detailed?.raw || null,
          candidate: buildingCandidate?.raw || buildingCandidate || null,
          fallbackPoi: fallbackPoiCandidate?.raw || fallbackPoiCandidate || null,
        },
        source: hierarchy.building
          ? buildingCandidate?.source || 'amap-regeo'
          : hierarchy.poi
          ? (buildingCandidate?.source || fallbackPoiCandidate?.source || 'amap-place')
          : detailed
          ? 'amap-regeo'
          : 'amap-place',
        level,
        distance: hierarchy.building
          ? buildingCandidate?.distance ?? null
          : fallbackPoiCandidate?.distance ?? buildingCandidate?.distance ?? null,
        coordinate: {
          latitude: basePoint.latitude,
          longitude: basePoint.longitude,
        },
        hierarchy,
        accuracy: basePoint.accuracy,
      };
    });
}

function resolveLocationLabel(location) {
  if (!location) {
    return '';
  }
  const hierarchy = location.hierarchy || {};
  for (let idx = 0; idx < FALLBACK_BUILDING_NAME_PRIORITY.length; idx += 1) {
    const key = FALLBACK_BUILDING_NAME_PRIORITY[idx];
    if (hierarchy[key]) {
      return hierarchy[key];
    }
  }
  return location.name || location.displayName || '';
}

function logEndpointResolution(direction, representative, location) {
  logger.info('Tracker endpoint resolved', {
    endpoint: direction,
    representative: representative
      ? {
          latitude: Number.isFinite(representative.latitude)
            ? Number(representative.latitude.toFixed(6))
            : null,
          longitude: Number.isFinite(representative.longitude)
            ? Number(representative.longitude.toFixed(6))
            : null,
          accuracy: representative.accuracy,
        }
      : null,
    location: location
      ? {
          name: location.name,
          level: location.level,
          source: location.source,
          distance: location.distance,
        }
      : null,
    signalQuality: trackerState.signalQuality,
  });
}

function resolveEndpoint(points = [], { fromStart = true } = {}) {
  if (!Array.isArray(points) || !points.length) {
    return Promise.resolve({ point: null, location: null });
  }
  const samples = collectEndpointSamples(points, { fromStart });
  let representative = computePrecisionWeightedMedianPoint(samples);
  if (!representative) {
    const fallback = fromStart ? points[0] : points[points.length - 1];
    if (fallback) {
      representative = {
        latitude: fallback.latitude,
        longitude: fallback.longitude,
        accuracy: fallback.accuracy,
        timestamp: fallback.timestamp,
      };
    }
  }
  if (!representative) {
    return Promise.resolve({ point: null, location: null });
  }
  const refined = refineRepresentativePoint(points, representative, { fromStart }) || representative;
  return resolveBuildingLocation(refined, { direction: fromStart ? 'start' : 'end' })
    .then((location) => {
      logEndpointResolution(fromStart ? 'start' : 'end', refined, location);
      return { point: refined, location };
    })
    .catch((error) => {
      logger.warn('Resolve endpoint failed', {
        endpoint: fromStart ? 'start' : 'end',
        message: error?.errMsg || error?.message || error,
      });
      return { point: refined, location: null };
    });
}

function stopTracking(meta = {}) {
  if (!trackerState.active) {
    return Promise.resolve(null);
  }
  clearSuspensionMonitor();
  applyKeepScreenState({ force: true }).catch(() => {});
  stopDurationTicker();
  const endTime = Date.now();
  const options = {
    ...trackerState.options,
    ...meta,
  };
  detachLocationListener();

  stopLocationStream().catch(() => {});
  stopMotionSensors({ clearBuffers: true });

  flushPendingBatch({ force: true });

  const offlineFragments = flushOfflineFragments();
  if (offlineFragments.length && trackerState.points.length === 0) {
    for (let index = offlineFragments.length - 1; index >= 0; index -= 1) {
      const fragment = offlineFragments[index];
      if (fragment && fragment.type === 'location' && fragment.point) {
        trackerState.points.push(fragment.point);
        trackerState.latestPoint = fragment.point;
        break;
      }
      if (
        fragment &&
        fragment.type === 'location_batch' &&
        Array.isArray(fragment.points) &&
        fragment.points.length
      ) {
        const fallbackPoint = fragment.points[fragment.points.length - 1];
        if (fallbackPoint) {
          trackerState.points.push(fallbackPoint);
          trackerState.latestPoint = fallbackPoint;
          break;
        }
      }
    }
  }

  const capturedPoints = trackerState.points.map((point) => cloneLocationPoint(point)).filter(Boolean);
  const capturedPausePoints = trackerState.pausePoints.map((point) => clonePausePoint(point)).filter(Boolean);

  if (capturedPoints.length > 1) {
    trackerState.stats.distance = calculateTotalDistance(capturedPoints);
  }
  const elapsedSinceResume = trackerState.startTime ? endTime - trackerState.startTime : 0;
  trackerState.stats.duration = trackerState.durationBase + elapsedSinceResume;
  trackerState.stats.speed = trackerState.stats.duration
    ? trackerState.stats.distance / (trackerState.stats.duration / 1000)
    : 0;

  const routeStartTime = trackerState.sessionId || trackerState.startTime || Date.now();

  logSessionQualitySummary(capturedPoints, capturedPausePoints);

  const payloadBase = {
    points: capturedPoints,
    title: options.title,
    startTime: routeStartTime,
    endTime,
    privacyLevel: options.privacyLevel || 'private',
    note: options.note,
    activityType:
      typeof options.activityType === 'string' && ACTIVITY_TYPE_MAP[options.activityType]
        ? options.activityType
        : trackerState.options.activityType || '',
    photos: Array.isArray(options.photos) ? options.photos : trackerState.options.photos,
    weight: options.weight || trackerState.options.weight || 60,
    purposeType:
      typeof options.purposeType === 'string'
        ? options.purposeType
        : trackerState.options.purposeType || '',
    pausePoints: capturedPausePoints,
  };

  const resolveLocations = () => {
    if (!capturedPoints.length) {
      return Promise.resolve({
        start: { point: null, location: null },
        end: { point: null, location: null },
      });
    }
    return Promise.all([
      resolveEndpoint(capturedPoints, { fromStart: true }),
      resolveEndpoint(capturedPoints, { fromStart: false }),
    ]).then(([start, end]) => ({
      start,
      end,
    }));
  };

  const finalize = ({ start, end }) => {
    const startLocation = start?.location || null;
    const endLocation = end?.location || null;
    const route = createRoutePayload({
      ...payloadBase,
      startLocation,
      endLocation,
      startLabel: resolveLocationLabel(startLocation) || startLocation?.name || startLocation?.displayName,
      endLabel: resolveLocationLabel(endLocation) || endLocation?.name || endLocation?.displayName,
    });
    return storeRoute(route);
  };

  return resolveLocations()
    .catch((error) => {
      logger.warn('Resolve start/end locations failed', error?.errMsg || error?.message || error);
      return {
        start: { point: null, location: null },
        end: { point: null, location: null },
      };
    })
    .then(finalize)
    .finally(() => {
      resetState();
      notifyTracker();
    });
}

function cancelTracking() {
  if (!trackerState.active && !trackerState.paused) {
    return Promise.resolve(null);
  }
  clearSuspensionMonitor();
  applyKeepScreenState({ force: true }).catch(() => {});
  stopDurationTicker();
  detachLocationListener();
  stopLocationStream().catch(() => {});
  stopMotionSensors({ clearBuffers: true });
  flushPendingBatch({ force: true });
  // 丢弃离线片段，不生成轨迹记录
  flushOfflineFragments();
  resetState();
  notifyTracker();
  logger.info('Tracker session cancelled without saving route');
  return Promise.resolve(null);
}

function getTrackerState() {
  return {
    ...trackerState,
    durationText: formatDuration(trackerState.stats.duration),
    pausePoints: trackerState.pausePoints.map((point) => ({ ...point })),
  };
}

function updatePurposeType(purposeType = '') {
  const normalized = typeof purposeType === 'string' ? purposeType.trim() : '';
  if (!trackerState.options) {
    trackerState.options = {};
  }
  if (trackerState.options.purposeType === normalized) {
    return { ...trackerState };
  }
  trackerState.options.purposeType = normalized;
  notifyTracker();
  return { ...trackerState };
}

function updateActivityTypeOverride(activityType = '') {
  const normalized =
    typeof activityType === 'string' && ACTIVITY_TYPE_MAP[activityType] ? activityType : '';
  if (!trackerState.options) {
    trackerState.options = {};
  }
  if ((trackerState.options.activityType || '') === normalized) {
    return { ...trackerState };
  }
  trackerState.options.activityType = normalized;
  notifyTracker();
  return { ...trackerState };
}

module.exports = {
  subscribe,
  startTracking,
  pauseTracking,
  resumeTracking,
  handleAppHide,
  handleAppShow,
  cancelTracking,
  stopTracking,
  getTrackerState,
  setKeepScreenPreference,
  getKeepScreenPreference,
  applyKeepScreenState,
  updatePurposeType,
  updateActivityTypeOverride,
};







