/**
 * Admin Service
 * Business logic for admin operations including analytics, backup, and exports
 */

const fs = require('fs');
const path = require('path');
const { pool } = require('../db/index');
const {
    DEFAULT_PAGE_SIZE,
    ADMIN_EXPORT_LIMIT,
    BACKUP_STORAGE_PATH,
    ACTIVITY_TYPE_VALUES
} = require('../config/index');

// === Analytics ===

async function computeAdminAnalyticsSummary(rangeDays = 30) {
    const cutoff = new Date(Date.now() - rangeDays * 24 * 60 * 60 * 1000);

    const [usersResult, routesResult, activeUsersResult] = await Promise.all([
        pool.query('SELECT COUNT(*) as count FROM users'),
        pool.query(
            `SELECT COUNT(*) as total,
              COUNT(*) FILTER (WHERE created_at >= $1) as recent,
              SUM((stats->>'distance')::numeric) as total_distance,
              SUM((stats->>'calories')::numeric) as total_calories
       FROM routes WHERE deleted_at IS NULL`,
            [cutoff]
        ),
        pool.query(
            `SELECT COUNT(DISTINCT user_id) as count
       FROM routes WHERE created_at >= $1 AND deleted_at IS NULL`,
            [cutoff]
        ),
    ]);

    return {
        totalUsers: parseInt(usersResult.rows[0]?.count || '0', 10),
        totalRoutes: parseInt(routesResult.rows[0]?.total || '0', 10),
        recentRoutes: parseInt(routesResult.rows[0]?.recent || '0', 10),
        activeUsers: parseInt(activeUsersResult.rows[0]?.count || '0', 10),
        totalDistance: parseFloat(routesResult.rows[0]?.total_distance || '0'),
        totalCalories: parseFloat(routesResult.rows[0]?.total_calories || '0'),
        rangeDays,
    };
}

async function computeAdminAnalyticsTimeseries(rangeDays = 30) {
    const cutoff = new Date(Date.now() - rangeDays * 24 * 60 * 60 * 1000);

    const result = await pool.query(
        `SELECT DATE(created_at) as date,
            COUNT(*) as routes,
            COUNT(DISTINCT user_id) as users,
            SUM((stats->>'distance')::numeric) as distance
     FROM routes
     WHERE created_at >= $1 AND deleted_at IS NULL
     GROUP BY DATE(created_at)
     ORDER BY date ASC`,
        [cutoff]
    );

    return result.rows.map((row) => ({
        date: row.date,
        routes: parseInt(row.routes || '0', 10),
        users: parseInt(row.users || '0', 10),
        distance: parseFloat(row.distance || '0'),
    }));
}

async function computeCollectionDistribution(rangeDays = 30) {
    const cutoff = new Date(Date.now() - rangeDays * 24 * 60 * 60 * 1000);

    const result = await pool.query(
        `SELECT activity_type, COUNT(*) as count
     FROM routes
     WHERE created_at >= $1 AND deleted_at IS NULL AND activity_type IS NOT NULL
     GROUP BY activity_type
     ORDER BY count DESC`,
        [cutoff]
    );

    return result.rows.map((row) => ({
        activityType: row.activity_type,
        count: parseInt(row.count || '0', 10),
    }));
}

async function computePurposeDistribution(rangeDays = 30) {
    const cutoff = new Date(Date.now() - rangeDays * 24 * 60 * 60 * 1000);

    const result = await pool.query(
        `SELECT purpose_code, COUNT(*) as count
     FROM routes
     WHERE created_at >= $1 AND deleted_at IS NULL AND purpose_code IS NOT NULL
     GROUP BY purpose_code
     ORDER BY count DESC`,
        [cutoff]
    );

    return result.rows.map((row) => ({
        purposeCode: row.purpose_code,
        count: parseInt(row.count || '0', 10),
    }));
}

// === Backup ===

async function buildBackupSnapshot() {
    const [usersResult, routesResult, pointsResult] = await Promise.all([
        pool.query('SELECT * FROM users ORDER BY id'),
        pool.query('SELECT * FROM routes ORDER BY id'),
        pool.query('SELECT * FROM route_points ORDER BY route_id, seq'),
    ]);

    return {
        version: 1,
        createdAt: new Date().toISOString(),
        users: usersResult.rows,
        routes: routesResult.rows,
        routePoints: pointsResult.rows,
    };
}

async function saveBackupToDisk(snapshot) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `backup-${timestamp}.json`;
    const filepath = path.join(BACKUP_STORAGE_PATH, filename);

    // Ensure backup directory exists
    fs.mkdirSync(BACKUP_STORAGE_PATH, { recursive: true });

    fs.writeFileSync(filepath, JSON.stringify(snapshot, null, 2), 'utf-8');

    return { filename, filepath };
}

