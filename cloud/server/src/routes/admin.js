/**
 * Admin Routes
 * Handles /api/admin/* endpoints
 */

const express = require('express');
const ExcelJS = require('exceljs');
const createEnsureAuth = require('../middlewares/ensureAuth');
const { pool } = require('../db/index');
const {
  JWT_SECRET,
  DEFAULT_PAGE_SIZE,
  ADMIN_EXPORT_LIMIT,
  ANNOUNCEMENT_STATUS_VALUES,
  ANNOUNCEMENT_DELIVERY_MODE_VALUES,
  ANNOUNCEMENT_TARGET_AUDIENCE_VALUES,
  FEEDBACK_STATUS_VALUES,
} = require('../config/index');
const {
  computeAdminAnalyticsSummary,
  computeAdminAnalyticsTimeseries,
  computeCollectionDistribution,
  computePurposeDistribution,
  computeRouteFeedbackSummary,
  buildBackupSnapshot,
  saveBackupToDisk,
  listAvailableBackups,
  loadBackupFromDisk,
  buildRoutesCsv,
  fetchAdminUsers,
  fetchAdminUserDetail,
  fetchAdminRoutes,
  fetchAdminRouteDetail,
  PURPOSE_TYPE_DEFINITIONS,
} = require('../services/adminService');
const { sanitizeEnumValue, normalizeRouteId } = require('../utils/format');

const ensureAuth = createEnsureAuth({ jwtSecret: JWT_SECRET });
const router = express.Router();

function ensureAdminRequest(req, res) {
  if (req.role !== 'admin') {
    res.status(403).json({ error: 'Admin access required' });
    return false;
  }
  return true;
}

function parseBooleanFlag(value) {
  if (value === null || value === undefined) return false;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value === 1;
  return ['1', 'true', 'yes', 'on', 'all'].includes(String(value).trim().toLowerCase());
}

function normalizePagination(pageValue, pageSizeValue) {
  const page = Math.max(Number(pageValue) || 1, 1);
  const pageSize = Math.min(Math.max(Number(pageSizeValue) || DEFAULT_PAGE_SIZE, 5), 200);
  const offset = (page - 1) * pageSize;
  return { page, pageSize, limit: pageSize, offset };
}

function sanitizeIdArray(value) {
  if (!value) return [];
  if (typeof value === 'string') return value.split(',').map((id) => id.trim()).filter(Boolean);
  if (Array.isArray(value)) return value.map((id) => String(id).trim()).filter(Boolean);
  return [];
}

function toBucketFormat(items = []) {
  return items.map((row) => {
    const key = row.purposeCode || row.activityType || row.key || '';
    const def = PURPOSE_TYPE_DEFINITIONS?.[key] || null;
    return {
      key,
      label: def?.label || key || '未设置',
      count: Number(row.count) || 0,
    };
  });
}

// === Analytics ===
router.get('/analytics/summary', ensureAuth, async (req, res) => {
  if (!ensureAdminRequest(req, res)) return;
  const rangeDays = Math.min(Math.max(Number(req.query.rangeDays || req.query.days) || 30, 1), 365);
  try {
    res.json(await computeAdminAnalyticsSummary(rangeDays));
  } catch (error) {
    console.error('GET /api/admin/analytics/summary failed', error);
    res.status(500).json({ error: 'Failed to compute analytics summary' });
  }
});

router.get('/analytics/timeseries', ensureAuth, async (req, res) => {
  if (!ensureAdminRequest(req, res)) return;
  const rangeDays = Math.min(Math.max(Number(req.query.rangeDays || req.query.days) || 30, 1), 365);
  try {
    const timeseries = await computeAdminAnalyticsTimeseries(rangeDays);
    res.json({ timeseries, rangeDays });
  } catch (error) {
    console.error('GET /api/admin/analytics/timeseries failed', error);
    res.status(500).json({ error: 'Failed to compute analytics timeseries' });
  }
});

router.get('/analytics/distribution', ensureAuth, async (req, res) => {
  if (!ensureAdminRequest(req, res)) return;
  const rangeDays = Math.min(Math.max(Number(req.query.rangeDays || req.query.days) || 30, 1), 365);
  try {
    const [activity, purpose] = await Promise.all([
      computeCollectionDistribution(rangeDays),
      computePurposeDistribution(rangeDays),
    ]);
    res.json({ activity, purpose, rangeDays });
  } catch (error) {
    console.error('GET /api/admin/analytics/distribution failed', error);
    res.status(500).json({ error: 'Failed to compute distribution' });
  }
});

