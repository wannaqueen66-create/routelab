const { STORAGE_KEYS } = require('../constants/storage');

function safeGet(key, defaultValue) {
  try {
    const value = wx.getStorageSync(key);
    if (value === undefined || value === null) {
      return defaultValue;
    }
    return value;
  } catch (err) {
    console.warn('RouteLab: read storage failed', key, err);
    return defaultValue;
  }
}

function safeSet(key, value) {
  try {
    wx.setStorageSync(key, value);
  } catch (err) {
    console.warn('RouteLab: write storage failed', key, err);
  }
}

function getRoutes() {
  const routes = safeGet(STORAGE_KEYS.ROUTES, []);
  if (!Array.isArray(routes)) {
    return [];
  }
  return routes.sort((a, b) => (b.startTime || 0) - (a.startTime || 0));
}

function saveRoute(route) {
  if (!route || !route.id) {
    throw new Error('RouteLab: invalid route data');
  }
  const routes = getRoutes();
  const index = routes.findIndex((item) => item.id === route.id);
  if (index >= 0) {
    routes.splice(index, 1, route);
  } else {
    routes.unshift(route);
  }
  safeSet(STORAGE_KEYS.ROUTES, routes);
  return route;
}

function setRoutes(routes = []) {
  const normalized = Array.isArray(routes) ? routes : [];
  safeSet(STORAGE_KEYS.ROUTES, normalized);
  return getRoutes();
}

function updateRoute(id, patch = {}) {
  const routes = getRoutes();
  const index = routes.findIndex((item) => item.id === id);
  if (index < 0) {
    return null;
  }
  const updated = {
    ...routes[index],
    ...patch,
  };
  routes.splice(index, 1, updated);
  safeSet(STORAGE_KEYS.ROUTES, routes);
  return updated;
}

function removeRoute(id) {
  const routes = getRoutes().filter((route) => route.id !== id);
  safeSet(STORAGE_KEYS.ROUTES, routes);
  return routes;
}

function getOfflineQueue() {
  const queue = safeGet(STORAGE_KEYS.OFFLINE_QUEUE, []);
  return Array.isArray(queue) ? queue : [];
}

function enqueueOfflineFragment(fragment) {
  const queue = getOfflineQueue();
  const nextQueue = Array.isArray(queue) ? [...queue] : [];
  nextQueue.push({
    ...fragment,
    timestamp: fragment.timestamp || Date.now(),
  });
  safeSet(STORAGE_KEYS.OFFLINE_QUEUE, nextQueue);
}

function clearOfflineQueue() {
  safeSet(STORAGE_KEYS.OFFLINE_QUEUE, []);
}

function getRecentSettings() {
  return safeGet(STORAGE_KEYS.RECENT_SETTINGS, {});
}

function saveRecentSettings(settings = {}) {
  safeSet(STORAGE_KEYS.RECENT_SETTINGS, settings);
  return settings;
}

function getKeepScreenPreference() {
  return safeGet(STORAGE_KEYS.KEEP_SCREEN_ON, false) === true;
}

function setKeepScreenPreference(value) {
  const normalized = !!value;
  safeSet(STORAGE_KEYS.KEEP_SCREEN_ON, normalized);
  return normalized;
}

function getUserProfile() {
  const profile = safeGet(STORAGE_KEYS.USER_PROFILE, null);
  if (!profile || typeof profile !== 'object') {
    return null;
  }
  const nickname =
    typeof profile.nickname === 'string'
      ? profile.nickname.trim()
      : typeof profile.nickName === 'string'
      ? profile.nickName.trim()
      : '';
  const avatarUrl =
    typeof profile.avatarUrl === 'string'
      ? profile.avatarUrl
      : typeof profile.avatar === 'string'
      ? profile.avatar
      : '';
  const gender = typeof profile.gender === 'string' ? profile.gender.trim() : '';
  const ageRange = typeof profile.ageRange === 'string' ? profile.ageRange.trim() : '';
  const identity = typeof profile.identity === 'string' ? profile.identity.trim() : '';
  const birthday = typeof profile.birthday === 'string' ? profile.birthday.trim() : '';
  const height =
    profile.height !== undefined && profile.height !== null && profile.height !== ''
      ? String(profile.height).trim()
      : '';
  const weight =
    profile.weight !== undefined && profile.weight !== null && profile.weight !== ''
      ? String(profile.weight).trim()
      : '';
  if (
    !nickname &&
    !avatarUrl &&
    !gender &&
    !ageRange &&
    !identity &&
    !birthday &&
    !height &&
    !weight
  ) {
    return null;
  }
  return {
    nickname,
    avatarUrl,
    gender,
    ageRange,
    identity,
    birthday,
    height,
    weight,
  };
}

