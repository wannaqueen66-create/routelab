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
    ACTIVITY_TYPE_VALUES
} = require('../config/index');

const {
    computeAdminAnalyticsSummary,
    computeAdminAnalyticsTimeseries,
    computeCollectionDistribution,
    computePurposeDistribution,
    buildBackupSnapshot,
    saveBackupToDisk,
    listAvailableBackups,
    loadBackupFromDisk,
    buildRoutesCsv,
    fetchAdminUsers,
    fetchAdminUserDetail,
    fetchAdminRoutes
} = require('../services/adminService');

const { sanitizeEnumValue } = require('../utils/format');

const ensureAuth = createEnsureAuth({ jwtSecret: JWT_SECRET });
const router = express.Router();

// Middleware to ensure admin role
function ensureAdminRequest(req, res) {
    if (req.role !== 'admin') {
        res.status(403).json({ error: 'Admin access required' });
        return false;
    }
    return true;
}

// Helper functions
function parseBooleanFlag(value) {
    if (value === null || value === undefined) return false;
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') return value === 1;
    const normalized = String(value).trim().toLowerCase();
    return ['1', 'true', 'yes', 'on', 'all'].includes(normalized);
}

function normalizePagination(pageValue, pageSizeValue) {
    const page = Math.max(Number(pageValue) || 1, 1);
    const pageSize = Math.min(Math.max(Number(pageSizeValue) || DEFAULT_PAGE_SIZE, 5), 200);
    const offset = (page - 1) * pageSize;
    return { page, pageSize, limit: pageSize, offset };
}

function sanitizeIdArray(value) {
    if (!value) return [];
    if (typeof value === 'string') {
        return value.split(',').map((id) => id.trim()).filter(Boolean);
    }
    if (Array.isArray(value)) {
        return value.map((id) => String(id).trim()).filter(Boolean);
    }
    return [];
}

// === Analytics ===

// GET /api/admin/analytics/summary
router.get('/analytics/summary', ensureAuth, async (req, res) => {
    if (!ensureAdminRequest(req, res)) return;
    const rangeDays = Math.min(Math.max(Number(req.query.days) || 30, 1), 365);
    try {
        const summary = await computeAdminAnalyticsSummary(rangeDays);
        res.json(summary);
    } catch (error) {
        console.error('GET /api/admin/analytics/summary failed', error);
        res.status(500).json({ error: 'Failed to compute analytics summary' });
    }
});

// GET /api/admin/analytics/timeseries
router.get('/analytics/timeseries', ensureAuth, async (req, res) => {
    if (!ensureAdminRequest(req, res)) return;
    const rangeDays = Math.min(Math.max(Number(req.query.days) || 30, 1), 365);
    try {
        const timeseries = await computeAdminAnalyticsTimeseries(rangeDays);
        res.json({ timeseries, rangeDays });
    } catch (error) {
        console.error('GET /api/admin/analytics/timeseries failed', error);
        res.status(500).json({ error: 'Failed to compute analytics timeseries' });
    }
});

// GET /api/admin/analytics/distribution
router.get('/analytics/distribution', ensureAuth, async (req, res) => {
    if (!ensureAdminRequest(req, res)) return;
    const rangeDays = Math.min(Math.max(Number(req.query.days) || 30, 1), 365);
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

// === Users ===

// GET /api/admin/users
router.get('/users', ensureAuth, async (req, res) => {
    if (!ensureAdminRequest(req, res)) return;
    const pagination = normalizePagination(req.query.page, req.query.pageSize);
    const filters = { search: req.query.search || '' };
    try {
        const { items, total } = await fetchAdminUsers({ filters, pagination });
        res.json({
            items,
            total,
            page: pagination.page,
            pageSize: pagination.pageSize,
            totalPages: Math.ceil(total / pagination.pageSize),
        });
    } catch (error) {
        console.error('GET /api/admin/users failed', error);
        res.status(500).json({ error: 'Failed to fetch users' });
    }
});

// GET /api/admin/users/:id
router.get('/users/:id', ensureAuth, async (req, res) => {
    if (!ensureAdminRequest(req, res)) return;
    const userId = req.params.id;
    if (!userId) {
        return res.status(400).json({ error: 'User ID is required' });
    }
    try {
        const user = await fetchAdminUserDetail(userId);
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }
        res.json(user);
    } catch (error) {
        console.error('GET /api/admin/users/:id failed', error);
        res.status(500).json({ error: 'Failed to fetch user detail' });
    }
});

// === Routes ===

// GET /api/admin/routes
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
    try {
        const { items, total } = await fetchAdminRoutes({
            filters,
            pagination,
            includeDeleted,
        });
        res.json({
            items,
            total,
            page: pagination.page,
            pageSize: pagination.pageSize,
            totalPages: Math.ceil(total / pagination.pageSize),
        });
    } catch (error) {
        console.error('GET /api/admin/routes failed', error);
        res.status(500).json({ error: 'Failed to fetch routes' });
    }
});