// ── Route Feedback Analytics ──

router.get('/analytics/feedback', ensureAuth, async (req, res) => {
  if (!ensureAdminRequest(req, res)) return;
  const rangeDays = Math.min(Math.max(Number(req.query.rangeDays || req.query.days) || 30, 1), 365);
  try {
    // Satisfaction score distribution
    const satisfactionResult = await pool.query(
      `SELECT feedback_satisfaction_score AS score, COUNT(*)::int AS count
       FROM routes
       WHERE feedback_satisfaction_score IS NOT NULL
         AND deleted_at IS NULL
         AND created_at >= NOW() - ($1 || ' days')::interval
       GROUP BY feedback_satisfaction_score
       ORDER BY feedback_satisfaction_score`,
      [rangeDays]
    );

    // Preference labels breakdown
    const preferenceResult = await pool.query(
      `SELECT label, COUNT(*)::int AS count
       FROM routes, unnest(feedback_preference_labels) AS label
       WHERE feedback_preference_labels IS NOT NULL
         AND deleted_at IS NULL
         AND created_at >= NOW() - ($1 || ' days')::interval
       GROUP BY label
       ORDER BY count DESC`,
      [rangeDays]
    );

    // Average satisfaction
    const avgResult = await pool.query(
      `SELECT AVG(feedback_satisfaction_score)::numeric(3,1) AS avg_score,
              COUNT(*)::int AS total_feedback
       FROM routes
       WHERE feedback_satisfaction_score IS NOT NULL
         AND deleted_at IS NULL
         AND created_at >= NOW() - ($1 || ' days')::interval`,
      [rangeDays]
    );

    // Confirmed end point distance stats
    const endPointResult = await pool.query(
      `SELECT AVG(confirmed_end_distance_meters)::numeric(5,1) AS avg_distance,
              MAX(confirmed_end_distance_meters)::numeric(5,1) AS max_distance,
              COUNT(*)::int AS total_confirmed
       FROM routes
       WHERE confirmed_end_distance_meters IS NOT NULL
         AND deleted_at IS NULL
         AND created_at >= NOW() - ($1 || ' days')::interval`,
      [rangeDays]
    );

    res.json({
      satisfaction: satisfactionResult.rows,
      preferences: preferenceResult.rows,
      summary: {
        averageScore: avgResult.rows[0]?.avg_score || null,
        totalFeedback: avgResult.rows[0]?.total_feedback || 0,
        endPointConfirmation: {
          averageDistance: endPointResult.rows[0]?.avg_distance || null,
          maxDistance: endPointResult.rows[0]?.max_distance || null,
          totalConfirmed: endPointResult.rows[0]?.total_confirmed || 0,
        },
      },
      rangeDays,
    });
  } catch (error) {
    console.error('GET /api/admin/analytics/feedback failed', error);
    res.status(500).json({ error: 'Failed to compute feedback analytics' });
  }
});

router.get('/analytics/collection-distribution', ensureAuth, async (req, res) => {
  if (!ensureAdminRequest(req, res)) return;
  const rangeDays = Math.min(Math.max(Number(req.query.rangeDays || req.query.days) || 30, 1), 365);
  try {
    const items = await computeCollectionDistribution(rangeDays);
    const total = items.reduce((sum, item) => sum + (Number(item.count) || 0), 0);
    const buckets = toBucketFormat(items).map((bucket) => ({
      ...bucket,
      percentage: total > 0 ? Number(((bucket.count / total) * 100).toFixed(2)) : 0,
    }));
    res.json({ buckets, total, rangeDays });
  } catch (error) {
    console.error('GET /api/admin/analytics/collection-distribution failed', error);
    res.status(500).json({ error: 'Failed to compute collection distribution' });
  }
});

