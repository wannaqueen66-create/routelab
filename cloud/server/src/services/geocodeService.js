/**
 * Geocode Service
 * Handles reverse geocoding via AMAP and OpenStreetMap (Nominatim)
 */

const fetch = require('node-fetch');
const {
    AMAP_WEB_KEY,
    AMAP_TIMEOUT_MS,
    GEOCODE_CACHE_TTL_MS,
    GEOCODE_CACHE_GRID_SIZE,
    GEOCODE_OSM_BASE_URL,
    GEOCODE_OSM_USER_AGENT,
    WEATHER_USER_AGENT
} = require('../config/index');

const {
    BUILDING_NAME_WHITELIST,
    FALLBACK_BUILDING_NAME_PRIORITY
} = require('../config/constants');

// In-memory geocode cache
const geocodeCache = new Map();

// Metrics for monitoring
const geocodeMetrics = {
    cacheHits: 0,
    cacheMisses: 0,
    amapRequests: 0,
    amapErrors: 0,
    lastResetAt: Date.now(),
    namingLevels: {
        building: 0,
        poi: 0,
        road: 0,
        district: 0,
        city: 0,
        unknown: 0,
    },
};

// === Cache Functions ===

function quantizeCoordinate(value) {
    if (!Number.isFinite(value)) {
        return null;
    }
    return Math.round(value / GEOCODE_CACHE_GRID_SIZE) * GEOCODE_CACHE_GRID_SIZE;
}

function buildGeocodeCacheKey(type, latitude, longitude, extra = '') {
    const latKey = quantizeCoordinate(latitude);
    const lonKey = quantizeCoordinate(longitude);
    if (latKey === null || lonKey === null) {
        return null;
    }
    const suffix = extra ? `:${extra}` : '';
    return `${type}:${latKey.toFixed(6)}:${lonKey.toFixed(6)}${suffix}`;
}

function getGeocodeCacheEntry(key) {
    if (!key) return null;
    const entry = geocodeCache.get(key);
    if (!entry) {
        geocodeMetrics.cacheMisses += 1;
        return null;
    }
    if (entry.expiresAt <= Date.now()) {
        geocodeCache.delete(key);
        geocodeMetrics.cacheMisses += 1;
        return null;
    }
    geocodeMetrics.cacheHits += 1;
    return entry.value;
}

function setGeocodeCacheEntry(key, value) {
    if (!key) return;
    geocodeCache.set(key, {
        value,
        expiresAt: Date.now() + GEOCODE_CACHE_TTL_MS,
    });
}

function pruneGeocodeCache() {
    const now = Date.now();
    geocodeCache.forEach((entry, key) => {
        if (!entry || entry.expiresAt <= now) {
            geocodeCache.delete(key);
        }
    });
}

// Auto-prune cache periodically
setInterval(pruneGeocodeCache, Math.max(GEOCODE_CACHE_TTL_MS, 60 * 1000)).unref();

// === AMAP Functions ===

function matchesBuildingWhitelist(text = '') {
    if (!text) return false;
    return BUILDING_NAME_WHITELIST.some((regex) => regex.test(text));
}

function deriveNamingLevelFromRegeo(payload) {
    if (!payload) {
        return 'unknown';
    }
    const regeocode = payload.regeocode || {};
    const aois = Array.isArray(regeocode.aois) ? regeocode.aois : [];
    const pois = Array.isArray(regeocode.pois) ? regeocode.pois : [];
    const roads = Array.isArray(regeocode.roads) ? regeocode.roads : [];
    const component = regeocode.addressComponent || {};

    const buildingCandidate =
        aois.find((item) => matchesBuildingWhitelist(item?.name || '')) ||
        pois.find((item) => matchesBuildingWhitelist(item?.name || '') || matchesBuildingWhitelist(item?.type || ''));

    if (buildingCandidate) {
        return 'building';
    }

    const poiCandidate =
        pois.find((item) => item && (item.name || item.type)) ||
        aois.find((item) => item && item.name);
    if (poiCandidate) {
        return 'poi';
    }

    if (roads.some((item) => item?.name)) {
        return 'road';
    }

    if (component.district || component.township) {
        return 'district';
    }

    if (component.city || component.province) {
        return 'city';
    }

    return 'unknown';
}

function trackNamingLevel(level) {
    const key = FALLBACK_BUILDING_NAME_PRIORITY.includes(level) ? level : 'unknown';
    geocodeMetrics.namingLevels[key] = (geocodeMetrics.namingLevels[key] || 0) + 1;
}

function buildAmapRequestUrl(base, params = {}) {
    const url = new URL(base);
    Object.entries(params).forEach(([key, value]) => {
        if (value === undefined || value === null || value === '') {
            return;
        }
        url.searchParams.set(key, value);
    });
    url.searchParams.set('key', AMAP_WEB_KEY);
    return url.toString();
}

