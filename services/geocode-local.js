const config = require('../config/saaa-config');
const logger = require('../utils/logger');
const { gcj02ToWgs84 } = require('../utils/coord');
const gridCache = require('../utils/grid-cache');
const api = require('./api');

function requestJson(url, { timeout = 8000, header = {} } = {}) {
  return new Promise((resolve, reject) => {
    wx.request({
      url,
      method: 'GET',
      timeout,
      header,
      success: (res) => {
        const code = res.statusCode || 0;
        if (code >= 200 && code < 300) {
          resolve(res.data);
          return;
        }
        const err = new Error(`HTTP ${code}`);
        err.statusCode = code;
        reject(err);
      },
      fail: (err) => reject(err),
    });
  });
}

function parseAmapRegeo(data) {
  try {
    const regeocode = data?.regeocode;
    if (!regeocode) return null;
    const comp = regeocode.addressComponent || {};
    const city = Array.isArray(comp.city) ? comp.city[0] : comp.city || '';
    const district = comp.district || '';
    const province = comp.province || '';
    const name = city || district || province || '';
    const displayName = regeocode.formatted_address || name;
    return {
      city: city || province,
      district,
      province,
      name: name || displayName,
      displayName,
      address: { ...comp },
      raw: data,
      source: 'amap',
    };
  } catch (e) {
    return null;
  }
}

function parseNominatim(data) {
  try {
    const disp = data?.display_name || '';
    const addr = data?.address || {};
    const city = addr.city || addr.town || addr.village || addr.county || '';
    const state = addr.state || '';
    const name = city || state || '';
    return {
      city,
      district: addr.suburb || addr.district || '',
      province: state,
      name: name || disp,
      displayName: disp || name,
      address: { ...addr },
      raw: data,
      source: 'nominatim',
    };
  } catch (e) {
    return null;
  }
}

function buildAmapUrl({ latitude, longitude }) {
  const key = config?.map?.amapWebKey || config?.amapWebKey || '';
  if (!key) return '';
  const loc = `${Number(longitude)},${Number(latitude)}`;
  return `https://restapi.amap.com/v3/geocode/regeo?key=${encodeURIComponent(
    key
  )}&location=${encodeURIComponent(loc)}&extensions=base&batch=false&roadlevel=0`;
}

function buildNominatimUrl({ latitude, longitude }) {
  return `https://nominatim.openstreetmap.org/reverse?format=json&lat=${encodeURIComponent(
    latitude
  )}&lon=${encodeURIComponent(longitude)}&zoom=14&addressdetails=1`;
}

function normalizeAmapPoi(poi = {}) {
  if (!poi || typeof poi !== 'object') {
    return null;
  }
  const [lng, lat] = (poi.location || '')
    .split(',')
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value));
  return {
    id: poi.id || '',
    name: poi.name || '',
    type: poi.type || '',
    typecode: poi.typecode || '',
    distance: Number.isFinite(Number(poi.distance)) ? Number(poi.distance) : null,
    latitude: Number.isFinite(lat) ? lat : null,
    longitude: Number.isFinite(lng) ? lng : null,
    address: poi.address || '',
    raw: { ...poi },
  };
}

function buildAmapRegeoDetailedUrl({ latitude, longitude, radius = 60 }) {
  const key = config?.map?.amapWebKey || config?.amapWebKey || '';
  if (!key) return '';
  const loc = `${Number(longitude)},${Number(latitude)}`;
  const boundedRadius = Math.min(Math.max(Math.round(radius) || 0, 10), 200);
  return `https://restapi.amap.com/v3/geocode/regeo?key=${encodeURIComponent(
    key
  )}&location=${encodeURIComponent(loc)}&extensions=all&radius=${boundedRadius}&roadlevel=0`;
}

function buildAmapPlaceAroundUrl({ latitude, longitude, radius = 80, types = '', keywords = '' }) {
  const key = config?.map?.amapWebKey || config?.amapWebKey || '';
  if (!key) return '';
  const loc = `${Number(longitude)},${Number(latitude)}`;
  const boundedRadius = Math.min(Math.max(Math.round(radius) || 0, 10), 500);
  const params = [
    `key=${encodeURIComponent(key)}`,
    `location=${encodeURIComponent(loc)}`,
    `radius=${boundedRadius}`,
    'sortrule=distance',
    'offset=20',
    'page=1',
    'output=json',
  ];
  if (types) {
    params.push(`types=${encodeURIComponent(types)}`);
  }
  if (keywords) {
    params.push(`keywords=${encodeURIComponent(keywords)}`);
  }
  return `https://restapi.amap.com/v3/place/around?${params.join('&')}`;
}

function parseAmapRegeoDetailed(data) {
  const base = parseAmapRegeo(data);
  if (!base) {
    return null;
  }
  const regeocode = data?.regeocode || {};
  const pois = Array.isArray(regeocode.pois) ? regeocode.pois.map((item) => normalizeAmapPoi(item)).filter(Boolean) : [];
  const aois = Array.isArray(regeocode.aois) ? regeocode.aois.map((item) => normalizeAmapPoi(item)).filter(Boolean) : [];
  const roads = Array.isArray(regeocode.roads)
    ? regeocode.roads.map((item) => ({
        id: item.id || '',
        name: item.name || '',
        distance: Number.isFinite(Number(item.distance)) ? Number(item.distance) : null,
        direction: item.direction || '',
        raw: { ...item },
      }))
    : [];
  return {
    ...base,
    pois,
    aois,
    roads,
    raw: data,
  };
}