function saveUserProfile(profile = null) {
  if (!profile || typeof profile !== 'object') {
    safeSet(STORAGE_KEYS.USER_PROFILE, null);
    return null;
  }
  const nickname =
    typeof profile.nickname === 'string'
      ? profile.nickname.trim()
      : typeof profile.nickName === 'string'
      ? profile.nickName.trim()
      : '';
  const avatarUrl =
    typeof profile.avatarUrl === 'string'
      ? profile.avatarUrl
      : typeof profile.avatar === 'string'
      ? profile.avatar
      : '';
  const gender = typeof profile.gender === 'string' ? profile.gender.trim() : '';
  const ageRange = typeof profile.ageRange === 'string' ? profile.ageRange.trim() : '';
  const identity = typeof profile.identity === 'string' ? profile.identity.trim() : '';
  const birthday = typeof profile.birthday === 'string' ? profile.birthday.trim() : '';
  const height =
    profile.height !== undefined && profile.height !== null && profile.height !== ''
      ? String(profile.height).trim()
      : '';
  const weight =
    profile.weight !== undefined && profile.weight !== null && profile.weight !== ''
      ? String(profile.weight).trim()
      : '';
  const payload = {
    nickname,
    avatarUrl,
    gender,
    ageRange,
    identity,
    birthday,
    height,
    weight,
  };
  safeSet(STORAGE_KEYS.USER_PROFILE, payload);
  return getUserProfile();
}

function normalizeAccount(account = null) {
  if (!account || typeof account !== 'object') {
    return null;
  }
  const id = Number(account.id);
  return {
    id: Number.isFinite(id) ? id : null,
    openid: account.openid || '',
    unionid: account.unionid || '',
    nickname: account.nickname || '',
    avatar: account.avatar || '',
    gender: typeof account.gender === 'string' ? account.gender.trim() : '',
    ageRange: typeof account.ageRange === 'string' ? account.ageRange.trim() : '',
    identity: typeof account.identity === 'string' ? account.identity.trim() : '',
  };
}

function getUserAccount() {
  const stored = safeGet(STORAGE_KEYS.USER_ACCOUNT, null);
  if (!stored || typeof stored !== 'object') {
    return null;
  }
  return normalizeAccount(stored);
}

function saveUserAccount(account = null) {
  const normalized = normalizeAccount(account);
  safeSet(STORAGE_KEYS.USER_ACCOUNT, normalized);
  return normalized;
}

function clearUserAccount() {
  safeSet(STORAGE_KEYS.USER_ACCOUNT, null);
}

function getAuthToken() {
  return safeGet(STORAGE_KEYS.AUTH_TOKEN, '');
}

function setAuthToken(token) {
  safeSet(STORAGE_KEYS.AUTH_TOKEN, token || '');
}

function clearAuthToken() {
  safeSet(STORAGE_KEYS.AUTH_TOKEN, '');
}

function getLastSyncTimestamp() {
  return Number(safeGet(STORAGE_KEYS.LAST_SYNC_AT, 0)) || 0;
}

function setLastSyncTimestamp(timestamp) {
  if (!timestamp) {
    safeSet(STORAGE_KEYS.LAST_SYNC_AT, 0);
    return 0;
  }
  safeSet(STORAGE_KEYS.LAST_SYNC_AT, Number(timestamp));
  return Number(timestamp);
}

function clearLastSyncTimestamp() {
  safeSet(STORAGE_KEYS.LAST_SYNC_AT, 0);
}

