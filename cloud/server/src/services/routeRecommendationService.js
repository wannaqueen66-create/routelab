const fetch = require('node-fetch');
const { AMAP_WEB_KEY, AMAP_TIMEOUT_MS, WEATHER_USER_AGENT } = require('../config/index');

function toFiniteNumber(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
}

function normalizePoint(point = {}) {
    const latitude = toFiniteNumber(point.latitude);
    const longitude = toFiniteNumber(point.longitude);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
        return null;
    }
    return { latitude, longitude };
}

function buildAmapUrl(base, params = {}) {
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
    let timeoutId;
    const timeoutPromise = new Promise((_, reject) => {
        timeoutId = setTimeout(() => {
            const error = new Error('AMap route request timeout');
            error.statusCode = 504;
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
            const error = new Error(`AMap route request failed with status ${response.status}`);
            error.statusCode = response.status;
            throw error;
        }
        const payload = await response.json();
        if (payload?.status && payload.status !== '1') {
            const error = new Error(payload?.info || 'AMap route API returned error');
            error.statusCode = 502;
            throw error;
        }
        if (payload?.errcode && String(payload.errcode) !== '0') {
            const error = new Error(payload?.errmsg || 'AMap route API returned error');
            error.statusCode = 502;
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

function parsePolylineString(polylineText = '') {
    if (typeof polylineText !== 'string' || !polylineText.trim()) {
        return [];
    }
    return polylineText
        .split(';')
        .map((pair) => pair.split(','))
        .map(([longitude, latitude]) => ({
            latitude: Number(latitude),
            longitude: Number(longitude),
        }))
        .filter((point) => Number.isFinite(point.latitude) && Number.isFinite(point.longitude));
}

function dedupePolyline(points = []) {
    const deduped = [];
    points.forEach((point) => {
        const last = deduped[deduped.length - 1];
        if (last && last.latitude === point.latitude && last.longitude === point.longitude) {
            return;
        }
        deduped.push(point);
    });
    return deduped;
}

function parseStepsPolyline(steps = []) {
    const merged = [];
    (Array.isArray(steps) ? steps : []).forEach((step) => {
        const polyline = parsePolylineString(step?.polyline || step?.path || '');
        merged.push(...polyline);
    });
    return dedupePolyline(merged);
}

function pickArray(value) {
    return Array.isArray(value) ? value : [];
}

function extractCandidatePaths(payload, strategy) {
    const route = payload?.route || payload?.data || payload || {};
    const paths = [
        ...pickArray(route.paths),
        ...pickArray(route.path),
        ...pickArray(route.routes),
        ...pickArray(route.data?.paths),
    ];
    const fallbackPath = route?.path || route?.route || null;
    const rawPaths = paths.length ? paths : fallbackPath && typeof fallbackPath === 'object' ? [fallbackPath] : [];
    if (!rawPaths.length) {
        return [];
    }

    return rawPaths
        .map((pathItem) => {
            if (!pathItem || typeof pathItem !== 'object') {
                return null;
            }
            const points = dedupePolyline([
                ...parsePolylineString(pathItem.polyline || pathItem.path || ''),
                ...parseStepsPolyline(pathItem.steps || pathItem.segments || []),
            ]);
            if (!points.length) {
                return null;
            }
            const distanceMeters = toFiniteNumber(pathItem.distance || pathItem.dist || pathItem.total_distance);
            const durationSeconds = toFiniteNumber(pathItem.duration || pathItem.time || pathItem.cost?.duration);
            return {
                distanceMeters,
                durationSeconds,
                polyline: points,
                raw: pathItem,
                strategy,
            };
        })
        .filter(Boolean);
}

async function fetchWalkingRecommendation(start, end) {
    const url = buildAmapUrl('https://restapi.amap.com/v3/direction/walking', {
        origin: `${start.longitude},${start.latitude}`,
        destination: `${end.longitude},${end.latitude}`,
    });
    const payload = await executeAmapRequest(url);
    return extractCandidatePaths(payload, 'walking');
}

async function fetchDrivingRecommendation(start, end) {
    const url = buildAmapUrl('https://restapi.amap.com/v3/direction/driving', {
        origin: `${start.longitude},${start.latitude}`,
        destination: `${end.longitude},${end.latitude}`,
        strategy: '0',
        extensions: 'base',
    });
    const payload = await executeAmapRequest(url);
    return extractCandidatePaths(payload, 'driving');
}

async function fetchRidingRecommendation(start, end) {
    const candidates = [
        buildAmapUrl('https://restapi.amap.com/v4/direction/bicycling', {
            origin: `${start.longitude},${start.latitude}`,
            destination: `${end.longitude},${end.latitude}`,
        }),
        buildAmapUrl('https://restapi.amap.com/v5/direction/bicycling', {
            origin: `${start.longitude},${start.latitude}`,
            destination: `${end.longitude},${end.latitude}`,
            alternative_route: '0',
        }),
    ];

    let lastError = null;
    for (const url of candidates) {
        try {
            const payload = await executeAmapRequest(url);
            const extracted = extractCandidatePaths(payload, 'riding');
            if (extracted.length) {
                return extracted;
            }
        } catch (error) {
            lastError = error;
        }
    }
    if (lastError) {
        throw lastError;
    }
    return [];
}

function buildActualRecommendation(actualPoints = [], distanceMeters = 0, durationMs = 0) {
    const polyline = dedupePolyline((Array.isArray(actualPoints) ? actualPoints : []).map(normalizePoint).filter(Boolean));
    return {
        id: 'actual-route',
        provider: 'actual',
        title: '实际轨迹',
        summary: '本次真实记录路线',
        scoreHint: 'actual',
        distanceMeters: Number(distanceMeters) || 0,
        durationSeconds: Math.max(1, Math.round((Number(durationMs) || 0) / 1000)),
        polyline,
        isActual: true,
        strategy: 'actual',
    };
}

function toRecommendationItem(candidate, index, total = 1) {
    if (!candidate || !Array.isArray(candidate.polyline) || !candidate.polyline.length) {
        return null;
    }
    const strategy = candidate.strategy || `candidate_${index + 1}`;
    const titleBaseMap = {
        walking: '步行方案',
        riding: '骑行方案',
        driving: '驾车方案',
    };
    const summaryMap = {
        walking: '高德步行推荐路线',
        riding: '高德骑行推荐路线',
        driving: '高德驾车风格推荐路线',
    };
    const scoreHintMap = {
        walking: 'walking',
        riding: 'riding',
        driving: 'driving',
    };
    const titleBase = titleBaseMap[strategy] || '候选路线';
    const showIndex = total > 1 ? ` ${index + 1}` : '';
    return {
        id: `amap-${strategy}-${index + 1}`,
        provider: 'amap',
        title: `${titleBase}${showIndex}`,
        summary: summaryMap[strategy] || '高德推荐路线',
        distanceMeters: candidate.distanceMeters,
        durationSeconds: candidate.durationSeconds,
        scoreHint: scoreHintMap[strategy] || strategy,
        polyline: candidate.polyline,
        isActual: false,
        strategy,
    };
}

async function getRouteRecommendations({ start, end, actualPoints = [], distanceMeters = 0, durationMs = 0 } = {}) {
    const safeStart = normalizePoint(start);
    const safeEnd = normalizePoint(end);
    const actual = buildActualRecommendation(actualPoints, distanceMeters, durationMs);

    if (!AMAP_WEB_KEY || !safeStart || !safeEnd) {
        return {
            source: 'actual_only',
            recommendations: [actual],
        };
    }

    const [walkingSettled, ridingSettled, drivingSettled] = await Promise.allSettled([
        fetchWalkingRecommendation(safeStart, safeEnd),
        fetchRidingRecommendation(safeStart, safeEnd),
        fetchDrivingRecommendation(safeStart, safeEnd),
    ]);

    const candidates = [];

    const appendCandidates = (items, strategy) => {
        const list = Array.isArray(items) ? items : [];
        list.forEach((item, index) => {
            const mapped = toRecommendationItem(item, index, list.length || 1);
            if (mapped) {
                candidates.push(mapped);
            }
        });
    };

    if (walkingSettled.status === 'fulfilled') {
        appendCandidates(walkingSettled.value, 'walking');
    }
    if (ridingSettled.status === 'fulfilled') {
        appendCandidates(ridingSettled.value, 'riding');
    }
    if (drivingSettled.status === 'fulfilled') {
        appendCandidates(drivingSettled.value, 'driving');
    }

    return {
        source: candidates.length ? 'amap' : 'actual_only',
        recommendations: [actual, ...candidates],
    };
}

module.exports = {
    getRouteRecommendations,
};
