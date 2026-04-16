const config = require('../config/saaa-config');
const logger = require('../utils/logger');
const auth = require('./auth');
const { STORAGE_KEYS } = require('../constants/storage');
const { getLocalWeatherSnapshot } = require('./weather-local');

const DEFAULT_TIMEOUT = config.api?.timeout || 15000;
const DEFAULT_RETRIES = typeof config.api?.retries === 'number' ? config.api.retries : 1;
const WEATHER_CACHE_TTL = 30 * 60 * 1000;
const WEATHER_CACHE_KEY = STORAGE_KEYS.WEATHER_SNAPSHOT || 'ROUTE_LAB_WEATHER_SNAPSHOT';

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function shouldRetry(error) {
  if (!error) {
    return false;
  }
  if (typeof error.statusCode === 'number') {
    return error.statusCode >= 500 || error.statusCode === 408;
  }
  const errMsg = (error.errMsg || error.message || '').toLowerCase();
  return errMsg.includes('timeout') || errMsg.includes('fail');
}

function request({
  path,
  method = 'GET',
  data,
  header = {},
  timeout = DEFAULT_TIMEOUT,
  retries = DEFAULT_RETRIES,
  requiresAuth = true,
} = {}) {
  const url = auth.buildUrl(path);
  if (!url) {
    return Promise.reject(new Error('Cloud API base URL is not configured'));
  }

  const maxAttempts = Math.max(1, Number(retries) + 1);

  const execute = (attempt = 1, retryAuth = true) =>
    new Promise((resolve, reject) => {
      const headers = {
        'Content-Type': 'application/json; charset=utf-8',
        ...header,
      };
      if (requiresAuth) {
        const token = auth.getToken();
        if (token) {
          headers.Authorization = auth.getAuthorizationHeader();
        }
      }
      wx.request({
        url,
        method,
        data,
        header: headers,
        timeout,
        success: (res) => {
          const statusCode = res.statusCode || 0;
          if (statusCode >= 200 && statusCode < 300) {
            resolve(res.data);
            return;
          }
          const error = new Error(`Request failed with status ${statusCode}`);
          error.statusCode = statusCode;
          error.response = res.data;
          reject(error);
        },
        fail: (err) => reject(err),
      });
    }).catch((error) => {
      if (requiresAuth && error && error.statusCode === 401 && retryAuth) {
        return auth
          .refreshToken()
          .then(() => execute(attempt, false))
          .catch((refreshError) => {
            throw refreshError;
          });
      }
      if (attempt < maxAttempts && shouldRetry(error)) {
        return delay(400 * attempt).then(() => execute(attempt + 1, retryAuth));
      }
      throw error;
    });

  const prepare = requiresAuth ? auth.ensureLogin() : Promise.resolve();

  return prepare
    .then(() => execute())
    .catch((error) => {
      logger.warn('Cloud API request failed', {
        url,
        method,
        message: error?.errMsg || error?.message || error,
      });
      throw error;
    });
}

function buildQueryString(query = {}) {
  const keys = Object.keys(query).filter(
    (key) => query[key] !== undefined && query[key] !== null && query[key] !== ''
  );
  if (!keys.length) {
    return '';
  }
  return `?${keys.map((key) => `${encodeURIComponent(key)}=${encodeURIComponent(query[key])}`).join('&')}`;
}

function safeReadStorage(key) {
  if (typeof wx === 'undefined' || typeof wx.getStorageSync !== 'function') {
    return null;
  }
  try {
    const value = wx.getStorageSync(key);
    if (value && typeof value === 'object') {
      return { ...value };
    }
    return value || null;
  } catch (error) {
    logger.warn('Weather cache read failed', {
      key,
      message: error?.errMsg || error?.message || error,
    });
    return null;
  }
}

function safeWriteStorage(key, value) {
  if (typeof wx === 'undefined' || typeof wx.setStorageSync !== 'function') {
    return;
  }
  try {
    wx.setStorageSync(key, value);
  } catch (error) {
    logger.warn('Weather cache write failed', {
      key,
      message: error?.errMsg || error?.message || error,
    });
  }
}

