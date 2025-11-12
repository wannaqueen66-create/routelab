'use strict';

const { gcj02ToWgs84 } = require('../utils/coord');

const OM_BASE = 'https://api.open-meteo.com/v1/forecast';
const AQ_BASE = 'https://air-quality-api.open-meteo.com/v1/air-quality';

function buildQuery(params = {}) {
  return Object.keys(params)
    .filter((key) => params[key] !== undefined && params[key] !== null && params[key] !== '')
    .map((key) => `${encodeURIComponent(key)}=${encodeURIComponent(params[key])}`)
    .join('&');
}

const WEATHER_CODE_TEXT = {
  0: '晴朗',
  1: '多云',
  2: '晴间多云',
  3: '阴天',
  45: '有雾',
  48: '霜雾',
  51: '毛毛雨（小）',
  53: '毛毛雨（中）',
  55: '毛毛雨（大）',
  56: '冻毛毛雨（小）',
  57: '冻毛毛雨（大）',
  61: '小雨',
  63: '中雨',
  65: '大雨',
  66: '冻雨（小）',
  67: '冻雨（大）',
  71: '小雪',
  73: '中雪',
  75: '大雪',
  77: '雪粒',
  80: '阵雨（小）',
  81: '阵雨（中）',
  82: '阵雨（强）',
  85: '阵雪（小）',
  86: '阵雪（强）',
  95: '雷阵雨',
  96: '雷阵雨伴冰雹（小）',
  99: '雷阵雨伴冰雹（强）',
};

function buildLocalSuggestion(tempC, wind, aqi) {
  const numericTemp = Number(tempC);
  const numericWind = Number(wind);
  const numericAqi = Number(aqi);
  if (Number.isFinite(numericAqi) && numericAqi >= 200) {
    return '空气较差，建议室内或延期运动';
  }
  if (Number.isFinite(numericTemp) && numericTemp < -5) {
    return '气温偏低，注意保暖与充分热身';
  }
  if (Number.isFinite(numericTemp) && numericTemp > 33) {
    return '高温天气，避开正午时段并注意补水';
  }
  if (Number.isFinite(numericWind) && numericWind > 10) {
    return '风力较大，注意防风与安全';
  }
  if (Number.isFinite(numericAqi) && numericAqi >= 150) {
    return '空气一般，建议降低强度或佩戴口罩';
  }
  return '适宜户外运动，注意补水与防晒';
}

function normalizeWeatherPayload(weatherNow = {}, airNow = null) {
  const temperature = Number(weatherNow.temperature_2m);
  const apparent = Number(weatherNow.apparent_temperature);
  const windSpeed = Number(weatherNow.wind_speed_10m);
  const humidity = Number(weatherNow.relative_humidity_2m);
  const weatherCode = Number(weatherNow.weather_code);
  const aqi =
    airNow && airNow.us_aqi !== undefined && airNow.us_aqi !== null
      ? Number(airNow.us_aqi)
      : airNow && airNow.european_aqi !== undefined && airNow.european_aqi !== null
      ? Number(airNow.european_aqi)
      : null;

  let airLevel = '';
  if (Number.isFinite(aqi)) {
    if (aqi <= 50) {
      airLevel = '优';
    } else if (aqi <= 100) {
      airLevel = '良';
    } else if (aqi <= 150) {
      airLevel = '轻度污染';
    } else if (aqi <= 200) {
      airLevel = '中度污染';
    } else if (aqi <= 300) {
      airLevel = '重度污染';
    } else {
      airLevel = '严重污染';
    }
  }

  return {
    temperature: Number.isFinite(temperature) ? temperature : null,
    apparentTemperature: Number.isFinite(apparent) ? apparent : null,
    humidity: Number.isFinite(humidity) ? humidity : null,
    weatherCode: Number.isFinite(weatherCode) ? weatherCode : null,
    weatherText: WEATHER_CODE_TEXT[weatherCode] || '天气数据获取中',
    windSpeed: Number.isFinite(windSpeed) ? windSpeed : null,
    wind: {
      speed: Number.isFinite(windSpeed) ? windSpeed : null,
      unit: 'm/s',
      height: 10,
    },
    airQuality: {
      aqi: Number.isFinite(aqi) ? aqi : null,
      level: airLevel,
    },
    suggestion: buildLocalSuggestion(temperature, windSpeed, aqi ?? 0),
    source: 'open-meteo',
    fetchedAt: Date.now(),
  };
}

function wxGet(url) {
  return new Promise((resolve, reject) => {
    wx.request({
      url,
      method: 'GET',
      timeout: 8000,
      success: (res) => {
        const status = res.statusCode || 0;
        if (status >= 200 && status < 300) {
          resolve(res.data);
          return;
        }
        reject(new Error(`HTTP ${status}`));
      },
      fail: (err) => reject(err),
    });
  });
}

function parseAirQualitySnapshot(airResponse = {}) {
  const hourly = airResponse.hourly || {};
  const times = Array.isArray(hourly.time) ? hourly.time : [];
  if (!times.length) {
    return null;
  }
  const currentTime = airResponse.current?.time;
  let index = times.length - 1;
  if (currentTime) {
    const idx = times.indexOf(currentTime);
    if (idx >= 0) {
      index = idx;
    }
  }
  return {
    us_aqi: hourly.us_aqi?.[index] ?? null,
    european_aqi: hourly.european_aqi?.[index] ?? null,
  };
}

async function getLocalWeatherSnapshot({ latitude, longitude } = {}) {
  if (latitude === undefined || longitude === undefined) {
    throw new Error('Latitude and longitude are required for local weather snapshot');
  }

  const coordsWGS84 = gcj02ToWgs84(latitude, longitude);
  const lat = Number(coordsWGS84.latitude);
  const lon = Number(coordsWGS84.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    throw new Error('Invalid coordinates for local weather snapshot');
  }

  const weatherParams = {
    latitude: lat,
    longitude: lon,
    current:
      'temperature_2m,apparent_temperature,relative_humidity_2m,wind_speed_10m,weather_code',
    timezone: 'auto',
    windspeed_unit: 'ms',
  };

  const airParams = {
    latitude: lat,
    longitude: lon,
    hourly: 'pm2_5,pm10,us_aqi,european_aqi',
    timezone: 'auto',
  };

  const [weatherRes, airRes] = await Promise.all([
    wxGet(`${OM_BASE}?${buildQuery(weatherParams)}`),
    wxGet(`${AQ_BASE}?${buildQuery(airParams)}`),
  ]);

  const weatherNow = weatherRes?.current || {};
  const airNow = parseAirQualitySnapshot(airRes);

  const normalized = normalizeWeatherPayload(weatherNow, airNow);
  return {
    ...normalized,
    latitude: lat,
    longitude: lon,
  };
}

module.exports = {
  getLocalWeatherSnapshot,
  WEATHER_CODE_TEXT,
};