router.get('/analytics/purpose-distribution', ensureAuth, async (req, res) => {
  if (!ensureAdminRequest(req, res)) return;
  const rangeDays = Math.min(Math.max(Number(req.query.rangeDays || req.query.days) || 30, 1), 365);
  try {
    const items = await computePurposeDistribution(rangeDays);
    const total = items.reduce((sum, item) => sum + (Number(item.count) || 0), 0);
    const buckets = toBucketFormat(items).map((bucket) => ({
      ...bucket,
      percentage: total > 0 ? Number(((bucket.count / total) * 100).toFixed(2)) : 0,
    }));
    res.json({ buckets, total, rangeDays });
  } catch (error) {
    console.error('GET /api/admin/analytics/purpose-distribution failed', error);
    res.status(500).json({ error: 'Failed to compute purpose distribution' });
  }
});

router.get('/analytics/quality', ensureAuth, async (req, res) => {
  if (!ensureAdminRequest(req, res)) return;
  try {
    res.json({ totalPoints: 0, backgroundRatio: 0, weakSignalRatio: 0, interpRatio: 0 });
  } catch (error) {
    console.error('GET /api/admin/analytics/quality failed', error);
    res.status(500).json({ error: 'Failed to compute quality metrics' });
  }
});

router.get('/analytics/route-feedback-summary', ensureAuth, async (req, res) => {
  if (!ensureAdminRequest(req, res)) return;
  const rangeDays = Math.min(Math.max(Number(req.query.rangeDays || req.query.days) || 30, 1), 365);
  try {
    res.json(await computeRouteFeedbackSummary(rangeDays));
  } catch (error) {
    console.error('GET /api/admin/analytics/route-feedback-summary failed', error);
    res.status(500).json({ error: 'Failed to compute route feedback summary' });
  }
});

