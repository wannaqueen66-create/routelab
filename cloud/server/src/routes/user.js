/**
 * User Routes
 * Handles /api/user/* endpoints
 */

const express = require('express');
const createEnsureAuth = require('../middlewares/ensureAuth');
const { pool } = require('../db/index');
const { JWT_SECRET } = require('../config/index');
const {
    USER_GENDER_VALUES,
    USER_AGE_RANGE_VALUES,
    USER_IDENTITY_VALUES
} = require('../config/index');
const { sanitizeEnumValue } = require('../utils/format');

const ensureAuth = createEnsureAuth({ jwtSecret: JWT_SECRET });
const router = express.Router();

// GET /api/user/profile
router.get('/profile', ensureAuth, async (req, res) => {
    if (!req.userId) {
        return res.status(403).json({ error: 'User context required' });
    }
    try {
        const result = await pool.query(
            `SELECT id, nickname, avatar, gender, age_range, identity_label,
              birthday, height_cm, weight_kg, created_at
       FROM users WHERE id = $1`,
            [req.userId]
        );
        if (!result.rows.length) {
            return res.status(404).json({ error: 'User not found' });
        }
        const row = result.rows[0];
        res.json({
            id: row.id,
            nickname: row.nickname || null,
            avatar: row.avatar || null,
            gender: row.gender || null,
            ageRange: row.age_range || null,
            identity: row.identity_label || null,
            birthday: row.birthday || null,
            heightCm: row.height_cm || null,
            weightKg: row.weight_kg || null,
            createdAt: row.created_at ? row.created_at.getTime() : null,
        });
    } catch (error) {
        console.error('GET /api/user/profile failed', error);
        res.status(500).json({ error: 'Failed to fetch user profile' });
    }
});

// POST /api/user/profile
router.post('/profile', ensureAuth, async (req, res) => {
    if (!req.userId) {
        return res.status(403).json({ error: 'User context required' });
    }
    const {
        nickname,
        nickName,
        avatarUrl,
        avatar,
        gender,
        ageRange,
        identity,
        birthday,
        height,
        weight,
    } = req.body || {};

    const normalizedNickname = (nickname || nickName || '').trim().slice(0, 64) || null;
    const normalizedAvatar = (avatarUrl || avatar || '').trim().slice(0, 512) || null;
    const normalizedGender = sanitizeEnumValue(gender, USER_GENDER_VALUES) || null;
    const normalizedAgeRange = sanitizeEnumValue(ageRange, USER_AGE_RANGE_VALUES) || null;
    const normalizedIdentity = sanitizeEnumValue(identity, USER_IDENTITY_VALUES) || null;
    const normalizedBirthday = birthday || null;
    const heightNumeric = Number(height);
    const normalizedHeight =
        Number.isFinite(heightNumeric) && heightNumeric > 0 && heightNumeric < 300
            ? Math.round(heightNumeric)
            : null;
    const weightNumeric = Number(weight);
    const normalizedWeight =
        Number.isFinite(weightNumeric) && weightNumeric > 0 && weightNumeric < 400
            ? Number(weightNumeric.toFixed(1))
            : null;

    if (typeof gender === 'string' && gender.trim() && !normalizedGender) {
        return res.status(400).json({ error: 'Invalid gender value' });
    }
    if (typeof ageRange === 'string' && ageRange.trim() && !normalizedAgeRange) {
        return res.status(400).json({ error: 'Invalid age range value' });
    }
    if (typeof identity === 'string' && identity.trim() && !normalizedIdentity) {
        return res.status(400).json({ error: 'Invalid identity label value' });
    }

    try {
        await pool.query(
            `UPDATE users
         SET nickname = $1,
             avatar = $2,
             gender = $3,
             age_range = $4,
             identity_label = $5,
             birthday = $6,
             height_cm = $7,
             weight_kg = $8,
             updated_at = NOW()
       WHERE id = $9`,
            [
                normalizedNickname,
                normalizedAvatar,
                normalizedGender,
                normalizedAgeRange,
                normalizedIdentity,
                normalizedBirthday,
                normalizedHeight,
                normalizedWeight,
                req.userId,
            ]
        );
        res.status(204).end();
    } catch (error) {
        console.error('POST /api/user/profile failed', error);
        res.status(500).json({ error: 'Failed to update user profile' });
    }
});

