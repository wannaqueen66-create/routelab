const config = require('../config/saaa-config');
const logger = require('../utils/logger');
const api = require('./api');

function parsePolyline(polyline = '') {
  if (typeof polyline !== 'string' || !polyline.length) {
    return [];
  }
  return polyline
    .split(';')
    .map((pair) => {
      const [lng, lat] = pair.split(',').map((value) => Number(value));
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        return null;
      }
      return {
        latitude: lat,
        longitude: lng,
      };
    })
    .filter(Boolean);
}

function normalizePath(points = [], { start, end } = {}) {
  const normalized = [];
  if (start) {
    normalized.push({ latitude: start.latitude, longitude: start.longitude });
  }
  points.forEach((point) => {
    if (!point) {
      return;
    }
    normalized.push({
      latitude: point.latitude,
      longitude: point.longitude,
    });
  });
  if (end) {
    normalized.push({ latitude: end.latitude, longitude: end.longitude });
  }
  return normalized;
}

function request({ url, method = 'GET', data }) {
  if (typeof wx === 'undefined' || typeof wx.request !== 'function') {
    return Promise.reject(new Error('wx.request is not available'));
  }
  return new Promise((resolve, reject) => {
    wx.request({
      url,
      method,
      data,
      timeout: 10000,
      header: {
        'Content-Type': 'application/json',
      },
      success: (res) => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(res.data);
          return;
        }
        const error = new Error(`Route service responded with ${res.statusCode}`);
        error.statusCode = res.statusCode;
        error.response = res.data;
        reject(error);
      },
      fail: (err) => reject(err),
    });
  });
}

function fetchWalkingRoute({ origin, destination, key }) {
  const url = `https://restapi.amap.com/v3/direction/walking?key=${encodeURIComponent(key)}&origin=${encodeURIComponent(
    origin
  )}&destination=${encodeURIComponent(destination)}`;
  return request({ url }).then((res) => {
    const steps = res?.route?.paths?.[0]?.steps || [];
    if (!steps.length) {
      return [];
    }
    return steps.flatMap((step) => parsePolyline(step.polyline));
  });
}

function fetchCyclingRoute({ origin, destination, key }) {
  const url = `https://restapi.amap.com/v4/direction/bicycling?key=${encodeURIComponent(
    key
  )}&origin=${encodeURIComponent(origin)}&destination=${encodeURIComponent(destination)}`;
  return request({ url }).then((res) => {
    const steps = res?.data?.paths?.[0]?.steps || [];
    if (!steps.length) {
      return [];
    }
    return steps.flatMap((step) => parsePolyline(step.polyline));
  });
}

function buildStraightLine({ start, end }) {
  if (!start || !end) {
    return [];
  }
  const steps = 5;
  const points = [];
  for (let index = 1; index < steps; index += 1) {
    const ratio = index / steps;
    points.push({
      latitude: start.latitude + (end.latitude - start.latitude) * ratio,
      longitude: start.longitude + (end.longitude - start.longitude) * ratio,
    });
  }
  return points;
}

function buildGapPath({ start, end, mode = 'walk' } = {}) {
  if (!start || !end) {
    return Promise.resolve([]);
  }
  const key = config?.map?.amapWebKey || config?.amapWebKey || '';
  if (!key) {
    logger.warn('Amap key is not configured, using straight line for interpolation');
    return Promise.resolve(normalizePath(buildStraightLine({ start, end }), { start, end }));
  }
  const origin = `${Number(start.longitude)},${Number(start.latitude)}`;
  const destination = `${Number(end.longitude)},${Number(end.latitude)}`;
  const fetcher = mode === 'ride' ? fetchCyclingRoute : fetchWalkingRoute;
  return fetcher({ origin, destination, key })
    .then((polyline) => {
      if (!Array.isArray(polyline) || !polyline.length) {
        logger.warn('Route service returned empty polyline, fallback to straight line');
        return normalizePath(buildStraightLine({ start, end }), { start, end });
      }
      return normalizePath(polyline, { start, end });
    })
    .catch((error) => {
      logger.warn('Route interpolation failed, fallback to straight line', error?.errMsg || error?.message || error);
      return normalizePath(buildStraightLine({ start, end }), { start, end });
    });
}

