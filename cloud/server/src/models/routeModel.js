/**
 * Route Model
 * Database operations for routes, likes, and comments
 */

const { pool } = require('../db/index');
const { calculateSegmentDistanceMeters } = require('../utils/geo');

// === Route CRUD ===

async function getRouteById(routeId) {
    const result = await pool.query(
        `SELECT * FROM routes WHERE id = $1`,
        [routeId]
    );
    return result.rows[0] || null;
}

async function getRoutesByUserId(userId, options = {}) {
    const { includeDeleted = false, limit = 100, offset = 0 } = options;
    const conditions = ['user_id = $1'];
    if (!includeDeleted) {
        conditions.push('deleted_at IS NULL');
    }
    const whereClause = conditions.join(' AND ');
    const result = await pool.query(
        `SELECT * FROM routes WHERE ${whereClause} ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
        [userId, limit, offset]
    );
    return result.rows;
}

async function getAllRouteIdsByUserId(userId, options = {}) {
    const { includeDeleted = false } = options;
    const conditions = ['user_id = $1'];
    if (!includeDeleted) {
        conditions.push('deleted_at IS NULL');
    }
    const whereClause = conditions.join(' AND ');
    const result = await pool.query(
        `SELECT id FROM routes WHERE ${whereClause}`,
        [userId]
    );
    return result.rows.map((row) => row.id).filter(Boolean);
}

async function createRoute(userId, routeData) {
    const {
        id,
        clientId,
        name,
        privacyLevel = 'private',
        activityType = 'walk',
        purposeCode = null,
        startTime,
        endTime,
        stats = {},
        meta = {},
        routeFeedback = null,
        photos = [],
        points = [],
        weather = null,
        confirmedEndLatitude: directConfirmedEndLatitude = null,
        confirmedEndLongitude: directConfirmedEndLongitude = null,
        confirmedEndDistanceMeters: directConfirmedEndDistanceMeters = null,
        rawEndLatitude: directRawEndLatitude = null,
        rawEndLongitude: directRawEndLongitude = null,
        feedbackSatisfactionScore: directFeedbackSatisfactionScore = null,
        feedbackPreferenceLabels = null,
        feedbackReasonText: directFeedbackReasonText = null,
        feedbackSource: directFeedbackSource = null,
    } = routeData;

    const feedbackChoice = routeFeedback?.preferenceChoice || (Array.isArray(feedbackPreferenceLabels) ? feedbackPreferenceLabels[0] : null) || null;
    const feedbackSatisfactionScore = Number.isFinite(Number(routeFeedback?.satisfactionScore))
        ? Number(routeFeedback.satisfactionScore)
        : (Number.isFinite(Number(directFeedbackSatisfactionScore)) ? Number(directFeedbackSatisfactionScore) : null);
    const feedbackPreferenceLabel = routeFeedback?.preferenceLabel || (Array.isArray(feedbackPreferenceLabels) ? feedbackPreferenceLabels.join(',') : null) || null;
    const feedbackReasonText = routeFeedback?.preferenceReason || directFeedbackReasonText || null;
    const feedbackSource = routeFeedback?.recommendationSource || directFeedbackSource || null;
    const rawEndPoint = Array.isArray(points) && points.length ? points[points.length - 1] : meta?.endPoint || null;
    const confirmedEnd = routeFeedback?.confirmedEnd || null;
    const rawEndLatitude = Number.isFinite(Number(rawEndPoint?.latitude)) ? Number(rawEndPoint.latitude) : (Number.isFinite(Number(directRawEndLatitude)) ? Number(directRawEndLatitude) : null);
    const rawEndLongitude = Number.isFinite(Number(rawEndPoint?.longitude)) ? Number(rawEndPoint.longitude) : (Number.isFinite(Number(directRawEndLongitude)) ? Number(directRawEndLongitude) : null);
    const confirmedEndLatitude = Number.isFinite(Number(confirmedEnd?.latitude)) ? Number(confirmedEnd.latitude) : (Number.isFinite(Number(directConfirmedEndLatitude)) ? Number(directConfirmedEndLatitude) : null);
    const confirmedEndLongitude = Number.isFinite(Number(confirmedEnd?.longitude)) ? Number(confirmedEnd.longitude) : (Number.isFinite(Number(directConfirmedEndLongitude)) ? Number(directConfirmedEndLongitude) : null);
    const confirmedEndDistanceMeters =
        Number.isFinite(rawEndLatitude) && Number.isFinite(rawEndLongitude) && Number.isFinite(confirmedEndLatitude) && Number.isFinite(confirmedEndLongitude)
            ? calculateSegmentDistanceMeters(
                { latitude: rawEndLatitude, longitude: rawEndLongitude },
                { latitude: confirmedEndLatitude, longitude: confirmedEndLongitude }
              )
            : (Number.isFinite(Number(directConfirmedEndDistanceMeters)) ? Number(directConfirmedEndDistanceMeters) : null);

    const result = await pool.query(
        `INSERT INTO routes (
      id, user_id, client_id, name, privacy_level, activity_type, purpose_code,
      start_time, end_time, stats, meta, photos, weather,
      feedback_choice, feedback_satisfaction_score, feedback_preference_label,
      feedback_reason_text, feedback_source, feedback_submitted_at,
      raw_end_latitude, raw_end_longitude, confirmed_end_latitude, confirmed_end_longitude, confirmed_end_distance_meters,
      created_at, updated_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, NOW(), NOW())
    RETURNING *`,
        [
            id,
            userId,
            clientId || null,
            name || null,
            privacyLevel,
            activityType,
            purposeCode,
            startTime || null,
            endTime || null,
            JSON.stringify(stats),
            JSON.stringify({ ...(meta || {}), routeFeedback: routeFeedback || meta?.routeFeedback || null }),
            JSON.stringify(photos),
            weather ? JSON.stringify(weather) : null,
            feedbackChoice,
            feedbackSatisfactionScore,
            feedbackPreferenceLabel,
            feedbackReasonText,
            feedbackSource,
            routeFeedback ? new Date() : null,
            rawEndLatitude,
            rawEndLongitude,
            confirmedEndLatitude,
            confirmedEndLongitude,
            confirmedEndDistanceMeters,
        ]
    );

    const route = result.rows[0];

    // Insert points if provided
    if (Array.isArray(points) && points.length > 0) {
        await insertRoutePoints(route.id, points);
    }

    return route;
}

async function updateRoute(routeId, userId, updateData) {
    const {
        name,
        privacyLevel,
        activityType,
        purposeCode,
        stats,
        meta,
        routeFeedback,
        photos,
    } = updateData;

    const setClauses = [];
    const params = [];
    let paramIndex = 1;

    if (name !== undefined) {
        setClauses.push(`name = $${paramIndex++}`);
        params.push(name);
    }
    if (privacyLevel !== undefined) {
        setClauses.push(`privacy_level = $${paramIndex++}`);
        params.push(privacyLevel);
    }
    if (activityType !== undefined) {
        setClauses.push(`activity_type = $${paramIndex++}`);
        params.push(activityType);
    }
    if (purposeCode !== undefined) {
        setClauses.push(`purpose_code = $${paramIndex++}`);
        params.push(purposeCode);
    }
    if (stats !== undefined) {
        setClauses.push(`stats = $${paramIndex++}`);
        params.push(JSON.stringify(stats));
    }
    if (meta !== undefined || routeFeedback !== undefined) {
        setClauses.push(`meta = $${paramIndex++}`);
        const nextMeta = {
            ...((meta && typeof meta === 'object') ? meta : {}),
            routeFeedback: routeFeedback !== undefined ? routeFeedback : (meta && meta.routeFeedback) || null,
        };
        params.push(JSON.stringify(nextMeta));
    }
    if (photos !== undefined) {
        setClauses.push(`photos = $${paramIndex++}`);
        params.push(JSON.stringify(photos));
    }
    if (routeFeedback !== undefined) {
        const rawEndPoint = (meta && meta.endPoint) || null;
        const rawEndLatitude = Number.isFinite(Number(rawEndPoint?.latitude)) ? Number(rawEndPoint.latitude) : null;
        const rawEndLongitude = Number.isFinite(Number(rawEndPoint?.longitude)) ? Number(rawEndPoint.longitude) : null;
        const confirmedEndLatitude = Number.isFinite(Number(routeFeedback?.confirmedEnd?.latitude)) ? Number(routeFeedback.confirmedEnd.latitude) : null;
        const confirmedEndLongitude = Number.isFinite(Number(routeFeedback?.confirmedEnd?.longitude)) ? Number(routeFeedback.confirmedEnd.longitude) : null;
        const confirmedEndDistanceMeters =
            Number.isFinite(rawEndLatitude) && Number.isFinite(rawEndLongitude) && Number.isFinite(confirmedEndLatitude) && Number.isFinite(confirmedEndLongitude)
                ? calculateSegmentDistanceMeters(
                    { latitude: rawEndLatitude, longitude: rawEndLongitude },
                    { latitude: confirmedEndLatitude, longitude: confirmedEndLongitude }
                  )
                : null;

        setClauses.push(`feedback_choice = $${paramIndex++}`);
        params.push(routeFeedback?.preferenceChoice || null);

        setClauses.push(`feedback_satisfaction_score = $${paramIndex++}`);
        params.push(Number.isFinite(Number(routeFeedback?.satisfactionScore)) ? Number(routeFeedback.satisfactionScore) : null);

        setClauses.push(`feedback_preference_label = $${paramIndex++}`);
        params.push(routeFeedback?.preferenceLabel || null);

        setClauses.push(`feedback_reason_text = $${paramIndex++}`);
        params.push(routeFeedback?.preferenceReason || null);

        setClauses.push(`feedback_source = $${paramIndex++}`);
        params.push(routeFeedback?.recommendationSource || null);

        setClauses.push(`feedback_submitted_at = $${paramIndex++}`);
        params.push(routeFeedback ? new Date() : null);

        setClauses.push(`raw_end_latitude = $${paramIndex++}`);
        params.push(rawEndLatitude);

        setClauses.push(`raw_end_longitude = $${paramIndex++}`);
        params.push(rawEndLongitude);

        setClauses.push(`confirmed_end_latitude = $${paramIndex++}`);
        params.push(confirmedEndLatitude);

        setClauses.push(`confirmed_end_longitude = $${paramIndex++}`);
        params.push(confirmedEndLongitude);

        setClauses.push(`confirmed_end_distance_meters = $${paramIndex++}`);
        params.push(confirmedEndDistanceMeters);
    }

    if (setClauses.length === 0) {
        return null;
    }

    setClauses.push('updated_at = NOW()');
    params.push(routeId);
    params.push(userId);

    const result = await pool.query(
        `UPDATE routes SET ${setClauses.join(', ')}
     WHERE id = $${paramIndex++} AND user_id = $${paramIndex}
     RETURNING *`,
        params
    );

    return result.rows[0] || null;
}

async function softDeleteRoute(routeId, userId) {
    const result = await pool.query(
        `UPDATE routes SET deleted_at = NOW(), updated_at = NOW()
     WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL
     RETURNING id`,
        [routeId, userId]
    );
    return result.rows[0] || null;
}

// === Route Points ===

async function insertRoutePoints(routeId, points) {
    if (!Array.isArray(points) || points.length === 0) {
        return;
    }

    const values = [];
    const params = [];
    let paramIndex = 1;

    points.forEach((point, index) => {
        values.push(`($${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++})`);
        params.push(
            routeId,
            index,
            point.latitude,
            point.longitude,
            point.altitude || null,
            point.timestamp || null
        );
    });

    await pool.query(
        `INSERT INTO route_points (route_id, seq, latitude, longitude, altitude, timestamp)
     VALUES ${values.join(', ')}`,
        params
    );
}

async function getPointsByRouteId(routeId) {
    const result = await pool.query(
        `SELECT * FROM route_points WHERE route_id = $1 ORDER BY seq ASC`,
        [routeId]
    );
    return result.rows;
}

async function getPointsByRoute(routeIds) {
    if (!Array.isArray(routeIds) || routeIds.length === 0) {
        return {};
    }

    const result = await pool.query(
        `SELECT * FROM route_points WHERE route_id = ANY($1) ORDER BY route_id, seq ASC`,
        [routeIds]
    );

    const pointsByRoute = {};
    result.rows.forEach((point) => {
        if (!pointsByRoute[point.route_id]) {
            pointsByRoute[point.route_id] = [];
        }
        pointsByRoute[point.route_id].push(point);
    });

    return pointsByRoute;
}

// === Likes ===

async function addLike(routeId, userId) {
    await pool.query(
        `INSERT INTO route_likes (route_id, user_id)
     VALUES ($1, $2)
     ON CONFLICT (route_id, user_id) DO NOTHING`,
        [routeId, userId]
    );
}

async function removeLike(routeId, userId) {
    await pool.query(
        `DELETE FROM route_likes WHERE route_id = $1 AND user_id = $2`,
        [routeId, userId]
    );
}

async function getLikeCount(routeId) {
    const result = await pool.query(
        `SELECT COUNT(*) as count FROM route_likes WHERE route_id = $1`,
        [routeId]
    );
    return parseInt(result.rows[0]?.count || '0', 10);
}

async function hasUserLiked(routeId, userId) {
    const result = await pool.query(
        `SELECT 1 FROM route_likes WHERE route_id = $1 AND user_id = $2`,
        [routeId, userId]
    );
    return result.rows.length > 0;
}

// === Comments ===

async function addComment(routeId, userId, content, parentId = null) {
    const result = await pool.query(
        `INSERT INTO route_comments (route_id, user_id, content, parent_id)
     VALUES ($1, $2, $3, $4)
     RETURNING id, created_at`,
        [routeId, userId, content, parentId]
    );
    return result.rows[0];
}

async function getCommentsByRouteId(routeId, options = {}) {
    const { includeDeleted = false } = options;
    const conditions = ['route_id = $1'];
    if (!includeDeleted) {
        conditions.push('deleted_at IS NULL');
    }
    const whereClause = conditions.join(' AND ');
    const result = await pool.query(
        `SELECT c.*, u.nickname, u.avatar
     FROM route_comments c
     LEFT JOIN users u ON c.user_id = u.id
     WHERE ${whereClause}
     ORDER BY c.created_at ASC`,
        [routeId]
    );
    return result.rows;
}

async function getCommentCount(routeId) {
    const result = await pool.query(
        `SELECT COUNT(*) as count FROM route_comments WHERE route_id = $1 AND deleted_at IS NULL`,
        [routeId]
    );
    return parseInt(result.rows[0]?.count || '0', 10);
}

async function softDeleteComment(commentId, userId) {
    const result = await pool.query(
        `UPDATE route_comments SET deleted_at = NOW()
     WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL
     RETURNING id`,
        [commentId, userId]
    );
    return result.rows[0] || null;
}

// === Social Stats ===

async function fetchRouteSocialStats(routeId, userId) {
    const [likesResult, likedResult, commentsResult] = await Promise.all([
        pool.query('SELECT COUNT(*) as count FROM route_likes WHERE route_id = $1', [routeId]),
        userId
            ? pool.query('SELECT 1 FROM route_likes WHERE route_id = $1 AND user_id = $2', [routeId, userId])
            : Promise.resolve({ rows: [] }),
        pool.query(
            `SELECT COUNT(*) FILTER (WHERE parent_id IS NULL) as top_level,
              COUNT(*) FILTER (WHERE parent_id IS NOT NULL) as replies
       FROM route_comments WHERE route_id = $1 AND deleted_at IS NULL`,
            [routeId]
        ),
    ]);

    const likes = parseInt(likesResult.rows[0]?.count || '0', 10);
    const liked = likedResult.rows.length > 0;
    const topLevel = parseInt(commentsResult.rows[0]?.top_level || '0', 10);
    const replies = parseInt(commentsResult.rows[0]?.replies || '0', 10);

    return {
        likes,
        liked,
        comments: topLevel + replies,
        commentsTopLevel: topLevel,
        commentsReplies: replies,
    };
}

// === Route for Social (visibility check) ===

async function getRouteForSocial(routeId) {
    const result = await pool.query(
        `SELECT id, user_id, privacy_level, deleted_at FROM routes WHERE id = $1`,
        [routeId]
    );
    return result.rows[0] || null;
}

// === Public Routes ===

async function getPublicRoutes(options = {}) {
    const { limit = 24, offset = 0 } = options;
    const result = await pool.query(
        `SELECT r.*, u.nickname, u.avatar
     FROM routes r
     LEFT JOIN users u ON r.user_id = u.id
     WHERE r.privacy_level = 'public' AND r.deleted_at IS NULL
     ORDER BY r.created_at DESC
     LIMIT $1 OFFSET $2`,
        [limit, offset]
    );
    return result.rows;
}

// === Weather Backfill ===

async function updateRouteWeather(routeId, weather) {
    if (!routeId || !weather) return null;
    const result = await pool.query(
        `UPDATE routes SET weather = $1, updated_at = NOW()
     WHERE id = $2 AND weather IS NULL
     RETURNING id`,
        [JSON.stringify(weather), routeId]
    );
    return result.rows[0] || null;
}

module.exports = {
    // Route CRUD
    getRouteById,
    getRoutesByUserId,
    getAllRouteIdsByUserId,
    createRoute,
    updateRoute,
    softDeleteRoute,
    // Points
    insertRoutePoints,
    getPointsByRouteId,
    getPointsByRoute,
    // Likes
    addLike,
    removeLike,
    getLikeCount,
    hasUserLiked,
    // Comments
    addComment,
    getCommentsByRouteId,
    getCommentCount,
    softDeleteComment,
    // Social
    fetchRouteSocialStats,
    getRouteForSocial,
    // Public
    getPublicRoutes,
    // Weather backfill
    updateRouteWeather,
};
