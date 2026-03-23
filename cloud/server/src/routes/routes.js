/**
 * Route Routes
 * Handles /api/routes/* endpoints for route CRUD, sync, likes, and comments
 */

const express = require('express');
const createEnsureAuth = require('../middlewares/ensureAuth');
const { JWT_SECRET, PUBLIC_ROUTE_LIMIT, ACTIVITY_TYPE_VALUES } = require('../config/index');
const { sanitizeEnumValue, normalizeRouteId } = require('../utils/format');

const {
    getRouteById,
    getRoutesByUserId,
    getAllRouteIdsByUserId,
    createRoute,
    updateRoute,
    softDeleteRoute,
    getPointsByRoute,
    addLike,
    removeLike,
    addComment,
    getCommentsByRouteId,
    softDeleteComment,
    fetchRouteSocialStats,
    getRouteForSocial,
    getPublicRoutes,
    updateRouteWeather,
} = require('../models/routeModel');

const {
    fetchWeatherSnapshot,
    fetchAirQualitySnapshot,
    describeAqi,
    buildExerciseSuggestion,
} = require('../services/weatherService');
const { getRouteRecommendations } = require('../services/routeRecommendationService');

const ensureAuth = createEnsureAuth({ jwtSecret: JWT_SECRET });
const router = express.Router();