/**
 * Fetch ALL alternative walking paths from Amap API for route comparison.
 * Returns an array of path objects: { points, distance, duration }.
 */
function fetchAllWalkingPaths({ origin, destination, key }) {
  const url = `https://restapi.amap.com/v3/direction/walking?key=${encodeURIComponent(key)}&origin=${encodeURIComponent(
    origin
  )}&destination=${encodeURIComponent(destination)}`;
  return request({ url }).then((res) => {
    const paths = res?.route?.paths || [];
    return paths.map((path) => {
      const steps = path.steps || [];
      const points = steps.flatMap((step) => parsePolyline(step.polyline));
      return {
        points,
        distance: Number(path.distance) || 0,
        duration: Number(path.duration) || 0,
      };
    }).filter((p) => p.points.length > 0);
  });
}

/**
 * Fetch ALL alternative cycling paths from Amap API for route comparison.
 */
function fetchAllCyclingPaths({ origin, destination, key }) {
  const url = `https://restapi.amap.com/v4/direction/bicycling?key=${encodeURIComponent(
    key
  )}&origin=${encodeURIComponent(origin)}&destination=${encodeURIComponent(destination)}`;
  return request({ url }).then((res) => {
    const paths = res?.data?.paths || [];
    return paths.map((path) => {
      const steps = path.steps || [];
      const points = steps.flatMap((step) => parsePolyline(step.polyline));
      return {
        points,
        distance: Number(path.distance) || 0,
        duration: Number(path.duration) || 0,
      };
    }).filter((p) => p.points.length > 0);
  });
}

/**
 * Fetch alternative routes between start and end for display in the feedback wizard.
 * Preferred path: call cloud API so the AMap key stays on the server.
 * Fallback path: direct client AMap request for backward compatibility.
 * Returns { alternatives: [{ points, distance, duration, title, strategy }] }.
 */
function fetchAlternativeRoutes({ start, end, mode = 'walk', actualPoints = [], distanceMeters = 0, durationMs = 0 } = {}) {
  if (!start || !end) {
    return Promise.resolve({ alternatives: [] });
  }

  const cloudRequest = api && typeof api.getRouteRecommendations === 'function'
    ? api.getRouteRecommendations({
        start,
        end,
        actualPoints,
        distanceMeters,
        durationMs,
        mode,
      })
        .then((res) => {
          const recommendations = Array.isArray(res?.recommendations) ? res.recommendations : [];
          const alternatives = recommendations
            .filter((item) => !item?.isActual)
            .map((item) => ({
              points: normalizePath(Array.isArray(item.polyline) ? item.polyline : [], { start, end }),
              distance: Number(item.distanceMeters || item.distance) || 0,
              duration: Number(item.durationSeconds || item.duration) || 0,
              title: item.title || '',
              strategy: item.strategy || item.scoreHint || '',
            }))
            .filter((item) => Array.isArray(item.points) && item.points.length > 1);
          return { alternatives };
        })
    : Promise.reject(new Error('Cloud route recommendations unavailable'));

  return cloudRequest.catch((cloudError) => {
    logger.warn('Cloud alternative routes failed, falling back to direct AMap', cloudError?.errMsg || cloudError?.message || cloudError);
    const key = config?.map?.amapWebKey || config?.amapWebKey || '';
    if (!key) {
      logger.warn('Amap key is not configured, cannot fetch alternative routes');
      return { alternatives: [] };
    }
    const origin = `${Number(start.longitude)},${Number(start.latitude)}`;
    const destination = `${Number(end.longitude)},${Number(end.latitude)}`;
    const fetcher = mode === 'ride' ? fetchAllCyclingPaths : fetchAllWalkingPaths;
    return fetcher({ origin, destination, key })
      .then((paths) => ({
        alternatives: paths.map((p) => ({
          points: normalizePath(p.points, { start, end }),
          distance: p.distance,
          duration: p.duration,
          title: '',
          strategy: mode,
        })),
      }))
      .catch((error) => {
        logger.warn('fetchAlternativeRoutes failed', error?.errMsg || error?.message || error);
        return { alternatives: [] };
      });
  });
}

module.exports = {
  buildGapPath,
  fetchAlternativeRoutes,
};