function readWeatherCache() {
  const cached = safeReadStorage(WEATHER_CACHE_KEY);
  if (!cached || typeof cached !== 'object') {
    return null;
  }
  const fetchedAt = Number(cached.fetchedAt);
  if (!Number.isFinite(fetchedAt)) {
    return null;
  }
  if (Date.now() - fetchedAt > WEATHER_CACHE_TTL) {
    return null;
  }
  return { ...cached };
}

function writeWeatherCache(payload) {
  if (!payload || typeof payload !== 'object') {
    return;
  }
  const { fromCache, ...rest } = payload;
  const fetchedAt = Number(rest.fetchedAt);
  const normalized = {
    ...rest,
    fetchedAt: Number.isFinite(fetchedAt) ? fetchedAt : Date.now(),
  };
  safeWriteStorage(WEATHER_CACHE_KEY, normalized);
}

function normalizeWeatherPayload(payload, source, coordinates = {}) {
  if (!payload || typeof payload !== 'object') {
    throw new Error('Invalid weather payload');
  }
  const weather = payload.weather && typeof payload.weather === 'object' ? payload.weather : null;
  const air = payload.air && typeof payload.air === 'object' ? payload.air : null;
  const suggestion = typeof payload.suggestion === 'string' ? payload.suggestion : '';
  const fetchedAtCandidate = Number(payload.fetchedAt ?? weather?.fetchedAt ?? air?.fetchedAt);
  const latitude =
    payload.latitude ?? weather?.latitude ?? coordinates.latitude;
  const longitude =
    payload.longitude ?? weather?.longitude ?? coordinates.longitude;

  if (!weather && !air) {
    return {
      ...payload,
      latitude,
      longitude,
      fetchedAt: Number.isFinite(fetchedAtCandidate) ? fetchedAtCandidate : Date.now(),
      source: payload.source || source,
    };
  }

  const weatherCode = weather?.weatherCode ?? weather?.code ?? payload.weatherCode ?? null;
  const weatherText = weather?.weatherText ?? weather?.text ?? payload.weatherText ?? '';
  const temperature = weather?.temperature ?? payload.temperature ?? null;
  const apparentTemperature = weather?.apparentTemperature ?? payload.apparentTemperature ?? null;
  const humidity = weather?.humidity ?? payload.humidity ?? null;
  const windSpeed = weather?.windSpeed ?? payload.windSpeed ?? payload.wind?.speed ?? null;
  const windDirection = weather?.windDirection ?? payload.windDirection ?? null;
  const windDirectionText = weather?.windDirectionText ?? payload.windDirectionText ?? null;
  const airQuality = air || payload.airQuality || null;

  return {
    ...payload,
    weatherCode,
    weatherText,
    temperature,
    apparentTemperature,
    humidity,
    windSpeed,
    windDirection,
    windDirectionText,
    wind: {
      ...(payload.wind && typeof payload.wind === 'object' ? payload.wind : {}),
      speed: windSpeed,
      direction: windDirection,
      directionText: windDirectionText,
      unit:
        payload.wind?.unit || weather?.windUnit || 'm/s',
    },
    airQuality:
      airQuality && typeof airQuality === 'object'
        ? {
            ...airQuality,
            value: airQuality.value ?? airQuality.aqi ?? null,
          }
        : null,
    suggestion,
    latitude,
    longitude,
    fetchedAt: Number.isFinite(fetchedAtCandidate) ? fetchedAtCandidate : Date.now(),
    source: payload.source || weather?.source || source,
  };
}

function upsertRoute(route) {
  if (!route?.id) {
    return Promise.reject(new Error('Route id is required'));
  }
  return request({
    path: `/routes/${route.id}`,
    method: 'PUT',
    data: route,
  });
}

function createRoute(route = {}) {
  if (!route || typeof route !== 'object') {
    return Promise.reject(new Error('Route payload is required'));
  }
  return request({
    path: '/routes',
    method: 'POST',
    data: route,
  });
}

function listRoutes(query = {}) {
  return request({
    path: `/routes${buildQueryString(query)}`,
    method: 'GET',
  });
}

function syncRoutes(payload = {}) {
  return request({
    path: '/routes/sync',
    method: 'POST',
    data: payload,
  });
}