// === Users ===
router.get('/users', ensureAuth, async (req, res) => {
  if (!ensureAdminRequest(req, res)) return;
  const pagination = normalizePagination(req.query.page, req.query.pageSize);
  const filters = { search: req.query.search || '' };
  try {
    const { items, total } = await fetchAdminUsers({ filters, pagination });
    res.json({ items, pagination: { total, page: pagination.page, pageSize: pagination.pageSize, totalPages: Math.ceil(total / pagination.pageSize) } });
  } catch (error) {
    console.error('GET /api/admin/users failed', error);
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

router.get('/users/:id', ensureAuth, async (req, res) => {
  if (!ensureAdminRequest(req, res)) return;
  try {
    const user = await fetchAdminUserDetail(req.params.id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json(user);
  } catch (error) {
    console.error('GET /api/admin/users/:id failed', error);
    res.status(500).json({ error: 'Failed to fetch user detail' });
  }
});

router.patch('/users/:id', ensureAuth, async (req, res) => {
  if (!ensureAdminRequest(req, res)) return;
  const userId = Number(req.params.id);
  if (!Number.isFinite(userId)) return res.status(400).json({ error: 'User id is required' });
  const body = req.body || {};
  try {
    const result = await pool.query(
      `UPDATE users
          SET nickname = COALESCE($1, nickname),
              avatar = COALESCE($2, avatar),
              gender = COALESCE($3, gender),
              age_range = COALESCE($4, age_range),
              identity_label = COALESCE($5, identity_label),
              birthday = COALESCE($6, birthday),
              height_cm = COALESCE($7, height_cm),
              weight_kg = COALESCE($8, weight_kg),
              updated_at = NOW()
        WHERE id = $9
        RETURNING id`,
      [
        body.nickname ?? null,
        body.avatar ?? null,
        body.gender ?? null,
        body.ageRange ?? null,
        body.identity ?? null,
        body.birthday ?? null,
        body.heightCm ?? null,
        body.weightKg ?? null,
        userId,
      ]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'User not found' });
    res.json(await fetchAdminUserDetail(userId));
  } catch (error) {
    console.error('PATCH /api/admin/users/:id failed', error);
    res.status(500).json({ error: 'Failed to update user' });
  }
});

router.patch('/users/:id/achievements', ensureAuth, async (req, res) => {
  if (!ensureAdminRequest(req, res)) return;
  const userId = Number(req.params.id);
  if (!Number.isFinite(userId)) return res.status(400).json({ error: 'User id is required' });
  const body = req.body || {};
  const payload = {
    totalPoints: Number(body.totalPoints) || 0,
    currentBadge: body.currentBadge || null,
    routeHistory: body.routeHistory || {},
  };
  try {
    await pool.query(
      `INSERT INTO user_achievements (user_id, payload, updated_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (user_id) DO UPDATE SET payload = EXCLUDED.payload, updated_at = NOW()`,
      [userId, payload]
    );
    res.json({ ok: true, userId });
  } catch (error) {
    console.error('PATCH /api/admin/users/:id/achievements failed', error);
    res.status(500).json({ error: 'Failed to update achievements' });
  }
});

// === Routes ===
router.get('/routes', ensureAuth, async (req, res) => {
  if (!ensureAdminRequest(req, res)) return;
  const pagination = normalizePagination(req.query.page, req.query.pageSize);
  const filters = {
    userId: req.query.userId || null,
    activityType: req.query.activityType || null,
    privacyLevel: req.query.privacyLevel || null,
    search: req.query.search || '',
    sort: req.query.sort || 'created_at',
    order: req.query.order || 'desc',
  };
  const includeDeleted = parseBooleanFlag(req.query.includeDeleted);
  const includePoints = parseBooleanFlag(req.query.includePoints);
  try {
    const { items, total } = await fetchAdminRoutes({ filters, pagination, includeDeleted, includePoints });
    res.json({ items, pagination: { total, page: pagination.page, pageSize: pagination.pageSize, totalPages: Math.ceil(total / pagination.pageSize) } });
  } catch (error) {
    console.error('GET /api/admin/routes failed', error);
    res.status(500).json({ error: 'Failed to fetch routes' });
  }
});

router.get('/routes/:id', ensureAuth, async (req, res) => {
  if (!ensureAdminRequest(req, res)) return;
  try {
    const route = await fetchAdminRouteDetail(req.params.id);
    if (!route) return res.status(404).json({ error: 'Route not found' });
    res.json(route);
  } catch (error) {
    console.error('GET /api/admin/routes/:id failed', error);
    res.status(500).json({ error: 'Failed to fetch route detail' });
  }
});

router.post('/routes', ensureAuth, async (req, res) => {
  if (!ensureAdminRequest(req, res)) return;
  const payload = req.body || {};
  const routeId = normalizeRouteId(payload.id);
  if (!routeId) return res.status(400).json({ error: 'Route id is required' });
  try {
    await pool.query(
      `INSERT INTO routes (
        id, user_id, client_id, name, privacy_level, activity_type, purpose_code,
        start_time, end_time, stats, meta, photos, weather, created_at, updated_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7,
        $8, $9, $10, $11, $12, $13, NOW(), NOW()
      )
      ON CONFLICT (id) DO NOTHING`,
      [
        routeId,
        payload.userId || payload.ownerId || null,
        payload.clientId || routeId,
        payload.title || payload.name || null,
        payload.privacyLevel || 'private',
        payload.activityType || 'walk',
        payload.purposeCode || payload.purposeType || null,
        payload.startTime ? new Date(payload.startTime) : null,
        payload.endTime ? new Date(payload.endTime) : null,
        payload.stats || {},
        payload.meta || {},
        payload.photos || [],
        payload.weather || null,
      ]
    );
    res.status(201).json({ ok: true, id: routeId });
  } catch (error) {
    console.error('POST /api/admin/routes failed', error);
    res.status(500).json({ error: 'Failed to create admin route' });
  }
});

router.patch('/routes/:id', ensureAuth, async (req, res) => {
  if (!ensureAdminRequest(req, res)) return;
  const routeId = req.params.id;
  if (!routeId) return res.status(400).json({ error: 'Route id is required' });
  const body = req.body || {};
  const updates = [];
  const params = [];
  let idx = 1;

  if (body.title !== undefined || body.name !== undefined) {
    updates.push(`name = $${idx++}`);
    params.push((body.title ?? body.name ?? '').trim() || null);
  }
  if (body.privacyLevel !== undefined) {
    updates.push(`privacy_level = $${idx++}`);
    params.push(body.privacyLevel || 'private');
  }
  if (body.activityType !== undefined) {
    updates.push(`activity_type = $${idx++}`);
    params.push(body.activityType || 'walk');
  }
  if (body.purposeCode !== undefined || body.purposeType !== undefined) {
    updates.push(`purpose_code = $${idx++}`);
    params.push(body.purposeCode ?? body.purposeType ?? null);
  }
  if (body.stats !== undefined) {
    updates.push(`stats = $${idx++}`);
    params.push(body.stats || {});
  }
  if (body.meta !== undefined) {
    updates.push(`meta = $${idx++}`);
    params.push(body.meta || {});
  }
  if (body.photos !== undefined) {
    updates.push(`photos = $${idx++}`);
    params.push(body.photos || []);
  }
  if (body.deletedAt !== undefined) {
    updates.push(`deleted_at = $${idx++}`);
    params.push(body.deletedAt ? new Date(body.deletedAt) : null);
  }
  if (!updates.length) return res.status(400).json({ error: 'No patchable fields provided' });
  updates.push('updated_at = NOW()');
  params.push(routeId);
  try {
    const result = await pool.query(`UPDATE routes SET ${updates.join(', ')} WHERE id = $${idx} RETURNING id`, params);
    if (!result.rows.length) return res.status(404).json({ error: 'Route not found' });
    res.json(await fetchAdminRouteDetail(routeId));
  } catch (error) {
    console.error('PATCH /api/admin/routes/:id failed', error);
    res.status(500).json({ error: 'Failed to update route' });
  }
});

router.post('/routes/bulk-delete', ensureAuth, async (req, res) => {
  if (!ensureAdminRequest(req, res)) return;
  const ids = sanitizeIdArray(req.body?.ids);
  if (!ids.length) return res.status(400).json({ error: 'Route ids are required' });
  const hardDelete = parseBooleanFlag(req.body?.hardDelete);
  try {
    if (hardDelete) {
      await pool.query('DELETE FROM routes WHERE id = ANY($1::text[])', [ids]);
    } else {
      await pool.query(`UPDATE routes SET deleted_at = NOW(), updated_at = NOW() WHERE id = ANY($1::text[])`, [ids]);
    }
    res.json({ ids, hardDelete, count: ids.length });
  } catch (error) {
    console.error('POST /api/admin/routes/bulk-delete failed', error);
    res.status(500).json({ error: 'Failed to delete routes' });
  }
});

router.post('/routes/export', ensureAuth, async (req, res) => {
  if (!ensureAdminRequest(req, res)) return;
  const payload = req.body || {};
  const format = String(payload.format || 'json').toLowerCase();
  const includePoints = Boolean(payload.includePoints);
  const includeDeleted = Boolean(payload.includeDeleted);
  const filters = { ...(payload.filters || {}), sort: payload.sort || payload.filters?.sort, order: payload.order || payload.filters?.order };
  const pagination = { limit: ADMIN_EXPORT_LIMIT, offset: 0 };
  try {
    const { items, total } = await fetchAdminRoutes({ filters, pagination, includePoints, includeDeleted });
    const label = new Date().toISOString().replace(/[:.]/g, '-');
    if (format === 'csv') {
      const csv = buildRoutesCsv(items);
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="routes-export-${label}.csv"`);
      res.send(`\uFEFF${csv}`);
      return;
    }
    if (format === 'excel' || format === 'xlsx') {
      const workbook = new ExcelJS.Workbook();
      const sheet = workbook.addWorksheet('Routes');
      sheet.columns = [
        { header: 'ID', key: 'id', width: 32 },
        { header: 'User ID', key: 'ownerId', width: 12 },
        { header: 'Title', key: 'title', width: 24 },
        { header: 'Start Time', key: 'startTime', width: 20 },
        { header: 'End Time', key: 'endTime', width: 20 },
        { header: 'Distance (m)', key: 'distance', width: 14 },
        { header: 'Duration (s)', key: 'duration', width: 14 },
        { header: 'Calories', key: 'calories', width: 12 },
        { header: 'Activity Type', key: 'activityType', width: 14 },
        { header: 'Privacy', key: 'privacyLevel', width: 12 },
        { header: 'Created At', key: 'createdAt', width: 20 },
      ];
      for (const route of items) {
        const stats = route.statSummary || route.stats || {};
        sheet.addRow({
          id: route.id,
          ownerId: route.ownerId ?? route.userId ?? null,
          title: route.title || route.name,
          startTime: route.startTime ? new Date(route.startTime) : null,
          endTime: route.endTime ? new Date(route.endTime) : null,
          distance: stats.distance ?? stats.distance_m ?? null,
          duration: stats.duration ?? stats.duration_s ?? null,
          calories: stats.calories ?? stats.calories_kcal ?? null,
          activityType: route.activityType,
          privacyLevel: route.privacyLevel,
          createdAt: route.createdAt ? new Date(route.createdAt) : null,
        });
      }
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="routes-export-${label}.xlsx"`);
      await workbook.xlsx.write(res);
      res.end();
      return;
    }
    res.json({ items, total, exportedAt: Date.now() });
  } catch (error) {
    console.error('POST /api/admin/routes/export failed', error);
    res.status(500).json({ error: 'Failed to export routes' });
  }
});

// === Announcements ===
router.get('/announcements', ensureAuth, async (req, res) => {
  if (!ensureAdminRequest(req, res)) return;
  const pagination = normalizePagination(req.query.page, req.query.pageSize);
  try {
    const [countResult, itemsResult] = await Promise.all([
      pool.query('SELECT COUNT(*) as total FROM announcements'),
      pool.query(
        `SELECT * FROM announcements ORDER BY COALESCE(publish_at, created_at) DESC LIMIT $1 OFFSET $2`,
        [pagination.limit, pagination.offset]
      ),
    ]);
    const items = itemsResult.rows.map((row) => ({
      id: row.id,
      title: row.title,
      body: row.body,
      status: row.status,
      deliveryMode: row.delivery_mode,
      forceRead: row.force_read,
      linkUrl: row.link_url,
      targetAudience: row.target_audience,
      publishAt: row.publish_at?.getTime() || null,
      createdAt: row.created_at?.getTime() || null,
      updatedAt: row.updated_at?.getTime() || null,
    }));
    const total = parseInt(countResult.rows[0]?.total || '0', 10);
    res.json({ items, pagination: { total, page: pagination.page, pageSize: pagination.pageSize, totalPages: Math.ceil(total / pagination.pageSize) } });
  } catch (error) {
    console.error('GET /api/admin/announcements failed', error);
    res.status(500).json({ error: 'Failed to fetch announcements' });
  }
});

router.post('/announcements', ensureAuth, async (req, res) => {
  if (!ensureAdminRequest(req, res)) return;
  const body = req.body || {};
  try {
    const result = await pool.query(
      `INSERT INTO announcements (title, body, status, publish_at, delivery_mode, force_read, link_url, target_audience, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW(),NOW()) RETURNING id`,
      [
        String(body.title || '').trim(),
        String(body.body || '').trim(),
        sanitizeEnumValue(body.status || 'draft', ANNOUNCEMENT_STATUS_VALUES) || 'draft',
        body.publishAt ? new Date(body.publishAt) : null,
        sanitizeEnumValue(body.deliveryMode || 'single', ANNOUNCEMENT_DELIVERY_MODE_VALUES) || 'single',
        Boolean(body.forceRead),
        body.linkUrl ? String(body.linkUrl).trim() : null,
        sanitizeEnumValue(body.targetAudience || 'all', ANNOUNCEMENT_TARGET_AUDIENCE_VALUES) || 'all',
      ]
    );
    res.status(201).json({ id: result.rows[0].id });
  } catch (error) {
    console.error('POST /api/admin/announcements failed', error);
    res.status(500).json({ error: 'Failed to create announcement' });
  }
});

router.patch('/announcements/:id', ensureAuth, async (req, res) => {
  if (!ensureAdminRequest(req, res)) return;
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'Announcement id is required' });
  const body = req.body || {};
  const updates = [];
  const params = [];
  let idx = 1;
  const set = (field, value) => { updates.push(`${field} = $${idx++}`); params.push(value); };
  if (body.title !== undefined) set('title', String(body.title || '').trim());
  if (body.body !== undefined) set('body', String(body.body || '').trim());
  if (body.status !== undefined) set('status', sanitizeEnumValue(body.status, ANNOUNCEMENT_STATUS_VALUES) || 'draft');
  if (body.publishAt !== undefined) set('publish_at', body.publishAt ? new Date(body.publishAt) : null);
  if (body.deliveryMode !== undefined) set('delivery_mode', sanitizeEnumValue(body.deliveryMode, ANNOUNCEMENT_DELIVERY_MODE_VALUES) || 'single');
  if (body.forceRead !== undefined) set('force_read', Boolean(body.forceRead));
  if (body.linkUrl !== undefined) set('link_url', body.linkUrl ? String(body.linkUrl).trim() : null);
  if (body.targetAudience !== undefined) set('target_audience', sanitizeEnumValue(body.targetAudience, ANNOUNCEMENT_TARGET_AUDIENCE_VALUES) || 'all');
  if (!updates.length) return res.status(400).json({ error: 'No patchable fields provided' });
  updates.push('updated_at = NOW()');
  params.push(id);
  try {
    const result = await pool.query(`UPDATE announcements SET ${updates.join(', ')} WHERE id = $${idx} RETURNING id`, params);
    if (!result.rows.length) return res.status(404).json({ error: 'Announcement not found' });
    res.json({ id });
  } catch (error) {
    console.error('PATCH /api/admin/announcements/:id failed', error);
    res.status(500).json({ error: 'Failed to update announcement' });
  }
});

