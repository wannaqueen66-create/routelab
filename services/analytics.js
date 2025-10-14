const { calculateTotalDistance } = require('../utils/geo');

function getActivityLevel(route) {
  const distance = route?.stats?.distance || calculateTotalDistance(route?.points);
  const duration = route?.stats?.duration || 0;
  const distanceKm = distance / 1000;
  const durationMin = duration / 60000;

  if (distanceKm >= 4 || durationMin >= 40) {
    return 'high';
  }
  if (distanceKm <= 1.2 && durationMin <= 20) {
    return 'sedentary';
  }
  return 'moderate';
}

function summarizeRoutes(routes = []) {
  if (!routes.length) {
    return {
      count: 0,
      distance: 0,
      duration: 0,
      avgPace: 0,
      avgDistance: 0,
      avgDuration: 0,
    };
  }

  const totals = routes.reduce(
    (acc, route) => {
      const distance = route?.stats?.distance || calculateTotalDistance(route?.points);
      const duration = route?.stats?.duration || Math.max(0, (route.endTime || Date.now()) - (route.startTime || Date.now()));
      acc.distance += distance;
      acc.duration += duration;
      return acc;
    },
    { distance: 0, duration: 0 }
  );

  const averageDistance = totals.distance / routes.length;
  const averageDuration = totals.duration / routes.length;
  const averagePace = averageDistance ? (averageDuration / 1000) / (averageDistance / 1000) : 0;

  return {
    count: routes.length,
    distance: Math.round(totals.distance),
    duration: totals.duration,
    avgDistance: Math.round(averageDistance),
    avgDuration: averageDuration,
    avgPace: averagePace,
  };
}

function buildComparisonSummary(routes = []) {
  const grouped = routes.reduce(
    (acc, route) => {
      const level = getActivityLevel(route);
      acc[level].push(route);
      return acc;
    },
    { sedentary: [], moderate: [], high: [] }
  );
  return {
    sedentary: summarizeRoutes(grouped.sedentary),
    moderate: summarizeRoutes(grouped.moderate),
    high: summarizeRoutes(grouped.high),
  };
}

function pickBestLoops(routes = []) {
  if (!routes.length) {
    return { commute: null, run: null };
  }
  const sorted = [...routes].sort((a, b) => (b.stats?.distance || 0) - (a.stats?.distance || 0));
  const commuteTarget = 1800; // meters
  const runTarget = 4000;

  let bestCommute = null;
  let bestRun = null;
  let commuteDiff = Number.MAX_SAFE_INTEGER;
  let runDiff = Number.MAX_SAFE_INTEGER;

  sorted.forEach((route) => {
    const distance = route.stats?.distance || calculateTotalDistance(route.points || []);
    const diffCommute = Math.abs(distance - commuteTarget);
    if (diffCommute < commuteDiff) {
      commuteDiff = diffCommute;
      bestCommute = route;
    }
    const diffRun = Math.abs(distance - runTarget);
    if (diffRun < runDiff) {
      runDiff = diffRun;
      bestRun = route;
    }
  });

  return {
    commute: bestCommute,
    run: bestRun,
  };
}

module.exports = {
  getActivityLevel,
  summarizeRoutes,
  buildComparisonSummary,
  pickBestLoops,
};