// --- Async weather backfill (fire-and-forget after route creation) ---
function backfillWeatherForRoute(routeId, points) {
    if (!Array.isArray(points) || points.length === 0) return;
    // Use the first point as the location reference
    const first = points[0];
    const lat = Number(first.latitude);
    const lon = Number(first.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;

    // Fire-and-forget: don't await, don't block response
    (async () => {
        try {
            const [weather, air] = await Promise.all([
                fetchWeatherSnapshot(lat, lon),
                fetchAirQualitySnapshot(lat, lon).catch(() => null),
            ]);

            const aqi = air?.aqi ?? null;
            const { level: airLevel, category: airCategory } = describeAqi(aqi);
            const suggestion = buildExerciseSuggestion({
                temperature: weather?.temperature,
                aqi,
                weatherCode: weather?.weatherCode,
                windSpeed: weather?.windSpeed,
                humidity: weather?.humidity,
            });

            const weatherSnapshot = {
                temperature: weather?.temperature ?? null,
                apparentTemperature: weather?.apparentTemperature ?? null,
                weatherCode: weather?.weatherCode ?? null,
                weatherText: weather?.weatherText || null,
                humidity: weather?.humidity ?? null,
                windSpeed: weather?.windSpeed ?? null,
                windDirection: weather?.windDirection ?? null,
                windDirectionText: weather?.windDirectionText || null,
                aqi,
                airLevel,
                airCategory,
                pm25: air?.pm25 ?? air?.pm2p5 ?? null,
                suggestion,
                source: weather?.source || 'unknown',
                fetchedAt: weather?.fetchedAt || Date.now(),
            };

            await updateRouteWeather(routeId, weatherSnapshot);
        } catch (err) {
            console.error(`[weather-backfill] route=${routeId} failed:`, err.message);
        }
    })();
}


const PRIVACY_LEVEL_VALUES = new Set(['private', 'public']);

function normalizePrivacyLevel(value, fallback = 'private') {
    if (typeof value !== 'string') {
        return fallback;
    }
    const normalized = value.trim().toLowerCase();
    return PRIVACY_LEVEL_VALUES.has(normalized) ? normalized : fallback;
}

function normalizeTimestamp(value) {
    if (value === null || value === undefined || value === '') {
        return null;
    }
    if (value instanceof Date) {
        return Number.isFinite(value.getTime()) ? value : null;
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
        const date = new Date(value);
        return Number.isFinite(date.getTime()) ? date : null;
    }
    if (typeof value === 'string') {
        const numeric = Number(value);
        if (Number.isFinite(numeric)) {
            const date = new Date(numeric);
            return Number.isFinite(date.getTime()) ? date : null;
        }
        const date = new Date(value);
        return Number.isFinite(date.getTime()) ? date : null;
    }
    return null;
}

function normalizePhotos(value) {
    if (!Array.isArray(value)) {
        return [];
    }
    return value.filter(Boolean);
}

function normalizeRouteFeedback(value) {
    if (!value || typeof value !== 'object') {
        return null;
    }
    const recommendationOptions = Array.isArray(value.recommendationOptions)
        ? value.recommendationOptions
            .filter((item) => item && typeof item === 'object')
            .map((item) => ({
                id: item.id || null,
                title: item.title || null,
                summary: item.summary || null,
                provider: item.provider || null,
                scoreHint: item.scoreHint || null,
                strategy: item.strategy || null,
                isActual: item.isActual === true,
                distanceMeters: Number.isFinite(Number(item.distanceMeters)) ? Number(item.distanceMeters) : null,
                durationSeconds: Number.isFinite(Number(item.durationSeconds)) ? Number(item.durationSeconds) : null,
            }))
        : [];

    const confirmedEnd = value.confirmedEnd && typeof value.confirmedEnd === 'object'
        ? {
            latitude: Number.isFinite(Number(value.confirmedEnd.latitude)) ? Number(value.confirmedEnd.latitude) : null,
            longitude: Number.isFinite(Number(value.confirmedEnd.longitude)) ? Number(value.confirmedEnd.longitude) : null,
        }
        : null;

    return {
        satisfactionScore: Number.isFinite(Number(value.satisfactionScore)) ? Number(value.satisfactionScore) : null,
        satisfactionLabel: typeof value.satisfactionLabel === 'string' ? value.satisfactionLabel.trim() : '',
        preferenceChoice: typeof value.preferenceChoice === 'string' ? value.preferenceChoice.trim() : '',
        preferenceLabel: typeof value.preferenceLabel === 'string' ? value.preferenceLabel.trim() : '',
        preferenceReason: typeof value.preferenceReason === 'string' ? value.preferenceReason.trim() : '',
        recommendationSource: typeof value.recommendationSource === 'string' ? value.recommendationSource.trim() : '',
        questionnaireStage: typeof value.questionnaireStage === 'string' ? value.questionnaireStage.trim() : '',
        confirmedEnd,
        recommendationOptions,
        updatedAt: Date.now(),
    };
}

function normalizePoints(value) {
    if (!Array.isArray(value)) {
        return [];
    }
    return value
        .map((point) => {
            if (!point || typeof point !== 'object') {
                return null;
            }
            const latitude = Number(point.latitude);
            const longitude = Number(point.longitude);
            if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
                return null;
            }
            const altitude = Number(point.altitude);
            const timestamp = normalizeTimestamp(point.timestamp || point.recordedAt || point.time);
            return {
                latitude,
                longitude,
                altitude: Number.isFinite(altitude) ? altitude : null,
                timestamp,
            };
        })
        .filter(Boolean);
}

function normalizeRoutePayload(input = {}, { routeId = null } = {}) {
    const body = input && typeof input === 'object' ? input : {};
    const meta = body.meta && typeof body.meta === 'object' ? body.meta : {};
    const stats = body.stats && typeof body.stats === 'object' ? body.stats : {};
    const routeFeedback = normalizeRouteFeedback(
        body.routeFeedback || meta.routeFeedback || body.route_feedback || null
    );

    const normalizedId = normalizeRouteId(routeId || body.id);
    const clientId = normalizeRouteId(body.clientId);
    const nameCandidate = typeof body.title === 'string' ? body.title : body.name;
    const name = typeof nameCandidate === 'string' ? nameCandidate.trim() : '';
    const privacyLevel = normalizePrivacyLevel(body.privacyLevel, 'private');

    const activityType = sanitizeEnumValue(
        body.activityType || meta.activityType,
        ACTIVITY_TYPE_VALUES
    ) || 'walk';

    const purposeCode =
        typeof body.purposeCode === 'string' && body.purposeCode.trim()
            ? body.purposeCode.trim()
            : typeof body.purposeType === 'string' && body.purposeType.trim()
                ? body.purposeType.trim()
                : null;

    return {
        id: normalizedId,
        clientId,
        name,
        privacyLevel,
        activityType,
        purposeCode,
        startTime: normalizeTimestamp(body.startTime),
        endTime: normalizeTimestamp(body.endTime),
        stats,
        meta: {
            ...meta,
            routeFeedback,
        },
        routeFeedback,
        photos: normalizePhotos(body.photos),
        points: normalizePoints(body.points),
        weather: body.weather && typeof body.weather === 'object' ? body.weather : null,
    };
}

