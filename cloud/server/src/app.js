const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const bodyParser = require('body-parser');
const fs = require('fs');
const path = require('path');
const multer = require('multer');

// Simple in-memory rate limiter (no extra dependency)
function createRateLimiter({ windowMs = 60000, max = 100, message = 'Too many requests' } = {}) {
    const hits = new Map();
    // Cleanup stale entries every minute
    setInterval(() => {
        const cutoff = Date.now() - windowMs;
        for (const [key, entry] of hits) {
            if (entry.resetAt < cutoff) hits.delete(key);
        }
    }, windowMs).unref();

    return (req, res, next) => {
        const key = req.ip || req.connection.remoteAddress || 'unknown';
        const now = Date.now();
        let entry = hits.get(key);
        if (!entry || now > entry.resetAt) {
            entry = { count: 0, resetAt: now + windowMs };
            hits.set(key, entry);
        }
        entry.count++;
        if (entry.count > max) {
            res.set('Retry-After', Math.ceil((entry.resetAt - now) / 1000));
            return res.status(429).json({ error: message });
        }
        next();
    };
}

const {
    STORAGE_LOCAL_PATH,
    STORAGE_BASE_URL,
    BACKUP_STORAGE_PATH
} = require('./config/index');

const { ensureUtf8ContentType } = require('./utils/format');

// === FS Setup ===
if (!fs.existsSync(STORAGE_LOCAL_PATH)) {
    fs.mkdirSync(STORAGE_LOCAL_PATH, { recursive: true });
}

if (!fs.existsSync(BACKUP_STORAGE_PATH)) {
    fs.mkdirSync(BACKUP_STORAGE_PATH, { recursive: true });
}

// === Upload (multer) ===
const upload = multer({
    storage: multer.diskStorage({
        destination: (req, file, cb) => cb(null, STORAGE_LOCAL_PATH),
        filename: (req, file, cb) => {
            const ext = path.extname((file && file.originalname) || '').toLowerCase();
            const filename = `${Date.now()}-${Math.round(Math.random() * 1e6)}${ext}`;
            cb(null, filename);
        },
    }),
});

const app = express();

app.use((req, res, next) => {
    const originalSetHeader = res.setHeader.bind(res);
    res.setHeader = (name, value) => {
        if (typeof name === 'string' && name.toLowerCase() === 'content-type') {
            if (Array.isArray(value)) {
                value = value.map(ensureUtf8ContentType);
            } else {
                value = ensureUtf8ContentType(value);
            }
        }
        return originalSetHeader(name, value);
    };
    res.charset = 'utf-8';
    next();
});

app.disable('x-powered-by');
app.use(helmet());
app.use(cors({
    origin: [
        'https://routelab.qzz.io',
        'https://servicewechat.com',  // WeChat mini program
    ],
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true,
}));
app.use(bodyParser.json({ limit: '10mb' }));

// Rate limiting: 200 requests per IP per minute for API routes
app.use('/api', createRateLimiter({ windowMs: 60000, max: 200, message: 'Too many requests, please try again later' }));

app.use('/api', (req, res, next) => {
    if (!res.getHeader('Content-Type')) {
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
    }
    next();
});

// Helper for public URLs (can be used by controllers)
app.locals.buildPublicUrl = function (filename) {
    const base = STORAGE_BASE_URL.endsWith('/') ? STORAGE_BASE_URL.slice(0, -1) : STORAGE_BASE_URL;
    const clean = filename.startsWith('/') ? filename.slice(1) : filename;
    return `${base}/${clean}`;
};

module.exports = { app, upload };