router.delete('/announcements/:id', ensureAuth, async (req, res) => {
  if (!ensureAdminRequest(req, res)) return;
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'Announcement id is required' });
  try {
    await pool.query('DELETE FROM announcements WHERE id = $1', [id]);
    res.json({ id, deleted: true });
  } catch (error) {
    console.error('DELETE /api/admin/announcements/:id failed', error);
    res.status(500).json({ error: 'Failed to delete announcement' });
  }
});

// === Feedback ===
router.get('/feedback', ensureAuth, async (req, res) => {
  if (!ensureAdminRequest(req, res)) return;
  const pagination = normalizePagination(req.query.page, req.query.pageSize);
  const status = req.query.status ? sanitizeEnumValue(req.query.status, FEEDBACK_STATUS_VALUES) : '';
  const conditions = [];
  const params = [];
  let idx = 1;
  if (status) {
    conditions.push(`status = $${idx++}`);
    params.push(status);
  }
  const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  try {
    const [countResult, itemsResult] = await Promise.all([
      pool.query(`SELECT COUNT(*) as total FROM feedback_tickets ${whereClause}`, params),
      pool.query(
        `SELECT * FROM feedback_tickets ${whereClause} ORDER BY created_at DESC LIMIT $${idx++} OFFSET $${idx}`,
        [...params, pagination.limit, pagination.offset]
      ),
    ]);
    const items = itemsResult.rows.map((row) => ({
      id: row.id,
      userId: row.user_id,
      category: row.category,
      title: row.title,
      content: row.content,
      contact: row.contact,
      status: row.status,
      adminReply: row.admin_reply,
      createdAt: row.created_at?.getTime() || null,
      updatedAt: row.updated_at?.getTime() || null,
      resolvedAt: row.resolved_at?.getTime() || null,
    }));
    const total = parseInt(countResult.rows[0]?.total || '0', 10);
    res.json({ items, pagination: { total, page: pagination.page, pageSize: pagination.pageSize, totalPages: Math.ceil(total / pagination.pageSize) } });
  } catch (error) {
    console.error('GET /api/admin/feedback failed', error);
    res.status(500).json({ error: 'Failed to fetch feedback' });
  }
});

