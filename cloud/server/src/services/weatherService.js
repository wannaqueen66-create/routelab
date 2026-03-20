/**
 * Weather Service
 * Handles weather data fetching from multiple providers:
 * - QWeather (primary)
 * - AMAP (fallback)
 * - Open-Meteo (fallback)
 */

const fetch = require('node-fetch');
const {
    QWEATHER_API_KEY,
    QWEATHER_BASE_URL,
    AMAP_WEB_KEY,
    AQICN_TOKEN,
    WEATHER_USER_AGENT,
    OPEN_METEO_WEATHER_BASE,
    OPEN_METEO_AIR_BASE
} = require('../config/index');

// Import geocode functions for AMAP weather
const { fetchAmapRegeo } = require('./geocodeService');

// === Utility Functions ===

function normalizeNumberValue(value) {
    if (value === undefined || value === null || value === '') {
        return null;
    }
    const num = Number(value);
    return Number.isFinite(num) ? num : null;
}

function maskQWeatherKey(url) {
    try {
        const parsed = new URL(url);
        if (parsed.searchParams.has('key')) {
            parsed.searchParams.set('key', '***');
        }
        return parsed.toString();
    } catch (error) {
        return url;
    }
}

function logQWeatherError(context, { url, httpStatus, payloadCode, payload }) {
    console.error(`[QWeather] ${context} error`, {
        url: maskQWeatherKey(url),
        httpStatus,
        payloadCode: payloadCode ?? null,
        message: payload?.message || payload?.warning || payload?.msg || '',
    });
}

function mapQWeatherCodeToStatus(code, httpStatus) {
    if (code === '401') return 401;
    if (code === '404') return 502;
    if (code === '429') return 429;
    if (code === '102') return 429;
    if (httpStatus && Number(httpStatus) >= 400) return httpStatus;
    return 502;
}

function describeAqi(aqi) {
    if (aqi === null || aqi === undefined || Number.isNaN(aqi)) {
        return { level: 'Unknown', category: 'unknown' };
    }
    const value = Number(aqi);
    if (value <= 50) return { level: 'Good', category: 'good' };
    if (value <= 100) return { level: 'Moderate', category: 'moderate' };
    if (value <= 150) return { level: 'Unhealthy (sensitive)', category: 'unhealthySensitive' };
    if (value <= 200) return { level: 'Unhealthy', category: 'unhealthy' };
    if (value <= 300) return { level: 'Very unhealthy', category: 'veryUnhealthy' };
    return { level: 'Hazardous', category: 'hazardous' };
}

function findClosestTimeIndex(times = []) {
    if (!Array.isArray(times) || !times.length) return -1;
    const now = Date.now();
    let minDiff = Number.POSITIVE_INFINITY;
    let index = -1;
    times.forEach((time, idx) => {
        const timestamp = new Date(time).getTime();
        if (Number.isNaN(timestamp)) return;
        const diff = Math.abs(timestamp - now);
        if (diff < minDiff) {
            minDiff = diff;
            index = idx;
        }
    });
    return index;
}

function buildExerciseSuggestion({ temperature, aqi, weatherCode, windSpeed, humidity }) {
    if (temperature === null || temperature === undefined) {
        return '天气数据暂时不可用，请稍后再试。';
    }
    if (aqi !== null && aqi !== undefined) {
        const value = Number(aqi);
        if (!Number.isNaN(value) && value >= 150) {
            return '空气质量较差，建议减少户外运动强度，佩戴口罩。';
        }
    }
    if (weatherCode !== null && weatherCode !== undefined) {
        const rainyCodes = [51, 53, 55, 61, 63, 65, 66, 67, 80, 81, 82, 95, 96, 99];
        if (rainyCodes.includes(Number(weatherCode))) {
            return '预计有降雨，建议携带雨具或改为室内运动。';
        }
        const snowyCodes = [71, 73, 75, 77, 85, 86];
        if (snowyCodes.includes(Number(weatherCode))) {
            return '路面可能结冰，建议选择安全路线或改为室内运动。';
        }
    }
    if (humidity !== null && humidity !== undefined && Number(humidity) >= 85) {
        return '湿度较高，请注意及时补水，避免过度运动。';
    }
    if (windSpeed !== null && windSpeed !== undefined && Number(windSpeed) >= 25) {
        return '今天风力较大，注意保暖，减少长时间户外运动。';
    }
    if (temperature <= 0) return '气温较低，注意保暖，适当缩短户外运动时间。';
    if (temperature >= 32) return '天气炎热，注意防晒补水，避免高温时段运动。';
    return '天气不错，可以按计划进行户外运动。';
}