// Helper: Map route row to API response
function mapRouteRow(row, points = [], options = {}) {
    const { includePoints = false, includeOwner = false } = options;

    const routeName = row.name || row.title || null;
    const routeMeta = row.meta || {};
    const routeActivityType = row.activity_type || routeMeta.activityType || 'walk';

    const result = {
        id: row.id,
        userId: row.user_id,
        clientId: row.client_id,
        name: routeName,
        title: routeName,
        activityType: routeActivityType,
        purposeCode: row.purpose_code || routeMeta.purposeType || null,
        privacyLevel: row.privacy_level,
        startTime: row.start_time?.getTime() || null,
        endTime: row.end_time?.getTime() || null,
        stats: row.stats || {},
        meta: routeMeta,
        photos: row.photos || [],
        weather: row.weather || null,
        routeFeedback: routeMeta.routeFeedback || null,
        feedbackChoice: row.feedback_choice || null,
        feedbackSatisfactionScore:
            row.feedback_satisfaction_score !== null && row.feedback_satisfaction_score !== undefined
                ? Number(row.feedback_satisfaction_score)
                : null,
        feedbackPreferenceLabel: row.feedback_preference_label || null,
        feedbackReasonText: row.feedback_reason_text || null,
        feedbackSource: row.feedback_source || null,
        feedbackSubmittedAt: row.feedback_submitted_at?.getTime() || null,
        pointCount: points.length,
        createdAt: row.created_at?.getTime() || null,
        updatedAt: row.updated_at?.getTime() || null,
        deletedAt: row.deleted_at?.getTime() || null,
    };

    if (includePoints) {
        result.points = points.map((p) => ({
            latitude: p.latitude,
            longitude: p.longitude,
            altitude: p.altitude,
            timestamp: p.timestamp?.getTime() || p.recorded_at?.getTime() || null,
        }));
    }

    if (includeOwner && row.owner_nickname) {
        result.owner = {
            nickname: row.owner_nickname,
            avatar: row.owner_avatar,
        };
    }

    return result;
}

// === Sync ===

// POST /api/routes/sync
router.post('/sync', ensureAuth, async (req, res) => {
    if (!req.userId) {
        return res.status(403).json({ error: 'User context required' });
    }

    const body = req.body || {};
    const includeDeleted = body.includeDeleted !== false;
    const limit = Math.min(Math.max(Number(body.limit) || 200, 1), 500);
    const lastSyncAt = Math.max(Number(body.lastSyncAt) || 0, 0);
    const cursor = Math.max(Number(body.cursor) || 0, 0);
    const knownRemoteIds = Array.isArray(body.knownRemoteIds)
        ? body.knownRemoteIds.map((id) => normalizeRouteId(id)).filter(Boolean)
        : [];

    try {
        const routes = await getRoutesByUserId(req.userId, {
            includeDeleted: true,
            limit: limit + 1,
            offset: cursor,
        });

        const pageRows = routes.slice(0, limit);
        const hasMore = routes.length > limit;
        const nextCursor = hasMore ? cursor + limit : null;

        const routeIds = pageRows.map((r) => r.id);
        const pointsByRoute = await getPointsByRoute(routeIds);

        const allMapped = pageRows.map((row) =>
            mapRouteRow(row, pointsByRoute[row.id] || [], {
                includePoints: true,
            })
        );

        const afterFiltered = allMapped.filter((item) => {
            const updatedAt = Number(item.updatedAt || item.createdAt || 0);
            return updatedAt > lastSyncAt;
        });

        const deletedIds = afterFiltered
            .filter((item) => item.deletedAt)
            .map((item) => item.id);

        const items = afterFiltered.filter((item) => !item.deletedAt);
        const allRouteIds = await getAllRouteIdsByUserId(req.userId, { includeDeleted: true });
        const fullRemoteIdSet = new Set(allRouteIds);
        const missingRemoteIds = knownRemoteIds.filter((id) => !fullRemoteIdSet.has(id));

        res.json({
            items,
            deletedIds: includeDeleted ? deletedIds : [],
            missingRemoteIds,
            lastSyncAt: Date.now(),
            limit,
            cursor,
            nextCursor,
            hasMore,
        });
    } catch (error) {
        console.error('POST /api/routes/sync failed', error);
        res.status(500).json({ error: 'Failed to sync routes' });
    }
});