router.patch('/feedback/:id', ensureAuth, async (req, res) => {
  if (!ensureAdminRequest(req, res)) return;
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'Feedback id is required' });
  const body = req.body || {};
  const updates = [];
  const params = [];
  let idx = 1;
  if (body.status !== undefined) {
    updates.push(`status = $${idx++}`);
    params.push(sanitizeEnumValue(body.status, FEEDBACK_STATUS_VALUES) || 'open');
    if (['resolved', 'closed'].includes(body.status)) {
      updates.push('resolved_at = NOW()');
    }
  }
  if (body.adminReply !== undefined) {
    updates.push(`admin_reply = $${idx++}`);
    params.push(body.adminReply ? String(body.adminReply) : null);
  }
  if (!updates.length) return res.status(400).json({ error: 'No patchable fields provided' });
  updates.push('updated_at = NOW()');
  params.push(id);
  try {
    const result = await pool.query(`UPDATE feedback_tickets SET ${updates.join(', ')} WHERE id = $${idx} RETURNING id`, params);
    if (!result.rows.length) return res.status(404).json({ error: 'Feedback not found' });
    res.json({ id, ok: true });
  } catch (error) {
    console.error('PATCH /api/admin/feedback/:id failed', error);
    res.status(500).json({ error: 'Failed to update feedback' });
  }
});