// === QWeather Functions ===

function ensureQWeatherConfigured() {
    if (!QWEATHER_API_KEY) {
        const error = new Error('QWeather API key is not configured');
        error.statusCode = 500;
        throw error;
    }
    if (!QWEATHER_BASE_URL) {
        const error = new Error('QWeather API host is not configured');
        error.statusCode = 500;
        throw error;
    }
}

async function requestQWeather(pathname, params = {}, context = 'request') {
    ensureQWeatherConfigured();
    const base = QWEATHER_BASE_URL.replace(/\/$/, '');
    const url = new URL(`${base}${pathname.startsWith('/') ? '' : '/'}${pathname}`);
    Object.entries(params || {}).forEach(([key, value]) => {
        if (value !== undefined && value !== null && value !== '') {
            url.searchParams.set(key, value);
        }
    });
    url.searchParams.set('key', QWEATHER_API_KEY);

    const headers = {
        'User-Agent': WEATHER_USER_AGENT,
        Accept: 'application/json',
        'X-QWeather-Key': QWEATHER_API_KEY,
    };

    let response;
    try {
        response = await fetch(url.toString(), { headers });
    } catch (networkError) {
        logQWeatherError(context, {
            url: url.toString(),
            httpStatus: null,
            payloadCode: null,
            payload: null,
        });
        networkError.statusCode = 502;
        throw networkError;
    }

    let payload;
    try {
        payload = await response.json();
    } catch (parseError) {
        logQWeatherError(context, {
            url: url.toString(),
            httpStatus: response?.status || null,
            payloadCode: null,
            payload: null,
        });
        const error = new Error('Failed to parse QWeather response');
        error.statusCode = response?.status || 502;
        throw error;
    }

    const payloadCode = String(payload?.code || payload?.status || '');
    if (!response.ok || (payloadCode && payloadCode !== '200')) {
        logQWeatherError(context, {
            url: url.toString(),
            httpStatus: response.status,
            payloadCode,
            payload,
        });
        const error = new Error(`QWeather ${context} failed`);
        error.statusCode = mapQWeatherCodeToStatus(payloadCode, response.status);
        error.httpStatus = response.status;
        error.payloadCode = payloadCode;
        error.url = maskQWeatherKey(url.toString());
        throw error;
    }

    return { payload, url: url.toString(), httpStatus: response.status };
}

async function fetchQWeatherWeatherSnapshot(latitude, longitude) {
    const location = `${longitude},${latitude}`;
    const { payload } = await requestQWeather(
        '/weather/now',
        { location, unit: 'm', lang: 'zh-hans' },
        'weather/now'
    );
    const now = payload.now || {};
    const fetchedAt = Date.now();
    const observedAt = now.obsTime ? new Date(now.obsTime).getTime() : null;
    const weatherCode = normalizeNumberValue(now.icon);

    return {
        temperature: normalizeNumberValue(now.temp),
        apparentTemperature: normalizeNumberValue(now.feelsLike),
        weatherCode: Number.isFinite(weatherCode) ? weatherCode : null,
        weatherText: typeof now.text === 'string' ? now.text : null,
        humidity: normalizeNumberValue(now.humidity),
        windSpeed: normalizeNumberValue(now.windSpeed),
        windDirection: normalizeNumberValue(now.wind360 ?? now.windDir),
        windDirectionText: now.windDir || null,
        fetchedAt,
        observedAt,
        obsTime: now.obsTime || null,
        source: 'qweather',
    };
}

