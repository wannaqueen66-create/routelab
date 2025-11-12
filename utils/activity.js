const { ACTIVITY_TYPE_MAP, DEFAULT_ACTIVITY_TYPE } = require('../constants/activity');
const { calculateSegmentDistance } = require('./geo');

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

function inferActivityType({ distance = 0, duration = 0, speed = 0, points = [] } = {}) {
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
  const distanceKm = effectiveDistance / 1000;
  const durationMinutes = effectiveDuration / 60000;

  if (distanceKm < 0.6 && durationMinutes < 6 && peakKmh < 16) {
    return 'walk';
  }
  if (peakKmh >= 28 || avgKmh >= 19) {
    return 'ride';
  }
  if (avgKmh >= 9.5 || peakKmh >= 14) {
    return 'run';
  }
  return 'walk';
}

function resolveActivityMeta(activityType) {
  return ACTIVITY_TYPE_MAP[activityType] || ACTIVITY_TYPE_MAP[DEFAULT_ACTIVITY_TYPE];
}

module.exports = {
  inferActivityType,
  resolveActivityMeta,
};
