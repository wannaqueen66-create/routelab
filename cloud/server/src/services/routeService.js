const {
    calculateTotalDistanceMeters,
    calculateSegmentDistanceMeters
} = require('../utils/geo');
const { ACTIVITY_TYPE_DEFINITIONS, DEFAULT_ACTIVITY_TYPE } = require('../config/index');
const { ensurePlainObject } = require('../utils/common');

function computeMaxSpeedFromPoints(points = []) {
    if (!Array.isArray(points) || !points.length) {
        return 0;
    }
    let maxSpeed = 0;
    for (let index = 0; index < points.length; index += 1) {
        const point = points[index];
        if (!point) {
            continue;
        }
        if (Number.isFinite(point.speed) && point.speed > maxSpeed) {
            maxSpeed = point.speed;
        }
        if (index === 0) {
            continue;
        }
        const previous = points[index - 1];
        if (!previous) {
            continue;
        }
        const deltaTimeSec = (point.timestamp - previous.timestamp) / 1000;
        if (!Number.isFinite(deltaTimeSec) || deltaTimeSec <= 0.5) {
            continue;
        }
        const segmentDistance = calculateSegmentDistanceMeters(previous, point);
        if (!Number.isFinite(segmentDistance) || segmentDistance <= 0) {
            continue;
        }
        const segmentSpeed = segmentDistance / deltaTimeSec;
        if (Number.isFinite(segmentSpeed) && segmentSpeed > maxSpeed && segmentSpeed < 35) {
            maxSpeed = segmentSpeed;
        }
    }
    return maxSpeed;
}

function estimateRouteCalories(distanceMeters, weightKg = 60, activityType = DEFAULT_ACTIVITY_TYPE) {
    const distanceKm = distanceMeters / 1000;
    let factorPerKm = 0.75;
    if (activityType === 'ride') {
        factorPerKm = 0.45;
    }
    const kcal = distanceKm * weightKg * factorPerKm;
    return Math.round(Number.isFinite(kcal) ? kcal : 0);
}

function inferActivityTypeFromMetrics({
    distanceMeters = 0,
    durationMs = 0,
    averageSpeed = 0,
    maxSpeed = 0,
    pointsCount = 0,
    fallback = DEFAULT_ACTIVITY_TYPE,
} = {}) {
    const distance = Number(distanceMeters) || 0;
    const duration = Number(durationMs) || 0;
    if (distance <= 0 || duration <= 0 || pointsCount < 2) {
        return ACTIVITY_TYPE_DEFINITIONS[fallback] ? fallback : DEFAULT_ACTIVITY_TYPE;
    }

    const avgSpeed = Number.isFinite(averageSpeed) && averageSpeed > 0 ? averageSpeed : distance / (duration / 1000);
    const peakSpeed = Number.isFinite(maxSpeed) && maxSpeed > 0 ? maxSpeed : avgSpeed;
    const avgSpeedKmh = avgSpeed * 3.6;
    const peakSpeedKmh = peakSpeed * 3.6;
    const distanceKm = distance / 1000;
    const durationMinutes = duration / 60000;

    if (distanceKm < 0.6 && durationMinutes < 6 && peakSpeedKmh < 16) {
        return 'walk';
    }
    if (peakSpeedKmh >= 28 || avgSpeedKmh >= 19) {
        return 'ride';
    }
    if (avgSpeedKmh >= 9.5 || peakSpeedKmh >= 14) {
        return 'run';
    }
    return 'walk';
}


