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
  return safeGet(STORAGE_KEYS.OFFLINE_QUEUE, []);
}

function enqueueOfflineFragment(fragment) {
  const queue = getOfflineQueue();
  queue.push({
    ...fragment,
    timestamp: fragment.timestamp || Date.now(),
  });
  safeSet(STORAGE_KEYS.OFFLINE_QUEUE, queue);
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

module.exports = {
  getRoutes,
  saveRoute,
  updateRoute,
  removeRoute,
  getOfflineQueue,
  enqueueOfflineFragment,
  clearOfflineQueue,
  getRecentSettings,
  saveRecentSettings,
};
