const { STORAGE_KEYS } = require('../constants/storage');

const MEMORY_CACHE = {
  map: {},
  ts: 0,
};

function readStore() {
  try {
    const obj = wx.getStorageSync(STORAGE_KEYS.GEOCODE_CACHE) || {};
    if (obj && typeof obj === 'object') {
      return obj;
    }
  } catch (_) {}
  return {};
}

function writeStore(data) {
  try {
    wx.setStorageSync(STORAGE_KEYS.GEOCODE_CACHE, data || {});
  } catch (_) {}
}

function ensureMemory() {
  if (!MEMORY_CACHE.ts) {
    MEMORY_CACHE.map = readStore();
    MEMORY_CACHE.ts = Date.now();
  }
}

function makeCellKey(latitude, longitude, cellSizeDeg = 0.002) {
  const lat = Number(latitude);
  const lon = Number(longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return '';
  }
  const factor = 1 / cellSizeDeg; // e.g., 0.002 -> 500
  const keyLat = Math.round(lat * factor) / factor;
  const keyLon = Math.round(lon * factor) / factor;
  return `${keyLat.toFixed(3)},${keyLon.toFixed(3)}`;
}

function get(key, ttlMs = 90 * 1000) {
  if (!key) return null;
  ensureMemory();
  const entry = MEMORY_CACHE.map[key];
  if (!entry) return null;
  const ts = Number(entry.ts) || 0;
  if (ts && Date.now() - ts <= ttlMs) {
    return entry.value;
  }
  return null;
}

function set(key, value) {
  if (!key) return;
  ensureMemory();
  MEMORY_CACHE.map[key] = { value, ts: Date.now() };
  writeStore(MEMORY_CACHE.map);
}

module.exports = {
  makeCellKey,
  get,
  set,
};