// GET /api/user/achievements
router.get('/achievements', ensureAuth, async (req, res) => {
    if (!req.userId) {
        return res.status(403).json({ error: 'User context required' });
    }
    try {
        const result = await pool.query(
            `SELECT payload, updated_at FROM user_achievements WHERE user_id = $1`,
            [req.userId]
        );
        if (!result.rows.length) {
            return res.json({
                totalPoints: 0,
                currentBadge: null,
                routeHistory: {},
                updatedAt: null,
            });
        }
        const row = result.rows[0];
        const payload = row.payload || {};
        res.json({
            totalPoints: payload.totalPoints || 0,
            currentBadge: payload.currentBadge || null,
            routeHistory: payload.routeHistory || {},
            updatedAt: row.updated_at ? row.updated_at.getTime() : null,
        });
    } catch (error) {
        console.error('GET /api/user/achievements failed', {
            userId: req.userId,
            message: error?.message,
            stack: error?.stack,
        });
        res.status(500).json({ error: 'Failed to fetch achievements' });
    }
});

// POST /api/user/achievements
router.post('/achievements', ensureAuth, async (req, res) => {
    if (!req.userId) {
        return res.status(403).json({ error: 'User context required' });
    }
    const body = req.body || {};
    const totalPointsCandidate = Number(body.totalPoints);
    const totalPoints =
        Number.isFinite(totalPointsCandidate) && totalPointsCandidate >= 0
            ? Math.round(totalPointsCandidate)
            : 0;
    const currentBadge =
        body.currentBadge && typeof body.currentBadge === 'string' ? body.currentBadge.trim() : null;
    const routeHistory =
        body.routeHistory && typeof body.routeHistory === 'object' ? body.routeHistory : {};
    const now = new Date();
    const payload = {
        totalPoints,
        currentBadge,
        routeHistory,
        updatedAt: now.getTime(),
    };

    try {
        const result = await pool.query(
            `INSERT INTO user_achievements (user_id, payload, updated_at)
       VALUES ($1, $2, $3)
       ON CONFLICT (user_id) DO UPDATE
         SET payload = EXCLUDED.payload,
             updated_at = EXCLUDED.updated_at
       RETURNING payload, updated_at`,
            [req.userId, payload, now]
        );
        const row = result.rows[0] || {};
        const returnedPayload = row.payload || payload;
        res.json({
            totalPoints: returnedPayload.totalPoints || 0,
            currentBadge: returnedPayload.currentBadge || null,
            routeHistory: returnedPayload.routeHistory || {},
            updatedAt: row.updated_at ? row.updated_at.getTime() : now.getTime(),
        });
    } catch (error) {
        console.error('POST /api/user/achievements failed', {
            userId: req.userId,
            message: error?.message,
            stack: error?.stack,
        });
        res.status(500).json({ error: 'Failed to update achievements' });
    }
});