// === Route Recommendations ===

router.post('/recommendations', ensureAuth, async (req, res) => {
    try {
        const body = req.body || {};
        const start = body.start && typeof body.start === 'object' ? body.start : null;
        const end = body.end && typeof body.end === 'object' ? body.end : null;
        const actualPoints = Array.isArray(body.actualPoints) ? body.actualPoints : [];
        const distanceMeters = Number(body.distanceMeters) || 0;
        const durationMs = Number(body.durationMs) || 0;

        const payload = await getRouteRecommendations({
            start,
            end,
            actualPoints,
            distanceMeters,
            durationMs,
        });

        return res.json(payload);
    } catch (error) {
        console.error('POST /api/routes/recommendations failed', error);
        return res.status(500).json({ error: 'Failed to build route recommendations' });
    }
});

// === Route CRUD ===

// POST /api/routes
router.post('/', ensureAuth, async (req, res) => {
    if (!req.userId) {
        return res.status(403).json({ error: 'User context required' });
    }

    const payload = normalizeRoutePayload(req.body || {});
    if (!payload.id) {
        return res.status(400).json({ error: 'Route id is required' });
    }

    try {
        const existing = await getRouteById(payload.id);
        if (existing) {
            if (existing.user_id !== req.userId) {
                return res.status(403).json({ error: 'Route id already exists for another user' });
            }
            return res.status(409).json({ error: 'Route already exists' });
        }

        const created = await createRoute(req.userId, payload);
        const pointsByRoute = await getPointsByRoute([created.id]);
        const item = mapRouteRow(created, pointsByRoute[created.id] || [], { includePoints: true });

        // Async weather backfill (non-blocking)
        if (!payload.weather) {
            backfillWeatherForRoute(created.id, payload.points);
        }

        res.status(201).json({
            route: item,
            lastSyncAt: Date.now(),
        });
    } catch (error) {
        console.error('POST /api/routes failed', error);
        res.status(500).json({ error: 'Failed to create route' });
    }
});

// PUT /api/routes/:id (upsert)
router.put('/:id', ensureAuth, async (req, res) => {
    if (!req.userId) {
        return res.status(403).json({ error: 'User context required' });
    }

    const routeId = normalizeRouteId(req.params.id);
    if (!routeId) {
        return res.status(400).json({ error: 'Route id is required' });
    }

    const payload = normalizeRoutePayload(req.body || {}, { routeId });
    payload.id = routeId;

    try {
        const existing = await getRouteById(routeId);

        if (!existing) {
            const created = await createRoute(req.userId, payload);
            const pointsByRoute = await getPointsByRoute([created.id]);
            const item = mapRouteRow(created, pointsByRoute[created.id] || [], { includePoints: true });

            // Async weather backfill (non-blocking)
            if (!payload.weather) {
                backfillWeatherForRoute(created.id, payload.points);
            }

            return res.status(201).json({ route: item, upserted: 'created', lastSyncAt: Date.now() });
        }

        if (existing.user_id !== req.userId) {
            return res.status(403).json({ error: 'Access denied' });
        }

        const updated = await updateRoute(routeId, req.userId, {
            name: payload.name,
            privacyLevel: payload.privacyLevel,
            activityType: payload.activityType,
            purposeCode: payload.purposeCode,
            stats: payload.stats,
            meta: payload.meta,
            routeFeedback: payload.routeFeedback,
            photos: payload.photos,
        });

        if (!updated) {
            return res.status(404).json({ error: 'Route not found' });
        }

        const pointsByRoute = await getPointsByRoute([updated.id]);
        const item = mapRouteRow(updated, pointsByRoute[updated.id] || [], { includePoints: true });
        return res.json({ route: item, upserted: 'updated', lastSyncAt: Date.now() });
    } catch (error) {
        console.error('PUT /api/routes/:id failed', error);
        return res.status(500).json({ error: 'Failed to upsert route' });
    }
});