function patchRoute(id, patch = {}) {
  if (!id) {
    return Promise.reject(new Error('Route id is required'));
  }
  return request({
    path: `/routes/${id}`,
    method: 'PATCH',
    data: patch,
  });
}

function removeRoute(id) {
  if (!id) {
    return Promise.reject(new Error('Route id is required'));
  }
  return request({
    path: `/routes/${id}`,
    method: 'DELETE',
  });
}

function likeRoute(id) {
  if (!id) {
    return Promise.reject(new Error('Route id is required'));
  }
  return request({
    path: `/routes/${id}/likes`,
    method: 'POST',
  });
}

function unlikeRoute(id) {
  if (!id) {
    return Promise.reject(new Error('Route id is required'));
  }
  return request({
    path: `/routes/${id}/likes`,
    method: 'DELETE',
  });
}

function createRouteComment(id, content) {
  if (!id) {
    return Promise.reject(new Error('Route id is required'));
  }
  if (!content || typeof content !== 'string') {
    return Promise.reject(new Error('Comment content is required'));
  }
  return request({
    path: `/routes/${id}/comments`,
    method: 'POST',
    data: { content },
  });
}

function listRouteComments(id) {
  if (!id) {
    return Promise.reject(new Error('Route id is required'));
  }
  return request({
    path: `/routes/${id}/comments`,
    method: 'GET',
  });
}

function createRouteCommentReply(routeId, commentId, content) {
  if (!routeId) {
    return Promise.reject(new Error('Route id is required'));
  }
  if (!commentId) {
    return Promise.reject(new Error('Comment id is required'));
  }
  if (!content || typeof content !== 'string') {
    return Promise.reject(new Error('Reply content is required'));
  }
  return request({
    path: `/routes/${routeId}/comments/${commentId}/replies`,
    method: 'POST',
    data: { content },
  });
}

function likeRouteComment(commentId) {
  if (!commentId) {
    return Promise.reject(new Error('Comment id is required'));
  }
  return request({
    path: `/comments/${commentId}/likes`,
    method: 'POST',
  });
}

function unlikeRouteComment(commentId) {
  if (!commentId) {
    return Promise.reject(new Error('Comment id is required'));
  }
  return request({
    path: `/comments/${commentId}/likes`,
    method: 'DELETE',
  });
}

function deleteRouteComment(commentId, options = {}) {
  if (!commentId) {
    return Promise.reject(new Error('Comment id is required'));
  }
  const query = buildQueryString(
    options && options.hard ? { hard: 1 } : {}
  );
  const suffix = query ? query : '';
  return request({
    path: `/comments/${commentId}${suffix}`,
    method: 'DELETE',
  });
}

function listPublicRoutes(query = {}) {
  return request({
    path: `/routes/public${buildQueryString(query)}`,
    method: 'GET',
  });
}

function getWeatherSnapshot({ latitude, longitude } = {}) {
  if (latitude === undefined || longitude === undefined) {
    return Promise.reject(new Error('Latitude and longitude are required'));
  }
  return request({
    path: `/weather${buildQueryString({ lat: latitude, lon: longitude })}`,
    method: 'GET',
  });
}

function getWeatherSnapshotSafe({ latitude, longitude } = {}) {
  if (latitude === undefined || longitude === undefined) {
    return Promise.reject(new Error('Latitude and longitude are required'));
  }
  const coordinates = { latitude, longitude };
  return getWeatherSnapshot(coordinates)
    .then((payload) => {
      const normalized = normalizeWeatherPayload(payload, 'cloud', coordinates);
      writeWeatherCache(normalized);
      return normalized;
    })
    .catch((cloudError) => {
      logger.warn('Cloud weather snapshot failed, attempting local fallback', {
        message: cloudError?.errMsg || cloudError?.message || cloudError,
      });
      return getLocalWeatherSnapshot(coordinates)
        .then((payload) => {
          const normalized = normalizeWeatherPayload(payload, payload?.source || 'local', coordinates);
          writeWeatherCache(normalized);
          return normalized;
        })
        .catch((localError) => {
          logger.warn('Local weather snapshot failed', {
            message: localError?.errMsg || localError?.message || localError,
          });
          const cached = readWeatherCache();
          if (cached) {
            return {
              ...cached,
              fromCache: true,
            };
          }
          const error = new Error('Unable to fetch weather data from cloud or local services');
          error.cloudError = cloudError;
          error.localError = localError;
          throw error;
        });
    });
}