async function fetchQWeatherAirSnapshot(latitude, longitude) {
    ensureQWeatherConfigured();
    // New API: /airquality/v1/current/{lat}/{lon} (replaces deprecated /v7/air/now)
    const base = QWEATHER_BASE_URL.replace(/\/$/, '');
    const lat = Number(latitude).toFixed(2);
    const lon = Number(longitude).toFixed(2);
    const url = `${base}/airquality/v1/current/${lat}/${lon}?lang=zh-hans&key=${QWEATHER_API_KEY}`;

    let response;
    try {
        response = await fetch(url, {
            headers: {
                'User-Agent': WEATHER_USER_AGENT,
                Accept: 'application/json',
            },
        });
    } catch (networkError) {
        console.error('[QWeather] airquality/v1 network error');
        networkError.statusCode = 502;
        throw networkError;
    }

    if (!response.ok) {
        const text = await response.text().catch(() => '');
        console.error('[QWeather] airquality/v1 error', {
            url: url.replace(QWEATHER_API_KEY, '***'),
            httpStatus: response.status,
            body: text.slice(0, 200),
        });
        const error = new Error('QWeather air quality v1 failed');
        error.statusCode = response.status;
        throw error;
    }

    const payload = await response.json();
    const indexes = Array.isArray(payload.indexes) ? payload.indexes : [];
    const pollutants = Array.isArray(payload.pollutants) ? payload.pollutants : [];

    // Prefer China AQI (cn-mep), fall back to US EPA, then QAQI
    const chinaIndex = indexes.find((i) => i.code === 'cn-mep');
    const usIndex = indexes.find((i) => i.code === 'us-epa');
    const bestIndex = chinaIndex || usIndex || indexes[0];

    const aqi = bestIndex ? normalizeNumberValue(bestIndex.aqi) : null;
    const meta = describeAqi(aqi);

    // Extract pollutant concentrations
    function findPollutant(code) {
        const p = pollutants.find((item) => item.code === code);
        return p ? normalizeNumberValue(p.concentration?.value) : null;
    }

    return {
        aqi: aqi ?? null,
        category: bestIndex?.category || meta.category,
        level: bestIndex?.level || meta.level,
        pm2p5: findPollutant('pm2p5'),
        pm25: findPollutant('pm2p5'),
        pm10: findPollutant('pm10'),
        o3: findPollutant('o3'),
        so2: findPollutant('so2'),
        no2: findPollutant('no2'),
        co: findPollutant('co'),
        healthAdvice: bestIndex?.health?.advice?.generalPopulation || null,
        fetchedAt: Date.now(),
        source: 'qweather',
    };
}

// === AMAP Weather ===

async function fetchAmapWeatherSnapshot(latitude, longitude) {
    if (!AMAP_WEB_KEY) {
        const error = new Error('Amap key is not configured');
        error.statusCode = 500;
        throw error;
    }
    const regeoPayload = await fetchAmapRegeo({
        latitude,
        longitude,
        radius: 60,
        extensions: 'base',
    });
    const addressComponent = regeoPayload?.regeocode?.addressComponent || {};
    const adcode = addressComponent.adcode || addressComponent.citycode;
    if (!adcode) {
        const error = new Error('Amap adcode is not available for weather');
        error.statusCode = 502;
        throw error;
    }

    // Build AMAP URL inline since we need the key
    const url = new URL('https://restapi.amap.com/v3/weather/weatherInfo');
    url.searchParams.set('city', adcode);
    url.searchParams.set('extensions', 'base');
    url.searchParams.set('output', 'JSON');
    url.searchParams.set('key', AMAP_WEB_KEY);

    const response = await fetch(url.toString(), {
        headers: { 'User-Agent': WEATHER_USER_AGENT },
    });

    if (!response.ok) {
        const error = new Error('AMAP weather request failed');
        error.statusCode = response.status;
        throw error;
    }

    const payload = await response.json();
    if (!Array.isArray(payload.lives) || !payload.lives.length) {
        const error = new Error('Amap weather payload is invalid');
        error.statusCode = 502;
        throw error;
    }

    const live = payload.lives[0] || {};
    const temperature =
        live.temperature !== undefined && live.temperature !== null && live.temperature !== ''
            ? Number(live.temperature)
            : null;
    const humidity =
        live.humidity !== undefined && live.humidity !== null && live.humidity !== ''
            ? Number(live.humidity)
            : null;
    const fetchedAt = live.reporttime ? new Date(live.reporttime).getTime() : Date.now();

    let windSpeed = null;
    if (live.windpower !== undefined && live.windpower !== null && live.windpower !== '') {
        const numericWind = Number(live.windpower);
        if (Number.isFinite(numericWind)) {
            windSpeed = numericWind;
        }
    }

    return {
        temperature: Number.isFinite(temperature) ? temperature : null,
        apparentTemperature: Number.isFinite(temperature) ? temperature : null,
        weatherCode: null,
        weatherText: typeof live.weather === 'string' ? live.weather : null,
        humidity: Number.isFinite(humidity) ? humidity : null,
        windSpeed: Number.isFinite(windSpeed) ? windSpeed : null,
        windDirection: live.winddirection || null,
        fetchedAt,
        source: 'amap',
    };
}

