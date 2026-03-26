/**
 * Auth Routes
 * Handles /api/login/* endpoints
 */

const express = require('express');
const {
    signToken,
    validateAdminPassword,
    isAdminLoginEnabled,
    getAdminUser,
    fetchWeChatSession,
    upsertUser
} = require('../services/authService');

const router = express.Router();

const adminLoginAttempts = new Map();

function getAdminLoginKey(req) {
    const username = typeof req.body?.username === 'string' ? req.body.username.trim() : '';
    const ip = req.ip || req.connection?.remoteAddress || 'unknown';
    return `${ip}:${username || 'unknown'}`;
}

function checkAdminLoginRateLimit(req, res) {
    const key = getAdminLoginKey(req);
    const now = Date.now();
    const current = adminLoginAttempts.get(key);
    if (!current || now >= current.resetAt) {
        adminLoginAttempts.set(key, { count: 0, resetAt: now + 10 * 60 * 1000 });
        return true;
    }
    if (current.count >= 5) {
        res.set('Retry-After', Math.ceil((current.resetAt - now) / 1000));
        res.status(429).json({ error: 'Too many admin login attempts, please try again later' });
        return false;
    }
    return true;
}

function recordAdminLoginFailure(req) {
    const key = getAdminLoginKey(req);
    const now = Date.now();
    const current = adminLoginAttempts.get(key);
    if (!current || now >= current.resetAt) {
        adminLoginAttempts.set(key, { count: 1, resetAt: now + 10 * 60 * 1000 });
        return;
    }
    current.count += 1;
}

function clearAdminLoginFailures(req) {
    adminLoginAttempts.delete(getAdminLoginKey(req));
}

// POST /api/login/admin
router.post('/admin', async (req, res) => {
    if (!isAdminLoginEnabled()) {
        return res.status(503).json({ error: 'Admin login is not configured' });
    }
    if (!checkAdminLoginRateLimit(req, res)) {
        return;
    }
    const { username, password } = req.body || {};
    if (typeof username !== 'string' || typeof password !== 'string') {
        return res.status(400).json({ error: 'Missing credentials' });
    }
    const normalizedUsername = username.trim();
    if (!normalizedUsername) {
        return res.status(400).json({ error: 'Username is required' });
    }
    if (normalizedUsername !== getAdminUser()) {
        recordAdminLoginFailure(req);
        return res.status(401).json({ error: 'Invalid username or password' });
    }
    const passwordValid = await validateAdminPassword(password);
    if (!passwordValid) {
        recordAdminLoginFailure(req);
        return res.status(401).json({ error: 'Invalid username or password' });
    }
    clearAdminLoginFailures(req);
    const token = signToken('admin', { role: 'admin' });
    res.json({ token, role: 'admin' });
});

// POST /api/login/wechat
router.post('/wechat', async (req, res) => {
    const { code } = req.body || {};
    if (!code) return res.status(400).json({ error: 'Missing code' });
    try {
        const session = await fetchWeChatSession(code);
        const user = await upsertUser(session);
        const userId = user?.id;
        const token = signToken(userId);
        res.json({
            token,
            userId,
            user: {
                id: user.id,
                nickname: user.nickname || null,
                avatar: user.avatar || null,
            },
        });
    } catch (error) {
        console.error('POST /api/login/wechat failed', error);
        const status = error.statusCode || 500;
        res.status(status).json({ error: error.message || 'Login failed' });
    }
});

module.exports = router;
