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

// POST /api/login/admin
router.post('/admin', async (req, res) => {
    if (!isAdminLoginEnabled()) {
        return res.status(503).json({ error: 'Admin login is not configured' });
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
        return res.status(401).json({ error: 'Invalid username or password' });
    }
    const passwordValid = await validateAdminPassword(password);
    if (!passwordValid) {
        return res.status(401).json({ error: 'Invalid username or password' });
    }
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