// === Open-Meteo ===

async function fetchOpenMeteoWeatherSnapshot(latitude, longitude) {
    const url = new URL(OPEN_METEO_WEATHER_BASE);
    url.searchParams.set('latitude', latitude);
    url.searchParams.set('longitude', longitude);
    url.searchParams.set(
        'current',
        'temperature_2m,weather_code,relative_humidity_2m,apparent_temperature,wind_speed_10m,wind_direction_10m'
    );
    url.searchParams.set('timezone', 'auto');

    const response = await fetch(url.toString(), {
        headers: { 'User-Agent': WEATHER_USER_AGENT },
    });
    if (!response.ok) {
        const error = new Error('Weather request failed');
        error.statusCode = response.status;
        throw error;
    }
    const payload = await response.json();
    const current = payload.current || {};
    return {
        temperature: current.temperature_2m ?? null,
        apparentTemperature: current.apparent_temperature ?? null,
        weatherCode: current.weather_code ?? null,
        humidity: current.relative_humidity_2m ?? null,
        windSpeed: current.wind_speed_10m ?? null,
        windDirection: current.wind_direction_10m ?? null,
        fetchedAt: current.time ? new Date(current.time).getTime() : Date.now(),
        source: 'open_meteo',
    };
}

async function fetchOpenMeteoAirQualitySnapshot(latitude, longitude) {
    const url = new URL(OPEN_METEO_AIR_BASE);
    url.searchParams.set('latitude', latitude);
    url.searchParams.set('longitude', longitude);
    url.searchParams.set('hourly', 'us_aqi,pm2_5,pm10');
    url.searchParams.set('timezone', 'auto');
    url.searchParams.set('forecast_days', '1');

    const response = await fetch(url.toString(), {
        headers: { 'User-Agent': WEATHER_USER_AGENT },
    });
    if (!response.ok) {
        const error = new Error('Air quality request failed');
        error.statusCode = response.status;
        throw error;
    }
    const payload = await response.json();
    const times = payload.hourly?.time || [];
    const index = findClosestTimeIndex(times);
    if (index === -1) {
        return { aqi: null, pm25: null, pm10: null };
    }
    const aqiList = payload.hourly.us_aqi || [];
    const pm25List = payload.hourly.pm2_5 || [];
    const pm10List = payload.hourly.pm10 || [];
    return {
        aqi: aqiList[index] ?? null,
        pm25: pm25List[index] ?? null,
        pm10: pm10List[index] ?? null,
        fetchedAt: times[index] ? new Date(times[index]).getTime() : Date.now(),
    };
}

// === AQICN (World Air Quality Index) ===

