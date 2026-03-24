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

// === UI 格式化相关常量和函数 ===

const WEATHER_TEXT_MAP = {
  sunny: '晴',
  clear: '晴',
  cloudy: '多云',
  overcast: '阴',
  rain: '雨',
  rainy: '雨',
  shower: '阵雨',
  snow: '雪',
  windy: '有风',
  fog: '雾',
};

const WEATHER_SUGGESTION_MAP = {
  'weather looks good. maintain your planned outdoor training.': '天气不错，可以按计划进行户外训练。',
  'take a rest day or choose indoor workouts due to harsh weather.': '天气较差，建议休息一天或选择室内运动。',
  'light rain. consider waterproof gear if you head outside.': '有小雨，外出运动请注意雨具和防水装备。',
  'hot and humid. stay hydrated and avoid noon training.': '天气炎热潮湿，注意补水，避免在中午时段训练。',
};

/**
 * 创建默认天气状态
 */
function createWeatherState(overrides = {}) {
  return {
    loading: false,
    ready: false,
    temperature: '--',
    apparentTemperature: null,
    weatherText: '等待获取天气',
    humidityText: '--',
    windText: '--',
    airQualityText: '--',
    airQualityLevel: '',
    suggestion: '保持联网可获取实时运动建议',
    fetchedAt: null,
    error: '',
    cityText: '',
    sportAdviceLevel: 'neutral',
    sportAdviceLabel: '关注实时天气',
    sportAdviceColor: '#60a5fa',
    ...overrides,
  };
}

/**
 * 格式化空气质量
 */
function formatAirQuality(airQuality = {}) {
  const toNonNegativeNumber = (val) => {
    if (val === null || val === undefined || val === '') {
      return null;
    }
    const numeric = Number(val);
    return Number.isFinite(numeric) && numeric >= 0 ? numeric : null;
  };
  const value = toNonNegativeNumber(airQuality.value) ?? toNonNegativeNumber(airQuality.aqi);
  const level = airQuality.level || airQuality.category || '';
  if (value === null) {
    return level || '--';
  }
  const label = level || '良好';
  return `${label} · ${value.toFixed(0)}`;
}

/**
 * 分析运动建议等级
 */
function analyzeSportAdvice(payload = {}) {
  const airLevelText = payload.airQuality?.level || payload.airQuality?.category || '';
  const text = `${payload.suggestion || ''}${payload.weatherText || ''}${airLevelText}`;
  const cautionKeywords = /(降温|雨|雾霾|谨慎|注意)/;
  const goodKeywords = /(晴|适宜|清爽|凉爽)/;
  let level = 'neutral';
  if (cautionKeywords.test(text)) {
    level = 'caution';
  }
  if (goodKeywords.test(text)) {
    level = 'good';
  }
  return {
    neutral: { label: '关注实时天气', color: '#60a5fa' },
    caution: { label: '注意补给与安全', color: '#f97316' },
    good: { label: '非常适合户外', color: '#34d399' },
  }[level];
}

/**
 * 检查文本是否包含中文
 */
function containsChinese(text = '') {
  return /[\u4e00-\u9fa5]/.test(text);
}

/**
 * 确保文本为中文
 */
function ensureChineseText(text, fallback, dictionary = WEATHER_TEXT_MAP) {
  if (!text || typeof text !== 'string') {
    return fallback;
  }
  if (containsChinese(text)) {
    return text.trim();
  }
  const normalized = text.trim().toLowerCase();
  if (dictionary && dictionary[normalized]) {
    return dictionary[normalized];
  }
  return fallback;
}

/**
 * 格式化风速
 */
function formatWindSpeed(windSpeed) {
  if (!Number.isFinite(windSpeed)) {
    return '--';
  }
  if (windSpeed < 0.3) {
    return '无风';
  }
  if (windSpeed < 1.6) {
    return '微风';
  }
  if (windSpeed < 5.5) {
    return `${windSpeed.toFixed(1)} m/s`;
  }
  return `${windSpeed.toFixed(1)} m/s 较大`;
}

/**
 * 格式化天气数据为 UI 展示格式
 */
function formatWeatherPayload(payload = {}) {
  const normalizedAirQuality = payload.airQuality && typeof payload.airQuality === 'object'
    ? payload.airQuality
    : {
        aqi: payload.aqi ?? null,
        value: payload.aqi ?? null,
        level: payload.airLevel || payload.airCategory || '',
        category: payload.airCategory || payload.airLevel || '',
      };
  const normalizedPayload = {
    ...payload,
    airQuality: normalizedAirQuality,
    cityName: payload.cityName || payload.city || payload.district || '',
  };
  const advice = analyzeSportAdvice(normalizedPayload);
  const weatherText = ensureChineseText(normalizedPayload.weatherText, advice.label);
  const suggestion = ensureChineseText(normalizedPayload.suggestion, advice.label, WEATHER_SUGGESTION_MAP);
  const apparent = Number(normalizedPayload.apparentTemperature);
  const humidity = Number(normalizedPayload.humidity);
  const windSpeed = Number(normalizedPayload.windSpeed);
  return {
    loading: false,
    ready: true,
    temperature: Number.isFinite(normalizedPayload.temperature)
      ? `${Number(normalizedPayload.temperature).toFixed(1)}℃`
      : '--',
    apparentTemperature: Number.isFinite(apparent) ? `${apparent.toFixed(1)}℃` : null,
    weatherText,
    humidityText: Number.isFinite(humidity) ? `${Math.round(humidity)}%` : '--',
    windText: formatWindSpeed(windSpeed),
    airQualityText: formatAirQuality(normalizedAirQuality),
    airQualityLevel: normalizedAirQuality.level || normalizedAirQuality.category || '',
    suggestion,
    fetchedAt: normalizedPayload.fetchedAt || Date.now(),
    error: '',
    cityText: normalizedPayload.cityName || '',
    sportAdviceLevel: advice.label,
    sportAdviceLabel: suggestion,
    sportAdviceColor: advice.color,
  };
}

module.exports = {
  // 数据获取
  getLocalWeatherSnapshot,
  WEATHER_CODE_TEXT,
  // UI 格式化
  createWeatherState,
  formatAirQuality,
  analyzeSportAdvice,
  formatWeatherPayload,
  WEATHER_TEXT_MAP,
  WEATHER_SUGGESTION_MAP,
};