async function executeAmapRequest(url) {
    geocodeMetrics.amapRequests += 1;
    let timeoutId;
    const timeoutPromise = new Promise((_, reject) => {
        timeoutId = setTimeout(() => {
            const error = new Error('AMap request timeout');
            error.statusCode = 504;
            geocodeMetrics.amapErrors += 1;
            reject(error);
        }, AMAP_TIMEOUT_MS);
    });
    const requestPromise = (async () => {
        const response = await fetch(url, {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
                'User-Agent': WEATHER_USER_AGENT,
            },
        });
        if (!response.ok) {
            const error = new Error(`AMap request failed with status ${response.status}`);
            error.statusCode = response.status;
            geocodeMetrics.amapErrors += 1;
            throw error;
        }
        const payload = await response.json();
        if (payload?.status !== '1') {
            const error = new Error(payload?.info || 'AMap API returned error');
            error.statusCode = 502;
            geocodeMetrics.amapErrors += 1;
            throw error;
        }
        return payload;
    })();
    try {
        return await Promise.race([requestPromise, timeoutPromise]);
    } finally {
        clearTimeout(timeoutId);
    }
}

async function fetchAmapRegeo({ latitude, longitude, radius = 60, extensions = 'all' } = {}) {
    if (!AMAP_WEB_KEY) {
        const error = new Error('Amap key is not configured');
        error.statusCode = 500;
        throw error;
    }
    const boundedRadius = Math.min(Math.max(Math.round(radius) || 0, 10), 300);
    const url = buildAmapRequestUrl('https://restapi.amap.com/v3/geocode/regeo', {
        location: `${longitude},${latitude}`,
        radius: boundedRadius,
        extensions,
        batch: 'false',
        roadlevel: '0',
    });
    const payload = await executeAmapRequest(url);
    const level = deriveNamingLevelFromRegeo(payload);
    trackNamingLevel(level);
    return payload;
}

async function fetchAmapAround({
    latitude,
    longitude,
    radius = 80,
    types = '',
    keywords = '',
    sortrule = 'distance',
    offset = 20,
} = {}) {
    if (!AMAP_WEB_KEY) {
        const error = new Error('Amap key is not configured');
        error.statusCode = 500;
        throw error;
    }
    const boundedRadius = Math.min(Math.max(Math.round(radius) || 0, 10), 500);
    const params = {
        location: `${longitude},${latitude}`,
        radius: boundedRadius,
        types,
        keywords,
        sortrule,
        offset,
        page: 1,
        output: 'json',
    };
    const url = buildAmapRequestUrl('https://restapi.amap.com/v3/place/around', params);
    return executeAmapRequest(url);
}

// === OSM Nominatim Fallback ===

async function reverseGeocode(latitude, longitude) {
    const url = new URL(`${GEOCODE_OSM_BASE_URL}/reverse`);
    url.searchParams.set('format', 'jsonv2');
    url.searchParams.set('lat', latitude);
    url.searchParams.set('lon', longitude);
    url.searchParams.set('zoom', '18');
    url.searchParams.set('addressdetails', '1');

    const response = await fetch(url.toString(), {
        headers: { 'User-Agent': GEOCODE_OSM_USER_AGENT },
    });

    if (!response.ok) {
        const error = new Error('Nominatim request failed');
        error.statusCode = response.status;
        throw error;
    }

    const payload = await response.json();
    return {
        name: payload.name || payload.display_name || '未知地点',
        displayName: payload.display_name || '',
        address: payload.address || {},
        raw: payload,
    };
}

// === Utility Functions ===

function normalizeCoordinate(value, { min = -180, max = 180 } = {}) {
    if (value === null || value === undefined) return null;
    const num = Number(value);
    if (Number.isNaN(num)) return null;
    if (num < min || num > max) return null;
    return num;
}

function buildCoordinateLabel(lat, lon) {
    const latitude = Number(lat);
    const longitude = Number(lon);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
        return '坐标未知';
    }
    return `坐标 ${latitude.toFixed(4)}, ${longitude.toFixed(4)}`;
}

function getGeocodeMetrics() {
    return { ...geocodeMetrics };
}

function resetGeocodeMetrics() {
    geocodeMetrics.cacheHits = 0;
    geocodeMetrics.cacheMisses = 0;
    geocodeMetrics.amapRequests = 0;
    geocodeMetrics.amapErrors = 0;
    geocodeMetrics.lastResetAt = Date.now();
    Object.keys(geocodeMetrics.namingLevels).forEach((key) => {
        geocodeMetrics.namingLevels[key] = 0;
    });
}

module.exports = {
    // Cache
    buildGeocodeCacheKey,
    getGeocodeCacheEntry,
    setGeocodeCacheEntry,
    pruneGeocodeCache,
    // AMAP
    fetchAmapRegeo,
    fetchAmapAround,
    deriveNamingLevelFromRegeo,
    matchesBuildingWhitelist,
    // OSM
    reverseGeocode,
    // Utils
    normalizeCoordinate,
    buildCoordinateLabel,
    // Metrics
    getGeocodeMetrics,
    resetGeocodeMetrics,
};
