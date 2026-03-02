/**
 * Route Routes
 * Handles /api/routes/* endpoints for route CRUD, likes, and comments
 */

const express = require('express');
const createEnsureAuth = require('../middlewares/ensureAuth');
const { pool } = require('../db/index');
const { JWT_SECRET, PUBLIC_ROUTE_LIMIT, ACTIVITY_TYPE_VALUES } = require('../config/index');
const { sanitizeEnumValue } = require('../utils/format');

const {
    getRouteById,
    getRoutesByUserId,
    softDeleteRoute,
    getPointsByRoute,
    addLike,
    removeLike,
    addComment,
    getCommentsByRouteId,
    softDeleteComment,
    fetchRouteSocialStats,
    getRouteForSocial,
    getPublicRoutes
} = require('../models/routeModel');

const ensureAuth = createEnsureAuth({ jwtSecret: JWT_SECRET });
const router = express.Router();

// Helper: Map route row to API response
function mapRouteRow(row, points = [], options = {}) {
    const { includePoints = false, includeOwner = false } = options;

    const result = {
        id: row.id,
        userId: row.user_id,
        clientId: row.client_id,
        name: row.name,
        title: row.name,
        activityType: row.activity_type,
        purposeCode: row.purpose_code,
        privacyLevel: row.privacy_level,
        startTime: row.start_time?.getTime() || null,
        endTime: row.end_time?.getTime() || null,
        stats: row.stats || {},
        meta: row.meta || {},
        photos: row.photos || [],
        weather: row.weather || null,
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
            timestamp: p.timestamp?.getTime() || null,
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
        res.json({ id: routeId, deleted: true });
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