async function listAvailableBackups() {
    try {
        const files = fs.readdirSync(BACKUP_STORAGE_PATH);
        return files
            .filter((file) => file.startsWith('backup-') && file.endsWith('.json'))
            .map((file) => {
                const filepath = path.join(BACKUP_STORAGE_PATH, file);
                const stat = fs.statSync(filepath);
                return {
                    filename: file,
                    size: stat.size,
                    createdAt: stat.mtime.toISOString(),
                };
            })
            .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    } catch (error) {
        console.error('Failed to list backups', error);
        return [];
    }
}

function loadBackupFromDisk(filename) {
    const filepath = path.join(BACKUP_STORAGE_PATH, filename);
    const content = fs.readFileSync(filepath, 'utf-8');
    return JSON.parse(content);
}

// === CSV Export ===

function serializeCsvValue(value) {
    if (value === null || value === undefined) {
        return '';
    }
    if (typeof value === 'object') {
        return `"${JSON.stringify(value).replace(/"/g, '""')}"`;
    }
    const str = String(value);
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
        return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
}

function buildRoutesCsv(items = []) {
    const headers = [
        'ID',
        'User ID',
        'Title',
        'Start Time',
        'End Time',
        'Distance (m)',
        'Duration (s)',
        'Calories',
        'Point Count',
        'Activity Type',
        'Privacy',
        'Created At',
        'Updated At',
    ];

    const rows = items.map((route) => {
        const stats = route.stats || route.statSummary || {};
        return [
            route.id,
            route.ownerId ?? route.userId ?? '',
            route.title || route.name || '',
            route.startTime ? new Date(route.startTime).toISOString() : '',
            route.endTime ? new Date(route.endTime).toISOString() : '',
            stats.distance ?? stats.distance_m ?? '',
            stats.duration ?? stats.duration_s ?? '',
            stats.calories ?? stats.calories_kcal ?? '',
            route.pointCount ?? '',
            route.activityType ?? '',
            route.privacyLevel ?? '',
            route.createdAt ? new Date(route.createdAt).toISOString() : '',
            route.updatedAt ? new Date(route.updatedAt).toISOString() : '',
        ].map(serializeCsvValue);
    });

    return [headers.join(','), ...rows.map((row) => row.join(','))].join('\n');
}

// === User Management ===

async function fetchAdminUsers(options = {}) {
    const { filters = {}, pagination = { limit: DEFAULT_PAGE_SIZE, offset: 0 } } = options;
    const { limit, offset } = pagination;

    const conditions = [];
    const params = [];
    let paramIndex = 1;

    if (filters.search) {
        conditions.push(`(nickname ILIKE $${paramIndex} OR id::text ILIKE $${paramIndex})`);
        params.push(`%${filters.search}%`);
        paramIndex++;
    }

    const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const [countResult, usersResult] = await Promise.all([
        pool.query(`SELECT COUNT(*) as total FROM users ${whereClause}`, params),
        pool.query(
            `SELECT u.*,
              (SELECT COUNT(*) FROM routes WHERE user_id = u.id AND deleted_at IS NULL) as route_count
       FROM users u
       ${whereClause}
       ORDER BY u.created_at DESC
       LIMIT $${paramIndex++} OFFSET $${paramIndex}`,
            [...params, limit, offset]
        ),
    ]);

    return {
        items: usersResult.rows.map((row) => ({
            id: row.id,
            nickname: row.nickname,
            avatar: row.avatar,
            gender: row.gender,
            ageRange: row.age_range,
            identity: row.identity_label,
            routeCount: parseInt(row.route_count || '0', 10),
            createdAt: row.created_at?.getTime() || null,
            lastLoginAt: row.last_login_at?.getTime() || null,
        })),
        total: parseInt(countResult.rows[0]?.total || '0', 10),
    };
}

