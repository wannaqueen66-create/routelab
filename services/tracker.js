const { createRoutePayload, storeRoute, cacheFragment, flushOfflineFragments } = require('./route-store');
const geocodeLocal = require('./geocode-local');
const { formatDuration } = require('../utils/time');
const { calculateSegmentDistance, calculateTotalDistance } = require('../utils/geo');
const { DEFAULT_ACTIVITY_TYPE, ACTIVITY_TYPE_MAP } = require('../constants/activity');
const { PURPOSE_MAP } = require('../constants/purpose');
// NOTE: inferActivityType 已迁移到 activity-inference.js 内部使用
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

// 传感器模块导入（包含常量和函数）
const {
  startMotionSensors,
  stopMotionSensors,
  clearMotionBuffers,
  getMotionFeatureSnapshot,
  SENSOR_WINDOW_MS,
} = require('./motion-sensor');
const {
  updateDetectedActivityType: inferDetectedActivityType,
  resetActivityState,
  STILL_SPEED_THRESHOLD_MPS,
  WALK_SPEED_MAX_MPS,
  ACTIVITY_UPGRADE_DURATION_MS,
  ACTIVITY_DOWNGRADE_DURATION_MS,
} = require('./activity-inference');

// 导入地理位置解析模块
const {
  resolveEndpoint,
  resolveLocationLabel,
} = require('./building-resolver');

const MIN_DISTANCE_METERS = 3;
const MAX_SPEED_MPS = 10; // ~36 km/h, reject abnormal spikes
const SPEED_CLAMP_THRESHOLD_MPS = 8; // clamp path before hard rejection
const MAX_DISTANCE_JUMP_METERS = 250;
const BACKGROUND_RETRY_DELAY_MS = 60 * 1000;

// NOTE: STILL_SPEED_THRESHOLD_MPS 和 WALK_SPEED_MAX_MPS 已从 activity-inference.js 导入
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

// NOTE: Sensor and activity constants moved to motion-sensor.js and activity-inference.js

const BATCH_MIN_POINTS = 5;
const BATCH_MAX_POINTS = 8;
const BATCH_FLUSH_TIMEOUT_MS = 8000;
const DEFAULT_UPLOAD_INTERVAL_MS = 5000;

// NOTE: 建筑物识别相关常量已迁移到 building-resolver.js
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
// NOTE: 传感器状态变量已迁移到 motion-sensor.js
// NOTE: activityStabilizer 已迁移到 activity-inference.js
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

// NOTE: 以下传感器处理函数已迁移到 motion-sensor.js，通过模块导入使用：
// - trimSensorSamples, clearMotionBuffers, handleAccelerometerReading, handleGyroscopeReading
// - attachMotionListeners, detachMotionListeners, startMotionSensors, stopMotionSensors
// - computeVariance, computeZeroCrossings, getMotionFeatureSnapshot

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
    .catch(() => { });
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
  const sensorStats = getMotionFeatureSnapshot();
  const detected = inferDetectedActivityType({
    trackerState,
    sensorStats,
    override,
  });
  trackerState.detectedActivityType = detected;
  return trackerState.detectedActivityType;
}

// NOTE: getActivityPriority 和 applyActivityHysteresis 已迁移到 activity-inference.js
// 通过模块导入使用

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
  // 使用 activity-inference.js 的状态重置函数
  resetActivityState();
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
    return () => { };
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
      isBackground ? '当前设备不支持后台持续定位' : '当前设备不支持持续定位'
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
  const prelude = needsRestart ? stopLocationStream().catch(() => { }) : Promise.resolve();
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
  applyKeepScreenState({ force: true }).catch(() => { });

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

  startMotionSensors().catch(() => { });

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
      stopLocationStream().catch(() => { });
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
  startMotionSensors().catch(() => { });
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
  applyKeepScreenState({ force: true }).catch(() => { });
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
  applyKeepScreenState({ force: true }).catch(() => { });
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

// NOTE: 端点解析逻辑（如 collectEndpointSamples, precisionWeight, weightedMedian, computePrecisionWeightedMedianPoint, refineRepresentativePoint, evaluateCandidate, pickBestCandidate, extractRoadName, extractDistrictName, extractCityName, resolveBuildingLocation 等）已迁移到 building-resolver.js

// NOTE: resolveLocationLabel 和 logEndpointResolution 已迁移到 building-resolver.js

function stopTracking(meta = {}) {
  if (!trackerState.active) {
    return Promise.resolve(null);
  }
  clearSuspensionMonitor();
  applyKeepScreenState({ force: true }).catch(() => { });
  stopDurationTicker();
  const endTime = Date.now();
  const options = {
    ...trackerState.options,
    ...meta,
  };
  detachLocationListener();

  stopLocationStream().catch(() => { });
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
    // 使用新的 resolveEndpoint 从 building-resolver.js
    return Promise.all([
      resolveEndpoint(capturedPoints, { fromStart: true, signalQuality: trackerState.signalQuality }),
      resolveEndpoint(capturedPoints, { fromStart: false, signalQuality: trackerState.signalQuality }),
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
  applyKeepScreenState({ force: true }).catch(() => { });
  stopDurationTicker();
  detachLocationListener();
  stopLocationStream().catch(() => { });
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