// PATCH /api/routes/:id
router.patch('/:id', ensureAuth, async (req, res) => {
    if (!req.userId) {
        return res.status(403).json({ error: 'User context required' });
    }

    const routeId = normalizeRouteId(req.params.id);
    if (!routeId) {
        return res.status(400).json({ error: 'Route ID is required' });
    }

    const body = req.body || {};
    const hasKnownField =
        body.name !== undefined ||
        body.title !== undefined ||
        body.privacyLevel !== undefined ||
        body.activityType !== undefined ||
        body.purposeCode !== undefined ||
        body.purposeType !== undefined ||
        body.stats !== undefined ||
        body.meta !== undefined ||
        body.routeFeedback !== undefined ||
        body.route_feedback !== undefined ||
        body.photos !== undefined;

    if (!hasKnownField) {
        return res.status(400).json({ error: 'No patchable fields provided' });
    }

    const normalizedActivity =
        body.activityType !== undefined
            ? sanitizeEnumValue(body.activityType, ACTIVITY_TYPE_VALUES)
            : undefined;

    const patch = {
        name:
            body.title !== undefined
                ? String(body.title || '').trim()
                : body.name !== undefined
                    ? String(body.name || '').trim()
                    : undefined,
        privacyLevel:
            body.privacyLevel !== undefined
                ? normalizePrivacyLevel(body.privacyLevel, 'private')
                : undefined,
        activityType: body.activityType !== undefined ? normalizedActivity || 'walk' : undefined,
        purposeCode:
            body.purposeCode !== undefined
                ? body.purposeCode
                : body.purposeType !== undefined
                    ? body.purposeType
                    : undefined,
        stats: body.stats !== undefined && typeof body.stats === 'object' ? body.stats : undefined,
        meta: body.meta !== undefined && typeof body.meta === 'object' ? body.meta : undefined,
        routeFeedback:
            body.routeFeedback !== undefined || body.route_feedback !== undefined
                ? normalizeRouteFeedback(body.routeFeedback || body.route_feedback || null)
                : undefined,
        photos: body.photos !== undefined ? normalizePhotos(body.photos) : undefined,
    };

    try {
        const updated = await updateRoute(routeId, req.userId, patch);
        if (!updated) {
            return res.status(404).json({ error: 'Route not found or not owned by user' });
        }
        const pointsByRoute = await getPointsByRoute([updated.id]);
        const item = mapRouteRow(updated, pointsByRoute[updated.id] || [], { includePoints: true });
        return res.json({ route: item, lastSyncAt: Date.now() });
    } catch (error) {
        console.error('PATCH /api/routes/:id failed', error);
        return res.status(500).json({ error: 'Failed to patch route' });
    }
});

// === Public Routes ===

// GET /api/routes/public
router.get('/public', ensureAuth, async (req, res) => {
    const limit = Math.min(Math.max(Number(req.query.limit) || PUBLIC_ROUTE_LIMIT, 5), 50);
    const offset = Math.max(Number(req.query.offset) || 0, 0);
    try {
        const routes = await getPublicRoutes({ limit, offset });
        const routeIds = routes.map((r) => r.id);
        const pointsByRoute = await getPointsByRoute(routeIds);

        const items = routes.map((row) =>
            mapRouteRow(row, pointsByRoute[row.id] || [], {
                includePoints: false,
                includeOwner: true,
            })
        );

        res.json({ items, limit, offset });
    } catch (error) {
        console.error('GET /api/routes/public failed', error);
        res.status(500).json({ error: 'Failed to fetch public routes' });
    }
});