async function fetchAdminUserDetail(userId, options = {}) {
    const { includeRoutes = true, routeLimit = 50 } = options;

    const userResult = await pool.query(
        `SELECT * FROM users WHERE id = $1`,
        [userId]
    );

    if (!userResult.rows.length) {
        return null;
    }

    const user = userResult.rows[0];
    let routes = [];

    if (includeRoutes) {
        const routesResult = await pool.query(
            `SELECT id, name, activity_type, privacy_level, created_at, deleted_at,
              stats->>'distance' as distance,
              stats->>'duration' as duration
       FROM routes
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT $2`,
            [userId, routeLimit]
        );
        routes = routesResult.rows.map((row) => ({
            id: row.id,
            name: row.name,
            activityType: row.activity_type,
            privacyLevel: row.privacy_level,
            distance: parseFloat(row.distance || '0'),
            duration: parseFloat(row.duration || '0'),
            createdAt: row.created_at?.getTime() || null,
            deletedAt: row.deleted_at?.getTime() || null,
        }));
    }

    return {
        id: user.id,
        openid: user.openid ? '***' : null, // Mask for privacy
        nickname: user.nickname,
        avatar: user.avatar,
        gender: user.gender,
        ageRange: user.age_range,
        identity: user.identity_label,
        birthday: user.birthday,
        heightCm: user.height_cm,
        weightKg: user.weight_kg,
        createdAt: user.created_at?.getTime() || null,
        lastLoginAt: user.last_login_at?.getTime() || null,
        routes,
    };
}

// === Route Management ===

async function fetchAdminRoutes(options = {}) {
    const {
        filters = {},
        pagination = { limit: DEFAULT_PAGE_SIZE, offset: 0 },
        includePoints = false,
        includeDeleted = false,
    } = options;
    const { limit, offset } = pagination;

    const conditions = [];
    const params = [];
    let paramIndex = 1;

    if (!includeDeleted) {
        conditions.push('r.deleted_at IS NULL');
    }

    if (filters.userId) {
        conditions.push(`r.user_id = $${paramIndex++}`);
        params.push(filters.userId);
    }

    if (filters.activityType) {
        conditions.push(`r.activity_type = $${paramIndex++}`);
        params.push(filters.activityType);
    }

    if (filters.privacyLevel) {
        conditions.push(`r.privacy_level = $${paramIndex++}`);
        params.push(filters.privacyLevel);
    }

    if (filters.search) {
        conditions.push(`r.name ILIKE $${paramIndex++}`);
        params.push(`%${filters.search}%`);
    }

    const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const sortColumn = filters.sort || 'created_at';
    const sortOrder = filters.order?.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

    const [countResult, routesResult] = await Promise.all([
        pool.query(`SELECT COUNT(*) as total FROM routes r ${whereClause}`, params),
        pool.query(
            `SELECT r.*, u.nickname as owner_nickname, u.avatar as owner_avatar
       FROM routes r
       LEFT JOIN users u ON r.user_id = u.id
       ${whereClause}
       ORDER BY r.${sortColumn} ${sortOrder}
       LIMIT $${paramIndex++} OFFSET $${paramIndex}`,
            [...params, limit, offset]
        ),
    ]);

    let pointsByRoute = {};
    if (includePoints) {
        const routeIds = routesResult.rows.map((r) => r.id);
        if (routeIds.length > 0) {
            const pointsResult = await pool.query(
                `SELECT * FROM route_points WHERE route_id = ANY($1) ORDER BY route_id, seq`,
                [routeIds]
            );
            pointsResult.rows.forEach((point) => {
                if (!pointsByRoute[point.route_id]) {
                    pointsByRoute[point.route_id] = [];
                }
                pointsByRoute[point.route_id].push(point);
            });
        }
    }

    const items = routesResult.rows.map((row) => ({
        id: row.id,
        userId: row.user_id,
        ownerId: row.user_id,
        ownerNickname: row.owner_nickname,
        ownerAvatar: row.owner_avatar,
        name: row.name,
        title: row.name,
        activityType: row.activity_type,
        purposeCode: row.purpose_code,
        privacyLevel: row.privacy_level,
        startTime: row.start_time?.getTime() || null,
        endTime: row.end_time?.getTime() || null,
        stats: row.stats || {},
        statSummary: row.stats || {},
        meta: row.meta || {},
        photos: row.photos || [],
        pointCount: includePoints ? (pointsByRoute[row.id]?.length || 0) : null,
        points: includePoints ? pointsByRoute[row.id] || [] : undefined,
        createdAt: row.created_at?.getTime() || null,
        updatedAt: row.updated_at?.getTime() || null,
        deletedAt: row.deleted_at?.getTime() || null,
    }));

    return {
        items,
        total: parseInt(countResult.rows[0]?.total || '0', 10),
    };
}

module.exports = {
    // Analytics
    computeAdminAnalyticsSummary,
    computeAdminAnalyticsTimeseries,
    computeCollectionDistribution,
    computePurposeDistribution,
    // Backup
    buildBackupSnapshot,
    saveBackupToDisk,
    listAvailableBackups,
    loadBackupFromDisk,
    // Export
    serializeCsvValue,
    buildRoutesCsv,
    // Users
    fetchAdminUsers,
    fetchAdminUserDetail,
    // Routes
    fetchAdminRoutes,
};