// === Maintenance / Backups ===
router.get('/maintenance/backups', ensureAuth, async (req, res) => {
  if (!ensureAdminRequest(req, res)) return;
  try {
    res.json({ backups: await listAvailableBackups() });
  } catch (error) {
    console.error('GET /api/admin/maintenance/backups failed', error);
    res.status(500).json({ error: 'Failed to list backups' });
  }
});

router.get('/backups', ensureAuth, async (req, res) => {
  if (!ensureAdminRequest(req, res)) return;
  try {
    res.json({ backups: await listAvailableBackups() });
  } catch (error) {
    console.error('GET /api/admin/backups failed', error);
    res.status(500).json({ error: 'Failed to list backups' });
  }
});

router.post('/maintenance/backup', ensureAuth, async (req, res) => {
  if (!ensureAdminRequest(req, res)) return;
  try {
    const snapshot = await buildBackupSnapshot();
    const { filename } = await saveBackupToDisk(snapshot);
    res.json({ filename, createdAt: snapshot.createdAt, users: snapshot.users.length, routes: snapshot.routes.length, routePoints: snapshot.routePoints.length });
  } catch (error) {
    console.error('POST /api/admin/maintenance/backup failed', error);
    res.status(500).json({ error: 'Failed to create backup' });
  }
});

