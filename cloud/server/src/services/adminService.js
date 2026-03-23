/**
 * Admin Service
 * Business logic for admin operations including analytics, backup, exports, users and routes.
 */

const fs = require('fs');
const path = require('path');
const { pool } = require('../db/index');
const {
  DEFAULT_PAGE_SIZE,
  BACKUP_STORAGE_PATH,
  PURPOSE_TYPE_DEFINITIONS,
} = require('../config/index');

async function hasColumn({ tableName, columnName, schema = 'public' }) {
  const result = await pool.query(
    `SELECT 1
       FROM information_schema.columns
      WHERE table_schema = $1
        AND table_name = $2
        AND column_name = $3
      LIMIT 1`,
    [schema, tableName, columnName]
  );
  return result.rows.length > 0;
}

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
         FROM routes
        WHERE deleted_at IS NULL`,
      [cutoff]
    ),
    pool.query(
      `SELECT COUNT(DISTINCT user_id) as count
         FROM routes
        WHERE created_at >= $1
          AND deleted_at IS NULL`,
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
      WHERE created_at >= $1
        AND deleted_at IS NULL
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
      WHERE created_at >= $1
        AND deleted_at IS NULL
        AND activity_type IS NOT NULL
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
  const supportsPurposeCode = await hasColumn({ tableName: 'routes', columnName: 'purpose_code' });

  if (supportsPurposeCode) {
    const result = await pool.query(
      `SELECT purpose_code, COUNT(*) as count
         FROM routes
        WHERE created_at >= $1
          AND deleted_at IS NULL
          AND purpose_code IS NOT NULL
        GROUP BY purpose_code
        ORDER BY count DESC`,
      [cutoff]
    );
    return result.rows.map((row) => ({
      purposeCode: row.purpose_code,
      count: parseInt(row.count || '0', 10),
    }));
  }

  const result = await pool.query(
    `SELECT COALESCE(NULLIF(meta->>'purposeCode', ''), NULLIF(meta->>'purposeType', '')) as purpose_code,
            COUNT(*) as count
       FROM routes
      WHERE created_at >= $1
        AND deleted_at IS NULL
        AND (meta->>'purposeCode' IS NOT NULL OR meta->>'purposeType' IS NOT NULL)
      GROUP BY purpose_code
      ORDER BY count DESC`,
    [cutoff]
  );

  return result.rows
    .map((row) => ({
      purposeCode: row.purpose_code,
      count: parseInt(row.count || '0', 10),
    }))
    .filter((row) => row.purposeCode);
}

async function computeRouteFeedbackSummary(rangeDays = 30) {
  const cutoff = new Date(Date.now() - rangeDays * 24 * 60 * 60 * 1000);
  const summaryResult = await pool.query(
    `SELECT
        COUNT(*) FILTER (WHERE feedback_choice IS NOT NULL) AS total_feedback,
        AVG(feedback_satisfaction_score) FILTER (WHERE feedback_satisfaction_score IS NOT NULL) AS avg_satisfaction
       FROM routes
      WHERE created_at >= $1
        AND deleted_at IS NULL`,
    [cutoff]
  );

  const choiceResult = await pool.query(
    `SELECT feedback_choice, COUNT(*) AS count
       FROM routes
      WHERE created_at >= $1
        AND deleted_at IS NULL
        AND feedback_choice IS NOT NULL
      GROUP BY feedback_choice
      ORDER BY count DESC`,
    [cutoff]
  );

  const purposeResult = await pool.query(
    `SELECT purpose_code, feedback_choice, COUNT(*) AS count,
            AVG(feedback_satisfaction_score) FILTER (WHERE feedback_satisfaction_score IS NOT NULL) AS avg_satisfaction
       FROM routes
      WHERE created_at >= $1
        AND deleted_at IS NULL
        AND feedback_choice IS NOT NULL
      GROUP BY purpose_code, feedback_choice
      ORDER BY purpose_code ASC NULLS LAST, count DESC`,
    [cutoff]
  );

  return {
    rangeDays,
    totalFeedback: Number(summaryResult.rows[0]?.total_feedback || 0),
    averageSatisfaction: Number(summaryResult.rows[0]?.avg_satisfaction || 0),
    byChoice: choiceResult.rows.map((row) => ({
      choice: row.feedback_choice,
      count: Number(row.count || 0),
    })),
    byPurpose: purposeResult.rows.map((row) => ({
      purposeCode: row.purpose_code || '',
      choice: row.feedback_choice,
      count: Number(row.count || 0),
      averageSatisfaction: Number(row.avg_satisfaction || 0),
    })),
  };
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
  fs.mkdirSync(BACKUP_STORAGE_PATH, { recursive: true });
  fs.writeFileSync(filepath, JSON.stringify(snapshot, null, 2), 'utf8');
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
          size_bytes: stat.size,
          createdAt: stat.mtime.toISOString(),
          modified_at: stat.mtime.toISOString(),
        };
      })
      .sort((a, b) => new Date(b.modified_at) - new Date(a.modified_at));
  } catch (error) {
    console.error('Failed to list backups', error);
    return [];
  }
}

function loadBackupFromDisk(filename) {
  const filepath = path.join(BACKUP_STORAGE_PATH, filename);
  return JSON.parse(fs.readFileSync(filepath, 'utf8'));
}

// === CSV Export ===

function serializeCsvValue(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') return `"${JSON.stringify(value).replace(/"/g, '""')}"`;
  const str = String(value);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function buildRoutesCsv(items = []) {
  const headers = [
    'ID', 'User ID', 'Title', 'Start Time', 'End Time', 'Distance (m)',
    'Duration (s)', 'Calories', 'Point Count', 'Activity Type', 'Privacy', 'Created At', 'Updated At'
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

// === Users ===

async function fetchAdminUsers(options = {}) {
  const { filters = {}, pagination = { limit: DEFAULT_PAGE_SIZE, offset: 0 } } = options;
  const { limit, offset } = pagination;
  const conditions = [];
  const params = [];
  let paramIndex = 1;

  if (filters.search) {
    conditions.push(`(u.nickname ILIKE $${paramIndex} OR u.id::text ILIKE $${paramIndex})`);
    params.push(`%${filters.search}%`);
    paramIndex += 1;
  }

  const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const [countResult, usersResult] = await Promise.all([
    pool.query(`SELECT COUNT(*) as total FROM users u ${whereClause}`, params),
    pool.query(
      `SELECT u.*, (SELECT COUNT(*) FROM routes WHERE user_id = u.id AND deleted_at IS NULL) as route_count
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
  const userResult = await pool.query(`SELECT * FROM users WHERE id = $1`, [userId]);
  if (!userResult.rows.length) return null;

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
    openid: user.openid ? '***' : null,
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

// === Routes ===

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

  if (!includeDeleted) conditions.push('r.deleted_at IS NULL');
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
  const allowedSortColumns = new Set(['created_at', 'updated_at', 'start_time', 'end_time', 'name']);
  const sortColumn = allowedSortColumns.has(filters.sort) ? filters.sort : 'created_at';
  const sortOrder = String(filters.order || 'desc').toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

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
        if (!pointsByRoute[point.route_id]) pointsByRoute[point.route_id] = [];
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
    owner: {
      id: row.user_id,
      displayName: row.owner_nickname || null,
      avatar: row.owner_avatar || null,
    },
    name: row.name,
    title: row.name,
    activityType: row.activity_type,
    purposeCode: row.purpose_code,
    purposeType: row.purpose_code,
    privacyLevel: row.privacy_level,
    startTime: row.start_time?.getTime() || null,
    endTime: row.end_time?.getTime() || null,
    stats: row.stats || {},
    statSummary: row.stats || {},
    meta: row.meta || {},
    photos: row.photos || [],
    weather: row.weather || null,
    pointCount: includePoints ? (pointsByRoute[row.id]?.length || 0) : null,
    points: includePoints
      ? (pointsByRoute[row.id] || []).map((point) => ({
          id: point.id,
          seq: point.seq,
          latitude: point.latitude,
          longitude: point.longitude,
          altitude: point.altitude,
          timestamp: point.timestamp?.getTime() || null,
          createdAt: point.created_at?.getTime() || null,
        }))
      : undefined,
    createdAt: row.created_at?.getTime() || null,
    updatedAt: row.updated_at?.getTime() || null,
    deletedAt: row.deleted_at?.getTime() || null,
  }));

  return {
    items,
    total: parseInt(countResult.rows[0]?.total || '0', 10),
  };
}

async function fetchAdminRouteDetail(routeId) {
  if (!routeId) return null;
  const { items } = await fetchAdminRoutes({
    filters: { search: '' },
    pagination: { limit: 1, offset: 0 },
    includePoints: true,
    includeDeleted: true,
  });
  const direct = items.find((item) => item.id === routeId);
  if (direct) return direct;

  const routeResult = await pool.query(
    `SELECT r.*, u.nickname as owner_nickname, u.avatar as owner_avatar
       FROM routes r
       LEFT JOIN users u ON r.user_id = u.id
      WHERE r.id = $1
      LIMIT 1`,
    [routeId]
  );
  if (!routeResult.rows.length) return null;
  const row = routeResult.rows[0];
  const pointsResult = await pool.query(`SELECT * FROM route_points WHERE route_id = $1 ORDER BY seq ASC`, [routeId]);
  return {
    id: row.id,
    userId: row.user_id,
    ownerId: row.user_id,
    owner: {
      id: row.user_id,
      displayName: row.owner_nickname || null,
      avatar: row.owner_avatar || null,
    },
    ownerNickname: row.owner_nickname || null,
    ownerAvatar: row.owner_avatar || null,
    clientId: row.client_id,
    name: row.name,
    title: row.name,
    activityType: row.activity_type,
    purposeCode: row.purpose_code,
    purposeType: row.purpose_code,
    privacyLevel: row.privacy_level,
    startTime: row.start_time?.getTime() || null,
    endTime: row.end_time?.getTime() || null,
    stats: row.stats || {},
    statSummary: row.stats || {},
    meta: row.meta || {},
    photos: row.photos || [],
    weather: row.weather || null,
    pointCount: pointsResult.rows.length,
    points: pointsResult.rows.map((point) => ({
      id: point.id,
      seq: point.seq,
      latitude: point.latitude,
      longitude: point.longitude,
      altitude: point.altitude,
      timestamp: point.timestamp?.getTime() || null,
      createdAt: point.created_at?.getTime() || null,
    })),
    createdAt: row.created_at?.getTime() || null,
    updatedAt: row.updated_at?.getTime() || null,
    deletedAt: row.deleted_at?.getTime() || null,
  };
}

module.exports = {
  computeAdminAnalyticsSummary,
  computeAdminAnalyticsTimeseries,
  computeCollectionDistribution,
  computePurposeDistribution,
  computeRouteFeedbackSummary,
  buildBackupSnapshot,
  saveBackupToDisk,
  listAvailableBackups,
  loadBackupFromDisk,
  serializeCsvValue,
  buildRoutesCsv,
  fetchAdminUsers,
  fetchAdminUserDetail,
  fetchAdminRoutes,
  fetchAdminRouteDetail,
  PURPOSE_TYPE_DEFINITIONS,
};