// === User's Routes ===

// GET /api/routes
router.get('/', ensureAuth, async (req, res) => {
    if (!req.userId) {
        return res.status(403).json({ error: 'User context required' });
    }
    const limit = Math.min(Math.max(Number(req.query.limit) || 100, 10), 500);
    const offset = Math.max(Number(req.query.offset) || 0, 0);
    const includeDeleted = req.query.includeDeleted === 'true';

    try {
        const routes = await getRoutesByUserId(req.userId, { includeDeleted, limit, offset });
        const routeIds = routes.map((r) => r.id);
        const pointsByRoute = await getPointsByRoute(routeIds);

        const items = routes.map((row) =>
            mapRouteRow(row, pointsByRoute[row.id] || [], {
                includePoints: true,
            })
        );

        res.json({ items, total: items.length });
    } catch (error) {
        console.error('GET /api/routes failed', error);
        res.status(500).json({ error: 'Failed to fetch routes' });
    }
});

// GET /api/routes/:id
router.get('/:id', ensureAuth, async (req, res) => {
    const routeId = req.params.id;
    if (!routeId) {
        return res.status(400).json({ error: 'Route ID is required' });
    }

    try {
        const route = await getRouteById(routeId);
        if (!route) {
            return res.status(404).json({ error: 'Route not found' });
        }

        // Check access
        const isOwner = route.user_id === req.userId;
        const isAdmin = req.role === 'admin';
        const isPublic = route.privacy_level === 'public';

        if (!isOwner && !isAdmin && !isPublic) {
            return res.status(403).json({ error: 'Access denied' });
        }

        const pointsByRoute = await getPointsByRoute([routeId]);
        const points = pointsByRoute[routeId] || [];
        const stats = await fetchRouteSocialStats(routeId, req.userId);

        const mapped = mapRouteRow(route, points, { includePoints: true });
        res.json({ ...mapped, social: stats });
    } catch (error) {
        console.error('GET /api/routes/:id failed', error);
        res.status(500).json({ error: 'Failed to fetch route' });
    }
});

// DELETE /api/routes/:id
router.delete('/:id', ensureAuth, async (req, res) => {
    const routeId = req.params.id;
    if (!routeId) {
        return res.status(400).json({ error: 'Route ID is required' });
    }
    if (!req.userId) {
        return res.status(403).json({ error: 'User context required' });
    }

    try {
        const deleted = await softDeleteRoute(routeId, req.userId);
        if (!deleted) {
            return res.status(404).json({ error: 'Route not found or already deleted' });
        }
        res.json({ id: routeId, deleted: true, lastSyncAt: Date.now() });
    } catch (error) {
        console.error('DELETE /api/routes/:id failed', error);
        res.status(500).json({ error: 'Failed to delete route' });
    }
});

// === Likes ===

// POST /api/routes/:id/likes
router.post('/:id/likes', ensureAuth, async (req, res) => {
    const routeId = req.params.id;
    if (!routeId) {
        return res.status(400).json({ error: 'Route ID is required' });
    }
    if (!req.userId) {
        return res.status(403).json({ error: 'User context required' });
    }

    try {
        const route = await getRouteForSocial(routeId);
        if (!route) {
            return res.status(404).json({ error: 'Route not found' });
        }
        if (route.privacy_level !== 'public' && route.user_id !== req.userId) {
            return res.status(403).json({ error: 'Route is not public' });
        }

        await addLike(routeId, req.userId);
        const stats = await fetchRouteSocialStats(routeId, req.userId);
        res.json(stats);
    } catch (error) {
        console.error('POST /api/routes/:id/likes failed', error);
        res.status(500).json({ error: 'Failed to add like' });
    }
});

