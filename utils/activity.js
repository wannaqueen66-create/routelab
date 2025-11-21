const { ACTIVITY_TYPE_MAP, DEFAULT_ACTIVITY_TYPE } = require('../constants/activity');
const { calculateSegmentDistance } = require('./geo');

const EARLY_DISTANCE_THRESHOLD_METERS = 200;
const EARLY_DURATION_THRESHOLD_MS = 30 * 1000;
const SENSOR_VALID_WINDOW_MS = 1000;
const RIDE_SPEED_PRIMARY_KMH = 17;
const RIDE_PEAK_SPEED_KMH = 22;
const RUN_SPEED_PRIMARY_KMH = 8;
const RUN_PEAK_SPEED_KMH = 12.5;
const RUN_ZERO_CROSSING_RATE = 1.6;
const RIDE_MOTION_STD_MAX = 1.1;
const WALK_MOTION_STD_MIN = 1;
const RUN_MOTION_STD_MIN = 2.3;
const RUN_GYRO_STD_MIN = 1.0;

function ensureFinite(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function computeMaxSpeed(points = [], fallbackSpeed = 0) {
  if (!Array.isArray(points) || points.length < 2) {
    return ensureFinite(fallbackSpeed, 0);
  }
  let maxSpeed = ensureFinite(fallbackSpeed, 0);
  for (let index = 1; index < points.length; index += 1) {
    const current = points[index];
    const previous = points[index - 1];
    if (!current || !previous) {
      continue;
    }
    if (Number.isFinite(current.speed) && current.speed > maxSpeed) {
      maxSpeed = current.speed;
    }
    const deltaTime = ensureFinite(current.timestamp, 0) - ensureFinite(previous.timestamp, 0);
    const deltaSeconds = deltaTime / 1000;
    if (deltaSeconds <= 0.5) {
      continue;
    }
    const segmentDistance = calculateSegmentDistance(previous, current);
    if (!segmentDistance) {
      continue;
    }
    const segmentSpeed = segmentDistance / deltaSeconds;
    if (Number.isFinite(segmentSpeed) && segmentSpeed > maxSpeed && segmentSpeed < 35) {
      maxSpeed = segmentSpeed;
    }
  }
  return maxSpeed;
}

function normalizeSensorStats(sensorStats = {}) {
  const windowMs = ensureFinite(sensorStats.windowMs, 0);
  const accVar = Number.isFinite(sensorStats.accVar) ? Math.max(sensorStats.accVar, 0) : null;
  const gyroVar = Number.isFinite(sensorStats.gyroVar) ? Math.max(sensorStats.gyroVar, 0) : null;
  const accStd = accVar !== null ? Math.sqrt(accVar) : null;
  const gyroStd = gyroVar !== null ? Math.sqrt(gyroVar) : null;
  const accZeroCrossings = ensureFinite(sensorStats.accZeroCrossings, 0);
  const windowSeconds = windowMs > 0 ? windowMs / 1000 : 0;
  const zeroCrossingRate =
    windowSeconds > 0 && accZeroCrossings >= 0 ? accZeroCrossings / windowSeconds : null;
  return {
    accStd,
    gyroStd,
    accZeroCrossings,
    zeroCrossingRate,
    windowMs,
  };
}

function inferActivityType({
  distance = 0,
  duration = 0,
  speed = 0,
  points = [],
  sensorStats = null,
} = {}) {
  const effectiveDistance = ensureFinite(distance, 0);
  const effectiveDuration = ensureFinite(duration, 0);
  const pointsCount = Array.isArray(points) ? points.length : 0;
  if (effectiveDistance <= 0 || effectiveDuration <= 0 || pointsCount < 2) {
    return DEFAULT_ACTIVITY_TYPE;
  }

  let avgSpeed = ensureFinite(speed, 0);
  if (avgSpeed <= 0) {
    avgSpeed = effectiveDistance / (effectiveDuration / 1000);
  }
  const maxSpeed = computeMaxSpeed(points, avgSpeed);
  const avgKmh = avgSpeed * 3.6;
  const peakKmh = maxSpeed * 3.6;
  const earlyStage =
    effectiveDistance < EARLY_DISTANCE_THRESHOLD_METERS || effectiveDuration < EARLY_DURATION_THRESHOLD_MS;

  const sensor = normalizeSensorStats(sensorStats || {});
  const hasSensorWindow = sensor.windowMs >= SENSOR_VALID_WINDOW_MS;
  const lowMotion =
    hasSensorWindow &&
    sensor.accStd !== null &&
    sensor.accStd < RIDE_MOTION_STD_MAX &&
    (sensor.gyroStd === null || sensor.gyroStd < RUN_GYRO_STD_MIN);
  const highMotion = hasSensorWindow && sensor.accStd !== null && sensor.accStd >= RUN_MOTION_STD_MIN;
  const moderateMotion =
    hasSensorWindow &&
    !highMotion &&
    sensor.accStd !== null &&
    sensor.accStd >= WALK_MOTION_STD_MIN &&
    sensor.accStd < RUN_MOTION_STD_MIN;
  const strongOscillation =
    hasSensorWindow &&
    sensor.zeroCrossingRate !== null &&
    sensor.zeroCrossingRate >= RUN_ZERO_CROSSING_RATE;
  const rideSpeedLikely = avgKmh >= RIDE_SPEED_PRIMARY_KMH || peakKmh >= RIDE_PEAK_SPEED_KMH;
  const runSpeedLikely = avgKmh >= RUN_SPEED_PRIMARY_KMH || peakKmh >= RUN_PEAK_SPEED_KMH;

  if (rideSpeedLikely) {
    if (lowMotion || peakKmh >= RIDE_PEAK_SPEED_KMH + 4) {
      return 'ride';
    }
    if (highMotion || strongOscillation) {
      return 'run';
    }
    if (!hasSensorWindow) {
      return 'ride';
    }
  }

  if (runSpeedLikely) {
    if (highMotion || strongOscillation || avgKmh >= 9.5 || peakKmh >= 14) {
      return 'run';
    }
    if (lowMotion && peakKmh >= 12) {
      return 'ride';
    }
  }

  if (earlyStage) {
    if (highMotion && (runSpeedLikely || strongOscillation)) {
      return 'run';
    }
    if (rideSpeedLikely && lowMotion) {
      return 'ride';
    }
    return 'walk';
  }

  if (highMotion && (runSpeedLikely || avgKmh >= 7.5)) {
    return 'run';
  }

  if (rideSpeedLikely && lowMotion) {
    return 'ride';
  }

  if (moderateMotion && avgKmh <= 8) {
    return 'walk';
  }

  if (!runSpeedLikely && !rideSpeedLikely) {
    return 'walk';
  }

  return runSpeedLikely ? 'run' : 'walk';
}

function resolveActivityMeta(activityType) {
  return ACTIVITY_TYPE_MAP[activityType] || ACTIVITY_TYPE_MAP[DEFAULT_ACTIVITY_TYPE];
}

module.exports = {
  inferActivityType,
  resolveActivityMeta,
};