function reverseGeocodeDetailed({ latitude, longitude, radius = 60 } = {}) {
  const cacheCell = gridCache.makeCellKey(latitude, longitude, 0.001);
  const cacheKey = `proxy-regeo:${cacheCell}:r${Math.round(radius) || 0}`;
  const cached = gridCache.get(cacheKey);
  if (cached) {
    return Promise.resolve({ ...cached });
  }
  return api
    .geocodeRegeo({ latitude, longitude, radius, extensions: 'all' })
    .then((payload) => {
      const parsed = parseAmapRegeoDetailed(payload);
      if (parsed) {
        gridCache.set(cacheKey, parsed);
      }
      return parsed;
    })
    .catch((proxyError) => {
      logger.warn('Proxy reverse geocode failed, falling back to direct AMap', {
        message: proxyError?.errMsg || proxyError?.message || proxyError,
      });
      const url = buildAmapRegeoDetailedUrl({ latitude, longitude, radius });
      if (!url) {
        throw proxyError;
      }
      return requestJson(url, { timeout: 6500 })
        .then((data) => {
          const parsed = parseAmapRegeoDetailed(data);
          if (parsed) {
            gridCache.set(cacheKey, parsed);
          }
          return parsed;
        })
        .catch((err) => {
          logger.warn('AMap detailed regeo fallback failed', err?.errMsg || err?.message || err);
          throw proxyError;
        });
    });
}

function searchAmapPlaceAround({ latitude, longitude, radius = 80, types = '', keywords = '' } = {}) {
  const cacheCell = gridCache.makeCellKey(latitude, longitude, 0.001);
  const cacheKeyParts = [
    `proxy-around:${cacheCell}`,
    radius ? `r${Math.round(radius)}` : '',
    types ? `t:${types}` : '',
    keywords ? `k:${keywords}` : '',
  ].filter(Boolean);
  const cacheKey = cacheKeyParts.join('|');
  const cached = gridCache.get(cacheKey);
  if (cached) {
    return Promise.resolve(cached.map((item) => ({ ...item })));
  }
  return api
    .geocodeAround({ latitude, longitude, radius, types, keywords })
    .then((payload) => {
      const list = Array.isArray(payload?.pois)
        ? payload.pois.map((poi) => normalizeAmapPoi(poi)).filter(Boolean)
        : [];
      gridCache.set(cacheKey, list);
      return list;
    })
    .catch((proxyError) => {
      logger.warn('Proxy place around failed, falling back to direct AMap', {
        message: proxyError?.errMsg || proxyError?.message || proxyError,
      });
      const url = buildAmapPlaceAroundUrl({ latitude, longitude, radius, types, keywords });
      if (!url) {
        return [];
      }
      return requestJson(url, { timeout: 6500 })
        .then((data) => {
          if (!data || data.status !== '1' || !Array.isArray(data.pois)) {
            return [];
          }
          const list = data.pois.map((poi) => normalizeAmapPoi(poi)).filter(Boolean);
          gridCache.set(cacheKey, list);
          return list;
        })
        .catch((err) => {
          logger.warn('AMap place around fallback failed', err?.errMsg || err?.message || err);
          return [];
        });
    });
}

function reverseGeocodeLocalGCJ({ latitude, longitude }) {
  const key = gridCache.makeCellKey(latitude, longitude, 0.002);
  const cached = gridCache.get(`amap:${key}`);
  if (cached) return Promise.resolve(cached);
  const url = buildAmapUrl({ latitude, longitude });
  if (!url) {
    return Promise.reject(new Error('AMap key not configured'));
  }
  return requestJson(url, { timeout: 6000 })
    .then((data) => parseAmapRegeo(data))
    .then((parsed) => {
      if (parsed) {
        gridCache.set(`amap:${key}`, parsed);
      }
      return parsed;
    });
}

function reverseGeocodeLocalWGS84({ latitude, longitude }) {
  const key = gridCache.makeCellKey(latitude, longitude, 0.002);
  const cached = gridCache.get(`osm:${key}`);
  if (cached) return Promise.resolve(cached);
  const url = buildNominatimUrl({ latitude, longitude });
  // NOTE: WeChat mini program forbids setting User-Agent header.
  // For Nominatim usage policy, prefer proxying via our cloud API.
  return requestJson(url, { timeout: 7000 })
    .then((data) => parseNominatim(data))
    .then((parsed) => {
      if (parsed) {
        gridCache.set(`osm:${key}`, parsed);
      }
      return parsed;
    });
}

function reverseGeocodeFallback({ latitude, longitude }) {
  // Try AMap with GCJ-02 first, then fallback to OSM via WGS-84
  return reverseGeocodeLocalGCJ({ latitude, longitude })
    .catch((err) => {
      logger.warn('AMap reverse geocode failed', err?.errMsg || err?.message || err);
      const wgs = gcj02ToWgs84(latitude, longitude);
      return reverseGeocodeLocalWGS84(wgs);
    })
    .catch((err) => {
      logger.warn('OSM reverse geocode failed', err?.errMsg || err?.message || err);
      return null;
    });
}

function getCityNameWithFallback({ latitude, longitude }) {
  return reverseGeocodeLocalGCJ({ latitude, longitude })
    .then((res) => res?.city || res?.province || null)
    .catch(() => {
      const wgs = gcj02ToWgs84(latitude, longitude);
      return reverseGeocodeLocalWGS84(wgs).then((res) => res?.city || res?.province || null);
    })
    .catch(() => null);
}

module.exports = {
  reverseGeocodeDetailed,
  searchAmapPlaceAround,
  reverseGeocodeLocalGCJ,
  reverseGeocodeLocalWGS84,
  reverseGeocodeFallback,
  getCityNameWithFallback,
};