function reverseGeocode({ latitude, longitude } = {}) {
  if (latitude === undefined || longitude === undefined) {
    return Promise.reject(new Error('Latitude and longitude are required'));
  }
  return request({
    path: `/geocode/reverse${buildQueryString({ lat: latitude, lon: longitude })}`,
    method: 'GET',
  });
}

function geocodeRegeo({ latitude, longitude, radius, extensions } = {}) {
  if (latitude === undefined || longitude === undefined) {
    return Promise.reject(new Error('Latitude and longitude are required'));
  }
  const query = {
    lat: latitude,
    lon: longitude,
  };
  if (radius !== undefined) {
    query.radius = radius;
  }
  if (extensions) {
    query.extensions = extensions;
  }
  return request({
    path: `/geocode/regeo${buildQueryString(query)}`,
    method: 'GET',
  });
}

function geocodeAround({ latitude, longitude, radius, types, keywords, sortrule, offset } = {}) {
  if (latitude === undefined || longitude === undefined) {
    return Promise.reject(new Error('Latitude and longitude are required'));
  }
  const query = {
    lat: latitude,
    lon: longitude,
  };
  if (radius !== undefined) {
    query.radius = radius;
  }
  if (types) {
    query.types = types;
  }
  if (keywords) {
    query.keywords = keywords;
  }
  if (sortrule) {
    query.sortrule = sortrule;
  }
  if (offset !== undefined) {
    query.offset = offset;
  }
  return request({
    path: `/geocode/around${buildQueryString(query)}`,
    method: 'GET',
  });
}

function getRouteById(id) {
  if (!id) {
    return Promise.reject(new Error('Route id is required'));
  }
  return request({
    path: `/routes/${id}`,
    method: 'GET',
  });
}

function getLatestAnnouncement() {
  return request({
    path: '/announcements/latest',
    method: 'GET',
  });
}

function updateUserProfile({
  nickname,
  avatarUrl,
  code,
  gender,
  ageRange,
  identity,
  birthday,
  height,
  weight,
} = {}) {
  const payload = {};
  if (typeof nickname === 'string') {
    payload.nickname = nickname.trim();
  }
  if (typeof avatarUrl === 'string') {
    payload.avatarUrl = avatarUrl.trim();
  }
  if (typeof code === 'string' && code.trim()) {
    payload.code = code.trim();
  }
  if (typeof gender === 'string' && gender.trim()) {
    payload.gender = gender.trim();
  }
  if (typeof ageRange === 'string' && ageRange.trim()) {
    payload.ageRange = ageRange.trim();
  }
  if (typeof identity === 'string' && identity.trim()) {
    payload.identity = identity.trim();
  }
  if (typeof birthday === 'string' && birthday.trim()) {
    payload.birthday = birthday.trim();
  }
  if (height !== undefined && height !== null && height !== '') {
    const heightNumeric = Number(height);
    if (Number.isFinite(heightNumeric) && heightNumeric > 0) {
      payload.height = heightNumeric;
    }
  }
  if (weight !== undefined && weight !== null && weight !== '') {
    const weightNumeric = Number(weight);
    if (Number.isFinite(weightNumeric) && weightNumeric > 0) {
      payload.weight = weightNumeric;
    }
  }
  return request({
    path: '/user/profile',
    method: 'POST',
    data: payload,
  });
}

function getUserSettings() {
  return request({
    path: '/user/settings',
    method: 'GET',
  });
}

function saveUserSettings(settings = {}) {
  const payload = {};
  if (typeof settings.privacyLevel === 'string') {
    payload.privacyLevel = settings.privacyLevel.trim();
  }
  if (settings.weight !== undefined && settings.weight !== null && settings.weight !== '') {
    const numeric = Number(settings.weight);
    if (Number.isFinite(numeric) && numeric > 0) {
      payload.weight = numeric;
    }
  }
  if (settings.autoSync !== undefined) {
    payload.autoSync = Boolean(settings.autoSync);
  }
  if (settings.keepScreenPreferred !== undefined) {
    payload.keepScreenPreferred = Boolean(settings.keepScreenPreferred);
  }
  return request({
    path: '/user/settings',
    method: 'POST',
    data: payload,
  });
}