function deriveRouteAnalytics({
    points = [],
    startTime = null,
    endTime = null,
    existingStats = {},
    existingMeta = {},
    weightKg = null,
} = {}) {
    const sanitizedPoints = Array.isArray(points) ? points : [];
    const computedDistance = calculateTotalDistanceMeters(sanitizedPoints);
    const fallbackDistanceCandidate =
        Number(existingStats?.distance ?? existingStats?.distance_m ?? existingStats?.distanceMeters) || 0;
    const distanceMeters = computedDistance > 0 ? computedDistance : Math.max(0, fallbackDistanceCandidate);

    const startMs = startTime instanceof Date ? startTime.getTime() : null;
    const endMs = endTime instanceof Date ? endTime.getTime() : null;
    let durationMs = null;
    if (Number.isFinite(startMs) && Number.isFinite(endMs)) {
        durationMs = Math.max(0, endMs - startMs);
    }
    if (!Number.isFinite(durationMs) || durationMs <= 0) {
        const existingDurationCandidate =
            Number(existingStats?.duration) ||
            Number(existingStats?.durationMs) ||
            Number(existingStats?.duration_ms) ||
            Number(existingStats?.durationMilliseconds);
        durationMs =
            Number.isFinite(existingDurationCandidate) && existingDurationCandidate > 0
                ? existingDurationCandidate
                : 0;
    }

    const averageSpeed =
        durationMs > 0 ? distanceMeters / (durationMs / 1000) : Number(existingStats?.speed) || 0;
    const maxSpeedCandidate = computeMaxSpeedFromPoints(sanitizedPoints);
    const existingMaxSpeed =
        Number(existingStats?.maxSpeed ?? existingStats?.max_speed ?? existingStats?.maxSpeedMs) || 0;
    const maxSpeed = maxSpeedCandidate > 0 ? maxSpeedCandidate : Math.max(0, existingMaxSpeed, averageSpeed);

    const fallbackActivity =
        typeof existingMeta?.activityType === 'string'
            ? existingMeta.activityType.trim().toLowerCase()
            : DEFAULT_ACTIVITY_TYPE;
    const activityType = inferActivityTypeFromMetrics({
        distanceMeters,
        durationMs,
        averageSpeed,
        maxSpeed,
        pointsCount: sanitizedPoints.length,
        fallback: fallbackActivity || DEFAULT_ACTIVITY_TYPE,
    });

    const weightCandidate =
        Number(weightKg) ||
        Number(existingMeta?.weight) ||
        Number(existingStats?.weight) ||
        Number(existingMeta?.bodyWeightKg);
    const effectiveWeight =
        Number.isFinite(weightCandidate) && weightCandidate > 0 ? weightCandidate : 60;

    const calories = estimateRouteCalories(distanceMeters, effectiveWeight, activityType);
    const steps = activityType === 'ride' ? 0 : Math.round(distanceMeters / 0.75);
    const pace =
        activityType === 'ride' || averageSpeed <= 0 ? 0 : Number((1000 / averageSpeed).toFixed(2));

    const existingStatsObject = ensurePlainObject(existingStats);
    const existingMetaObject = ensurePlainObject(existingMeta);

    const stats = {
        ...existingStatsObject,
        distance: Number.isFinite(distanceMeters) ? Number(distanceMeters.toFixed(2)) : 0,
        duration: Number.isFinite(durationMs) ? durationMs : 0,
        speed: Number.isFinite(averageSpeed) ? Number(averageSpeed.toFixed(3)) : 0,
        pace,
        steps,
        calories,
        maxSpeed: Number.isFinite(maxSpeed) ? Number(maxSpeed.toFixed(3)) : 0,
    };

    const activityMeta = ACTIVITY_TYPE_DEFINITIONS[activityType] || ACTIVITY_TYPE_DEFINITIONS[DEFAULT_ACTIVITY_TYPE];
    const inference = {
        source: 'server',
        computedAt: Date.now(),
        points: sanitizedPoints.length,
        averageSpeedKmh: Number((stats.speed * 3.6).toFixed(1)),
        maxSpeedKmh: Number((stats.maxSpeed * 3.6).toFixed(1)),
        distanceKm: Number((stats.distance / 1000).toFixed(2)),
        durationMinutes: Number((stats.duration / 60000).toFixed(1)),
    };

    const meta = {
        ...existingMetaObject,
        activityType,
        modeLabel: activityMeta ? `${activityMeta.label}记录` : '路线记录',
        weight: effectiveWeight,
        activityInference: inference,
    };

    return { stats, meta, activityType, weight: effectiveWeight, inference };
}

module.exports = {
    deriveRouteAnalytics,
    inferActivityTypeFromMetrics,
    estimateRouteCalories,
    computeMaxSpeedFromPoints
}