async function fetchAqicnAirSnapshot(latitude, longitude) {
    if (!AQICN_TOKEN) {
        const error = new Error('AQICN token is not configured');
        error.statusCode = 500;
        throw error;
    }
    const url = `https://api.waqi.info/feed/geo:${latitude};${longitude}/?token=${AQICN_TOKEN}`;

    const response = await fetch(url, {
        headers: { 'User-Agent': WEATHER_USER_AGENT },
    });
    if (!response.ok) {
        const error = new Error('AQICN request failed');
        error.statusCode = response.status;
        throw error;
    }

    const payload = await response.json();
    if (payload.status !== 'ok' || !payload.data) {
        const error = new Error('AQICN response invalid: ' + (payload.status || 'unknown'));
        error.statusCode = 502;
        throw error;
    }

    const data = payload.data;
    const iaqi = data.iaqi || {};

    return {
        aqi: normalizeNumberValue(data.aqi),
        pm25: iaqi.pm25?.v != null ? normalizeNumberValue(iaqi.pm25.v) : null,
        pm10: iaqi.pm10?.v != null ? normalizeNumberValue(iaqi.pm10.v) : null,
        o3: iaqi.o3?.v != null ? normalizeNumberValue(iaqi.o3.v) : null,
        so2: iaqi.so2?.v != null ? normalizeNumberValue(iaqi.so2.v) : null,
        no2: iaqi.no2?.v != null ? normalizeNumberValue(iaqi.no2.v) : null,
        co: iaqi.co?.v != null ? normalizeNumberValue(iaqi.co.v) : null,
        stationName: data.city?.name || null,
        fetchedAt: Date.now(),
        source: 'aqicn',
    };
}

// === Unified Fetchers (with fallback) ===

async function fetchWeatherSnapshot(latitude, longitude) {
    const errors = [];

    if (QWEATHER_API_KEY && QWEATHER_BASE_URL) {
        try {
            return await fetchQWeatherWeatherSnapshot(latitude, longitude);
        } catch (error) {
            error.provider = 'qweather';
            errors.push(error);
        }
    }

    if (AMAP_WEB_KEY) {
        try {
            return await fetchAmapWeatherSnapshot(latitude, longitude);
        } catch (error) {
            error.provider = 'amap';
            errors.push(error);
        }
    }

    try {
        return await fetchOpenMeteoWeatherSnapshot(latitude, longitude);
    } catch (error) {
        error.provider = 'open_meteo';
        errors.push(error);
        const aggregate = new Error('All weather providers failed');
        aggregate.statusCode = error.statusCode || 502;
        aggregate.details = errors.map((item) => ({
            provider: item.provider || 'unknown',
            statusCode: item.statusCode,
            message: item.message,
        }));
        throw aggregate;
    }
}

async function fetchAirQualitySnapshot(latitude, longitude) {
    const errors = [];

    // 1. QWeather (new v1 API, best China precision at 1x1km)
    if (QWEATHER_API_KEY && QWEATHER_BASE_URL) {
        try {
            return await fetchQWeatherAirSnapshot(latitude, longitude);
        } catch (error) {
            error.provider = 'qweather';
            errors.push(error);
        }
    }

    // 2. AQICN (China national monitoring stations, real EPA data)
    if (AQICN_TOKEN) {
        try {
            return await fetchAqicnAirSnapshot(latitude, longitude);
        } catch (error) {
            error.provider = 'aqicn';
            errors.push(error);
        }
    }

    // 3. Open-Meteo (global fallback, CAMS model)
    try {
        return await fetchOpenMeteoAirQualitySnapshot(latitude, longitude);
    } catch (error) {
        error.provider = 'open_meteo';
        errors.push(error);
        const aggregate = new Error('All air quality providers failed');
        aggregate.statusCode = error.statusCode || 502;
        aggregate.details = errors.map((item) => ({
            provider: item.provider || 'unknown',
            statusCode: item.statusCode,
            message: item.message,
        }));
        throw aggregate;
    }
}

module.exports = {
    // Individual providers
    fetchQWeatherWeatherSnapshot,
    fetchQWeatherAirSnapshot,
    fetchAmapWeatherSnapshot,
    fetchOpenMeteoWeatherSnapshot,
    fetchOpenMeteoAirQualitySnapshot,
    fetchAqicnAirSnapshot,
    // Unified (with fallback)
    fetchWeatherSnapshot,
    fetchAirQualitySnapshot,
    // Utilities
    describeAqi,
    buildExerciseSuggestion,
    normalizeNumberValue,
};
