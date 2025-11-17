const {
  getAchievementStats,
  saveAchievementStats,
} = require('../utils/storage');
const {
  BADGE_LEVELS,
  resolveBadgeByPoints,
  getBadgeProgress,
  countUnlockedBadges,
} = require('../constants/achievements');
const api = require('./api');

const MIN_DURATION_SECONDS = 90;
const MIN_DISTANCE_METERS = 200;
const MIN_POINT_COUNT = 5;
const MAX_AVG_SPEED_MPS = 20;

function evaluateRouteValidity(route) {
  if (!route || typeof route !== 'object') {
    return {
      valid: false,
      durationSeconds: 0,
      distanceMeters: 0,
      pointCount: 0,
      averageSpeed: 0,
      reasons: ['missing_route'],
    };
  }
  const stats = route.stats || {};
  const durationMs = Number(stats.duration) || 0;
  const durationSeconds = durationMs > 0 ? Math.floor(durationMs / 1000) : 0;
  const distanceMeters = Number(stats.distance) || 0;
  const pointCount = Array.isArray(route.points) ? route.points.length : 0;
  const averageSpeed = durationSeconds > 0 ? distanceMeters / durationSeconds : 0;

  const reasons = [];
  if (durationSeconds < MIN_DURATION_SECONDS) {
    reasons.push('duration_short');
  }
  if (distanceMeters < MIN_DISTANCE_METERS) {
    reasons.push('distance_short');
  }
  if (pointCount < MIN_POINT_COUNT) {
    reasons.push('insufficient_points');
  }
  if (averageSpeed > MAX_AVG_SPEED_MPS || averageSpeed <= 0) {
    reasons.push('avg_speed_abnormal');
  }

  const valid =
    durationSeconds >= MIN_DURATION_SECONDS &&
    distanceMeters >= MIN_DISTANCE_METERS &&
    pointCount >= MIN_POINT_COUNT &&
    averageSpeed > 0 &&
    averageSpeed <= MAX_AVG_SPEED_MPS;

  return {
    valid,
    durationSeconds,
    distanceMeters,
    pointCount,
    averageSpeed,
    reasons,
  };
}

function buildHistoryEntry({ route, hasPhoto, photoCount, evaluation, pointsAwarded, totalPoints, badgeKey }) {
  const endTime = Number(route?.endTime) || Date.now();
  return {
    routeId: route?.id || null,
    valid: evaluation.valid,
    hasPhoto,
    photoCount,
    pointsAwarded,
    recordedAt: endTime,
    awardedAt: Date.now(),
    stats: {
      distanceMeters: evaluation.distanceMeters,
      durationSeconds: evaluation.durationSeconds,
      pointCount: evaluation.pointCount,
      averageSpeed: Number(evaluation.averageSpeed.toFixed ? evaluation.averageSpeed.toFixed(2) : evaluation.averageSpeed),
    },
    badgeKey,
    totalPointsAfter: totalPoints,
  };
}

function awardPointsForRoute(route) {
  const evaluation = evaluateRouteValidity(route);
  const photoCount = Array.isArray(route?.photos) ? route.photos.length : 0;
  const hasPhoto = photoCount > 0;
  const basePoints = evaluation.valid ? (hasPhoto ? 2 : 1) : 0;
  const achievements = getAchievementStats();
  const historyKey = route?.id;
  const existingHistory =
    historyKey && achievements.routeHistory ? achievements.routeHistory[historyKey] : null;
  let totalPoints = achievements.totalPoints;
  let pointsAwarded = basePoints;
  let alreadyRecorded = false;

  if (existingHistory) {
    alreadyRecorded = true;
    pointsAwarded = existingHistory.pointsAwarded || 0;
  } else if (basePoints > 0) {
    totalPoints += basePoints;
  }

  const badge = resolveBadgeByPoints(totalPoints);
  const unlockedCount = countUnlockedBadges(totalPoints);
  const shouldPersistHistory = Boolean(historyKey) && !existingHistory;

  if (shouldPersistHistory && historyKey) {
    const historyEntry = buildHistoryEntry({
      route,
      hasPhoto,
      photoCount,
      evaluation,
      pointsAwarded: basePoints,
      totalPoints,
      badgeKey: badge.key,
    });
    const saved = saveAchievementStats({
      totalPoints,
      currentBadge: badge.key,
      routeHistory: {
        [historyKey]: historyEntry,
      },
    });
    api
      .saveUserAchievements(saved)
      .catch((error) =>
        console.warn('RouteLab: sync achievements to cloud failed', error?.errMsg || error?.message || error)
      );
  } else if (!historyKey) {
    const saved = saveAchievementStats({
      totalPoints,
      currentBadge: badge.key,
    });
    api
      .saveUserAchievements(saved)
      .catch((error) =>
        console.warn('RouteLab: sync achievements to cloud failed', error?.errMsg || error?.message || error)
      );
  }

  return {
    evaluation,
    hasPhoto,
    photoCount,
    pointsAwarded,
    totalPoints,
    badge,
    unlockedCount,
    alreadyRecorded,
  };
}

function getAchievementSnapshot() {
  const achievements = getAchievementStats();
  const badge = resolveBadgeByPoints(achievements.totalPoints);
  const progress = getBadgeProgress(achievements.totalPoints);
  const unlockedCount = countUnlockedBadges(achievements.totalPoints);
  return {
    totalPoints: achievements.totalPoints,
    badgeKey: badge.key,
    badgeLabel: badge.label,
    badgeIcon: badge.icon,
    unlockedCount,
    badgeCount: BADGE_LEVELS.length,
    nextBadge: progress.next,
    progressRatio: progress.ratio,
    remainingToNext: progress.remaining,
  };
}

function getBadgeWallState() {
  const achievements = getAchievementStats();
  const totalPoints = achievements.totalPoints;
  return BADGE_LEVELS.map((level, index) => {
    const nextLevel = BADGE_LEVELS[index + 1] || null;
    const rangeEnd = nextLevel ? nextLevel.minPoints - 1 : '+';
    const rangeText = nextLevel ? `${level.minPoints}-${rangeEnd} 分` : `${level.minPoints}+ 分`;
    return {
      ...level,
      rangeText,
      unlocked: totalPoints >= level.minPoints,
      remaining: totalPoints >= level.minPoints ? 0 : level.minPoints - totalPoints,
    };
  });
}

module.exports = {
  evaluateRouteValidity,
  awardPointsForRoute,
  getAchievementSnapshot,
  getBadgeWallState,
};