// POST /api/admin/routes/bulk-delete
router.post('/routes/bulk-delete', ensureAuth, async (req, res) => {
    if (!ensureAdminRequest(req, res)) return;
    const ids = sanitizeIdArray(req.body?.ids);
    if (!ids.length) {
        return res.status(400).json({ error: 'Route ids are required' });
    }
    const hardDelete = parseBooleanFlag(req.body?.hardDelete);
    try {
        if (hardDelete) {
            await pool.query('DELETE FROM routes WHERE id = ANY($1::text[])', [ids]);
        } else {
            await pool.query(
                `UPDATE routes SET deleted_at = NOW(), updated_at = NOW() WHERE id = ANY($1::text[])`,
                [ids]
            );
        }
        res.json({ ids, hardDelete, count: ids.length });
    } catch (error) {
        console.error('POST /api/admin/routes/bulk-delete failed', error);
        res.status(500).json({ error: 'Failed to delete routes' });
    }
});

// POST /api/admin/routes/export
router.post('/routes/export', ensureAuth, async (req, res) => {
    if (!ensureAdminRequest(req, res)) return;
    const payload = req.body || {};
    const format = String(payload.format || 'json').toLowerCase();
    const includePoints = Boolean(payload.includePoints);
    const includeDeleted = Boolean(payload.includeDeleted);
    const filters = {
        ...(payload.filters || {}),
        sort: payload.sort || payload.filters?.sort,
        order: payload.order || payload.filters?.order,
    };
    const pagination = { limit: ADMIN_EXPORT_LIMIT, offset: 0 };

    try {
        const { items, total } = await fetchAdminRoutes({
            filters,
            pagination,
            includePoints,
            includeDeleted,
        });
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

        // Default: JSON
        res.json({ items, total, exportedAt: Date.now() });
    } catch (error) {
        console.error('POST /api/admin/routes/export failed', error);
        res.status(500).json({ error: 'Failed to export routes' });
    }
});

// === Backup ===

// GET /api/admin/backups
router.get('/backups', ensureAuth, async (req, res) => {
    if (!ensureAdminRequest(req, res)) return;
    try {
        const backups = await listAvailableBackups();
        res.json({ backups });
    } catch (error) {
        console.error('GET /api/admin/backups failed', error);
        res.status(500).json({ error: 'Failed to list backups' });
    }
});

// POST /api/admin/backups
router.post('/backups', ensureAuth, async (req, res) => {
    if (!ensureAdminRequest(req, res)) return;
    try {
        const snapshot = await buildBackupSnapshot();
        const { filename, filepath } = await saveBackupToDisk(snapshot);
        res.json({
            filename,
            createdAt: snapshot.createdAt,
            users: snapshot.users.length,
            routes: snapshot.routes.length,
            routePoints: snapshot.routePoints.length,
        });
    } catch (error) {
        console.error('POST /api/admin/backups failed', error);
        res.status(500).json({ error: 'Failed to create backup' });
    }
});

// POST /api/admin/backups/restore
router.post('/backups/restore', ensureAuth, async (req, res) => {
    if (!ensureAdminRequest(req, res)) return;
    const { filename } = req.body || {};
    if (!filename) {
        return res.status(400).json({ error: 'Backup filename is required' });
    }
    try {
        const snapshot = loadBackupFromDisk(filename);
        // Note: Actual restore logic would need to be implemented carefully
        // This is a placeholder that just validates the backup file
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
