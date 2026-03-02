const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const bodyParser = require('body-parser');
const fs = require('fs');
const path = require('path');
const multer = require('multer');

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
app.use(cors());
app.use(bodyParser.json({ limit: '10mb' }));
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