function getLatestSeenAnnouncement() {
  const stored = safeGet(STORAGE_KEYS.LATEST_ANNOUNCEMENT, null);
  if (!stored || typeof stored !== 'object') {
    return null;
  }
  const id = Number(stored.id);
  const seenAt = Number(stored.seenAt);
  if (!Number.isFinite(id) || id <= 0) {
    return null;
  }
  return {
    id,
    seenAt: Number.isFinite(seenAt) && seenAt > 0 ? seenAt : 0,
  };
}

function setLatestSeenAnnouncement(payload = null) {
  if (!payload || typeof payload !== 'object') {
    safeSet(STORAGE_KEYS.LATEST_ANNOUNCEMENT, null);
    return null;
  }
  const id = Number(payload.id);
  if (!Number.isFinite(id) || id <= 0) {
    safeSet(STORAGE_KEYS.LATEST_ANNOUNCEMENT, null);
    return null;
  }
  const seenAtCandidate = Number(payload.seenAt);
  const seenAt =
    Number.isFinite(seenAtCandidate) && seenAtCandidate > 0
      ? seenAtCandidate
      : Date.now();
  const value = { id, seenAt };
  safeSet(STORAGE_KEYS.LATEST_ANNOUNCEMENT, value);
  return value;
}

const ACHIEVEMENT_DEFAULTS = {
  totalPoints: 0,
  currentBadge: 'rookie',
  routeHistory: {},
};

function getAchievementStats() {
  const stored = safeGet(STORAGE_KEYS.USER_ACHIEVEMENTS, null);
  if (!stored || typeof stored !== 'object') {
    return { ...ACHIEVEMENT_DEFAULTS };
  }
  const totalPointsCandidate = Number(stored.totalPoints);
  const totalPoints =
    Number.isFinite(totalPointsCandidate) && totalPointsCandidate > 0
      ? Math.floor(totalPointsCandidate)
      : 0;
  const currentBadge =
    typeof stored.currentBadge === 'string' && stored.currentBadge.trim()
      ? stored.currentBadge.trim()
      : ACHIEVEMENT_DEFAULTS.currentBadge;
  const routeHistory =
    stored.routeHistory && typeof stored.routeHistory === 'object'
      ? { ...stored.routeHistory }
      : { ...ACHIEVEMENT_DEFAULTS.routeHistory };
  return {
    totalPoints,
    currentBadge,
    routeHistory,
  };
}

function saveAchievementStats(stats = {}) {
  const base = getAchievementStats();
  const totalPointsCandidate = Number(stats.totalPoints);
  const normalizedPoints =
    Number.isFinite(totalPointsCandidate) && totalPointsCandidate >= 0
      ? Math.floor(totalPointsCandidate)
      : base.totalPoints;
  const currentBadge =
    typeof stats.currentBadge === 'string' && stats.currentBadge.trim()
      ? stats.currentBadge.trim()
      : base.currentBadge;
  const historyPatch =
    stats.routeHistory && typeof stats.routeHistory === 'object'
      ? { ...stats.routeHistory }
      : null;
  const routeHistory = historyPatch ? { ...base.routeHistory, ...historyPatch } : base.routeHistory;
  const payload = {
    totalPoints: normalizedPoints,
    currentBadge,
    routeHistory,
    updatedAt: Date.now(),
  };
  safeSet(STORAGE_KEYS.USER_ACHIEVEMENTS, payload);
  return payload;
}

module.exports = {
  getRoutes,
  saveRoute,
  setRoutes,
  updateRoute,
  removeRoute,
  getOfflineQueue,
  enqueueOfflineFragment,
  clearOfflineQueue,
  getRecentSettings,
  saveRecentSettings,
  getKeepScreenPreference,
  setKeepScreenPreference,
  getUserProfile,
  saveUserProfile,
  getUserAccount,
  saveUserAccount,
  clearUserAccount,
  getAuthToken,
  setAuthToken,
  clearAuthToken,
  getLastSyncTimestamp,
  setLastSyncTimestamp,
  clearLastSyncTimestamp,
  getAchievementStats,
  saveAchievementStats,
  getLatestSeenAnnouncement,
  setLatestSeenAnnouncement,
};