// DELETE /api/routes/:id/likes
router.delete('/:id/likes', ensureAuth, async (req, res) => {
    const routeId = req.params.id;
    if (!routeId) {
        return res.status(400).json({ error: 'Route ID is required' });
    }
    if (!req.userId) {
        return res.status(403).json({ error: 'User context required' });
    }

    try {
        await removeLike(routeId, req.userId);
        const stats = await fetchRouteSocialStats(routeId, req.userId);
        res.json(stats);
    } catch (error) {
        console.error('DELETE /api/routes/:id/likes failed', error);
        res.status(500).json({ error: 'Failed to remove like' });
    }
});

// === Comments ===

// GET /api/routes/:id/comments
router.get('/:id/comments', ensureAuth, async (req, res) => {
    const routeId = req.params.id;
    if (!routeId) {
        return res.status(400).json({ error: 'Route ID is required' });
    }

    try {
        const route = await getRouteForSocial(routeId);
        if (!route) {
            return res.status(404).json({ error: 'Route not found' });
        }
        if (route.privacy_level !== 'public' && route.user_id !== req.userId) {
            return res.status(403).json({ error: 'Route is not public' });
        }

        const comments = await getCommentsByRouteId(routeId);
        const stats = await fetchRouteSocialStats(routeId, req.userId);

        res.json({
            comments: comments.map((c) => ({
                id: c.id,
                userId: c.user_id,
                nickname: c.nickname,
                avatar: c.avatar,
                content: c.content,
                parentId: c.parent_id,
                createdAt: c.created_at?.getTime() || null,
            })),
            total: stats.comments,
            stats,
        });
    } catch (error) {
        console.error('GET /api/routes/:id/comments failed', error);
        res.status(500).json({ error: 'Failed to fetch comments' });
    }
});

// POST /api/routes/:id/comments
router.post('/:id/comments', ensureAuth, async (req, res) => {
    const routeId = req.params.id;
    if (!routeId) {
        return res.status(400).json({ error: 'Route ID is required' });
    }
    if (!req.userId) {
        return res.status(403).json({ error: 'User context required' });
    }

    const content = typeof req.body?.content === 'string' ? req.body.content.trim() : '';
    if (!content) {
        return res.status(400).json({ error: 'Comment content is required' });
    }
    if (content.length > 500) {
        return res.status(400).json({ error: 'Comment content is too long' });
    }

    const parentId = req.body?.parentId || null;

    try {
        const route = await getRouteForSocial(routeId);
        if (!route) {
            return res.status(404).json({ error: 'Route not found' });
        }
        if (route.privacy_level !== 'public' && route.user_id !== req.userId) {
            return res.status(403).json({ error: 'Route is not public' });
        }

        const inserted = await addComment(routeId, req.userId, content, parentId);
        const stats = await fetchRouteSocialStats(routeId, req.userId);

        res.status(201).json({
            comment: {
                id: inserted.id,
                routeId,
                userId: req.userId,
                content,
                parentId,
                createdAt: inserted.created_at?.getTime() || Date.now(),
            },
            stats,
        });
    } catch (error) {
        console.error('POST /api/routes/:id/comments failed', error);
        res.status(500).json({ error: 'Failed to add comment' });
    }
});

// DELETE /api/routes/:id/comments/:commentId
router.delete('/:id/comments/:commentId', ensureAuth, async (req, res) => {
    const { id: routeId, commentId } = req.params;
    if (!routeId || !commentId) {
        return res.status(400).json({ error: 'Route ID and Comment ID are required' });
    }
    if (!req.userId) {
        return res.status(403).json({ error: 'User context required' });
    }

    try {
        const deleted = await softDeleteComment(commentId, req.userId);
        if (!deleted) {
            return res.status(404).json({ error: 'Comment not found or not owned by user' });
        }
        const stats = await fetchRouteSocialStats(routeId, req.userId);
        res.json({ commentId, deleted: true, stats });
    } catch (error) {
        console.error('DELETE /api/routes/:id/comments/:commentId failed', error);
        res.status(500).json({ error: 'Failed to delete comment' });
    }
});

module.exports = router;
