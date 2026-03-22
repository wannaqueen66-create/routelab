'use strict';

const config = require('../config/saaa-config');
const api = require('./api');
const logger = require('../utils/logger');

function toFiniteNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function clonePoint(point = {}) {
  const latitude = toFiniteNumber(point.latitude);
  const longitude = toFiniteNumber(point.longitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return null;
  }
  return {
    latitude,
    longitude,
  };
}

function buildPolylineFromPoints(points = []) {
  return (Array.isArray(points) ? points : [])
    .map((point) => clonePoint(point))
    .filter(Boolean);
}

function buildFallbackRecommendations({ start, end, actualPoints = [], distance = 0, duration = 0 } = {}) {
  const safeStart = clonePoint(start);
  const safeEnd = clonePoint(end);
  const actualPolyline = buildPolylineFromPoints(actualPoints);
  const actualDistance = Number(distance) || 0;
  const actualDuration = Number(duration) || 0;

  const base = [
    {
      id: 'actual-route',
      provider: 'actual',
      title: '你的实际轨迹',
      summary: '本次真实记录路线',
      distanceMeters: actualDistance,
      durationSeconds: Math.max(1, Math.round(actualDuration / 1000)),
      scoreHint: 'actual',
      polyline: actualPolyline,
      isActual: true,
    },
  ];

  if (!safeStart || !safeEnd) {
    return base;
  }

  const midpoint = {
    latitude: Number(((safeStart.latitude + safeEnd.latitude) / 2).toFixed(6)),
    longitude: Number(((safeStart.longitude + safeEnd.longitude) / 2).toFixed(6)),
  };

  return base.concat([
    {
      id: 'candidate-shortest',
      provider: 'fallback',
      title: '候选路线 A',
      summary: '偏向更短距离的推荐',
      distanceMeters: actualDistance ? Math.max(0, Math.round(actualDistance * 0.92)) : null,
      durationSeconds: actualDuration ? Math.max(60, Math.round((actualDuration / 1000) * 0.96)) : null,
      scoreHint: 'shortest',
      polyline: [safeStart, safeEnd],
      isActual: false,
    },
    {
      id: 'candidate-comfort',
      provider: 'fallback',
      title: '候选路线 B',
      summary: '偏向更平滑/更舒适的推荐',
      distanceMeters: actualDistance ? Math.max(0, Math.round(actualDistance * 1.05)) : null,
      durationSeconds: actualDuration ? Math.max(60, Math.round((actualDuration / 1000) * 1.03)) : null,
      scoreHint: 'comfort',
      polyline: [safeStart, midpoint, safeEnd],
      isActual: false,
    },
    {
      id: 'candidate-fastest',
      provider: 'fallback',
      title: '候选路线 C',
      summary: '偏向更快到达的推荐',
      distanceMeters: actualDistance ? Math.max(0, Math.round(actualDistance * 0.98)) : null,
      durationSeconds: actualDuration ? Math.max(60, Math.round((actualDuration / 1000) * 0.9)) : null,
      scoreHint: 'fastest',
      polyline: [safeStart, safeEnd],
      isActual: false,
    },
  ]);
}

function normalizeServerRecommendation(item = {}, index = 0) {
  const polyline = buildPolylineFromPoints(item.polyline || item.points || []);
  return {
    id: item.id || `server-${index}`,
    provider: item.provider || 'server',
    title: item.title || `候选路线 ${index + 1}`,
    summary: item.summary || item.description || '',
    distanceMeters: toFiniteNumber(item.distanceMeters ?? item.distance),
    durationSeconds: toFiniteNumber(item.durationSeconds ?? item.duration),
    scoreHint: item.scoreHint || item.strategy || '',
    polyline,
    isActual: item.isActual === true,
  };
}

function getRouteRecommendations({ start, end, actualPoints = [], distance = 0, duration = 0 } = {}) {
  const safeStart = clonePoint(start);
  const safeEnd = clonePoint(end);
  const fallback = buildFallbackRecommendations({
    start: safeStart,
    end: safeEnd,
    actualPoints,
    distance,
    duration,
  });

  if (!safeStart || !safeEnd) {
    return Promise.resolve({
      source: 'fallback',
      recommendations: fallback,
    });
  }

  const requestFn = api && typeof api.request === 'function' ? api.request : null;
  if (!requestFn) {
    return Promise.resolve({ source: 'fallback', recommendations: fallback });
  }

  const amapKey = config?.map?.amapWebKey || '';

  return requestFn({
    path: '/routes/recommendations',
    method: 'POST',
    data: {
      start: safeStart,
      end: safeEnd,
      actualPoints: buildPolylineFromPoints(actualPoints),
      distanceMeters: Number(distance) || 0,
      durationMs: Number(duration) || 0,
      providerHint: amapKey ? 'amap' : 'auto',
    },
  })
    .then((res) => {
      const list = Array.isArray(res?.recommendations)
        ? res.recommendations.map((item, index) => normalizeServerRecommendation(item, index)).filter(Boolean)
        : [];
      if (!list.length) {
        return {
          source: 'fallback',
          recommendations: fallback,
        };
      }
      const hasActual = list.some((item) => item.isActual);
      return {
        source: 'server',
        recommendations: hasActual ? list : fallback.slice(0, 1).concat(list),
      };
    })
    .catch((error) => {
      logger.warn('Route recommendations unavailable, using fallback', error?.errMsg || error?.message || error);
      return {
        source: 'fallback',
        recommendations: fallback,
      };
    });
}

module.exports = {
  getRouteRecommendations,
};