function getUserAchievements() {
  return request({
    path: '/user/achievements',
    method: 'GET',
  });
}

function saveUserAchievements(stats = {}) {
  const payload = {};
  if (Number.isFinite(Number(stats.totalPoints))) {
    payload.totalPoints = Number(stats.totalPoints);
  }
  if (typeof stats.currentBadge === 'string') {
    payload.currentBadge = stats.currentBadge.trim();
  }
  if (stats.routeHistory && typeof stats.routeHistory === 'object') {
    payload.routeHistory = stats.routeHistory;
  }
  return request({
    path: '/user/achievements',
    method: 'POST',
    data: payload,
  });
}

function getActiveAnnouncements() {
  return request({
    path: '/announcements/active',
    method: 'GET',
  });
}

function getPowercxSurveyStatus() {
  return request({
    path: '/user/surveys/powercx/status',
    method: 'GET',
  });
}

function createPowercxSurveySession({ source } = {}) {
  const payload = {};
  if (typeof source === 'string' && source.trim()) {
    payload.source = source.trim();
  }
  return request({
    path: '/user/surveys/powercx/session',
    method: 'POST',
    data: payload,
  });
}

function submitFeedbackTicket({ category, title, content, contact } = {}) {
  const payload = {};
  if (typeof category === 'string') {
    payload.category = category.trim();
  }
  if (typeof title === 'string') {
    payload.title = title.trim();
  }
  if (typeof content === 'string') {
    payload.content = content.trim();
  }
  if (typeof contact === 'string') {
    payload.contact = contact.trim();
  }
  return request({
    path: '/feedback',
    method: 'POST',
    data: payload,
  });
}

// Safe reverse geocoding with local fallbacks and normalization
function reverseGeocodeSafe({ latitude, longitude } = {}) {
  if (latitude === undefined || longitude === undefined) {
    return Promise.reject(new Error('Latitude and longitude are required'));
  }
  const coords = { latitude, longitude };

  // The mini-program location and map rendering chain use GCJ-02.
  // Cloud /api/geocode/reverse prefers AMap, which also expects GCJ-02.
  // So keep the original coordinates for cloud reverse geocoding.
  // Only local OSM fallbacks should convert to WGS84 internally when needed.
  return reverseGeocode(coords)
    .catch((cloudError) => {
      logger.warn('Cloud reverse geocode failed, using local fallbacks', {
        message: cloudError?.errMsg || cloudError?.message || cloudError,
      });
      const geocodeLocal = require('./geocode-local');
      return geocodeLocal.reverseGeocodeFallback(coords);
    })
    .then((res) => {
      if (!res) {
        const lat = Number(latitude).toFixed(4);
        const lon = Number(longitude).toFixed(4);
        return {
          name: `坐标 · ${lat},${lon}`,
          displayName: `坐标 · ${lat},${lon}`,
          address: null,
          raw: null,
        };
      }
      return {
        name: res.name || res.displayName || '',
        displayName: res.displayName || res.name || '',
        address: res.address || null,
        raw: res.raw || res,
        city: res.city || res.province || '',
      };
    });
}

module.exports = {
  request,
  getBaseUrl: auth.getBaseUrl,
  buildUrl: auth.buildUrl,
  upsertRoute,
  createRoute,
  listRoutes,
  syncRoutes,
  patchRoute,
  removeRoute,
  likeRoute,
  unlikeRoute,
  createRouteComment,
  listRouteComments,
  createRouteCommentReply,
  likeRouteComment,
  unlikeRouteComment,
  deleteRouteComment,
  listPublicRoutes,
  getWeatherSnapshot,
  getWeatherSnapshotSafe,
  reverseGeocode,
  geocodeRegeo,
  geocodeAround,
  reverseGeocodeSafe,
  getRouteById,
  getLatestAnnouncement,
  getActiveAnnouncements,
  getPowercxSurveyStatus,
  createPowercxSurveySession,
  submitFeedbackTicket,
  updateUserProfile,
  getUserSettings,
  saveUserSettings,
  getUserAchievements,
  saveUserAchievements,
};