// GET /api/user/settings
router.get('/settings', ensureAuth, async (req, res) => {
    if (!req.userId) {
        return res.status(403).json({ error: 'User context required' });
    }
    try {
        const result = await pool.query(
            `SELECT default_privacy_level,
              default_weight_kg,
              auto_sync,
              keep_screen_preferred,
              updated_at
       FROM user_settings WHERE user_id = $1`,
            [req.userId]
        );

        let privacyLevel = 'public';
        let weight = null;
        let autoSync = true;
        let keepScreenPreferred = false;
        let updatedAt = null;

        if (result.rows.length > 0) {
            const row = result.rows[0];
            if (typeof row.default_privacy_level === 'string' && row.default_privacy_level.trim()) {
                privacyLevel = row.default_privacy_level.trim();
            }
            const weightNumeric = Number(row.default_weight_kg);
            weight = Number.isFinite(weightNumeric) && weightNumeric > 0 ? weightNumeric : null;
            autoSync = row.auto_sync !== false;
            keepScreenPreferred = row.keep_screen_preferred === true;
            if (row.updated_at instanceof Date) {
                updatedAt = row.updated_at.getTime();
            }
        }

        res.json({
            privacyLevel,
            weight,
            autoSync,
            keepScreenPreferred,
            updatedAt,
        });
    } catch (error) {
        console.error('GET /api/user/settings failed', {
            userId: req.userId,
            message: error?.message,
            stack: error?.stack,
        });
        res.status(500).json({ error: 'Failed to fetch user settings' });
    }
});

// POST /api/user/settings
router.post('/settings', ensureAuth, async (req, res) => {
    if (!req.userId) {
        return res.status(403).json({ error: 'User context required' });
    }
    const { privacyLevel, weight, autoSync, keepScreenPreferred } = req.body || {};
    const normalizedPrivacyLevel =
        typeof privacyLevel === 'string' && privacyLevel.trim()
            ? privacyLevel.trim().toLowerCase()
            : null;
    const weightNumeric = Number(weight);
    const normalizedWeight =
        Number.isFinite(weightNumeric) && weightNumeric > 0 && weightNumeric < 400
            ? Number(weightNumeric.toFixed(1))
            : null;
    const normalizedAutoSync =
        autoSync === null || autoSync === undefined ? null : Boolean(autoSync);
    const normalizedKeepScreen =
        keepScreenPreferred === null || keepScreenPreferred === undefined
            ? null
            : Boolean(keepScreenPreferred);
    const now = new Date();

    try {
        const result = await pool.query(
            `INSERT INTO user_settings (
         user_id,
         default_privacy_level,
         default_weight_kg,
         auto_sync,
         keep_screen_preferred,
         updated_at
       )
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (user_id) DO UPDATE
         SET default_privacy_level = COALESCE(EXCLUDED.default_privacy_level, user_settings.default_privacy_level),
             default_weight_kg = COALESCE(EXCLUDED.default_weight_kg, user_settings.default_weight_kg),
             auto_sync = COALESCE(EXCLUDED.auto_sync, user_settings.auto_sync),
             keep_screen_preferred = COALESCE(EXCLUDED.keep_screen_preferred, user_settings.keep_screen_preferred),
             updated_at = EXCLUDED.updated_at
       RETURNING default_privacy_level, default_weight_kg, auto_sync, keep_screen_preferred, updated_at`,
            [req.userId, normalizedPrivacyLevel, normalizedWeight, normalizedAutoSync, normalizedKeepScreen, now]
        );
        const row = result.rows[0] || {};
        let privacyLevelOut = 'public';
        if (typeof row.default_privacy_level === 'string' && row.default_privacy_level.trim()) {
            privacyLevelOut = row.default_privacy_level.trim();
        }
        const weightOutNumeric = Number(row.default_weight_kg);
        const weightOut = Number.isFinite(weightOutNumeric) && weightOutNumeric > 0 ? weightOutNumeric : null;
        res.json({
            privacyLevel: privacyLevelOut,
            weight: weightOut,
            autoSync: row.auto_sync !== false,
            keepScreenPreferred: row.keep_screen_preferred === true,
            updatedAt: row.updated_at instanceof Date ? row.updated_at.getTime() : now.getTime(),
        });
    } catch (error) {
        console.error('POST /api/user/settings failed', {
            userId: req.userId,
            message: error?.message,
            stack: error?.stack,
        });
        res.status(500).json({ error: 'Failed to update user settings' });
    }
});

module.exports = router;