router.post('/backups', ensureAuth, async (req, res) => {
  if (!ensureAdminRequest(req, res)) return;
  try {
    const snapshot = await buildBackupSnapshot();
    const { filename } = await saveBackupToDisk(snapshot);
    res.json({ filename, createdAt: snapshot.createdAt, users: snapshot.users.length, routes: snapshot.routes.length, routePoints: snapshot.routePoints.length });
  } catch (error) {
    console.error('POST /api/admin/backups failed', error);
    res.status(500).json({ error: 'Failed to create backup' });
  }
});

router.get('/maintenance/backup/:filename', ensureAuth, async (req, res) => {
  if (!ensureAdminRequest(req, res)) return;
  try {
    const snapshot = loadBackupFromDisk(req.params.filename);
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${req.params.filename}"`);
    res.send(JSON.stringify(snapshot, null, 2));
  } catch (error) {
    console.error('GET /api/admin/maintenance/backup/:filename failed', error);
    res.status(500).json({ error: 'Failed to download backup' });
  }
});

router.post('/maintenance/restore', ensureAuth, async (req, res) => {
  if (!ensureAdminRequest(req, res)) return;
  const { filename } = req.body || {};
  if (!filename) return res.status(400).json({ error: 'Backup filename is required' });
  try {
    const snapshot = loadBackupFromDisk(filename);
    res.json({
      filename,
      version: snapshot.version,
      createdAt: snapshot.createdAt,
      users: snapshot.users?.length || 0,
      routes: snapshot.routes?.length || 0,
      routePoints: snapshot.routePoints?.length || 0,
      message: 'Backup file validated successfully. Full restore not implemented yet.',
    });
  } catch (error) {
    console.error('POST /api/admin/maintenance/restore failed', error);
    res.status(500).json({ error: 'Failed to restore backup' });
  }
});

router.post('/backups/restore', ensureAuth, async (req, res) => {
  if (!ensureAdminRequest(req, res)) return;
  const { filename } = req.body || {};
  if (!filename) return res.status(400).json({ error: 'Backup filename is required' });
  try {
    const snapshot = loadBackupFromDisk(filename);
    res.json({
      filename,
      version: snapshot.version,
      createdAt: snapshot.createdAt,
      users: snapshot.users?.length || 0,
      routes: snapshot.routes?.length || 0,
      routePoints: snapshot.routePoints?.length || 0,
      message: 'Backup file validated successfully. Full restore not implemented yet.',
    });
  } catch (error) {
    console.error('POST /api/admin/backups/restore failed', error);
    res.status(500).json({ error: 'Failed to restore backup' });
  }
});

module.exports = router;
