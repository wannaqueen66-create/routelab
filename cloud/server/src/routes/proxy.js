/**
 * Proxy Routes
 * Handles external API proxy endpoints: /api/weather, /api/geocode/*
 */

const express = require('express');
const createEnsureAuth = require('../middlewares/ensureAuth');
const { JWT_SECRET } = require('../config/index');

const {
    fetchWeatherSnapshot,
    fetchAirQualitySnapshot,
    describeAqi,
    buildExerciseSuggestion,
    normalizeNumberValue
} = require('../services/weatherService');

const {
    fetchAmapRegeo,
    reverseGeocode,
    normalizeCoordinate,
    buildCoordinateLabel,
    buildGeocodeCacheKey,
    getGeocodeCacheEntry,
    setGeocodeCacheEntry
} = require('../services/geocodeService');

const ensureAuth = createEnsureAuth({ jwtSecret: JWT_SECRET });
const router = express.Router();

// GET /api/weather
router.get('/weather', ensureAuth, async (req, res) => {
    const latitude = normalizeCoordinate(req.query.lat, { min: -90, max: 90 });
    const longitude = normalizeCoordinate(req.query.lon, { min: -180, max: 180 });
    if (latitude === null || longitude === null) {
        return res.status(400).json({ error: 'Invalid coordinates' });
    }

    try {
        const [weather, air] = await Promise.all([
            fetchWeatherSnapshot(latitude, longitude),
            fetchAirQualitySnapshot(latitude, longitude).catch(() => null),
        ]);

        const weatherFetchedAt = weather?.fetchedAt || Date.now();
        const airFetchedAt = air?.fetchedAt || null;
        const fetchedAt = Math.max(weatherFetchedAt, airFetchedAt || 0);

        const weatherCode = weather?.weatherCode ?? null;
        const temperature = normalizeNumberValue(weather?.temperature);
        const apparentTemperature = normalizeNumberValue(weather?.apparentTemperature);
        const humidity = normalizeNumberValue(weather?.humidity);
        const windSpeed = normalizeNumberValue(weather?.windSpeed);
        const windDirection = weather?.windDirection ?? null;

        const aqiValue = normalizeNumberValue(air?.aqi);
        const { level: airLevel, category: airCategory } = describeAqi(aqiValue);

        const normalizeMetric = (val) => {
            const num = normalizeNumberValue(val);
            return Number.isFinite(num) ? num : null;
        };

        const suggestionText = buildExerciseSuggestion({
            temperature,
            aqi: aqiValue,
            weatherCode,
            windSpeed,
            humidity,
        });

        res.json({
            weather: {
                code: weatherCode,
                text: weather?.weatherText || null,
                temperature,
                apparentTemperature,
                humidity,
                windSpeed,
                windDirection,
                windDirectionText: weather?.windDirectionText || null,
                fetchedAt: weatherFetchedAt,
                source: weather?.source || 'unknown',
            },
            air: {
                aqi: aqiValue,
                level: airLevel,
                category: airCategory,
                pm25: normalizeMetric(air?.pm25 ?? air?.pm2p5),
                pm2p5: normalizeMetric(air?.pm2p5 ?? air?.pm25),
                pm10: normalizeMetric(air?.pm10),
                o3: normalizeMetric(air?.o3),
                so2: normalizeMetric(air?.so2),
                no2: normalizeMetric(air?.no2),
                co: normalizeMetric(air?.co),
                fetchedAt: airFetchedAt,
            },
            fetchedAt,
            suggestion: suggestionText,
        });
    } catch (error) {
        console.error('GET /api/weather failed', error);
        const status = error.statusCode || 502;
        res.status(status).json({ error: 'Failed to fetch weather data' });
    }
});

// GET /api/geocode/reverse
router.get('/geocode/reverse', ensureAuth, async (req, res) => {
    const latitude = normalizeCoordinate(req.query.lat, { min: -90, max: 90 });
    const longitude = normalizeCoordinate(req.query.lon, { min: -180, max: 180 });
    if (latitude === null || longitude === null) {
        return res.status(400).json({ error: 'Invalid coordinates' });
    }
    try {
        const cacheKey = buildGeocodeCacheKey('legacy-regeo', latitude, longitude, 'simple');
        const cached = getGeocodeCacheEntry(cacheKey);
        if (cached) {
            return res.json(cached);
        }
        let payload;
        try {
            payload = await fetchAmapRegeo({ latitude, longitude, radius: 60, extensions: 'all' });
        } catch (amapError) {
            console.warn('Legacy /api/geocode/reverse falling back to Nominatim', amapError.message);
            const fallback = await reverseGeocode(latitude, longitude);
            setGeocodeCacheEntry(cacheKey, fallback);
            return res.json(fallback);
        }
        const regeocode = payload.regeocode || {};
        const address = regeocode.addressComponent || {};
        const name =
            regeocode.formatted_address ||
            (Array.isArray(regeocode.aois) && regeocode.aois[0]?.name) ||
            (Array.isArray(regeocode.pois) && regeocode.pois[0]?.name) ||
            regeocode.road || address.neighborhood || address.district || address.city || '未知地点';
        const simplified = {
            name,
            displayName: regeocode.formatted_address || name,
            address: address,
            raw: payload,
        };
        setGeocodeCacheEntry(cacheKey, simplified);
        res.json(simplified);
    } catch (error) {
        console.error('GET /api/geocode/reverse failed', error);
        const fallbackLabel = buildCoordinateLabel(latitude, longitude);
        const fallbackPayload = {
            name: fallbackLabel,
            displayName: fallbackLabel,
            address: { latitude, longitude },
            raw: null,
            fallback: true,
        };
        res.status(200).json(fallbackPayload);
    }
});

module.exports = router;
