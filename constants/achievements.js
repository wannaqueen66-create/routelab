const BADGE_LEVELS = [
  { key: 'rookie', label: '新手上路', icon: '🏃', minPoints: 0 },
  { key: 'junior_runner', label: '初级跑者', icon: '🥉', minPoints: 10 },
  { key: 'enthusiast', label: '运动达人', icon: '🥈', minPoints: 30 },
  { key: 'elite', label: '健身精英', icon: '🥇', minPoints: 60 },
  { key: 'pro', label: '运动健将', icon: '🏆', minPoints: 100 },
  { key: 'legend', label: '传奇运动员', icon: '👑', minPoints: 200 },
];

function resolveBadgeByPoints(points = 0) {
  const numeric = Number(points);
  const safePoints = Number.isFinite(numeric) && numeric > 0 ? Math.floor(numeric) : 0;
  let current = BADGE_LEVELS[0];
  BADGE_LEVELS.forEach((level) => {
    if (safePoints >= level.minPoints) {
      current = level;
    }
  });
  return current;
}

function getBadgeProgress(points = 0) {
  const numeric = Number(points);
  const safePoints = Number.isFinite(numeric) && numeric > 0 ? Math.floor(numeric) : 0;
  const current = resolveBadgeByPoints(safePoints);
  const currentIndex = BADGE_LEVELS.findIndex((level) => level.key === current.key);
  const next = BADGE_LEVELS[currentIndex + 1] || null;
  const start = current.minPoints;
  const end = next ? next.minPoints : safePoints;
  const denominator = Math.max((next ? next.minPoints : safePoints) - start, 1);
  const progressValue = safePoints - start;
  const ratio = next ? Math.min(Math.max(progressValue / denominator, 0), 1) : 1;
  const remaining = next ? Math.max(next.minPoints - safePoints, 0) : 0;
  return {
    current,
    next,
    ratio,
    remaining,
    start,
    end,
  };
}

function countUnlockedBadges(points = 0) {
  const numeric = Number(points);
  const safePoints = Number.isFinite(numeric) && numeric > 0 ? Math.floor(numeric) : 0;
  return BADGE_LEVELS.filter((level) => safePoints >= level.minPoints).length;
}

module.exports = {
  BADGE_LEVELS,
  resolveBadgeByPoints,
  getBadgeProgress,
  countUnlockedBadges,
};
