/**
 * Auth Service
 * Handles authentication logic including token signing and WeChat session
 */

const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const fetch = require('node-fetch');

const {
    JWT_SECRET,
    TOKEN_EXPIRES_IN,
    WECHAT_APPID,
    WECHAT_SECRET,
    ADMIN_USER,
    ADMIN_PASSWORD,
    ADMIN_PASSWORD_HASH
} = require('../config/index');

const { pool } = require('../db/index');

// === Token Management ===

function signToken(subject, extraPayload = {}) {
    const payload = { ...extraPayload };
    if (subject !== undefined && subject !== null) {
        payload.sub = subject;
    }
    if (payload.sub === undefined || payload.sub === null) {
        throw new Error('Token subject is required');
    }
    if (!payload.role) {
        payload.role = 'user';
    }
    return jwt.sign(payload, JWT_SECRET, { expiresIn: TOKEN_EXPIRES_IN });
}

// === Admin Authentication ===

async function validateAdminPassword(password) {
    if (!password) {
        return false;
    }
    if (ADMIN_PASSWORD_HASH) {
        try {
            return await bcrypt.compare(password, ADMIN_PASSWORD_HASH);
        } catch (err) {
            console.error('bcrypt.compare failed', err);
            return false;
        }
    }
    if (ADMIN_PASSWORD) {
        return password === ADMIN_PASSWORD;
    }
    return false;
}

function isAdminLoginEnabled() {
    return Boolean(ADMIN_USER && (ADMIN_PASSWORD || ADMIN_PASSWORD_HASH));
}

function getAdminUser() {
    return ADMIN_USER;
}

// === WeChat Session ===

async function fetchWeChatSession(code) {
    if (!WECHAT_APPID || !WECHAT_SECRET) {
        const error = new Error('WeChat APPID/SECRET not configured');
        error.statusCode = 500;
        throw error;
    }
    const url = new URL('https://api.weixin.qq.com/sns/jscode2session');
    url.searchParams.set('appid', WECHAT_APPID);
    url.searchParams.set('secret', WECHAT_SECRET);
    url.searchParams.set('js_code', code);
    url.searchParams.set('grant_type', 'authorization_code');

    const response = await fetch(url.toString());
    if (!response.ok) {
        const error = new Error('WeChat API request failed');
        error.statusCode = response.status;
        throw error;
    }
    const session = await response.json();
    if (session.errcode) {
        const error = new Error(session.errmsg || 'WeChat session error');
        error.statusCode = 401;
        error.errcode = session.errcode;
        throw error;
    }
    return session;
}

// === User Management ===

async function upsertUser(session) {
    const openid = session?.openid;
    if (!openid) {
        const error = new Error('Invalid WeChat session: missing openid');
        error.statusCode = 400;
        throw error;
    }

    // Try to find existing user
    const existing = await pool.query(
        'SELECT id, openid, nickname, avatar FROM users WHERE openid = $1',
        [openid]
    );

    if (existing.rows.length > 0) {
        // Update last login time
        await pool.query(
            'UPDATE users SET last_login_at = NOW() WHERE id = $1',
            [existing.rows[0].id]
        );
        return existing.rows[0];
    }

    // Create new user
    const result = await pool.query(
        `INSERT INTO users (openid, session_key, created_at, last_login_at)
     VALUES ($1, $2, NOW(), NOW())
     RETURNING id, openid, nickname, avatar`,
        [openid, session.session_key || null]
    );

    return result.rows[0];
}

async function getUserById(userId) {
    const result = await pool.query(
        `SELECT id, openid, nickname, avatar, gender, age_range, identity_label,
            birthday, height_cm, weight_kg, created_at, last_login_at
     FROM users WHERE id = $1`,
        [userId]
    );
    return result.rows[0] || null;
}

module.exports = {
    signToken,
    validateAdminPassword,
    isAdminLoginEnabled,
    getAdminUser,
    fetchWeChatSession,
    upsertUser,
    getUserById
};
