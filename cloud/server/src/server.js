require('dotenv').config();

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const bodyParser = require('body-parser');
const multer = require('multer');
const jwt = require('jsonwebtoken');
const fetch = require('node-fetch');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const ExcelJS = require('exceljs');

const createEnsureAuth = require('./middlewares/ensureAuth');

// === Config ===
const PORT = Number(process.env.PORT) || 8080; // 默认 8080，供 Nginx proxy_pass 使用
const JWT_SECRET = process.env.JWT_SECRET;
const WECHAT_APPID = process.env.WECHAT_APPID || '';
const WECHAT_SECRET = process.env.WECHAT_SECRET || '';
const ADMIN_USER = process.env.ADMIN_USER || '';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const ADMIN_PASSWORD_HASH = process.env.ADMIN_PASSWORD_HASH || '';
const TOKEN_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';
const STORAGE_LOCAL_PATH =
  process.env.STORAGE_LOCAL_PATH || path.resolve(process.cwd(), 'data', 'uploads');
const STORAGE_BASE_URL =
  process.env.STORAGE_BASE_URL || 'https://routelab.qzz.io/static/uploads';
const BACKUP_STORAGE_PATH =
  process.env.BACKUP_STORAGE_PATH || path.resolve(process.cwd(), 'data', 'backups');
const ADMIN_EXPORT_LIMIT = Math.min(
  Math.max(Number(process.env.ADMIN_EXPORT_LIMIT) || 2000, 100),
  10000
);
const DEFAULT_PAGE_SIZE = Math.min(Math.max(Number(process.env.ADMIN_PAGE_SIZE) || 25, 5), 200);

if (!JWT_SECRET) {
  throw new Error('JWT_SECRET environment variable is required');
}

const ensureAuth = createEnsureAuth({ jwtSecret: JWT_SECRET });
const WEATHER_USER_AGENT =
  process.env.WEATHER_USER_AGENT || 'RouteLabServer/1.0 (+https://routelab.qzz.io)';
const PUBLIC_ROUTE_LIMIT = Math.min(
  Math.max(Number(process.env.PUBLIC_ROUTE_LIMIT) || 24, 5),
  50
);
const ADMIN_LOGIN_ENABLED = Boolean(ADMIN_USER && (ADMIN_PASSWORD || ADMIN_PASSWORD_HASH));

const AMAP_WEB_KEY = process.env.AMAP_WEB_KEY || '';
const AMAP_TIMEOUT_MS = Math.max(Number(process.env.AMAP_TIMEOUT_MS) || 6500, 2000);
const GEOCODE_CACHE_TTL_MS = Math.max(Number(process.env.GEOCODE_CACHE_TTL_MS) || 10 * 60 * 1000, 1000);
const GEOCODE_CACHE_GRID_SIZE =
  Math.max(Number(process.env.GEOCODE_CACHE_GRID_SIZE) || 0.001, 0.0001);

const geocodeCache = new Map();
const geocodeMetrics = {
  cacheHits: 0,
  cacheMisses: 0,
  amapRequests: 0,
  amapErrors: 0,
  lastResetAt: Date.now(),
  namingLevels: {
    building: 0,
    poi: 0,
    road: 0,
    district: 0,
    city: 0,
    unknown: 0,
  },
};
const ALLOWED_INTERP_METHODS = new Set(['linear', 'snap_road', 'spline', 'gap_fill']);
const ROUTE_POINT_INSERT_COLUMNS = [
  'route_id',
  'latitude',
  'longitude',
  'altitude',
  'speed',
  'heading',
  'accuracy',
  'recorded_at',
  'source',
  'source_detail',
  'interp_method',
];
const ROUTE_POINT_COLUMNS_PER_ROW = ROUTE_POINT_INSERT_COLUMNS.length;
const ROUTE_POINT_INSERT_COLUMNS_SQL = ROUTE_POINT_INSERT_COLUMNS.join(', ');
const MAX_ROUTE_POINTS_PER_BATCH = 4000;
const ROUTE_ID_PATTERN = /^[\w\-:.]{6,128}$/;
const ROUTE_POINT_LOG_SAMPLE_SIZE = 5;

const EARTH_RADIUS = 6371000; // meters
const ACTIVITY_TYPE_DEFINITIONS = {
  walk: { key: 'walk', label: '步行' },
  run: { key: 'run', label: '跑步' },
  ride: { key: 'ride', label: '骑行' },
};
const DEFAULT_ACTIVITY_TYPE = 'walk';
const PURPOSE_TYPE_DEFINITIONS = {
  walk: { key: 'walk', label: '散步' },
  run: { key: 'run', label: '跑步' },
  ride: { key: 'ride', label: '骑行' },
  gym: { key: 'gym', label: '健身' },
  basketball: { key: 'basketball', label: '篮球' },
  football: { key: 'football', label: '足球' },
  badminton: { key: 'badminton', label: '羽毛球' },
  tableTennis: { key: 'tableTennis', label: '乒乓球' },
  tennis: { key: 'tennis', label: '网球' },
  volleyball: { key: 'volleyball', label: '排球' },
  hiking: { key: 'hiking', label: '爬山' },
  other: { key: 'other', label: '其他' },
};
const PURPOSE_TYPE_VALUES = new Set(Object.keys(PURPOSE_TYPE_DEFINITIONS));

const USER_GENDER_VALUES = new Set(['male', 'female']);
const USER_AGE_RANGE_VALUES = new Set(['under18', '18_24', '25_34', '35_44', '45_54', '55_plus']);
const USER_IDENTITY_VALUES = new Set(['minor', 'undergrad', 'postgrad', 'staff', 'resident', 'other']);
const ANNOUNCEMENT_STATUS_VALUES = new Set(['draft', 'published']);

function sanitizeEnumValue(value, allowedValues) {
  if (typeof value !== 'string') {
    return '';
  }
  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return '';
  }
  return allowedValues.has(normalized) ? normalized : '';
}

function toRadians(value) {
  return (value * Math.PI) / 180;
}

function calculateSegmentDistanceMeters(startPoint, endPoint) {
  if (!(startPoint && endPoint)) {
    return 0;
  }
  const startLat = toRadians(startPoint.latitude);
  const endLat = toRadians(endPoint.latitude);
  const deltaLat = toRadians(endPoint.latitude - startPoint.latitude);
  const deltaLng = toRadians(endPoint.longitude - startPoint.longitude);

  const a =
    Math.sin(deltaLat / 2) * Math.sin(deltaLat / 2) +
    Math.cos(startLat) * Math.cos(endLat) * Math.sin(deltaLng / 2) * Math.sin(deltaLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return Number((EARTH_RADIUS * c).toFixed(2));
}

function calculateTotalDistanceMeters(points = []) {
  if (!Array.isArray(points) || points.length < 2) {
    return 0;
  }
  let total = 0;
  for (let index = 1; index < points.length; index += 1) {
    total += calculateSegmentDistanceMeters(points[index - 1], points[index]);
  }
  return total;
}

function computeMaxSpeedFromPoints(points = []) {
  if (!Array.isArray(points) || !points.length) {
    return 0;
  }
  let maxSpeed = 0;
  for (let index = 0; index < points.length; index += 1) {
    const point = points[index];
    if (!point) {
      continue;
    }
    if (Number.isFinite(point.speed) && point.speed > maxSpeed) {
      maxSpeed = point.speed;
    }
    if (index === 0) {
      continue;
    }
    const previous = points[index - 1];
    if (!previous) {
      continue;
    }
    const deltaTimeSec = (point.timestamp - previous.timestamp) / 1000;
    if (!Number.isFinite(deltaTimeSec) || deltaTimeSec <= 0.5) {
      continue;
    }
    const segmentDistance = calculateSegmentDistanceMeters(previous, point);
    if (!Number.isFinite(segmentDistance) || segmentDistance <= 0) {
      continue;
    }
    const segmentSpeed = segmentDistance / deltaTimeSec;
    if (Number.isFinite(segmentSpeed) && segmentSpeed > maxSpeed && segmentSpeed < 35) {
      maxSpeed = segmentSpeed;
    }
  }
  return maxSpeed;
}

function estimateRouteCalories(distanceMeters, weightKg = 60, activityType = DEFAULT_ACTIVITY_TYPE) {
  const distanceKm = distanceMeters / 1000;
  let factorPerKm = 0.75;
  if (activityType === 'ride') {
    factorPerKm = 0.45;
  }
  const kcal = distanceKm * weightKg * factorPerKm;
  return Math.round(Number.isFinite(kcal) ? kcal : 0);
}

function inferActivityTypeFromMetrics({
  distanceMeters = 0,
  durationMs = 0,
  averageSpeed = 0,
  maxSpeed = 0,
  pointsCount = 0,
  fallback = DEFAULT_ACTIVITY_TYPE,
} = {}) {
  const distance = Number(distanceMeters) || 0;
  const duration = Number(durationMs) || 0;
  if (distance <= 0 || duration <= 0 || pointsCount < 2) {
    return ACTIVITY_TYPE_DEFINITIONS[fallback] ? fallback : DEFAULT_ACTIVITY_TYPE;
  }

  const avgSpeed = Number.isFinite(averageSpeed) && averageSpeed > 0 ? averageSpeed : distance / (duration / 1000);
  const peakSpeed = Number.isFinite(maxSpeed) && maxSpeed > 0 ? maxSpeed : avgSpeed;
  const avgSpeedKmh = avgSpeed * 3.6;
  const peakSpeedKmh = peakSpeed * 3.6;
  const distanceKm = distance / 1000;
  const durationMinutes = duration / 60000;

  if (distanceKm < 0.6 && durationMinutes < 6 && peakSpeedKmh < 16) {
    return 'walk';
  }
  if (peakSpeedKmh >= 28 || avgSpeedKmh >= 19) {
    return 'ride';
  }
  if (avgSpeedKmh >= 9.5 || peakSpeedKmh >= 14) {
    return 'run';
  }
  return 'walk';
}

function ensurePlainObject(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value;
  }
  return {};
}

function deriveRouteAnalytics({
  points = [],
  startTime = null,
  endTime = null,
  existingStats = {},
  existingMeta = {},
  weightKg = null,
} = {}) {
  const sanitizedPoints = Array.isArray(points) ? points : [];
  const computedDistance = calculateTotalDistanceMeters(sanitizedPoints);
  const fallbackDistanceCandidate =
    Number(existingStats?.distance ?? existingStats?.distance_m ?? existingStats?.distanceMeters) || 0;
  const distanceMeters = computedDistance > 0 ? computedDistance : Math.max(0, fallbackDistanceCandidate);

  const startMs = startTime instanceof Date ? startTime.getTime() : null;
  const endMs = endTime instanceof Date ? endTime.getTime() : null;
  let durationMs = null;
  if (Number.isFinite(startMs) && Number.isFinite(endMs)) {
    durationMs = Math.max(0, endMs - startMs);
  }
  if (!Number.isFinite(durationMs) || durationMs <= 0) {
    const existingDurationCandidate =
      Number(existingStats?.duration) ||
      Number(existingStats?.durationMs) ||
      Number(existingStats?.duration_ms) ||
      Number(existingStats?.durationMilliseconds);
    durationMs =
      Number.isFinite(existingDurationCandidate) && existingDurationCandidate > 0
        ? existingDurationCandidate
        : 0;
  }

  const averageSpeed =
    durationMs > 0 ? distanceMeters / (durationMs / 1000) : Number(existingStats?.speed) || 0;
  const maxSpeedCandidate = computeMaxSpeedFromPoints(sanitizedPoints);
  const existingMaxSpeed =
    Number(existingStats?.maxSpeed ?? existingStats?.max_speed ?? existingStats?.maxSpeedMs) || 0;
  const maxSpeed = maxSpeedCandidate > 0 ? maxSpeedCandidate : Math.max(0, existingMaxSpeed, averageSpeed);

  const fallbackActivity =
    typeof existingMeta?.activityType === 'string'
      ? existingMeta.activityType.trim().toLowerCase()
      : DEFAULT_ACTIVITY_TYPE;
  const activityType = inferActivityTypeFromMetrics({
    distanceMeters,
    durationMs,
    averageSpeed,
    maxSpeed,
    pointsCount: sanitizedPoints.length,
    fallback: fallbackActivity || DEFAULT_ACTIVITY_TYPE,
  });

  const weightCandidate =
    Number(weightKg) ||
    Number(existingMeta?.weight) ||
    Number(existingStats?.weight) ||
    Number(existingMeta?.bodyWeightKg);
  const effectiveWeight =
    Number.isFinite(weightCandidate) && weightCandidate > 0 ? weightCandidate : 60;

  const calories = estimateRouteCalories(distanceMeters, effectiveWeight, activityType);
  const steps = activityType === 'ride' ? 0 : Math.round(distanceMeters / 0.75);
  const pace =
    activityType === 'ride' || averageSpeed <= 0 ? 0 : Number((1000 / averageSpeed).toFixed(2));

  const existingStatsObject = ensurePlainObject(existingStats);
  const existingMetaObject = ensurePlainObject(existingMeta);

  const stats = {
    ...existingStatsObject,
    distance: Number.isFinite(distanceMeters) ? Number(distanceMeters.toFixed(2)) : 0,
    duration: Number.isFinite(durationMs) ? durationMs : 0,
    speed: Number.isFinite(averageSpeed) ? Number(averageSpeed.toFixed(3)) : 0,
    pace,
    steps,
    calories,
    maxSpeed: Number.isFinite(maxSpeed) ? Number(maxSpeed.toFixed(3)) : 0,
  };

  const activityMeta = ACTIVITY_TYPE_DEFINITIONS[activityType] || ACTIVITY_TYPE_DEFINITIONS[DEFAULT_ACTIVITY_TYPE];
  const inference = {
    source: 'server',
    computedAt: Date.now(),
    points: sanitizedPoints.length,
    averageSpeedKmh: Number((stats.speed * 3.6).toFixed(1)),
    maxSpeedKmh: Number((stats.maxSpeed * 3.6).toFixed(1)),
    distanceKm: Number((stats.distance / 1000).toFixed(2)),
    durationMinutes: Number((stats.duration / 60000).toFixed(1)),
  };

  const meta = {
    ...existingMetaObject,
    activityType,
    modeLabel: activityMeta ? `${activityMeta.label}记录` : '路线记录',
    weight: effectiveWeight,
    activityInference: inference,
  };

  return { stats, meta, activityType, weight: effectiveWeight, inference };
}

const BUILDING_NAME_WHITELIST = [
  /教学楼/i,
  /实验楼/i,
  /综合楼/i,
  /学院/i,
  /图书馆/i,
  /信息中心/i,
  /学生公寓/i,
  /宿舍/i,
  /办公楼/i,
  /行政楼/i,
  /体育馆/i,
  /运动中心/i,
  /礼堂/i,
  /食堂/i,
  /餐厅/i,
  /auditorium/i,
  /library/i,
  /dining/i,
  /canteen/i,
  /administration/i,
  /office/i,
  /laboratory/i,
  /lab/i,
  /dormitory/i,
];

const FALLBACK_BUILDING_NAME_PRIORITY = ['building', 'poi', 'road', 'district', 'city'];

if (!AMAP_WEB_KEY) {
  console.warn('[geocode] AMAP_WEB_KEY is not configured. Geocode proxy endpoints will fail.');
}

const TEXTUAL_MIME_PREFIXES = ['text/'];
const TEXTUAL_MIME_TYPES = new Set([
  'application/json',
  'application/ld+json',
  'application/manifest+json',
  'application/vnd.api+json',
  'application/graphql+json',
  'application/javascript',
  'text/javascript',
  'application/xml',
  'text/xml',
  'application/rss+xml',
  'application/atom+xml',
  'image/svg+xml',
  'application/x-www-form-urlencoded',
  'text/csv',
  'application/csv',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
]);

function isTextualMimeType(mime) {
  if (!mime) {
    return false;
  }
  if (TEXTUAL_MIME_TYPES.has(mime)) {
    return true;
  }
  if (TEXTUAL_MIME_PREFIXES.some((prefix) => mime.startsWith(prefix))) {
    return true;
  }
  if (mime.endsWith('+json') || mime.endsWith('+xml')) {
    return true;
  }
  return false;
}

function ensureUtf8ContentType(value) {
  if (typeof value !== 'string') {
    return value;
  }
  const segments = value
    .split(';')
    .map((segment) => segment.trim())
    .filter(Boolean);
  if (!segments.length) {
    return value;
  }
  const [type, ...params] = segments;
  const normalizedType = type.toLowerCase();
  if (!isTextualMimeType(normalizedType)) {
    return value;
  }
  const hasCharset = params.some((param) => param.toLowerCase().startsWith('charset='));
  if (hasCharset) {
    return [type, ...params].join('; ');
  }
  return [type, 'charset=utf-8', ...params].join('; ');
}

// === DB ===
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.PGSSLMODE === 'require' ? { rejectUnauthorized: false } : false,
});

pool.on('connect', (client) => {
  client
    .query(`SET client_encoding TO 'UTF8'`)
    .catch((error) => console.error('Failed to enforce UTF-8 client encoding', error));
});

async function assertDatabaseEncoding() {
  let client;
  try {
    client = await pool.connect();
    const serverEncodingResult = await client.query(`SHOW SERVER_ENCODING`);
    const clientEncodingResult = await client.query(`SHOW CLIENT_ENCODING`);
    const serverEncoding = serverEncodingResult.rows?.[0]?.server_encoding;
    const clientEncoding = clientEncodingResult.rows?.[0]?.client_encoding;
    if (serverEncoding && serverEncoding.toUpperCase() !== 'UTF8') {
      console.warn(
        `[db] Unexpected server encoding "${serverEncoding}". Expected UTF8 to avoid mojibake issues.`
      );
    }
    if (clientEncoding && clientEncoding.toUpperCase() !== 'UTF8') {
      console.warn(
        `[db] Unexpected client encoding "${clientEncoding}". Expected UTF8 to avoid mojibake issues.`
      );
    }
  } catch (error) {
    console.error('[db] Failed to verify database encoding', error);
  } finally {
    if (client) {
      client.release();
    }
  }
}
assertDatabaseEncoding();

const INIT_SQL_PATH = path.resolve(__dirname, '../..', 'scripts', 'init.sql');
const REQUIRED_SOCIAL_TABLES = [
  'route_likes',
  'route_comments',
  'route_comment_likes',
  'route_comment_replies',
];
let databaseReadyPromise = null;

function splitSqlStatements(sql) {
  return sql
    .split(/;\s*(?:\r?\n|$)/)
    .map((statement) => statement.trim())
    .filter(Boolean);
}

async function applyInitSql() {
  if (!INIT_SQL_PATH) {
    return;
  }
  if (!fs.existsSync(INIT_SQL_PATH)) {
    console.warn(`Skipping database bootstrap: init script not found at ${INIT_SQL_PATH}`);
    return;
  }
  let sql;
  try {
    sql = await fs.promises.readFile(INIT_SQL_PATH, 'utf8');
  } catch (error) {
    console.error('Unable to read database init script', error);
    throw error;
  }
  if (!sql || !sql.trim()) {
    console.warn('Database init script is empty, skipping bootstrap');
    return;
  }
  const statements = splitSqlStatements(sql);
  if (!statements.length) {
    console.warn('Database init script produced no executable statements, skipping bootstrap');
    return;
  }
  const client = await pool.connect();
  try {
    console.log('Applying database bootstrap script');
    for (const statement of statements) {
      try {
        await client.query(statement);
      } catch (error) {
        const normalized = statement.trim().toUpperCase();
        if (normalized.startsWith('CREATE EXTENSION') && error.code === '42501') {
          console.warn('Skipping CREATE EXTENSION due to insufficient privileges');
          continue;
        }
        throw error;
      }
    }
    console.log('Database bootstrap script applied successfully');
  } catch (error) {
    console.error('Database bootstrap failed', error);
    throw error;
  } finally {
    client.release();
  }
}

async function verifyRequiredTables() {
  if (!REQUIRED_SOCIAL_TABLES.length) {
    return;
  }
  try {
    const { rows } = await pool.query(
      `SELECT tablename
       FROM pg_catalog.pg_tables
       WHERE schemaname = 'public'
         AND tablename = ANY($1::text[])`,
      [REQUIRED_SOCIAL_TABLES]
    );
    const existing = new Set(rows.map((row) => row.tablename));
    const missing = REQUIRED_SOCIAL_TABLES.filter((name) => !existing.has(name));
    if (missing.length) {
      throw new Error(`Missing required database tables: ${missing.join(', ')}`);
    }
  } catch (error) {
    error.message = `Failed to verify required tables: ${error.message}`;
    throw error;
  }
}

async function verifyUtf8Encoding() {
  const client = await pool.connect();
  try {
    const serverResult = await client.query(`SHOW SERVER_ENCODING`);
    const clientResult = await client.query(`SHOW CLIENT_ENCODING`);
    const serverEncoding = serverResult?.rows?.[0]?.server_encoding || '';
    const clientEncoding = clientResult?.rows?.[0]?.client_encoding || '';
    if (typeof serverEncoding === 'string' && serverEncoding.toUpperCase() !== 'UTF8') {
      throw new Error(`PostgreSQL server_encoding must be UTF8 (current: ${serverEncoding})`);
    }
    if (typeof clientEncoding === 'string' && clientEncoding.toUpperCase() !== 'UTF8') {
      console.warn(
        `Adjusting PostgreSQL client_encoding to UTF8 (previous value: ${clientEncoding})`
      );
      await client.query(`SET client_encoding TO 'UTF8'`);
    }
    const { rows } = await client.query(
      `SELECT data_type
         FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'users'
          AND column_name = 'nickname'
        LIMIT 1`
    );
    const nicknameType = rows?.[0]?.data_type || '';
    if (nicknameType && nicknameType.toLowerCase() !== 'text') {
      throw new Error(`users.nickname column must be TEXT (current: ${nicknameType})`);
    }
  } finally {
    client.release();
  }
}

function ensureDatabaseReady() {
  if (!databaseReadyPromise) {
    databaseReadyPromise = (async () => {
      await applyInitSql();
      await verifyUtf8Encoding();
      await verifyRequiredTables();
    })().catch((error) => {
      databaseReadyPromise = null;
      throw error;
    });
  }
  return databaseReadyPromise;
}

// === FS ===
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

// === App ===
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

// === Helpers ===
function buildPublicUrl(filename) {
  const base = STORAGE_BASE_URL.endsWith('/') ? STORAGE_BASE_URL.slice(0, -1) : STORAGE_BASE_URL;
  const clean = filename.startsWith('/') ? filename.slice(1) : filename;
  return `${base}/${clean}`;
}

function parseTimestamp(value) {
  if (!value) return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }
  if (typeof value === 'number') {
    const fromNumber = new Date(value);
    return Number.isNaN(fromNumber.getTime()) ? null : fromNumber;
  }
  if (typeof value === 'string') {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) {
      const fromNumeric = new Date(numeric);
      if (!Number.isNaN(fromNumeric.getTime())) {
        return fromNumeric;
      }
    }
    const fromString = new Date(value);
    return Number.isNaN(fromString.getTime()) ? null : fromString;
  }
  return null;
}

function normalizePointSource(value) {
  if (typeof value !== 'string') {
    return 'gps';
  }
  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return 'gps';
  }
  return normalized === 'interp' ? 'interp' : 'gps';
}

function normalizeSourceDetail(value) {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
}

function normalizeInterpMethod(value) {
  if (typeof value !== 'string') {
    return null;
  }
  const method = value.trim().toLowerCase();
  if (!method) {
    return null;
  }
  return ALLOWED_INTERP_METHODS.has(method) ? method : null;
}

function buildHttpError(statusCode, message, details = undefined) {
  const error = new Error(message);
  error.statusCode = statusCode;
  if (details !== undefined) {
    error.details = details;
  }
  return error;
}

function normalizeRouteId(value) {
  if (value === null || value === undefined) {
    return null;
  }
  const id = String(value).trim();
  if (!id) {
    return null;
  }
  if (id.length < 6 || id.length > 128) {
    return null;
  }
  if (!ROUTE_ID_PATTERN.test(id)) {
    return null;
  }
  return id;
}

function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object || {}, key);
}

function isPlainObject(value) {
  if (!value || typeof value !== 'object') {
    return false;
  }
  if (Array.isArray(value)) {
    return false;
  }
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function sanitizeJsonObject(value, fallback = {}) {
  if (value === null || value === undefined) {
    return fallback;
  }
  if (isPlainObject(value)) {
    return value;
  }
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return isPlainObject(parsed) ? parsed : fallback;
    } catch (error) {
      return fallback;
    }
  }
  return fallback;
}

function ensureJsonValue(value, fallback) {
  if (value === null || value === undefined) {
    return fallback;
  }
  try {
    const text = JSON.stringify(value);
    // 确保传入数据库的一定是标准 JSON，可被 pg 驱动安全序列化
    return JSON.parse(text);
  } catch (error) {
    return fallback;
  }
}
function sanitizeJsonArray(value, fallback = []) {
  if (value === null || value === undefined) {
    return fallback;
  }
  if (Array.isArray(value)) {
    return value.filter((item) => item !== undefined);
  }
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : fallback;
    } catch (error) {
      return fallback;
    }
  }
  return fallback;
}

function sanitizeRoutePhotos(value) {
  const photos = sanitizeJsonArray(value, []);
  return photos
    .map((item) => {
      if (!item) {
        return null;
      }
      if (typeof item === 'string') {
        const trimmed = item.trim();
        return trimmed ? { url: trimmed } : null;
      }
      if (!isPlainObject(item)) {
        return null;
      }
      const normalized = { ...item };
      if (typeof normalized.url !== 'string' || !normalized.url.trim()) {
        if (typeof normalized.path === 'string' && normalized.path.trim()) {
          normalized.url = normalized.path.trim();
        } else if (typeof normalized.fileId === 'string' && normalized.fileId.trim()) {
          normalized.url = normalized.fileId.trim();
        }
      }
      return normalized;
    })
    .filter(Boolean);
}

function sanitizeRoutePointsForPersistence(points = []) {
  if (!Array.isArray(points)) {
    return {
      points: [],
      stats: { originalCount: 0, invalidCount: 0, duplicateCount: 0, invalidSamples: [] },
    };
  }
  const sanitized = [];
  const invalidSamples = [];
  let invalidCount = 0;
  let duplicateCount = 0;
  for (let index = 0; index < points.length; index += 1) {
    const raw = points[index];
    if (!raw || typeof raw !== 'object') {
      invalidCount += 1;
      if (invalidSamples.length < ROUTE_POINT_LOG_SAMPLE_SIZE) {
        invalidSamples.push({ index, reason: 'missing_point' });
      }
      continue;
    }
    const latitude = Number(raw.latitude);
    const longitude = Number(raw.longitude);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      invalidCount += 1;
      if (invalidSamples.length < ROUTE_POINT_LOG_SAMPLE_SIZE) {
        invalidSamples.push({ index, reason: 'invalid_coordinates' });
      }
      continue;
    }
    if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
      invalidCount += 1;
      if (invalidSamples.length < ROUTE_POINT_LOG_SAMPLE_SIZE) {
        invalidSamples.push({ index, reason: 'coordinate_out_of_range' });
      }
      continue;
    }
    const timestampCandidate =
      raw.timestamp !== undefined && raw.timestamp !== null
        ? parseTimestamp(raw.timestamp)
        : raw.recordedAt !== undefined && raw.recordedAt !== null
        ? parseTimestamp(raw.recordedAt)
        : null;
    if (!timestampCandidate) {
      invalidCount += 1;
      if (invalidSamples.length < ROUTE_POINT_LOG_SAMPLE_SIZE) {
        invalidSamples.push({ index, reason: 'invalid_timestamp' });
      }
      continue;
    }
    const timestampValue = timestampCandidate.getTime();
    if (!Number.isFinite(timestampValue)) {
      invalidCount += 1;
      if (invalidSamples.length < ROUTE_POINT_LOG_SAMPLE_SIZE) {
        invalidSamples.push({ index, reason: 'invalid_timestamp' });
      }
      continue;
    }
    const source = normalizePointSource(raw.source);
    const sourceDetail = normalizeSourceDetail(raw?.source_detail ?? raw?.sourceDetail);
    const interpMethod =
      source === 'interp'
        ? normalizeInterpMethod(raw?.interp_method ?? raw?.interpMethod)
        : null;
    const point = {
      latitude,
      longitude,
      timestamp: timestampValue,
      source,
    };
    if (Number.isFinite(Number(raw.altitude))) {
      point.altitude = Number(raw.altitude);
    }
    if (Number.isFinite(Number(raw.speed))) {
      point.speed = Number(raw.speed);
    }
    if (Number.isFinite(Number(raw.heading))) {
      point.heading = Number(raw.heading);
    }
    if (Number.isFinite(Number(raw.accuracy))) {
      point.accuracy = Number(raw.accuracy);
    }
    if (sourceDetail) {
      point.source_detail = sourceDetail;
    }
    if (interpMethod) {
      point.interp_method = interpMethod;
    }
    const last = sanitized[sanitized.length - 1];
    if (
      last &&
      last.latitude === point.latitude &&
      last.longitude === point.longitude &&
      last.timestamp === point.timestamp &&
      (last.source === point.source || (!last.source && !point.source))
    ) {
      duplicateCount += 1;
      continue;
    }
    sanitized.push(point);
  }
  sanitized.sort((a, b) => a.timestamp - b.timestamp);
  return {
    points: sanitized,
    stats: {
      originalCount: points.length,
      invalidCount,
      duplicateCount,
      invalidSamples,
    },
  };
}

function summarizeRoutePayloadForLog(route) {
  if (!route || typeof route !== 'object') {
    return null;
  }
  const points = Array.isArray(route.points) ? route.points : [];
  const summary = {
    id: route.id,
    title: route.title ?? null,
    startTime: route.startTime ?? null,
    endTime: route.endTime ?? null,
    privacyLevel: route.privacyLevel ?? route.privacy_level ?? null,
    pointCount: points.length,
    hasStats: !!route.stats,
    hasMeta: !!route.meta,
    deletedAt: route.deletedAt ?? null,
  };
  if (route.userId !== undefined) {
    summary.userId = route.userId;
  } else if (route.ownerId !== undefined) {
    summary.ownerId = route.ownerId;
  } else if (route.owner?.id !== undefined) {
    summary.ownerId = route.owner.id;
  }
  const samplePoints = points.slice(0, ROUTE_POINT_LOG_SAMPLE_SIZE).map((point, index) => ({
    index,
    latitude: Number(point?.latitude),
    longitude: Number(point?.longitude),
    timestamp: point?.timestamp ?? point?.recordedAt ?? null,
    source: point?.source ?? null,
  }));
  if (samplePoints.length) {
    summary.samplePoints = samplePoints;
  }
  if (points.length > ROUTE_POINT_LOG_SAMPLE_SIZE) {
    summary.pointsTruncated = true;
  }
  return summary;
}

async function fetchRouteQualityMetrics() {
  const client = await pool.connect();
  try {
    const statsResult = await client.query(
      `
        SELECT
          COUNT(*)::BIGINT AS total_points,
          SUM(CASE WHEN source = 'interp' THEN 1 ELSE 0 END)::BIGINT AS interp_points,
          SUM(CASE WHEN source_detail = 'weak_signal' THEN 1 ELSE 0 END)::BIGINT AS weak_signal_points,
          SUM(CASE WHEN source_detail = 'background' THEN 1 ELSE 0 END)::BIGINT AS background_points,
          SUM(CASE WHEN source_detail = 'screen_off' THEN 1 ELSE 0 END)::BIGINT AS screen_off_points
        FROM route_points
      `
    );
    const statsRow = statsResult.rows[0] || {};
    const pauseResult = await client.query(
      `
        SELECT COALESCE(SUM(spike_count), 0)::BIGINT AS resume_spike_count
        FROM (
          SELECT COALESCE(
            (
              SELECT COUNT(*)
              FROM jsonb_array_elements(COALESCE(meta->'pausePoints', '[]'::jsonb)) AS p
              WHERE COALESCE(p->>'reason', '') = 'suspension'
            ),
            0
          ) AS spike_count
          FROM routes
        ) AS aggregated
      `
    );
    const totalPoints = Number(statsRow.total_points || 0);
    const interpPoints = Number(statsRow.interp_points || 0);
    const weakSignalPoints = Number(statsRow.weak_signal_points || 0);
    const backgroundPoints = Number(statsRow.background_points || 0);
    const screenOffPoints = Number(statsRow.screen_off_points || 0);
    const resumeSpikeCount = Number(pauseResult.rows?.[0]?.resume_spike_count || 0);
    const combinedBackground = backgroundPoints + screenOffPoints;
    const metrics = {
      totalPoints,
      interpPoints,
      backgroundPoints,
      screenOffPoints,
      weakSignalPoints,
      resumeSpikeCount,
      backgroundRatio: totalPoints ? Number(((combinedBackground / totalPoints) || 0).toFixed(4)) : 0,
      interpRatio: totalPoints ? Number(((interpPoints / totalPoints) || 0).toFixed(4)) : 0,
      weakSignalRatio: totalPoints ? Number(((weakSignalPoints / totalPoints) || 0).toFixed(4)) : 0,
    };
    console.info('Route quality metrics snapshot', metrics);
    return metrics;
  } finally {
    client.release();
  }
}

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

function parseBooleanFlag(value) {
  if (value === null || value === undefined) {
    return false;
  }
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'number') {
    return value === 1;
  }
  const normalized = String(value).trim().toLowerCase();
  if (!normalized) {
    return false;
  }
  return ['1', 'true', 'yes', 'on', 'all'].includes(normalized);
}

function parseNumber(value, { min = Number.NEGATIVE_INFINITY, max = Number.POSITIVE_INFINITY } = {}) {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return Number.NaN;
  }
  let result = numeric;
  if (Number.isFinite(min) && result < min) {
    result = min;
  }
  if (Number.isFinite(max) && result > max) {
    result = max;
  }
  return result;
}

function normalizeSortOrder(value, fallback = 'desc') {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (normalized === 'asc' || normalized === 'ascending') {
    return 'ASC';
  }
  if (normalized === 'desc' || normalized === 'descending') {
    return 'DESC';
  }
  return fallback.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';
}

function normalizePagination(pageValue, pageSizeValue) {
  const page = Math.max(parseInt(pageValue, 10) || 1, 1);
  let pageSize = parseInt(pageSizeValue, 10);
  if (!Number.isFinite(pageSize) || pageSize <= 0) {
    pageSize = DEFAULT_PAGE_SIZE;
  }
  pageSize = Math.min(Math.max(pageSize, 5), 200);
  return {
    page,
    pageSize,
    offset: (page - 1) * pageSize,
    limit: pageSize,
  };
}

function ensureAdminRequest(req, res) {
  if (req.role !== 'admin') {
    res.status(403).json({ error: 'Admin privileges required' });
    return false;
  }
  return true;
}

function computePointStats(points = []) {
  if (!Array.isArray(points) || points.length === 0) {
    return {
      count: 0,
      intervalMin: null,
      intervalMax: null,
      intervalAvg: null,
    };
  }
  let prevTs = null;
  let min = null;
  let max = null;
  let total = 0;
  let samples = 0;
  for (const point of points) {
    const ts = Number(point?.timestamp ?? point?.recordedAt);
    if (!Number.isFinite(ts)) {
      continue;
    }
    if (prevTs !== null) {
      const delta = Math.max(0, (ts - prevTs) / 1000);
      if (Number.isFinite(delta)) {
        min = min === null ? delta : Math.min(min, delta);
        max = max === null ? delta : Math.max(max, delta);
        total += delta;
        samples += 1;
      }
    }
    prevTs = ts;
  }
  return {
    count: points.length,
    intervalMin: min,
    intervalMax: max,
    intervalAvg: samples > 0 ? total / samples : null,
  };
}

function buildOwnerProfileFromRow(row) {
  const rawUserId =
    row?.owner_id ??
    row?.user_id ??
    row?.userid ??
    row?.userId ??
    (Array.isArray(row?.users) && row.users.length ? row.users[0]?.id : null);
  const numericId = Number(rawUserId);
  const ownerId = Number.isFinite(numericId) ? numericId : null;
  if (ownerId === null) {
    return null;
  }
  const nickname =
    row?.owner_nickname ??
    row?.user_nickname ??
    row?.nickname ??
    row?.ownerNickname ??
    row?.userNickname ??
    null;
  const avatar =
    row?.owner_avatar ??
    row?.user_avatar ??
    row?.avatar ??
    row?.ownerAvatar ??
    row?.userAvatar ??
    null;
  const gender =
    row?.owner_gender ??
    row?.user_gender ??
    row?.gender ??
    row?.ownerGender ??
    row?.userGender ??
    null;
  const ageRange =
    row?.owner_age_range ??
    row?.user_age_range ??
    row?.age_range ??
    row?.ownerAgeRange ??
    row?.userAgeRange ??
    null;
  const identity =
    row?.owner_identity_label ??
    row?.user_identity_label ??
    row?.identity_label ??
    row?.ownerIdentity ??
    row?.userIdentity ??
    null;
  const lastActiveRaw =
    row?.owner_last_active ??
    row?.last_active ??
    row?.last_active_at ??
    row?.updated_at ??
    null;
  const lastActive =
    lastActiveRaw instanceof Date
      ? lastActiveRaw.getTime()
      : typeof lastActiveRaw === 'number'
      ? lastActiveRaw
      : null;
  return {
    id: ownerId,
    nickname: typeof nickname === 'string' ? nickname : null,
    avatar: typeof avatar === 'string' ? avatar : null,
    gender: typeof gender === 'string' ? gender : null,
    ageRange: typeof ageRange === 'string' ? ageRange : null,
    identity: typeof identity === 'string' ? identity : null,
    displayName: buildUserDisplayName({ id: ownerId, nickname }),
    lastActiveAt: lastActive,
  };
}

function buildAdminRouteFilters(filters = {}) {
  const conditions = [];
  const params = [];

  if (!filters.includeDeleted) {
    conditions.push('r.deleted_at IS NULL');
  }

  if (filters.userId !== null && filters.userId !== undefined) {
    const userId = Number(filters.userId);
    if (!Number.isFinite(userId)) {
      throw new Error('Invalid userId filter');
    }
    params.push(userId);
    conditions.push(`r.user_id = $${params.length}`);
  }

  if (filters.startDate) {
    const startDate = parseTimestamp(filters.startDate);
    if (!startDate) {
      throw new Error('Invalid startDate filter');
    }
    params.push(startDate);
    conditions.push(`r.start_time >= $${params.length}`);
  }

  if (filters.endDate) {
    const endDate = parseTimestamp(filters.endDate);
    if (!endDate) {
      throw new Error('Invalid endDate filter');
    }
    params.push(endDate);
    conditions.push(`r.start_time <= $${params.length}`);
  }

  if (filters.minDistance !== undefined && filters.minDistance !== null) {
    const minDistance = parseNumber(filters.minDistance, { min: 0 });
    if (Number.isNaN(minDistance)) {
      throw new Error('Invalid minDistance filter');
    }
    if (minDistance !== null) {
      params.push(minDistance);
      conditions.push(`COALESCE((r.stats->>'distance')::numeric, 0) >= $${params.length}`);
    }
  }

  if (filters.maxDistance !== undefined && filters.maxDistance !== null) {
    const maxDistance = parseNumber(filters.maxDistance, { min: 0 });
    if (Number.isNaN(maxDistance)) {
      throw new Error('Invalid maxDistance filter');
    }
    if (maxDistance !== null) {
      params.push(maxDistance);
      conditions.push(`COALESCE((r.stats->>'distance')::numeric, 0) <= $${params.length}`);
    }
  }

  if (filters.minDuration !== undefined && filters.minDuration !== null) {
    const minDuration = parseNumber(filters.minDuration, { min: 0 });
    if (Number.isNaN(minDuration)) {
      throw new Error('Invalid minDuration filter');
    }
    if (minDuration !== null) {
      params.push(minDuration);
      conditions.push(`COALESCE((r.stats->>'duration')::numeric, 0) >= $${params.length}`);
    }
  }

  if (filters.maxDuration !== undefined && filters.maxDuration !== null) {
    const maxDuration = parseNumber(filters.maxDuration, { min: 0 });
    if (Number.isNaN(maxDuration)) {
      throw new Error('Invalid maxDuration filter');
    }
    if (maxDuration !== null) {
      params.push(maxDuration);
      conditions.push(`COALESCE((r.stats->>'duration')::numeric, 0) <= $${params.length}`);
    }
  }

  if (filters.keyword) {
    const keyword = String(filters.keyword || '').trim();
    if (keyword) {
      params.push(`%${keyword.replace(/[%_]/g, '\\$&')}%`);
      const placeholder = `$${params.length}`;
      conditions.push(
        `(r.title ILIKE ${placeholder} ESCAPE '\\' OR r.note ILIKE ${placeholder} ESCAPE '\\')`
      );
    }
  }

  if (filters.privacyLevel) {
    const privacy = String(filters.privacyLevel || '').trim().toLowerCase();
    if (privacy) {
      params.push(privacy);
      conditions.push(`LOWER(r.privacy_level) = LOWER($${params.length})`);
    }
  }

  if (filters.routeId) {
    params.push(String(filters.routeId));
    conditions.push(`r.id = $${params.length}`);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  return { where, params };
}

function buildRouteSortClause(sortKey, sortOrder = 'DESC') {
  const normalizedOrder = normalizeSortOrder(sortOrder);
  const normalizedKey = typeof sortKey === 'string' ? sortKey.trim().toLowerCase() : '';
  switch (normalizedKey) {
    case 'distance':
      return `COALESCE((r.stats->>'distance')::numeric, 0) ${normalizedOrder}, r.start_time DESC`;
    case 'duration':
      return `COALESCE((r.stats->>'duration')::numeric, 0) ${normalizedOrder}, r.start_time DESC`;
    case 'calories':
      return `COALESCE((r.stats->>'calories')::numeric, 0) ${normalizedOrder}, r.start_time DESC`;
    case 'updatedat':
    case 'updated':
      return `r.updated_at ${normalizedOrder}`;
    case 'createdat':
    case 'created':
      return `r.created_at ${normalizedOrder}`;
    case 'endtime':
      return `r.end_time ${normalizedOrder} NULLS LAST`;
    case 'pointcount':
      return `COALESCE(pc.point_count, 0) ${normalizedOrder}`;
    case 'starttime':
    default:
      return `r.start_time ${normalizedOrder} NULLS LAST`;
  }
}

function buildUserSortClause(sortKey, sortOrder = 'DESC') {
  const normalizedOrder = normalizeSortOrder(sortOrder);
  const normalizedKey = typeof sortKey === 'string' ? sortKey.trim().toLowerCase() : '';
  switch (normalizedKey) {
    case 'routes':
    case 'routecount':
      return `routes_count ${normalizedOrder}, total_distance DESC`;
    case 'distance':
      return `total_distance ${normalizedOrder}, routes_count DESC`;
    case 'duration':
      return `total_duration ${normalizedOrder}, routes_count DESC`;
    case 'calories':
      return `total_calories ${normalizedOrder}, total_distance DESC`;
    case 'created':
    case 'createdat':
      return `created_at ${normalizedOrder}`;
    case 'updated':
    case 'updatedat':
      return `updated_at ${normalizedOrder}`;
    case 'lastactive':
    default:
      return `last_active ${normalizedOrder} NULLS LAST`;
  }
}

function sanitizeIdArray(value) {
  if (Array.isArray(value)) {
    return value
      .map((item) => String(item).trim())
      .filter((item) => item.length)
      .slice(0, 1000);
  }
  if (typeof value === 'string') {
    return value
      .split(',')
      .map((item) => item.trim())
      .filter((item) => item.length)
      .slice(0, 1000);
  }
  return [];
}

function mapUserOverviewRow(row) {
  const id = Number(row.id);
  const routesCount = Number(row.routes_count || 0);
  const totalDistance = Number(row.total_distance || 0);
  const totalDuration = normalizeDurationAggregate(row.total_duration);
  const totalCalories = Number(row.total_calories || 0);
  return {
    id: Number.isFinite(id) ? id : null,
    nickname: typeof row.nickname === 'string' ? row.nickname : null,
    avatar: typeof row.avatar === 'string' ? row.avatar : null,
    displayName: buildUserDisplayName({ id, nickname: row.nickname }),
    createdAt: row.created_at instanceof Date ? row.created_at.getTime() : null,
    updatedAt: row.updated_at instanceof Date ? row.updated_at.getTime() : null,
    routesCount,
    totalDistance,
    totalDuration,
    totalCalories,
    averageDistance: routesCount > 0 ? totalDistance / routesCount : null,
    averageDuration: routesCount > 0 ? totalDuration / routesCount : null,
    lastActiveAt: row.last_active instanceof Date ? row.last_active.getTime() : null,
    lastRouteUpdatedAt:
      row.last_route_updated instanceof Date ? row.last_route_updated.getTime() : null,
  };
}

function mapAnnouncementRow(row) {
  const id = Number(row.id);
  return {
    id: Number.isFinite(id) ? id : null,
    title: typeof row.title === 'string' ? row.title : '',
    body: typeof row.body === 'string' ? row.body : '',
    status: typeof row.status === 'string' ? row.status : 'draft',
    publishAt: row.publish_at instanceof Date ? row.publish_at.getTime() : null,
    createdAt: row.created_at instanceof Date ? row.created_at.getTime() : null,
    updatedAt: row.updated_at instanceof Date ? row.updated_at.getTime() : null,
  };
}

async function fetchAdminRoutes({
  filters = {},
  pagination = { limit: DEFAULT_PAGE_SIZE, offset: 0 },
  includePoints = false,
  includeDeleted = false,
} = {}) {
  const { where, params } = buildAdminRouteFilters({ ...filters, includeDeleted });
  const orderClause = buildRouteSortClause(filters.sort, filters.order);
  const limitIndex = params.length + 1;
  const offsetIndex = params.length + 2;

  const baseQuery = `
    SELECT
      r.*,
      u.id AS owner_id,
      u.nickname AS owner_nickname,
      u.avatar AS owner_avatar,
      u.gender AS owner_gender,
      u.age_range AS owner_age_range,
      u.identity_label AS owner_identity_label,
      pc.point_count
    FROM routes r
    LEFT JOIN users u ON u.id = r.user_id
    LEFT JOIN (
      SELECT route_id, COUNT(*) AS point_count
      FROM route_points
      GROUP BY route_id
    ) pc ON pc.route_id = r.id
    ${where}
    ORDER BY ${orderClause}
    LIMIT $${limitIndex}
    OFFSET $${offsetIndex}`;

  const countQuery = `
    SELECT COUNT(*) AS total
    FROM routes r
    ${where}`;

  const [listResult, countResult] = await Promise.all([
    pool.query(baseQuery, [...params, pagination.limit, pagination.offset]),
    pool.query(countQuery, params),
  ]);

  let pointsMap = {};
  if (includePoints && listResult.rows.length) {
    const routeIds = listResult.rows.map((row) => row.id);
    pointsMap = await getPointsByRoute(routeIds);
  }

  const mapOptions = {
    includeOwner: true,
    includePointSummary: true,
    includeStatsSummary: true,
  };
  const items = listResult.rows.map((row) => {
    const pointsForRoute = includePoints ? pointsMap[row.id] || [] : [];
    const route = mapRouteRow(row, pointsForRoute, mapOptions);
    if (!includePoints) {
      route.points = [];
    }
    return route;
  });

  return {
    items,
    total: Number(countResult.rows?.[0]?.total || 0),
  };
}

async function fetchAdminUsers({
  filters = {},
  pagination = { limit: DEFAULT_PAGE_SIZE, offset: 0 },
} = {}) {
  const whereClauses = [];
  const params = [];

  if (filters.search) {
    const keyword = String(filters.search || '').trim();
    if (keyword) {
      params.push(`%${keyword.replace(/[%_]/g, '\\$&')}%`);
      whereClauses.push(
        `(nickname ILIKE $${params.length} ESCAPE '\\' OR CAST(id AS TEXT) ILIKE $${params.length})`
      );
    }
  }

  if (filters.activeSince) {
    const activeSince = parseTimestamp(filters.activeSince);
    if (!activeSince) {
      throw new Error('Invalid activeSince filter');
    }
    params.push(activeSince);
    whereClauses.push(`(last_active IS NOT NULL AND last_active >= $${params.length})`);
  }

  if (filters.activeUntil) {
    const activeUntil = parseTimestamp(filters.activeUntil);
    if (!activeUntil) {
      throw new Error('Invalid activeUntil filter');
    }
    params.push(activeUntil);
    whereClauses.push(`(last_active IS NOT NULL AND last_active <= $${params.length})`);
  }

  if (filters.minRoutes !== undefined && filters.minRoutes !== null) {
    const minRoutes = parseNumber(filters.minRoutes, { min: 0 });
    if (Number.isNaN(minRoutes)) {
      throw new Error('Invalid minRoutes filter');
    }
    if (minRoutes !== null) {
      params.push(minRoutes);
      whereClauses.push(`routes_count >= $${params.length}`);
    }
  }

  if (filters.maxRoutes !== undefined && filters.maxRoutes !== null) {
    const maxRoutes = parseNumber(filters.maxRoutes, { min: 0 });
    if (Number.isNaN(maxRoutes)) {
      throw new Error('Invalid maxRoutes filter');
    }
    if (maxRoutes !== null) {
      params.push(maxRoutes);
      whereClauses.push(`routes_count <= $${params.length}`);
    }
  }

  if (filters.minDistance !== undefined && filters.minDistance !== null) {
    const minDistance = parseNumber(filters.minDistance, { min: 0 });
    if (Number.isNaN(minDistance)) {
      throw new Error('Invalid minDistance filter');
    }
    if (minDistance !== null) {
      params.push(minDistance);
      whereClauses.push(`total_distance >= $${params.length}`);
    }
  }

  if (filters.maxDistance !== undefined && filters.maxDistance !== null) {
    const maxDistance = parseNumber(filters.maxDistance, { min: 0 });
    if (Number.isNaN(maxDistance)) {
      throw new Error('Invalid maxDistance filter');
    }
    if (maxDistance !== null) {
      params.push(maxDistance);
      whereClauses.push(`total_distance <= $${params.length}`);
    }
  }

  if (filters.requireRoutes) {
    whereClauses.push('routes_count > 0');
  }

  const whereClause = whereClauses.length ? `WHERE ${whereClauses.join(' AND ')}` : '';
  const orderClause = buildUserSortClause(filters.sort, filters.order);

  const statsCte = `
    WITH user_stats AS (
      SELECT
        u.id,
        u.nickname,
        u.avatar,
        u.created_at,
        u.updated_at,
        COUNT(r.*) FILTER (WHERE r.deleted_at IS NULL) AS routes_count,
        COALESCE(SUM((r.stats->>'distance')::numeric), 0) AS total_distance,
        COALESCE(SUM((r.stats->>'duration')::numeric), 0) AS total_duration,
        COALESCE(SUM((r.stats->>'calories')::numeric), 0) AS total_calories,
        MAX(r.start_time) AS last_active,
        MAX(r.updated_at) AS last_route_updated
      FROM users u
      LEFT JOIN routes r
        ON r.user_id = u.id
        AND r.deleted_at IS NULL
      GROUP BY u.id
    )
  `;

  const listQuery = `
    ${statsCte}
    SELECT *
    FROM user_stats
    ${whereClause}
    ORDER BY ${orderClause}
    LIMIT $${params.length + 1}
    OFFSET $${params.length + 2}
  `;

  const countQuery = `
    ${statsCte}
    SELECT COUNT(*) AS total
    FROM user_stats
    ${whereClause}
  `;

  const [listResult, countResult] = await Promise.all([
    pool.query(listQuery, [...params, pagination.limit, pagination.offset]),
    pool.query(countQuery, params),
  ]);

  const items = listResult.rows.map(mapUserOverviewRow);
  return {
    items,
    total: Number(countResult.rows?.[0]?.total || 0),
  };
}

async function fetchAdminUserDetail(userId, { includeRoutes = true, routeLimit = 50 } = {}) {
  const numericUserId = Number(userId);
  if (!Number.isFinite(numericUserId)) {
    throw new Error('Invalid user id');
  }

  const detailResult = await pool.query(
    `
      SELECT
        u.*,
        stats.routes_count,
        stats.total_distance,
        stats.total_duration,
        stats.total_calories,
        stats.last_active
      FROM users u
      LEFT JOIN (
        SELECT
          user_id,
          COUNT(*) FILTER (WHERE deleted_at IS NULL) AS routes_count,
          COALESCE(SUM((stats->>'distance')::numeric), 0) AS total_distance,
          COALESCE(SUM((stats->>'duration')::numeric), 0) AS total_duration,
          COALESCE(SUM((stats->>'calories')::numeric), 0) AS total_calories,
          MAX(start_time) AS last_active
        FROM routes
        GROUP BY user_id
      ) stats ON stats.user_id = u.id
      WHERE u.id = $1
      LIMIT 1
    `,
    [numericUserId]
  );

  if (!detailResult.rows.length) {
    return null;
  }

  const row = detailResult.rows[0];
  const baseProfile = mapUserOverviewRow({
    ...row,
    routes_count: row.routes_count,
    total_distance: row.total_distance,
    total_duration: row.total_duration,
    total_calories: row.total_calories,
    last_active: row.last_active,
    last_route_updated: row.updated_at,
  });

  const result = {
    profile: baseProfile,
  };

  if (includeRoutes) {
    const { items } = await fetchAdminRoutes({
      filters: { userId: numericUserId, sort: 'startTime', order: 'DESC' },
      pagination: { limit: Math.min(routeLimit, 500), offset: 0 },
      includePoints: false,
      includeDeleted: false,
    });
    result.routes = items;
  }

  return result;
}

async function computeAdminAnalyticsSummary(rangeDays = 30) {
  const numericRange = Math.min(Math.max(Number(rangeDays) || 30, 1), 365);
  const since = new Date(Date.now() - numericRange * 24 * 60 * 60 * 1000);

  const [totalsResult, usersCountResult, activeUsersResult, topUsersResult] = await Promise.all([
    pool.query(
      `
        SELECT
          COUNT(*) FILTER (WHERE deleted_at IS NULL) AS total_routes,
          COUNT(*) FILTER (
            WHERE deleted_at IS NULL AND start_time IS NOT NULL AND start_time >= $1
          ) AS new_routes,
          COALESCE(SUM((stats->>'distance')::numeric), 0) AS total_distance,
          COALESCE(SUM((stats->>'duration')::numeric), 0) AS total_duration,
          COALESCE(SUM((stats->>'calories')::numeric), 0) AS total_calories
        FROM routes
      `,
      [since]
    ),
    pool.query(`SELECT COUNT(*) AS total_users FROM users`),
    pool.query(
      `
        SELECT COUNT(DISTINCT user_id) AS active_users
        FROM routes
        WHERE deleted_at IS NULL
          AND start_time IS NOT NULL
          AND start_time >= $1
      `,
      [since]
    ),
    pool.query(
      `
        SELECT
          u.id,
          u.nickname,
          u.avatar,
          COUNT(r.*) AS routes_count,
          COALESCE(SUM((r.stats->>'distance')::numeric), 0) AS total_distance,
          COALESCE(SUM((r.stats->>'duration')::numeric), 0) AS total_duration
        FROM routes r
        JOIN users u ON u.id = r.user_id
        WHERE r.deleted_at IS NULL
          AND r.start_time IS NOT NULL
          AND r.start_time >= $1
        GROUP BY u.id, u.nickname, u.avatar
        ORDER BY total_distance DESC
        LIMIT 5
      `,
      [since]
    ),
  ]);

  const totalsRow = totalsResult.rows?.[0] || {};
  const totalRoutes = Number(totalsRow.total_routes || 0);
  const totalDistance = Number(totalsRow.total_distance || 0);
  const totalDuration = normalizeDurationAggregate(totalsRow.total_duration);
  const totalCalories = Number(totalsRow.total_calories || 0);
  const totalUsers = Number(usersCountResult.rows?.[0]?.total_users || 0);
  const activeUsers = Number(activeUsersResult.rows?.[0]?.active_users || 0);
  const newRoutes = Number(totalsRow.new_routes || 0);

  const topUsers = topUsersResult.rows.map((row) => ({
    id: Number(row.id),
    nickname: row.nickname,
    avatar: row.avatar,
    displayName: buildUserDisplayName({ id: row.id, nickname: row.nickname }),
    routesCount: Number(row.routes_count || 0),
    totalDistance: Number(row.total_distance || 0),
    totalDuration: normalizeDurationAggregate(row.total_duration),
  }));

  return {
    rangeDays: numericRange,
    totalRoutes,
    newRoutes,
    totalUsers,
    activeUsers,
    totalDistance,
    totalDuration,
    totalCalories,
    averageDistance: totalRoutes > 0 ? totalDistance / totalRoutes : null,
    averageDuration: totalRoutes > 0 ? totalDuration / totalRoutes : null,
    topUsers,
  };
}

async function computeAdminAnalyticsTimeseries(rangeDays = 30) {
  const numericRange = Math.min(Math.max(Number(rangeDays) || 30, 1), 180);
  const since = new Date(Date.now() - numericRange * 24 * 60 * 60 * 1000);

  const result = await pool.query(
    `
      SELECT
        date_trunc('day', start_time) AS day,
        COUNT(*) AS routes_count,
        COUNT(DISTINCT user_id) AS users_count,
        COALESCE(SUM((stats->>'distance')::numeric), 0) AS total_distance,
        COALESCE(SUM((stats->>'duration')::numeric), 0) AS total_duration
      FROM routes
      WHERE deleted_at IS NULL
        AND start_time IS NOT NULL
        AND start_time >= $1
      GROUP BY day
      ORDER BY day ASC
    `,
    [since]
  );

  const series = result.rows.map((row) => ({
    date: row.day instanceof Date ? row.day.getTime() : null,
    routes: Number(row.routes_count || 0),
    activeUsers: Number(row.users_count || 0),
    totalDistance: Number(row.total_distance || 0),
    totalDuration: normalizeDurationAggregate(row.total_duration),
  }));

  return {
    rangeDays: numericRange,
    series,
  };
}

async function computeCollectionDistribution(rangeDays = 30) {
  const numericRange = Math.min(Math.max(Number(rangeDays) || 30, 1), 365);
  const since = new Date(Date.now() - numericRange * 24 * 60 * 60 * 1000);

  const result = await pool.query(
    `
      WITH recent_routes AS (
        SELECT id
        FROM routes
        WHERE deleted_at IS NULL
          AND start_time IS NOT NULL
          AND start_time >= $1
      ), point_intervals AS (
        SELECT
          rp.route_id,
          EXTRACT(EPOCH FROM rp.recorded_at - LAG(rp.recorded_at) OVER (
            PARTITION BY rp.route_id
            ORDER BY rp.recorded_at
          )) AS interval_s
        FROM route_points rp
        JOIN recent_routes rr ON rr.id = rp.route_id
      )
      SELECT
        CASE
          WHEN interval_s IS NULL THEN 'unknown'
          WHEN interval_s < 5 THEN '0-5s'
          WHEN interval_s < 10 THEN '5-10s'
          WHEN interval_s < 30 THEN '10-30s'
          WHEN interval_s < 60 THEN '30-60s'
          WHEN interval_s < 120 THEN '1-2m'
          WHEN interval_s < 300 THEN '2-5m'
          ELSE '5m+'
        END AS bucket,
        COUNT(*) AS samples
      FROM point_intervals
      WHERE interval_s IS NOT NULL
      GROUP BY bucket
      ORDER BY bucket
    `,
    [since]
  );

  return {
    rangeDays: numericRange,
    buckets: result.rows.map((row) => ({
      bucket: row.bucket,
      samples: Number(row.samples || 0),
    })),
  };
}

async function buildBackupSnapshot() {
  const timestamp = new Date();
  const [
    usersResult,
    routesResult,
    pointsResult,
    photosResult,
    likesResult,
    commentsResult,
    commentLikesResult,
    repliesResult,
  ] = await Promise.all([
    pool.query('SELECT * FROM users ORDER BY id ASC'),
    pool.query('SELECT * FROM routes ORDER BY created_at ASC'),
    pool.query('SELECT * FROM route_points ORDER BY id ASC'),
    pool.query('SELECT * FROM photos ORDER BY id ASC'),
    pool.query('SELECT * FROM route_likes ORDER BY id ASC'),
    pool.query('SELECT * FROM route_comments ORDER BY id ASC'),
    pool.query('SELECT * FROM route_comment_likes ORDER BY id ASC'),
    pool.query('SELECT * FROM route_comment_replies ORDER BY id ASC'),
  ]);

  return {
    version: 1,
    generatedAt: timestamp.toISOString(),
    tables: {
      users: usersResult.rows,
      routes: routesResult.rows,
      route_points: pointsResult.rows,
      photos: photosResult.rows,
      route_likes: likesResult.rows,
      route_comments: commentsResult.rows,
      route_comment_likes: commentLikesResult.rows,
      route_comment_replies: repliesResult.rows,
    },
  };
}

function serializeCsvValue(value) {
  if (value === null || value === undefined) {
    return '';
  }
  if (typeof value === 'object') {
    const json = JSON.stringify(value);
    return `"${json.replace(/"/g, '""')}"`;
  }
  const str = String(value);
  if (/[",\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function buildRoutesCsv(items = []) {
  const headers = [
    'id',
    'userId',
    'title',
    'startTime',
    'endTime',
    'distance',
    'duration',
    'calories',
    'pointCount',
    'purposeType',
    'privacyLevel',
    'createdAt',
    'updatedAt',
    'deletedAt',
  ];
  const lines = [headers.join(',')];
  items.forEach((route) => {
    const statSummary = route.statSummary || {};
    const line = [
      route.id,
      route.ownerId ?? route.userId ?? null,
      route.title,
      route.startTime ? new Date(route.startTime).toISOString() : '',
      route.endTime ? new Date(route.endTime).toISOString() : '',
      statSummary.distance ?? route.stats?.distance ?? null,
      statSummary.duration ?? route.stats?.duration ?? null,
      statSummary.calories ?? route.stats?.calories ?? null,
      route.pointCount ?? (Array.isArray(route.points) ? route.points.length : null),
      sanitizeEnumValue(route.purposeType ?? route.meta?.purposeType, PURPOSE_TYPE_VALUES),
      route.privacyLevel,
      route.createdAt ? new Date(route.createdAt).toISOString() : '',
      route.updatedAt ? new Date(route.updatedAt).toISOString() : '',
      route.deletedAt ? new Date(route.deletedAt).toISOString() : '',
    ].map(serializeCsvValue);
    lines.push(line.join(','));
  });
  return lines.join('\n');
}

async function saveBackupToDisk(snapshot) {
  const timestamp = new Date(snapshot.generatedAt || Date.now())
    .toISOString()
    .replace(/[:.]/g, '-');
  const filename = `routelab-backup-${timestamp}.json`;
  const filepath = path.join(BACKUP_STORAGE_PATH, filename);
  const payload = JSON.stringify(snapshot, null, 2);
  await fs.promises.writeFile(filepath, payload, 'utf8');
  const stats = await fs.promises.stat(filepath);
  return {
    filename,
    filepath,
    bytes: stats.size,
    modifiedAt: stats.mtimeMs,
  };
}

async function listAvailableBackups() {
  let entries = [];
  try {
    entries = await fs.promises.readdir(BACKUP_STORAGE_PATH, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') {
      return [];
    }
    throw error;
  }
  const backups = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (!entry.name.endsWith('.json')) continue;
    const filepath = path.join(BACKUP_STORAGE_PATH, entry.name);
    try {
      const stats = await fs.promises.stat(filepath);
      backups.push({
        filename: entry.name,
        filepath,
        bytes: stats.size,
        modifiedAt: stats.mtimeMs,
      });
    } catch (error) {
      console.warn('Failed to stat backup file', entry.name, error);
    }
  }
  return backups.sort((a, b) => b.modifiedAt - a.modifiedAt);
}

async function loadBackupFromDisk(filename) {
  const cleanName = path.basename(filename);
  const filepath = path.join(BACKUP_STORAGE_PATH, cleanName);
  const content = await fs.promises.readFile(filepath, 'utf8');
  return JSON.parse(content);
}

function coerceDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

async function restoreBackupSnapshot(snapshot, { mode = 'append' } = {}) {
  if (!snapshot || typeof snapshot !== 'object') {
    throw new Error('Invalid backup snapshot');
  }
  const tables = snapshot.tables || {};
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    if (mode === 'replace') {
      await client.query(`
        TRUNCATE
          route_comment_replies,
          route_comment_likes,
          route_comments,
          route_likes,
          route_points,
          photos,
          routes,
          users
        RESTART IDENTITY CASCADE
      `);
    }

    if (Array.isArray(tables.users) && tables.users.length) {
      for (const user of tables.users) {
        const importGender = sanitizeEnumValue(
          typeof user.gender === 'string'
            ? user.gender
            : typeof user.gender_code === 'string'
            ? user.gender_code
            : '',
          USER_GENDER_VALUES
        );
        const importAgeRange = sanitizeEnumValue(
          typeof user.age_range === 'string'
            ? user.age_range
            : typeof user.ageRange === 'string'
            ? user.ageRange
            : '',
          USER_AGE_RANGE_VALUES
        );
        const importIdentity = sanitizeEnumValue(
          typeof user.identity_label === 'string'
            ? user.identity_label
            : typeof user.identity === 'string'
            ? user.identity
            : '',
          USER_IDENTITY_VALUES
        );
        await client.query(
          `
            INSERT INTO users (
              id,
              openid,
              unionid,
              nickname,
              avatar,
              gender,
              age_range,
              identity_label,
              session_key,
              created_at,
              updated_at
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
            ON CONFLICT (id) DO UPDATE SET
              openid = EXCLUDED.openid,
              unionid = EXCLUDED.unionid,
              nickname = EXCLUDED.nickname,
              avatar = EXCLUDED.avatar,
              gender = EXCLUDED.gender,
              age_range = EXCLUDED.age_range,
              identity_label = EXCLUDED.identity_label,
              session_key = EXCLUDED.session_key,
              created_at = EXCLUDED.created_at,
              updated_at = EXCLUDED.updated_at
          `,
          [
            user.id,
            user.openid || null,
            user.unionid || null,
            user.nickname || null,
            user.avatar || null,
            importGender || null,
            importAgeRange || null,
            importIdentity || null,
            user.session_key || null,
            coerceDate(user.created_at) || new Date(),
            coerceDate(user.updated_at) || new Date(),
          ]
        );
      }
      await client.query(
        `SELECT setval(pg_get_serial_sequence('users', 'id'), (SELECT COALESCE(MAX(id), 1) FROM users))`
      );
    }

    if (Array.isArray(tables.routes) && tables.routes.length) {
      for (const route of tables.routes) {
        await client.query(
          `
            INSERT INTO routes (
              id, user_id, title, start_time, end_time, privacy_level, note, campus_zone,
              start_campus, end_campus, stats, meta, photos, deleted_at, created_at, updated_at
            )
            VALUES (
              $1, $2, $3, $4, $5, $6, $7, $8,
              $9, $10, $11, $12, $13, $14, $15, $16
            )
            ON CONFLICT (id) DO UPDATE SET
              user_id = EXCLUDED.user_id,
              title = EXCLUDED.title,
              start_time = EXCLUDED.start_time,
              end_time = EXCLUDED.end_time,
              privacy_level = EXCLUDED.privacy_level,
              note = EXCLUDED.note,
              campus_zone = EXCLUDED.campus_zone,
              start_campus = EXCLUDED.start_campus,
              end_campus = EXCLUDED.end_campus,
              stats = EXCLUDED.stats,
              meta = EXCLUDED.meta,
              photos = EXCLUDED.photos,
              deleted_at = EXCLUDED.deleted_at,
              created_at = EXCLUDED.created_at,
              updated_at = EXCLUDED.updated_at
          `,
          [
            route.id,
            route.user_id,
            route.title || null,
            coerceDate(route.start_time),
            coerceDate(route.end_time),
            route.privacy_level || 'private',
            route.note || null,
            route.campus_zone || null,
            route.start_campus || null,
            route.end_campus || null,
            route.stats || {},
            route.meta || {},
            route.photos || [],
            coerceDate(route.deleted_at),
            coerceDate(route.created_at) || new Date(),
            coerceDate(route.updated_at) || new Date(),
          ]
        );
      }
    }

    if (Array.isArray(tables.route_points) && tables.route_points.length) {
      const affectedRoutes = new Set(tables.route_points.map((row) => row.route_id).filter(Boolean));
      if (affectedRoutes.size) {
        await client.query(
          `DELETE FROM route_points WHERE route_id = ANY($1::text[])`,
          [Array.from(affectedRoutes)]
        );
      }
      for (const point of tables.route_points) {
        const pointSource = normalizePointSource(point.source);
        const pointSourceDetail = normalizeSourceDetail(point.source_detail ?? point.sourceDetail);
        const pointInterpMethod = normalizeInterpMethod(point.interp_method ?? point.interpMethod);
        await client.query(
          `
            INSERT INTO route_points (
              id, route_id, latitude, longitude, altitude, speed, heading,
              accuracy, recorded_at, source, source_detail, interp_method
            )
            VALUES (
              $1, $2, $3, $4, $5, $6, $7,
              $8, $9, $10, $11, $12
            )
            ON CONFLICT (id) DO UPDATE SET
              route_id = EXCLUDED.route_id,
              latitude = EXCLUDED.latitude,
              longitude = EXCLUDED.longitude,
              altitude = EXCLUDED.altitude,
              speed = EXCLUDED.speed,
              heading = EXCLUDED.heading,
              accuracy = EXCLUDED.accuracy,
              recorded_at = EXCLUDED.recorded_at,
              source = EXCLUDED.source,
              source_detail = EXCLUDED.source_detail,
              interp_method = EXCLUDED.interp_method
          `,
          [
            point.id,
            point.route_id,
            point.latitude,
            point.longitude,
            point.altitude,
            point.speed,
            point.heading,
            point.accuracy,
            coerceDate(point.recorded_at) || new Date(),
            pointSource,
            pointSourceDetail,
            pointInterpMethod,
          ]
        );
      }
      await client.query(
        `SELECT setval(pg_get_serial_sequence('route_points', 'id'), (SELECT COALESCE(MAX(id), 1) FROM route_points))`
      );
    }

    if (Array.isArray(tables.photos) && tables.photos.length) {
      for (const photo of tables.photos) {
        await client.query(
          `
            INSERT INTO photos (id, user_id, route_id, url, original_name, created_at)
            VALUES ($1, $2, $3, $4, $5, $6)
            ON CONFLICT (id) DO UPDATE SET
              user_id = EXCLUDED.user_id,
              route_id = EXCLUDED.route_id,
              url = EXCLUDED.url,
              original_name = EXCLUDED.original_name,
              created_at = EXCLUDED.created_at
          `,
          [
            photo.id,
            photo.user_id,
            photo.route_id || null,
            photo.url,
            photo.original_name || null,
            coerceDate(photo.created_at) || new Date(),
          ]
        );
      }
      await client.query(
        `SELECT setval(pg_get_serial_sequence('photos', 'id'), (SELECT COALESCE(MAX(id), 1) FROM photos))`
      );
    }

    if (Array.isArray(tables.route_likes) && tables.route_likes.length) {
      for (const like of tables.route_likes) {
        await client.query(
          `
            INSERT INTO route_likes (id, route_id, user_id, created_at)
            VALUES ($1, $2, $3, $4)
            ON CONFLICT (id) DO UPDATE SET
              route_id = EXCLUDED.route_id,
              user_id = EXCLUDED.user_id,
              created_at = EXCLUDED.created_at
          `,
          [
            like.id,
            like.route_id,
            like.user_id,
            coerceDate(like.created_at) || new Date(),
          ]
        );
      }
      await client.query(
        `SELECT setval(pg_get_serial_sequence('route_likes', 'id'), (SELECT COALESCE(MAX(id), 1) FROM route_likes))`
      );
    }

    if (Array.isArray(tables.route_comments) && tables.route_comments.length) {
      for (const comment of tables.route_comments) {
        await client.query(
          `
            INSERT INTO route_comments (
              id, route_id, user_id, content, created_at, is_deleted, deleted_at
            )
            VALUES (
              $1, $2, $3, $4, $5, $6, $7
            )
            ON CONFLICT (id) DO UPDATE SET
              route_id = EXCLUDED.route_id,
              user_id = EXCLUDED.user_id,
              content = EXCLUDED.content,
              created_at = EXCLUDED.created_at,
              is_deleted = EXCLUDED.is_deleted,
              deleted_at = EXCLUDED.deleted_at
          `,
          [
            comment.id,
            comment.route_id,
            comment.user_id,
            comment.content,
            coerceDate(comment.created_at) || new Date(),
            comment.is_deleted || false,
            coerceDate(comment.deleted_at),
          ]
        );
      }
      await client.query(
        `SELECT setval(pg_get_serial_sequence('route_comments', 'id'), (SELECT COALESCE(MAX(id), 1) FROM route_comments))`
      );
    }

    if (Array.isArray(tables.route_comment_likes) && tables.route_comment_likes.length) {
      for (const like of tables.route_comment_likes) {
        await client.query(
          `
            INSERT INTO route_comment_likes (id, comment_id, user_id, created_at)
            VALUES ($1, $2, $3, $4)
            ON CONFLICT (id) DO UPDATE SET
              comment_id = EXCLUDED.comment_id,
              user_id = EXCLUDED.user_id,
              created_at = EXCLUDED.created_at
          `,
          [
            like.id,
            like.comment_id,
            like.user_id,
            coerceDate(like.created_at) || new Date(),
          ]
        );
      }
      await client.query(
        `SELECT setval(pg_get_serial_sequence('route_comment_likes', 'id'), (SELECT COALESCE(MAX(id), 1) FROM route_comment_likes))`
      );
    }

    if (Array.isArray(tables.route_comment_replies) && tables.route_comment_replies.length) {
      for (const reply of tables.route_comment_replies) {
        await client.query(
          `
            INSERT INTO route_comment_replies (
              id, comment_id, route_id, user_id, content, created_at
            )
            VALUES ($1, $2, $3, $4, $5, $6)
            ON CONFLICT (id) DO UPDATE SET
              comment_id = EXCLUDED.comment_id,
              route_id = EXCLUDED.route_id,
              user_id = EXCLUDED.user_id,
              content = EXCLUDED.content,
              created_at = EXCLUDED.created_at
          `,
          [
            reply.id,
            reply.comment_id,
            reply.route_id,
            reply.user_id,
            reply.content,
            coerceDate(reply.created_at) || new Date(),
          ]
        );
      }
      await client.query(
        `SELECT setval(pg_get_serial_sequence('route_comment_replies', 'id'), (SELECT COALESCE(MAX(id), 1) FROM route_comment_replies))`
      );
    }

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

function buildUserDisplayName({ id, nickname } = {}) {
  const rawNickname = typeof nickname === 'string' ? nickname.trim() : '';
  if (rawNickname) {
    return rawNickname;
  }
  const numericId = Number(id);
  if (Number.isFinite(numericId) && numericId > 0) {
    return `用户 ID ${numericId}`;
  }
  return 'RouteLab 用户';
}

function timingSafeCompare(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') {
    return false;
  }
  const aBuffer = Buffer.from(a);
  const bBuffer = Buffer.from(b);
  if (aBuffer.length !== bBuffer.length) {
    return false;
  }
  return crypto.timingSafeEqual(aBuffer, bBuffer);
}

async function validateAdminPassword(candidate) {
  if (typeof candidate !== 'string' || !candidate.length) {
    return false;
  }
  if (ADMIN_PASSWORD_HASH) {
    try {
      return await bcrypt.compare(candidate, ADMIN_PASSWORD_HASH);
    } catch (error) {
      console.error('Failed to validate admin password hash', error);
      return false;
    }
  }
  if (ADMIN_PASSWORD) {
    return timingSafeCompare(candidate, ADMIN_PASSWORD);
  }
  return false;
}

async function fetchWeChatSession(code) {
  if (!WECHAT_APPID || !WECHAT_SECRET) {
    throw new Error('WeChat credentials are not configured');
  }
  const url = new URL('https://api.weixin.qq.com/sns/jscode2session');
  url.searchParams.set('appid', WECHAT_APPID);
  url.searchParams.set('secret', WECHAT_SECRET);
  url.searchParams.set('js_code', code);
  url.searchParams.set('grant_type', 'authorization_code');

  const response = await fetch(url.toString());
  const payload = await response.json();
  if (!response.ok || payload.errcode) {
    const error = new Error('WeChat code2session failed');
    error.statusCode = 502;
    error.details = payload;
    throw error;
  }
  if (!payload.openid) throw new Error('WeChat response missing openid');
  return payload;
}

async function upsertUser({ openid, unionid, session_key: sessionKey }) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const existing = await client.query('SELECT id FROM users WHERE openid = $1 FOR UPDATE', [openid]);
    let userRow = null;
    if (existing.rows.length) {
      const userId = existing.rows[0].id;
      await client.query(
        `UPDATE users
         SET unionid = COALESCE($2, unionid),
             session_key = COALESCE($3, session_key),
             updated_at = NOW()
         WHERE id = $1`,
        [userId, unionid || null, sessionKey || null]
      );
      const rows = await client.query(
        `SELECT id, nickname, avatar, gender, age_range, identity_label FROM users WHERE id = $1`,
        [userId]
      );
      userRow =
        rows.rows[0] || {
          id: userId,
          nickname: null,
          avatar: null,
          gender: null,
          age_range: null,
          identity_label: null,
        };
    } else {
      const inserted = await client.query(
        `INSERT INTO users (openid, unionid, session_key)
         VALUES ($1, $2, $3)
         RETURNING id, nickname, avatar, gender, age_range, identity_label`,
        [openid, unionid || null, sessionKey || null]
      );
      userRow = inserted.rows[0];
    }
    await client.query('COMMIT');
    return userRow;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function getPointsByRoute(routeIds) {
  if (!routeIds.length) return {};
  const result = await pool.query(
    'SELECT * FROM route_points WHERE route_id = ANY($1) ORDER BY recorded_at ASC',
    [routeIds]
  );
  return result.rows.reduce((acc, row) => {
    acc[row.route_id] = acc[row.route_id] || [];
    acc[row.route_id].push({
      latitude: row.latitude,
      longitude: row.longitude,
      altitude: row.altitude,
      speed: row.speed,
      heading: row.heading,
      accuracy: row.accuracy,
      timestamp: row.recorded_at ? row.recorded_at.getTime() : null,
      source: normalizePointSource(row.source),
      source_detail: normalizeSourceDetail(row.source_detail),
      interp_method: normalizeInterpMethod(row.interp_method),
    });
    return acc;
  }, {});
}

async function fetchRouteSnapshot(routeId) {
  if (!routeId) {
    return null;
  }
  const result = await pool.query(
    `
      SELECT
        r.*,
        (SELECT COUNT(*) FROM route_points rp WHERE rp.route_id = r.id) AS point_count,
        u.id AS owner_id,
        u.nickname AS owner_nickname,
        u.avatar AS owner_avatar,
        u.gender AS owner_gender,
        u.age_range AS owner_age_range,
        u.identity_label AS owner_identity_label
      FROM routes r
      LEFT JOIN users u ON u.id = r.user_id
      WHERE r.id = $1
    `,
    [routeId]
  );
  if (!result.rows.length) {
    return null;
  }
  const mapped = mapRouteRow(result.rows[0], [], { includeOwner: true });
  if (Array.isArray(mapped.points)) {
    delete mapped.points;
  }
  if (mapped.pointsSummary !== undefined) {
    delete mapped.pointsSummary;
  }
  if (mapped.statSummary !== undefined) {
    delete mapped.statSummary;
  }
  return mapped;
}

function resolveDurationSeconds(stats = {}, startTime = null, endTime = null) {
  const SECOND_FIELDS = ['durationSeconds', 'duration_s', 'duration_sec'];
  for (const field of SECOND_FIELDS) {
    const value = Number(stats?.[field]);
    if (Number.isFinite(value) && value >= 0) {
      return value;
    }
  }

  const MILLISECOND_FIELDS = [
    'durationMs',
    'duration_ms',
    'durationMilliseconds',
    'duration_milliseconds',
    'duration',
  ];
  for (const field of MILLISECOND_FIELDS) {
    const value = Number(stats?.[field]);
    if (Number.isFinite(value) && value >= 0) {
      return value / 1000;
    }
  }

  if (startTime instanceof Date && endTime instanceof Date) {
    const diff = endTime.getTime() - startTime.getTime();
    if (Number.isFinite(diff) && diff > 0) {
      return diff / 1000;
    }
  }

  return null;
}

function normalizeDurationAggregate(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return 0;
  }
  return numeric / 1000;
}

function mapRouteRow(row, points = [], options = {}) {
  const owner = options.includeOwner ? buildOwnerProfileFromRow(row) : null;
  const rawOwnerId = owner ? owner.id : Number(row.user_id);
  const ownerId = Number.isFinite(rawOwnerId) ? Number(rawOwnerId) : null;
  const stats = row.stats || {};
  const pointCountFromRow = Number(row.point_count || row.points_count || row.pointcount);
  const pointCount = Number.isFinite(pointCountFromRow) ? pointCountFromRow : points.length;

  const route = {
    id: row.id,
    title: row.title,
    startTime: row.start_time ? row.start_time.getTime() : null,
    endTime: row.end_time ? row.end_time.getTime() : null,
    privacyLevel: row.privacy_level,
    note: row.note,
    campusZone: row.campus_zone,
    startCampusMeta: row.start_campus,
    endCampusMeta: row.end_campus,
    stats,
    meta: row.meta,
    photos: row.photos || [],
    points: Array.isArray(points) ? points : [],
    pointCount,
    ownerId,
    createdAt: row.created_at ? row.created_at.getTime() : null,
    updatedAt: row.updated_at ? row.updated_at.getTime() : null,
    deletedAt: row.deleted_at ? row.deleted_at.getTime() : null,
  };

  if (owner) {
    route.owner = owner;
  }

  const mappedPurpose = sanitizeEnumValue(route.meta?.purposeType, PURPOSE_TYPE_VALUES);
  route.purposeType = mappedPurpose || null;

  if (options.includePointSummary) {
    route.pointsSummary = computePointStats(route.points);
  }

  if (options.includeStatsSummary) {
    const distanceCandidate = stats?.distance ?? stats?.distance_m ?? stats?.distanceMeters ?? null;
    const distanceValue = Number(distanceCandidate);
    const distance = Number.isFinite(distanceValue) ? distanceValue : null;

    const durationSeconds = resolveDurationSeconds(stats, row.start_time, row.end_time);
    const normalizedDurationSeconds =
      Number.isFinite(durationSeconds) && durationSeconds >= 0 ? durationSeconds : null;
    const durationMs =
      normalizedDurationSeconds !== null ? normalizedDurationSeconds * 1000 : null;

    const caloriesCandidate = stats?.calories ?? stats?.calories_kcal ?? null;
    const caloriesValue = Number(caloriesCandidate);
    const calories = Number.isFinite(caloriesValue) ? caloriesValue : null;

    route.statSummary = {
      distance,
      duration: normalizedDurationSeconds,
      durationSeconds: normalizedDurationSeconds,
      durationMs,
      calories,
      pace:
        distance !== null && normalizedDurationSeconds !== null && distance > 0
          ? normalizedDurationSeconds / distance
          : null,
    };
  }

  return route;
}

function prepareRoutePointBatch(routeId, points) {
  if (!Array.isArray(points) || !points.length) {
    return { placeholders: '', params: [] };
  }
  const params = [];
  const placeholders = [];
  for (let index = 0; index < points.length; index += 1) {
    const point = points[index] || {};
    const source = normalizePointSource(point.source);
    const sourceDetail = normalizeSourceDetail(point?.source_detail ?? point?.sourceDetail);
    const interpMethod =
      source === 'interp'
        ? normalizeInterpMethod(point?.interp_method ?? point?.interpMethod)
        : null;
    const recordedAt =
      point?.timestamp !== undefined && point?.timestamp !== null
        ? parseTimestamp(point.timestamp) || new Date()
        : point?.recordedAt
        ? parseTimestamp(point.recordedAt) || new Date()
        : new Date();

    params.push(
      routeId,
      point.latitude,
      point.longitude,
      point.altitude ?? null,
      point.speed ?? null,
      point.heading ?? null,
      point.accuracy ?? null,
      recordedAt,
      source,
      sourceDetail,
      interpMethod
    );

    const base = index * ROUTE_POINT_COLUMNS_PER_ROW;
    const tokens = [];
    for (let offset = 0; offset < ROUTE_POINT_COLUMNS_PER_ROW; offset += 1) {
      tokens.push("$" + (base + offset + 1));
    }
    placeholders.push('(' + tokens.join(', ') + ')');
  }

  return {
    placeholders: placeholders.join(', '),
    params,
  };
}

async function persistRouteWithPoints(
  routePayload,
  { actingUserId = null, allowOwnerOverride = false, returnSnapshot = false } = {}
) {
  if (!routePayload || typeof routePayload !== 'object') {
    throw buildHttpError(400, 'Route payload is required');
  }
  const route = { ...routePayload };
  const normalizedId = normalizeRouteId(route.id);
  if (!normalizedId) {
    throw buildHttpError(400, 'Invalid route id');
  }
  route.id = normalizedId;

  const hasPointsField = hasOwn(route, 'points');
  let rawPoints = [];
  if (hasPointsField) {
    if (route.points === null || route.points === undefined) {
      rawPoints = [];
    } else if (!Array.isArray(route.points)) {
      throw buildHttpError(400, 'Route points must be an array');
    } else {
      rawPoints = route.points;
    }
  }
  const pointSanitization = sanitizeRoutePointsForPersistence(rawPoints);
  const sanitizedPoints = pointSanitization.points;
  if (hasPointsField && rawPoints.length && !sanitizedPoints.length) {
    throw buildHttpError(400, 'Route points contain no valid coordinates', {
      invalidSamples: pointSanitization.stats.invalidSamples,
    });
  }

  const normalizedActingUser =
    actingUserId === null || actingUserId === undefined ? null : Number(actingUserId);
  const hasActingUser = Number.isFinite(normalizedActingUser);
  let ownerCandidate =
    route.userId ?? route.ownerId ?? route.owner?.id ?? route.user_id ?? route.owner_id ?? null;
  if (ownerCandidate === null || ownerCandidate === undefined) {
    ownerCandidate = hasActingUser ? normalizedActingUser : null;
  }
  const ownerId = Number(ownerCandidate);
  if (!Number.isFinite(ownerId) || ownerId <= 0) {
    throw buildHttpError(400, 'Route owner id is required');
  }
  if (!allowOwnerOverride && hasActingUser && ownerId !== normalizedActingUser) {
    throw buildHttpError(403, 'Route owner does not match current session');
  }

  const hasTitleField = hasOwn(route, 'title');
  const rawTitle = hasTitleField && typeof route.title === 'string' ? route.title.trim() : '';

  const hasNoteField = hasOwn(route, 'note');
  const rawNote = hasNoteField && typeof route.note === 'string' ? route.note.trim() : '';

  const hasPrivacyField = hasOwn(route, 'privacyLevel') || hasOwn(route, 'privacy_level');
  const privacySource = hasOwn(route, 'privacyLevel') ? route.privacyLevel : route.privacy_level;
  const rawPrivacy =
    hasPrivacyField && typeof privacySource === 'string' ? privacySource.trim().toLowerCase() : '';

  const hasCampusZoneField = hasOwn(route, 'campusZone') || hasOwn(route, 'campus_zone');
  const campusZoneSource = hasOwn(route, 'campusZone') ? route.campusZone : route.campus_zone;
  const rawCampusZone =
    hasCampusZoneField && typeof campusZoneSource === 'string' ? campusZoneSource.trim() : '';

  const hasStatsField = hasOwn(route, 'stats');
  const hasMetaField = hasOwn(route, 'meta');
  const hasPhotosField = hasOwn(route, 'photos');
  const hasStartCampusField = hasOwn(route, 'startCampusMeta') || hasOwn(route, 'start_campus');
  const startCampusSource = hasOwn(route, 'startCampusMeta')
    ? route.startCampusMeta
    : route.start_campus;
  const hasEndCampusField = hasOwn(route, 'endCampusMeta') || hasOwn(route, 'end_campus');
  const endCampusSource = hasOwn(route, 'endCampusMeta') ? route.endCampusMeta : route.end_campus;
  const hasStartTimeField = hasOwn(route, 'startTime') || hasOwn(route, 'start_time');
  const hasEndTimeField = hasOwn(route, 'endTime') || hasOwn(route, 'end_time');
  const hasCreatedAtField = hasOwn(route, 'createdAt') || hasOwn(route, 'created_at');
  const hasUpdatedAtField = hasOwn(route, 'updatedAt') || hasOwn(route, 'updated_at');
  const hasDeletedAtField = hasOwn(route, 'deletedAt') || hasOwn(route, 'deleted_at');

  const client = await pool.connect();
  const shouldPersistPoints = hasPointsField;
  let isNewRoute = false;
  try {
    await client.query('BEGIN');
    const existingResult = await client.query(
      `
        SELECT
          user_id,
          title,
          start_time,
          end_time,
          privacy_level,
          note,
          campus_zone,
          start_campus,
          end_campus,
          stats,
          meta,
          photos,
          deleted_at,
          created_at,
          updated_at
        FROM routes
        WHERE id = $1
        FOR UPDATE
      `,
      [route.id]
    );
    const existingRow = existingResult.rows[0] || null;
    const existingOwnerId = existingRow ? Number(existingRow.user_id) : null;
    if (existingRow) {
      if (!allowOwnerOverride) {
        if (!hasActingUser || !Number.isFinite(existingOwnerId) || existingOwnerId <= 0) {
          throw buildHttpError(403, 'Route owner does not match current session');
        }
        if (existingOwnerId !== normalizedActingUser || ownerId !== existingOwnerId) {
          throw buildHttpError(403, 'Route owner does not match current session');
        }
      }
    }
    isNewRoute = !existingRow;

    const existingTitle =
      typeof existingRow?.title === 'string' ? existingRow.title.trim() : '';
    let nextTitle =
      hasTitleField && rawTitle !== '' ? rawTitle : existingTitle || rawTitle || 'Campus Route';
    nextTitle = typeof nextTitle === 'string' ? nextTitle.trim() : '';
    if (!nextTitle) {
      nextTitle = 'Campus Route';
    }

    const existingPrivacy =
      typeof existingRow?.privacy_level === 'string'
        ? existingRow.privacy_level.trim().toLowerCase()
        : '';
    const nextPrivacyLevel =
      hasPrivacyField && rawPrivacy ? rawPrivacy : existingPrivacy || rawPrivacy || 'private';

    let nextNote;
    if (hasNoteField) {
      nextNote = rawNote || null;
    } else if (typeof existingRow?.note === 'string') {
      const trimmed = existingRow.note.trim();
      nextNote = trimmed ? trimmed : null;
    } else {
      nextNote = null;
    }

    const existingCampusZone =
      typeof existingRow?.campus_zone === 'string' ? existingRow.campus_zone.trim() : '';
    const nextCampusZone = hasCampusZoneField
      ? rawCampusZone || null
      : existingCampusZone || null;

    const rawStats = hasStatsField
      ? sanitizeJsonObject(route.stats, existingRow?.stats || {})
      : existingRow?.stats || {};
    const baseStats =
      rawStats && typeof rawStats === 'object' && !Array.isArray(rawStats) ? { ...rawStats } : {};

    const rawMeta = hasMetaField
      ? sanitizeJsonObject(route.meta, existingRow?.meta || {})
      : existingRow?.meta || {};
    const baseMeta =
      rawMeta && typeof rawMeta === 'object' && !Array.isArray(rawMeta) ? { ...rawMeta } : {};
    const requestedPurpose = sanitizeEnumValue(route.purposeType, PURPOSE_TYPE_VALUES);
    const metaPurpose = sanitizeEnumValue(baseMeta.purposeType, PURPOSE_TYPE_VALUES);
    const nextPurposeType = requestedPurpose || metaPurpose;
    route.purposeType = nextPurposeType || null;

    const rawPhotos = hasPhotosField
      ? sanitizeRoutePhotos(route.photos)
      : Array.isArray(existingRow?.photos)
      ? existingRow.photos
      : [];
    const nextPhotos = ensureJsonValue(rawPhotos, []);

    const rawStartCampus = hasStartCampusField
      ? sanitizeJsonObject(startCampusSource, null)
      : existingRow?.start_campus || null;
    const rawEndCampus = hasEndCampusField
      ? sanitizeJsonObject(endCampusSource, null)
      : existingRow?.end_campus || null;
    const nextStartCampus = rawStartCampus === null ? null : ensureJsonValue(rawStartCampus, null);
    const nextEndCampus = rawEndCampus === null ? null : ensureJsonValue(rawEndCampus, null);

    const firstPointTimestamp = sanitizedPoints.length ? sanitizedPoints[0].timestamp : null;
    const lastPointTimestamp = sanitizedPoints.length
      ? sanitizedPoints[sanitizedPoints.length - 1].timestamp
      : null;

    const providedStartTime = hasStartTimeField
      ? parseTimestamp(route.startTime ?? route.start_time)
      : null;
    const providedEndTime = hasEndTimeField ? parseTimestamp(route.endTime ?? route.end_time) : null;
    const providedCreatedAt = hasCreatedAtField
      ? parseTimestamp(route.createdAt ?? route.created_at)
      : null;
    const providedUpdatedAt = hasUpdatedAtField
      ? parseTimestamp(route.updatedAt ?? route.updated_at)
      : null;
    const providedDeletedAt = hasDeletedAtField
      ? parseTimestamp(route.deletedAt ?? route.deleted_at)
      : undefined;

    let nextStartTime =
      providedStartTime ||
      (firstPointTimestamp !== null ? new Date(firstPointTimestamp) : null) ||
      existingRow?.start_time ||
      null;
    let nextEndTime =
      providedEndTime ||
      (lastPointTimestamp !== null ? new Date(lastPointTimestamp) : null) ||
      existingRow?.end_time ||
      null;

    if (!nextStartTime && nextEndTime) {
      nextStartTime = nextEndTime;
    }
    if (!nextEndTime && nextStartTime) {
      nextEndTime = nextStartTime;
    }
    if (!nextStartTime) {
      nextStartTime = new Date();
    }
    if (!nextEndTime) {
      nextEndTime = nextStartTime;
    }
    if (nextStartTime && nextEndTime && nextEndTime.getTime() < nextStartTime.getTime()) {
      if (
        lastPointTimestamp !== null &&
        firstPointTimestamp !== null &&
        lastPointTimestamp >= firstPointTimestamp
      ) {
        nextEndTime = new Date(lastPointTimestamp);
      }
      if (nextEndTime.getTime() < nextStartTime.getTime()) {
        nextEndTime = nextStartTime;
      }
    }

    const weightCandidate =
      route.weight !== undefined && route.weight !== null
        ? Number(route.weight)
        : Number(baseMeta.weight);
    const analytics = deriveRouteAnalytics({
      points: sanitizedPoints,
      startTime: nextStartTime,
      endTime: nextEndTime,
      existingStats: baseStats,
      existingMeta: baseMeta,
      weightKg: Number.isFinite(weightCandidate) && weightCandidate > 0 ? weightCandidate : null,
    });

    const nextStats = ensureJsonValue(analytics.stats, {});
    const nextMeta = ensureJsonValue(analytics.meta, {});
    if (nextPurposeType) {
      nextMeta.purposeType = nextPurposeType;
    } else if (hasOwn(nextMeta, 'purposeType')) {
      delete nextMeta.purposeType;
    }

    let nextCreatedAt =
      providedCreatedAt || existingRow?.created_at || nextStartTime || new Date();
    let nextUpdatedAt = providedUpdatedAt || new Date();
    if (existingRow?.updated_at instanceof Date) {
      if (!providedUpdatedAt || providedUpdatedAt < existingRow.updated_at) {
        nextUpdatedAt = existingRow.updated_at;
        if (providedUpdatedAt && providedUpdatedAt < existingRow.updated_at) {
          console.warn('Route upsert ignored stale updatedAt', {
            routeId: route.id,
            provided: providedUpdatedAt.getTime(),
            existing: existingRow.updated_at.getTime(),
          });
        }
      }
    }
    if (!nextUpdatedAt) {
      nextUpdatedAt = new Date();
    }
    if (nextCreatedAt && nextUpdatedAt && nextCreatedAt.getTime() > nextUpdatedAt.getTime()) {
      nextCreatedAt = nextUpdatedAt;
    }

    let nextDeletedAt = null;
    if (providedDeletedAt !== undefined) {
      nextDeletedAt = providedDeletedAt || null;
    } else if (existingRow?.deleted_at instanceof Date) {
      nextDeletedAt = existingRow.deleted_at;
    }

    await client.query(
      `
        INSERT INTO routes (
          id, user_id, title, start_time, end_time, privacy_level, note, campus_zone,
          start_campus, end_campus, stats, meta, photos, deleted_at, created_at, updated_at
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8,
          $9, $10, $11, $12, $13, $14, COALESCE($15, NOW()), COALESCE($16, NOW())
        )
        ON CONFLICT (id) DO UPDATE SET
          user_id = EXCLUDED.user_id,
          title = EXCLUDED.title,
          start_time = EXCLUDED.start_time,
          end_time = EXCLUDED.end_time,
          privacy_level = EXCLUDED.privacy_level,
          note = EXCLUDED.note,
          campus_zone = EXCLUDED.campus_zone,
          start_campus = EXCLUDED.start_campus,
          end_campus = EXCLUDED.end_campus,
          stats = EXCLUDED.stats,
          meta = EXCLUDED.meta,
          photos = EXCLUDED.photos,
          deleted_at = EXCLUDED.deleted_at,
          created_at = COALESCE(EXCLUDED.created_at, routes.created_at),
          updated_at = COALESCE(EXCLUDED.updated_at, NOW())
      `,
      [
        route.id,
        ownerId,
        nextTitle,
        nextStartTime,
        nextEndTime,
        nextPrivacyLevel,
        nextNote,
        nextCampusZone,
        nextStartCampus,
        nextEndCampus,
        nextStats,
        nextMeta,
        nextPhotos,
        nextDeletedAt,
        nextCreatedAt,
        nextUpdatedAt,
      ]
    );

    if (shouldPersistPoints) {
      await client.query('DELETE FROM route_points WHERE route_id = $1', [route.id]);
      if (sanitizedPoints.length) {
        for (let start = 0; start < sanitizedPoints.length; start += MAX_ROUTE_POINTS_PER_BATCH) {
          const batch = sanitizedPoints.slice(start, start + MAX_ROUTE_POINTS_PER_BATCH);
          const prepared = prepareRoutePointBatch(route.id, batch);
          if (!prepared.placeholders || !prepared.params.length) {
            continue;
          }
          const insertSql =
            'INSERT INTO route_points (' +
            ROUTE_POINT_INSERT_COLUMNS_SQL +
            ')\n            VALUES ' +
            prepared.placeholders;
          await client.query(insertSql, prepared.params);
        }
      }
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }

  if (
    shouldPersistPoints &&
    (pointSanitization.stats.invalidCount || pointSanitization.stats.duplicateCount)
  ) {
    console.warn('Route points sanitized during persist', {
      routeId: route.id,
      invalidCount: pointSanitization.stats.invalidCount,
      duplicateCount: pointSanitization.stats.duplicateCount,
      originalCount: pointSanitization.stats.originalCount,
      persistedCount: sanitizedPoints.length,
      invalidSamples: pointSanitization.stats.invalidSamples,
    });
  }

  if (!returnSnapshot) {
    return route.id;
  }
  const snapshot = await fetchRouteSnapshot(route.id);
  return {
    id: route.id,
    route: snapshot,
    wasCreated: typeof isNewRoute === 'boolean' ? isNewRoute : null,
  };
}

async function applyRoutePatch(id, patch = {}, { isAdmin = false, userId = null } = {}) {
  const normalizedId = normalizeRouteId(id);
  if (!normalizedId) {
    throw buildHttpError(400, 'Invalid route id');
  }
  if (!patch || typeof patch !== 'object') {
    throw buildHttpError(400, 'Patch payload is required');
  }
  const updates = [];
  const params = [];

  if (patch.privacyLevel !== undefined) {
    const privacy =
      typeof patch.privacyLevel === 'string'
        ? patch.privacyLevel.trim().toLowerCase()
        : null;
    params.push(privacy || 'private');
    updates.push(`privacy_level = $${params.length}`);
  }
  if (patch.note !== undefined) {
    if (patch.note === null) {
      params.push(null);
    } else if (typeof patch.note === 'string') {
      const trimmed = patch.note.trim();
      params.push(trimmed ? trimmed : null);
    } else {
      params.push(null);
    }
    updates.push(`note = $${params.length}`);
  }
  if (patch.title !== undefined) {
    if (patch.title === null) {
      params.push('Campus Route');
    } else if (typeof patch.title === 'string') {
      const trimmed = patch.title.trim();
      params.push(trimmed || 'Campus Route');
    } else {
      params.push('Campus Route');
    }
    updates.push(`title = $${params.length}`);
  }
  if (patch.stats !== undefined) {
    if (!isAdmin) {
      throw buildHttpError(403, 'Insufficient privileges to update stats');
    }
    params.push(sanitizeJsonObject(patch.stats, {}));
    updates.push(`stats = $${params.length}`);
  }
  if (patch.meta !== undefined) {
    if (!isAdmin) {
      throw buildHttpError(403, 'Insufficient privileges to update meta');
    }
    params.push(sanitizeJsonObject(patch.meta, {}));
    updates.push(`meta = $${params.length}`);
  }
  if (patch.photos !== undefined) {
    if (!isAdmin) {
      throw buildHttpError(403, 'Insufficient privileges to update photos');
    }
    params.push(sanitizeRoutePhotos(patch.photos));
    updates.push(`photos = $${params.length}`);
  }
  if (patch.deletedAt !== undefined) {
    if (!isAdmin) {
      throw buildHttpError(403, 'Insufficient privileges to modify deletion state');
    }
    params.push(patch.deletedAt ? parseTimestamp(patch.deletedAt) : null);
    updates.push(`deleted_at = $${params.length}`);
  }
  if (isAdmin && patch.userId !== undefined) {
    const nextOwner = Number(patch.userId);
    if (!Number.isFinite(nextOwner) || nextOwner <= 0) {
      throw buildHttpError(400, 'Invalid owner id');
    }
    params.push(nextOwner);
    updates.push(`user_id = $${params.length}`);
  }

  if (!updates.length) {
    throw buildHttpError(400, 'No updatable fields provided');
  }

  params.push(normalizedId);
  let whereClause = `WHERE id = $${params.length}`;
  if (!isAdmin) {
    const normalizedUser = Number(userId);
    if (!Number.isFinite(normalizedUser) || normalizedUser <= 0) {
      throw buildHttpError(403, 'User context required for route update');
    }
    params.push(normalizedUser);
    whereClause += ` AND user_id = $${params.length}`;
  }

  const updateSql = `
    UPDATE routes
    SET ${updates.join(', ')},
        updated_at = NOW()
  ${whereClause}
    RETURNING id, updated_at
  `;

  const result = await pool.query(updateSql, params);
  if (!result.rows.length) {
    return null;
  }
  const row = result.rows[0];
  return {
    id: row.id,
    updatedAt: row.updated_at instanceof Date ? row.updated_at.getTime() : null,
  };
}

function mapPublicRouteRow(row) {
  const userIdCandidate = Number(row.user_id);
  const normalizedUserId = Number.isFinite(userIdCandidate) ? userIdCandidate : null;
  const nickname = typeof row.user_nickname === 'string' ? row.user_nickname.trim() : '';
  const avatar = typeof row.user_avatar === 'string' ? row.user_avatar : '';
  const displayName = buildUserDisplayName({ id: normalizedUserId, nickname });
  const ownerProfile = {
    id: normalizedUserId,
    nickname,
    avatar,
    displayName,
  };
  const topLevelCount = Number(row.comments_count || 0);
  const repliesCount = Number(row.replies_count || 0);
  const totalThreads =
    Number.isFinite(Number(row.total_threads))
      ? Number(row.total_threads)
      : topLevelCount + repliesCount;
  const startLabel =
    typeof row.start_label === 'string' && row.start_label.trim()
      ? row.start_label.trim()
      : '';
  const endLabel =
    typeof row.end_label === 'string' && row.end_label.trim() ? row.end_label.trim() : '';
  return {
    id: row.id,
    title: row.title,
    startTime: row.start_time ? row.start_time.getTime() : null,
    endTime: row.end_time ? row.end_time.getTime() : null,
    stats: row.stats || {},
    meta: row.meta || {},
    campusZone: row.campus_zone || '',
    startCampusMeta: row.start_campus || null,
    endCampusMeta: row.end_campus || null,
    privacyLevel: 'public',
    privacy_level: 'public',
    startLabel,
    start_label: startLabel,
    endLabel,
    end_label: endLabel,
    createdAt: row.created_at ? row.created_at.getTime() : null,
    updatedAt: row.updated_at ? row.updated_at.getTime() : null,
    userId: normalizedUserId,
    user: ownerProfile,
    ownerId: normalizedUserId,
    owner: ownerProfile,
    ownerProfile,
    owner_profile: ownerProfile,
    ownerDisplayName: displayName,
    owner_display_name: displayName,
    ownerNickname: nickname,
    owner_nickname: nickname,
    ownerAvatar: avatar,
    owner_avatar: avatar,
    likes: Number(row.likes_count || 0),
    comments: totalThreads,
    commentsTopLevel: topLevelCount,
    commentsReplies: repliesCount,
    commentPreviews: [],
    liked: Boolean(row.liked_by_current),
  };
}

async function getRouteForSocial(routeId) {
  if (!routeId) {
    return null;
  }
  const result = await pool.query(
    `SELECT id, user_id, privacy_level
     FROM routes
     WHERE id = $1 AND deleted_at IS NULL`,
    [routeId]
  );
  return result.rows[0] || null;
}

async function fetchRouteSocialStats(routeId, currentUserId) {
  const result = await pool.query(
    `SELECT
       COALESCE(l.likes_count, 0) AS likes_count,
       COALESCE(l.liked_by_current, false) AS liked_by_current,
       COALESCE(c.comments_count, 0) AS comments_count,
       COALESCE(c.replies_count, 0) AS replies_count
     FROM routes r
     LEFT JOIN LATERAL (
       SELECT
         COUNT(*) AS likes_count,
         BOOL_OR(user_id = $2) AS liked_by_current
       FROM route_likes
       WHERE route_id = $1
     ) l ON TRUE
     LEFT JOIN LATERAL (
       SELECT
        (SELECT COUNT(*) FROM route_comments WHERE route_id = $1 AND is_deleted IS NOT TRUE) AS comments_count,
        (SELECT COUNT(*)
           FROM route_comment_replies rcr
           JOIN route_comments rc2 ON rc2.id = rcr.comment_id
          WHERE rcr.route_id = $1 AND rc2.is_deleted IS NOT TRUE
        ) AS replies_count
     ) c ON TRUE
     WHERE r.id = $1`,
    [routeId, currentUserId || 0]
  );
  if (!result.rows.length) {
    return null;
  }
  const row = result.rows[0];
  const commentsCount = Number(row.comments_count || 0);
  const repliesCount = Number(row.replies_count || 0);
  return {
    likes: Number(row.likes_count || 0),
    liked: Boolean(row.liked_by_current),
    comments: commentsCount + repliesCount,
    commentsTopLevel: commentsCount,
    commentsReplies: repliesCount,
  };
}

function mapCommentRow(row, { currentUserId, isAdmin } = {}) {
  if (!row) {
    return null;
  }
  const numericId = Number(row.id);
  const commentId = Number.isFinite(numericId) ? numericId : row.id;
  const routeIdRaw = row.route_id;
  const userIdRaw = Number(row.user_id);
  const userId = Number.isFinite(userIdRaw) ? userIdRaw : null;
  const nickname = typeof row.nickname === 'string' ? row.nickname : '';
  const avatar = typeof row.avatar === 'string' ? row.avatar : '';
  const createdAt =
    row.created_at instanceof Date ? row.created_at.getTime() : Number(row.created_at) || null;
  const deletedAt =
    row.deleted_at instanceof Date ? row.deleted_at.getTime() : Number(row.deleted_at) || null;
  const normalizedCurrentUserId = Number(currentUserId);
  const isDeleted = Boolean(row.is_deleted);
  const canDelete =
    Boolean(isAdmin) ||
    (Number.isFinite(normalizedCurrentUserId) && normalizedCurrentUserId === userId);
  return {
    id: commentId,
    routeId: routeIdRaw,
    content: row.content || '',
    createdAt,
    likes: Number(row.likes_count || 0),
    liked: Boolean(row.liked_by_current),
    repliesCount: Number(row.replies_count || 0),
    user: {
      id: userId,
      displayName: buildUserDisplayName({ id: userId, nickname }),
      nickname,
      avatar,
    },
    replies: [],
    isDeleted,
    deletedAt,
    canDelete,
    canModerate: Boolean(isAdmin),
  };
}

function mapReplyRow(row) {
  if (!row) {
    return null;
  }
  const numericId = Number(row.id);
  const replyId = Number.isFinite(numericId) ? numericId : row.id;
  const commentIdRaw = Number(row.comment_id);
  const commentId = Number.isFinite(commentIdRaw) ? commentIdRaw : row.comment_id;
  const routeIdRaw = row.route_id;
  const userIdRaw = Number(row.user_id);
  const userId = Number.isFinite(userIdRaw) ? userIdRaw : null;
  const nickname = typeof row.nickname === 'string' ? row.nickname : '';
  const avatar = typeof row.avatar === 'string' ? row.avatar : '';
  const createdAt =
    row.created_at instanceof Date ? row.created_at.getTime() : Number(row.created_at) || null;
  return {
    id: replyId,
    commentId,
    routeId: routeIdRaw,
    content: row.content || '',
    createdAt,
    user: {
      id: userId,
      displayName: buildUserDisplayName({ id: userId, nickname }),
      nickname,
      avatar,
    },
  };
}

async function fetchRepliesForComments(commentIds = []) {
  if (!Array.isArray(commentIds) || !commentIds.length) {
    return {};
  }
  const result = await pool.query(
    `SELECT
       rr.id,
       rr.comment_id,
       rr.route_id,
       rr.user_id,
       rr.content,
       rr.created_at,
       u.nickname,
       u.avatar
     FROM route_comment_replies rr
     JOIN users u ON u.id = rr.user_id
     WHERE rr.comment_id = ANY($1::bigint[])
     ORDER BY rr.created_at ASC`,
    [commentIds]
  );
  const grouped = {};
  for (const row of result.rows) {
    const reply = mapReplyRow(row);
    if (!reply) {
      continue;
    }
    const key = reply.commentId;
    if (!grouped[key]) {
      grouped[key] = [];
    }
    grouped[key].push(reply);
  }
  return grouped;
}

async function fetchRouteComments(routeId, currentUserId, options = {}) {
  if (!routeId) {
    return [];
  }
  const includeDeleted = Boolean(options.includeDeleted);
  const isAdmin = Boolean(options.isAdmin);
  const result = await pool.query(
    `SELECT
       rc.id,
       rc.route_id,
       rc.user_id,
       rc.content,
       rc.created_at,
       rc.is_deleted,
       rc.deleted_at,
       u.nickname,
       u.avatar,
       COALESCE(l.likes_count, 0) AS likes_count,
       COALESCE(l.liked_by_current, false) AS liked_by_current,
       COALESCE(r.replies_count, 0) AS replies_count
     FROM route_comments rc
     JOIN users u ON u.id = rc.user_id
     LEFT JOIN LATERAL (
       SELECT
         COUNT(*) AS likes_count,
         BOOL_OR(user_id = $2) AS liked_by_current
       FROM route_comment_likes
       WHERE comment_id = rc.id
     ) l ON TRUE
     LEFT JOIN LATERAL (
       SELECT COUNT(*) AS replies_count
       FROM route_comment_replies
       WHERE comment_id = rc.id
     ) r ON TRUE
     WHERE rc.route_id = $1
       AND ($3::boolean IS TRUE OR rc.is_deleted IS NOT TRUE)
     ORDER BY COALESCE(l.likes_count, 0) DESC, rc.created_at DESC`,
    [routeId, currentUserId || 0, includeDeleted]
  );
  if (!result.rows.length) {
    return [];
  }
  const commentIds = result.rows
    .map((row) => Number(row.id))
    .filter((value) => Number.isFinite(value));
  const repliesByComment = await fetchRepliesForComments(commentIds);
  return result.rows
    .map((row) => {
      const comment = mapCommentRow(row, { currentUserId, isAdmin });
      if (!comment) {
        return null;
      }
      const numericKey = Number(row.id);
      const key = Number.isFinite(numericKey) ? numericKey : row.id;
      comment.replies = repliesByComment[key] || [];
      return comment;
    })
    .filter(Boolean);
}

async function fetchCommentPreviews(routeIds = [], currentUserId, limit = 3) {
  if (!Array.isArray(routeIds) || !routeIds.length) {
    return {};
  }
  const normalizedIds = routeIds
    .map((id) => {
      if (id === null || id === undefined) {
        return null;
      }
      const text = String(id).trim();
      return text ? text : null;
    })
    .filter(Boolean);
  if (!normalizedIds.length) {
    return {};
  }
  const previewLimit = Math.max(1, Math.min(Number(limit) || 3, 10));
  const numericUserId = Number(currentUserId);
  const likeUserId = Number.isFinite(numericUserId) ? numericUserId : -1;
  const result = await pool.query(
    `WITH ranked AS (
       SELECT
         rc.id,
         rc.route_id,
         rc.user_id,
         rc.content,
         rc.created_at,
         rc.is_deleted,
         rc.deleted_at,
         u.nickname,
         u.avatar,
         COALESCE(l.likes_count, 0) AS likes_count,
         COALESCE(l.liked_by_current, false) AS liked_by_current,
         COALESCE(r.replies_count, 0) AS replies_count,
         ROW_NUMBER() OVER (
           PARTITION BY rc.route_id
           ORDER BY COALESCE(l.likes_count, 0) DESC, rc.created_at DESC
         ) AS rn
       FROM route_comments rc
       JOIN users u ON u.id = rc.user_id
       LEFT JOIN LATERAL (
         SELECT
           COUNT(*) AS likes_count,
           BOOL_OR(user_id = $2::int) AS liked_by_current
         FROM route_comment_likes
         WHERE comment_id = rc.id
       ) l ON TRUE
       LEFT JOIN LATERAL (
         SELECT COUNT(*) AS replies_count
         FROM route_comment_replies
       WHERE comment_id = rc.id
       ) r ON TRUE
       WHERE rc.route_id = ANY($1::text[])
         AND rc.is_deleted IS NOT TRUE
     )
     SELECT *
     FROM ranked
     WHERE rn <= $3
     ORDER BY route_id, rn`,
    [normalizedIds, likeUserId, previewLimit]
  );
  const grouped = {};
  for (const row of result.rows) {
    const comment = mapCommentRow(row, { currentUserId });
    if (!comment) {
      continue;
    }
    const key = comment.routeId;
    if (!grouped[key]) {
      grouped[key] = [];
    }
    grouped[key].push(comment);
  }
  return grouped;
}

async function fetchCommentDetail(commentId, currentUserId, options = {}) {
  if (!commentId) {
    return null;
  }
  const includeDeleted = Boolean(options.includeDeleted);
  const isAdmin = Boolean(options.isAdmin);
  const result = await pool.query(
    `SELECT
       rc.id,
       rc.route_id,
       rc.user_id,
       rc.content,
       rc.created_at,
       rc.is_deleted,
       rc.deleted_at,
       u.nickname,
       u.avatar,
       COALESCE(l.likes_count, 0) AS likes_count,
       COALESCE(l.liked_by_current, false) AS liked_by_current,
       COALESCE(r.replies_count, 0) AS replies_count
     FROM route_comments rc
     JOIN users u ON u.id = rc.user_id
     LEFT JOIN LATERAL (
       SELECT
         COUNT(*) AS likes_count,
         BOOL_OR(user_id = $2) AS liked_by_current
       FROM route_comment_likes
       WHERE comment_id = rc.id
     ) l ON TRUE
     LEFT JOIN LATERAL (
       SELECT COUNT(*) AS replies_count
       FROM route_comment_replies
       WHERE comment_id = rc.id
     ) r ON TRUE
     WHERE rc.id = $1
       AND ($3::boolean IS TRUE OR rc.is_deleted IS NOT TRUE)`,
    [commentId, currentUserId || 0, includeDeleted]
  );
  if (!result.rows.length) {
    return null;
  }
  const comment = mapCommentRow(result.rows[0], { currentUserId, isAdmin });
  if (!comment) {
    return null;
  }
  const replies = await fetchRepliesForComments([comment.id]);
  comment.replies = replies[comment.id] || [];
  return comment;
}

async function fetchReplyDetail(replyId) {
  if (!replyId) {
    return null;
  }
  const result = await pool.query(
    `SELECT
       rr.id,
       rr.comment_id,
       rr.route_id,
       rr.user_id,
       rr.content,
       rr.created_at,
       u.nickname,
       u.avatar
     FROM route_comment_replies rr
     JOIN users u ON u.id = rr.user_id
     WHERE rr.id = $1`,
    [replyId]
  );
  if (!result.rows.length) {
    return null;
  }
  return mapReplyRow(result.rows[0]);
}

async function getCommentRouteMeta(commentId) {
  if (!commentId) {
    return null;
  }
  const result = await pool.query(
    `SELECT
       rc.route_id,
       r.user_id,
       rc.user_id AS comment_user_id,
       r.privacy_level,
       rc.is_deleted
     FROM route_comments rc
     JOIN routes r ON r.id = rc.route_id
     WHERE rc.id = $1`,
    [commentId]
  );
  if (!result.rows.length) {
    return null;
  }
  return result.rows[0];
}

const WEATHER_CODE_LABELS = {
  0: 'Clear sky',
  1: 'Mostly clear',
  2: 'Partly cloudy',
  3: 'Overcast',
  45: 'Fog',
  48: 'Rime fog',
  51: 'Light drizzle',
  53: 'Drizzle',
  55: 'Dense drizzle',
  56: 'Freezing drizzle',
  57: 'Heavy freezing drizzle',
  61: 'Light rain',
  63: 'Rain',
  65: 'Heavy rain',
  66: 'Freezing rain',
  67: 'Heavy freezing rain',
  71: 'Light snow',
  73: 'Snow',
  75: 'Heavy snow',
  77: 'Snow grains',
  80: 'Rain shower',
  81: 'Moderate rain shower',
  82: 'Violent rain shower',
  85: 'Light snow shower',
  86: 'Heavy snow shower',
  95: 'Thunderstorm',
  96: 'Thunderstorm with small hail',
  99: 'Thunderstorm with hail',
};

function describeWeather(code) {
  if (code === undefined || code === null) return 'Unknown';
  return WEATHER_CODE_LABELS[code] || 'Unstable weather';
}

function describeAqi(aqi) {
  if (aqi === null || aqi === undefined || Number.isNaN(Number(aqi))) {
    return { level: 'Unknown', category: 'unknown' };
  }
  const value = Number(aqi);
  if (value <= 50) return { level: 'Good', category: 'good' };
  if (value <= 100) return { level: 'Moderate', category: 'moderate' };
  if (value <= 150) return { level: 'Unhealthy (sensitive)', category: 'unhealthySensitive' };
  if (value <= 200) return { level: 'Unhealthy', category: 'unhealthy' };
  if (value <= 300) return { level: 'Very unhealthy', category: 'veryUnhealthy' };
  return { level: 'Hazardous', category: 'hazardous' };
}

function buildExerciseSuggestion({ temperature, aqi, weatherCode, windSpeed, humidity }) {
  if (temperature === null || temperature === undefined) {
    return 'Weather data is temporarily unavailable. Please try again later.';
  }
  if (aqi !== null && aqi !== undefined) {
    const value = Number(aqi);
    if (!Number.isNaN(value) && value >= 150) {
      return 'Air quality is poor. Reduce outdoor intensity and consider a mask.';
    }
  }
  if (weatherCode !== null && weatherCode !== undefined) {
    const rainyCodes = [51, 53, 55, 61, 63, 65, 66, 67, 80, 81, 82, 95, 96, 99];
    if (rainyCodes.includes(Number(weatherCode))) {
      return 'Rain is expected. Prepare rain gear or train indoors.';
    }
    const snowyCodes = [71, 73, 75, 77, 85, 86];
    if (snowyCodes.includes(Number(weatherCode))) {
      return 'Conditions may be icy. Choose safe routes or move indoors.';
    }
  }
  if (humidity !== null && humidity !== undefined && Number(humidity) >= 85) {
    return 'Humidity is high. Rehydrate often and avoid overheating.';
  }
  if (windSpeed !== null && windSpeed !== undefined && Number(windSpeed) >= 25) {
    return 'Strong winds today. Keep warm and limit long outdoor sessions.';
  }
  if (temperature <= 0) return 'It is quite cold. Dress warmly and shorten outdoor time.';
  if (temperature >= 32) return 'Hot weather forecast. Slow down, stay shaded, and hydrate well.';
  return 'Weather looks good. Maintain your planned outdoor training.';
}

function normalizeCoordinate(value, { min = -180, max = 180 } = {}) {
  if (value === null || value === undefined) return null;
  const num = Number(value);
  if (Number.isNaN(num)) return null;
  if (num < min || num > max) return null;
  return num;
}

function buildCoordinateLabel(lat, lon) {
  const latitude = Number(lat);
  const longitude = Number(lon);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return '坐标未知';
  }
  return `坐标 ${latitude.toFixed(4)}, ${longitude.toFixed(4)}`;
}

function findClosestTimeIndex(times = []) {
  if (!Array.isArray(times) || !times.length) return -1;
  const now = Date.now();
  let minDiff = Number.POSITIVE_INFINITY;
  let index = -1;
  times.forEach((time, idx) => {
    const timestamp = new Date(time).getTime();
    if (Number.isNaN(timestamp)) return;
    const diff = Math.abs(timestamp - now);
    if (diff < minDiff) {
      minDiff = diff;
      index = idx;
    }
  });
  return index;
}

function quantizeCoordinate(value) {
  if (!Number.isFinite(value)) {
    return null;
  }
  return Math.round(value / GEOCODE_CACHE_GRID_SIZE) * GEOCODE_CACHE_GRID_SIZE;
}

function buildGeocodeCacheKey(type, latitude, longitude, extra = '') {
  const latKey = quantizeCoordinate(latitude);
  const lonKey = quantizeCoordinate(longitude);
  if (latKey === null || lonKey === null) {
    return null;
  }
  const suffix = extra ? `:${extra}` : '';
  return `${type}:${latKey.toFixed(6)}:${lonKey.toFixed(6)}${suffix}`;
}

function getGeocodeCacheEntry(key) {
  if (!key) return null;
  const entry = geocodeCache.get(key);
  if (!entry) {
    geocodeMetrics.cacheMisses += 1;
    return null;
  }
  if (entry.expiresAt <= Date.now()) {
    geocodeCache.delete(key);
    geocodeMetrics.cacheMisses += 1;
    return null;
  }
  geocodeMetrics.cacheHits += 1;
  return entry.value;
}

function setGeocodeCacheEntry(key, value) {
  if (!key) return;
  geocodeCache.set(key, {
    value,
    expiresAt: Date.now() + GEOCODE_CACHE_TTL_MS,
  });
}

function pruneGeocodeCache() {
  const now = Date.now();
  geocodeCache.forEach((entry, key) => {
    if (!entry || entry.expiresAt <= now) {
      geocodeCache.delete(key);
    }
  });
}

setInterval(pruneGeocodeCache, Math.max(GEOCODE_CACHE_TTL_MS, 60 * 1000)).unref();

function matchesBuildingWhitelist(text = '') {
  if (!text) return false;
  return BUILDING_NAME_WHITELIST.some((regex) => regex.test(text));
}

function deriveNamingLevelFromRegeo(payload) {
  if (!payload) {
    return 'unknown';
  }
  const regeocode = payload.regeocode || {};
  const aois = Array.isArray(regeocode.aois) ? regeocode.aois : [];
  const pois = Array.isArray(regeocode.pois) ? regeocode.pois : [];
  const roads = Array.isArray(regeocode.roads) ? regeocode.roads : [];
  const component = regeocode.addressComponent || {};

  const buildingCandidate =
    aois.find((item) => matchesBuildingWhitelist(item?.name || '')) ||
    pois.find((item) => matchesBuildingWhitelist(item?.name || '') || matchesBuildingWhitelist(item?.type || ''));

  if (buildingCandidate) {
    return 'building';
  }

  const poiCandidate =
    pois.find((item) => item && (item.name || item.type)) ||
    aois.find((item) => item && item.name);
  if (poiCandidate) {
    return 'poi';
  }

  if (roads.some((item) => item?.name)) {
    return 'road';
  }

  if (component.district || component.township) {
    return 'district';
  }

  if (component.city || component.province) {
    return 'city';
  }

  return 'unknown';
}

function trackNamingLevel(level) {
  const key = FALLBACK_BUILDING_NAME_PRIORITY.includes(level) ? level : 'unknown';
  geocodeMetrics.namingLevels[key] = (geocodeMetrics.namingLevels[key] || 0) + 1;
}

function buildAmapRequestUrl(base, params = {}) {
  const url = new URL(base);
  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '') {
      return;
    }
    url.searchParams.set(key, value);
  });
  url.searchParams.set('key', AMAP_WEB_KEY);
  return url.toString();
}

async function executeAmapRequest(url) {
  geocodeMetrics.amapRequests += 1;
  let timeoutId;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(() => {
      const error = new Error('AMap request timeout');
      error.statusCode = 504;
      geocodeMetrics.amapErrors += 1;
      reject(error);
    }, AMAP_TIMEOUT_MS);
  });
  const requestPromise = (async () => {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': WEATHER_USER_AGENT,
      },
    });
    if (!response.ok) {
      const error = new Error(`AMap request failed with status ${response.status}`);
      error.statusCode = response.status;
      geocodeMetrics.amapErrors += 1;
      throw error;
    }
    const payload = await response.json();
    if (payload?.status !== '1') {
      const error = new Error(payload?.info || 'AMap API returned error');
      error.statusCode = 502;
      geocodeMetrics.amapErrors += 1;
      throw error;
    }
    return payload;
  })();
  try {
    return await Promise.race([requestPromise, timeoutPromise]);
  } finally {
    clearTimeout(timeoutId);
  }
}

async function fetchAmapRegeo({ latitude, longitude, radius = 60, extensions = 'all' } = {}) {
  if (!AMAP_WEB_KEY) {
    const error = new Error('Amap key is not configured');
    error.statusCode = 500;
    throw error;
  }
  const boundedRadius = Math.min(Math.max(Math.round(radius) || 0, 10), 300);
  const url = buildAmapRequestUrl('https://restapi.amap.com/v3/geocode/regeo', {
    location: `${longitude},${latitude}`,
    radius: boundedRadius,
    extensions,
    batch: 'false',
    roadlevel: '0',
  });
  const payload = await executeAmapRequest(url);
  const level = deriveNamingLevelFromRegeo(payload);
  trackNamingLevel(level);
  return payload;
}

async function fetchAmapAround({
  latitude,
  longitude,
  radius = 80,
  types = '',
  keywords = '',
  sortrule = 'distance',
  offset = 20,
} = {}) {
  if (!AMAP_WEB_KEY) {
    const error = new Error('Amap key is not configured');
    error.statusCode = 500;
    throw error;
  }
  const boundedRadius = Math.min(Math.max(Math.round(radius) || 0, 10), 500);
  const params = {
    location: `${longitude},${latitude}`,
    radius: boundedRadius,
    types,
    keywords,
    sortrule,
    offset,
    page: 1,
    output: 'json',
  };
  const url = buildAmapRequestUrl('https://restapi.amap.com/v3/place/around', params);
  return executeAmapRequest(url);
}

async function fetchWeatherSnapshot(latitude, longitude) {
  const base = 'https://api.open-meteo.com/v1/forecast';
  const url = new URL(base);
  url.searchParams.set('latitude', latitude);
  url.searchParams.set('longitude', longitude);
  url.searchParams.set(
    'current',
    'temperature_2m,weather_code,relative_humidity_2m,apparent_temperature,wind_speed_10m,wind_direction_10m'
  );
  url.searchParams.set('timezone', 'auto');

  const response = await fetch(url.toString(), {
    headers: { 'User-Agent': WEATHER_USER_AGENT },
  });
  if (!response.ok) {
    const error = new Error('Weather request failed');
    error.statusCode = response.status;
    throw error;
  }
  const payload = await response.json();
  const current = payload.current || {};
  return {
    temperature: current.temperature_2m ?? null,
    apparentTemperature: current.apparent_temperature ?? null,
    weatherCode: current.weather_code ?? null,
    humidity: current.relative_humidity_2m ?? null,
    windSpeed: current.wind_speed_10m ?? null,
    windDirection: current.wind_direction_10m ?? null,
    fetchedAt: current.time ? new Date(current.time).getTime() : Date.now(),
  };
}

async function fetchAirQualitySnapshot(latitude, longitude) {
  const base = 'https://air-quality-api.open-meteo.com/v1/air-quality';
  const url = new URL(base);
  url.searchParams.set('latitude', latitude);
  url.searchParams.set('longitude', longitude);
  url.searchParams.set('hourly', 'us_aqi,pm2_5,pm10');
  url.searchParams.set('timezone', 'auto');
  url.searchParams.set('forecast_days', '1');

  const response = await fetch(url.toString(), {
    headers: { 'User-Agent': WEATHER_USER_AGENT },
  });
  if (!response.ok) {
    const error = new Error('Air quality request failed');
    error.statusCode = response.status;
    throw error;
  }
  const payload = await response.json();
  const times = payload.hourly?.time || [];
  const index = findClosestTimeIndex(times);
  if (index === -1) {
    return { aqi: null, pm25: null, pm10: null };
  }
  const aqiList = payload.hourly.us_aqi || [];
  const pm25List = payload.hourly.pm2_5 || [];
  const pm10List = payload.hourly.pm10 || [];
  return {
    aqi: aqiList[index] ?? null,
    pm25: pm25List[index] ?? null,
    pm10: pm10List[index] ?? null,
    fetchedAt: times[index] ? new Date(times[index]).getTime() : Date.now(),
  };
}

async function reverseGeocode(latitude, longitude) {
  const url = new URL('https://nominatim.openstreetmap.org/reverse');
  url.searchParams.set('format', 'jsonv2');
  url.searchParams.set('lat', latitude);
  url.searchParams.set('lon', longitude);
  url.searchParams.set('zoom', '17');
  url.searchParams.set('addressdetails', '1');

  const response = await fetch(url.toString(), {
    headers: { 'User-Agent': WEATHER_USER_AGENT, Accept: 'application/json' },
  });
  if (!response.ok) {
    const error = new Error('Reverse geocode failed');
    error.statusCode = response.status;
    throw error;
  }
  const payload = await response.json();
  const address = payload.address || {};
  const name =
    payload.name ||
    address.road ||
    address.neighbourhood ||
    address.suburb ||
    address.city_district ||
    address.city ||
    address.county ||
    payload.display_name ||
    'Unknown location';
  return {
    name,
    displayName: payload.display_name || name,
    address,
    raw: payload,
  };
}

// === Routes ===
app.get('/api/ping', (req, res) => {
  res.json({ status: 'ok', time: Date.now() });
});

app.post('/api/login/admin', async (req, res) => {
  if (!ADMIN_LOGIN_ENABLED) {
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
  if (normalizedUsername !== ADMIN_USER) {
    return res.status(401).json({ error: 'Invalid username or password' });
  }
  const passwordValid = await validateAdminPassword(password);
  if (!passwordValid) {
    return res.status(401).json({ error: 'Invalid username or password' });
  }
  const token = signToken('admin', { role: 'admin' });
  res.json({ token, role: 'admin' });
});

app.post('/api/login/wechat', async (req, res) => {
  const { code } = req.body || {};
  if (!code) return res.status(400).json({ error: 'Missing code' });
  try {
    const session = await fetchWeChatSession(code);
    const user = await upsertUser(session);
    const userId = user?.id;
    const token = signToken(userId);
    res.json({
      token,
      user: {
        id: userId,
        openid: session.openid,
        nickname: user?.nickname || '',
        avatar: user?.avatar || '',
        gender: user?.gender || '',
        ageRange: user?.age_range || '',
        identity: user?.identity_label || '',
        displayName: buildUserDisplayName({ id: userId, nickname: user?.nickname }),
      },
      role: 'user',
      lastSyncAt: Date.now(),
    });
  } catch (error) {
    const status = error.statusCode || 500;
    console.error('POST /api/login/wechat failed', error);
    res
      .status(status)
      .json({ error: 'WeChat login failed', details: error.details || null });
  }
});

app.post('/api/user/profile', ensureAuth, async (req, res) => {
  if (!req.userId) {
    return res.status(403).json({ error: 'User context required' });
  }
  const {
    nickname,
    nickName,
    avatarUrl,
    avatar,
    code,
    gender,
    ageRange,
    identity,
    birthday,
    height,
    weight,
  } = req.body || {};
  const rawNickname = typeof nickname === 'string' ? nickname : typeof nickName === 'string' ? nickName : '';
  const rawAvatar = typeof avatarUrl === 'string' ? avatarUrl : typeof avatar === 'string' ? avatar : '';
  const normalizedNickname = rawNickname ? rawNickname.trim() : '';
  const normalizedAvatar = rawAvatar ? rawAvatar.trim() : '';
  const rawCode = typeof code === 'string' ? code.trim() : '';
  const normalizedGender = sanitizeEnumValue(gender, USER_GENDER_VALUES);
  const normalizedAgeRange = sanitizeEnumValue(ageRange, USER_AGE_RANGE_VALUES);
  const normalizedIdentity = sanitizeEnumValue(identity, USER_IDENTITY_VALUES);
  const normalizedBirthday =
    typeof birthday === 'string' && birthday.trim() ? birthday.trim().slice(0, 64) : null;
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

  if (rawCode) {
    try {
      const session = await fetchWeChatSession(rawCode);
      if (session?.openid) {
        const existing = await pool.query('SELECT openid FROM users WHERE id = $1', [req.userId]);
        const currentOpenid = existing.rows[0]?.openid || null;
        if (currentOpenid && currentOpenid !== session.openid) {
          return res.status(409).json({ error: 'WeChat code does not match current user' });
        }
        await pool.query(
          `UPDATE users
             SET openid = COALESCE($1, openid),
                 unionid = COALESCE($2, unionid),
                 session_key = COALESCE($3, session_key),
                 updated_at = NOW()
           WHERE id = $4`,
          [session.openid || null, session.unionid || null, session.session_key || null, req.userId]
        );
      }
    } catch (error) {
      console.error('POST /api/user/profile failed to verify code', error);
      const status = error.statusCode || 502;
      return res.status(status).json({ error: 'Failed to verify WeChat code' });
    }
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
        normalizedNickname || null,
        normalizedAvatar || null,
        normalizedGender || null,
        normalizedAgeRange || null,
        normalizedIdentity || null,
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

app.get('/api/user/achievements', ensureAuth, async (req, res) => {
  if (!req.userId) {
    return res.status(403).json({ error: 'User context required' });
  }
  try {
    const result = await pool.query(
      'SELECT payload, updated_at FROM user_achievements WHERE user_id = $1',
      [req.userId]
    );
    if (!result.rows.length) {
      return res.json({
        totalPoints: 0,
        currentBadge: 'rookie',
        routeHistory: {},
        updatedAt: Date.now(),
      });
    }
    const row = result.rows[0];
    const payload = row.payload && typeof row.payload === 'object' ? { ...row.payload } : {};
    const updatedAtMs =
      row.updated_at instanceof Date ? row.updated_at.getTime() : Number(payload.updatedAt) || Date.now();
    res.json({
      totalPoints: Number(payload.totalPoints) || 0,
      currentBadge: typeof payload.currentBadge === 'string' ? payload.currentBadge : 'rookie',
      routeHistory:
        payload.routeHistory && typeof payload.routeHistory === 'object'
          ? payload.routeHistory
          : {},
      updatedAt: updatedAtMs,
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

app.post('/api/user/achievements', ensureAuth, async (req, res) => {
  if (!req.userId) {
    return res.status(403).json({ error: 'User context required' });
  }
  const body = req.body || {};
  const totalPointsCandidate = Number(body.totalPoints);
  const totalPoints =
    Number.isFinite(totalPointsCandidate) && totalPointsCandidate >= 0
      ? Math.floor(totalPointsCandidate)
      : 0;
  const currentBadgeRaw = typeof body.currentBadge === 'string' ? body.currentBadge : '';
  const currentBadge = currentBadgeRaw.trim() || 'rookie';
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
    const row = result.rows[0];
    const persistedPayload = row.payload && typeof row.payload === 'object' ? { ...row.payload } : payload;
    const updatedAtMs =
      row.updated_at instanceof Date
        ? row.updated_at.getTime()
        : Number(persistedPayload.updatedAt) || now.getTime();
    res.json({
      totalPoints: Number(persistedPayload.totalPoints) || totalPoints,
      currentBadge:
        typeof persistedPayload.currentBadge === 'string'
          ? persistedPayload.currentBadge
          : currentBadge,
      routeHistory:
        persistedPayload.routeHistory && typeof persistedPayload.routeHistory === 'object'
          ? persistedPayload.routeHistory
          : routeHistory,
      updatedAt: updatedAtMs,
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

app.get('/api/user/settings', ensureAuth, async (req, res) => {
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
         FROM user_settings
        WHERE user_id = $1`,
      [req.userId]
    );
    let privacyLevel = 'public';
    let weight = null;
    let autoSync = true;
    let keepScreenPreferred = false;
    let updatedAt = Date.now();

    if (result.rows.length) {
      const row = result.rows[0];
      if (typeof row.default_privacy_level === 'string' && row.default_privacy_level.trim()) {
        privacyLevel = row.default_privacy_level.trim();
      }
      const weightNumeric = Number(row.default_weight_kg);
      if (Number.isFinite(weightNumeric) && weightNumeric > 0) {
        weight = Number(weightNumeric.toFixed(1));
      }
      if (row.auto_sync !== null && row.auto_sync !== undefined) {
        autoSync = Boolean(row.auto_sync);
      }
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

app.post('/api/user/settings', ensureAuth, async (req, res) => {
  if (!req.userId) {
    return res.status(403).json({ error: 'User context required' });
  }
  const { privacyLevel, weight, autoSync, keepScreenPreferred } = req.body || {};
  const rawPrivacy =
    typeof privacyLevel === 'string' && privacyLevel.trim() ? privacyLevel.trim().toLowerCase() : '';
  const normalizedPrivacy =
    rawPrivacy === 'public' || rawPrivacy === 'private' ? rawPrivacy : null;
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
       ON CONFLICT (user_id) DO UPDATE SET
         default_privacy_level = COALESCE(EXCLUDED.default_privacy_level, user_settings.default_privacy_level),
         default_weight_kg = COALESCE(EXCLUDED.default_weight_kg, user_settings.default_weight_kg),
         auto_sync = COALESCE(EXCLUDED.auto_sync, user_settings.auto_sync),
         keep_screen_preferred = COALESCE(EXCLUDED.keep_screen_preferred, user_settings.keep_screen_preferred),
         updated_at = EXCLUDED.updated_at
       RETURNING default_privacy_level,
                 default_weight_kg,
                 auto_sync,
                 keep_screen_preferred,
                 updated_at`,
      [req.userId, normalizedPrivacy, normalizedWeight, normalizedAutoSync, normalizedKeepScreen, now]
    );

    const row = result.rows[0];
    let privacyLevelOut = 'public';
    if (typeof row.default_privacy_level === 'string' && row.default_privacy_level.trim()) {
      privacyLevelOut = row.default_privacy_level.trim();
    }
    const weightOutNumeric = Number(row.default_weight_kg);
    const weightOut =
      Number.isFinite(weightOutNumeric) && weightOutNumeric > 0
        ? Number(weightOutNumeric.toFixed(1))
        : null;
    const autoSyncOut =
      row.auto_sync === null || row.auto_sync === undefined ? true : Boolean(row.auto_sync);
    const keepScreenPreferredOut = row.keep_screen_preferred === true;
    const updatedAtOut =
      row.updated_at instanceof Date ? row.updated_at.getTime() : now.getTime();

    res.json({
      privacyLevel: privacyLevelOut,
      weight: weightOut,
      autoSync: autoSyncOut,
      keepScreenPreferred: keepScreenPreferredOut,
      updatedAt: updatedAtOut,
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

app.post('/api/routes', ensureAuth, async (req, res) => {
  const route = req.body || {};
  const allowOverride = req.role === 'admin';
  try {
    const result = await persistRouteWithPoints(route, {
      actingUserId: req.userId,
      allowOwnerOverride: allowOverride,
      returnSnapshot: true,
    });
    const persistedRoute = result?.route || null;
    const lastSyncAt = Number(persistedRoute?.updatedAt) || Date.now();
    const statusCode = result?.wasCreated ? 201 : 200;
    res.status(statusCode).json({
      id: result?.id || route.id,
      route: persistedRoute,
      lastSyncAt,
      wasCreated: !!result?.wasCreated,
    });
  } catch (error) {
    const message = error?.message || 'Failed to save route';
    const normalized = message.toLowerCase();
    const isInputError =
      normalized.includes('required') ||
      normalized.includes('array') ||
      normalized.includes('owner') ||
      normalized.includes('points') ||
      normalized.includes('invalid');
    const statusFromError =
      Number.isInteger(error?.statusCode) && error.statusCode >= 400 && error.statusCode < 600
        ? error.statusCode
        : null;
    const status = statusFromError || (isInputError ? 400 : 500);
    console.error('POST /api/routes failed', {
      userId: req.userId,
      role: req.role,
      statusCode: status,
      message,
      details: error?.details,
      stack: error?.stack,
      code: error?.code,
      dbDetail: error?.detail,
      dbHint: error?.hint,
      dbConstraint: error?.constraint,
    });
    const responseBody = { error: message };
    if (error?.details !== undefined && status < 500) {
      responseBody.details = error.details;
    }
    res.status(status).json(responseBody);
  }
});

app.post('/api/routes/sync', ensureAuth, async (req, res) => {
  if (!req.userId) {
    return res.status(403).json({ error: 'User context required' });
  }
  const {
    lastSyncAt,
    includeDeleted: includeDeletedRaw = true,
    limit: limitRaw = 200,
    knownRemoteIds,
  } = req.body || {};

  const includeDeleted = includeDeletedRaw !== false;
  const limit = Math.min(Math.max(Number(limitRaw) || 0, 10), 500);
  const lastSyncDate = parseTimestamp(lastSyncAt);

  try {
    const params = [req.userId];
    const conditions = ['user_id = $1'];

    if (!includeDeleted) {
      conditions.push('deleted_at IS NULL');
    }

    if (lastSyncDate) {
      params.push(lastSyncDate);
      conditions.push(`updated_at >= $${params.length}`);
    }

    params.push(limit);
    const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const routesResult = await pool.query(
      `SELECT * FROM routes ${whereClause} ORDER BY updated_at ASC LIMIT $${params.length}`,
      params
    );

    const routeRows = routesResult.rows || [];
    const routeIds = routeRows.map((row) => row.id);
    const pointsByRoute = await getPointsByRoute(routeIds);
    const items = routeRows.map((row) =>
      mapRouteRow(row, pointsByRoute[row.id] || [], {
        includeOwner: false,
        includePointSummary: true,
        includeStatsSummary: true,
      })
    );

    const currentResult = await pool.query(
      `SELECT id, deleted_at, updated_at FROM routes WHERE user_id = $1`,
      [req.userId]
    );
    const existingRows = currentResult.rows || [];
    const existingMap = new Map(existingRows.map((row) => [row.id, row]));

    const deletedIdsSet = new Set();
    const missingRemoteIdsSet = new Set();

    const normalizedKnownIds = Array.isArray(knownRemoteIds)
      ? knownRemoteIds
          .map((id) => (typeof id === 'string' ? id.trim() : ''))
          .filter((id) => id)
      : [];

    normalizedKnownIds.forEach((id) => {
      const row = existingMap.get(id);
      if (!row) {
        missingRemoteIdsSet.add(id);
        return;
      }
      if (row.deleted_at instanceof Date) {
        deletedIdsSet.add(id);
      }
    });

    const maxUpdatedFromItems = items.reduce((max, route) => {
      const updatedAt = Number(route?.updatedAt);
      return Number.isFinite(updatedAt) && updatedAt > max ? updatedAt : max;
    }, 0);

    const maxUpdatedResult = await pool.query(
      `SELECT MAX(updated_at) AS max_updated_at FROM routes WHERE user_id = $1`,
      [req.userId]
    );
    const dbMaxUpdated =
      maxUpdatedResult.rows?.[0]?.max_updated_at instanceof Date
        ? maxUpdatedResult.rows[0].max_updated_at.getTime()
        : 0;
    const maxUpdatedAt = Math.max(maxUpdatedFromItems, dbMaxUpdated, 0);

    res.json({
      items,
      deletedIds: Array.from(deletedIdsSet),
      missingRemoteIds: Array.from(missingRemoteIdsSet),
      lastSyncAt: lastSyncDate ? lastSyncDate.getTime() : 0,
      latestSyncAt: maxUpdatedAt || Date.now(),
      maxUpdatedAt: maxUpdatedAt || Date.now(),
      cursor: null,
      cursorUpdatedAt: maxUpdatedAt || Date.now(),
    });
  } catch (error) {
    console.error('POST /api/routes/sync failed', {
      userId: req.userId,
      role: req.role,
      message: error?.message,
      stack: error?.stack,
    });
    res.status(500).json({ error: 'Failed to sync routes' });
  }
});

app.get('/api/routes', ensureAuth, async (req, res) => {
  try {
    const updatedAfter = parseTimestamp(req.query.updatedAfter);
    const isAdmin = req.role === 'admin';
    const wantsAll = isAdmin && parseBooleanFlag(req.query.all);

    if (isAdmin && !wantsAll) {
      return res
        .status(400)
        .json({ error: 'Admin requests must include all=1 to fetch all routes' });
    }

    const params = [];
    const conditions = [];

    if (wantsAll) {
      const targetUserId = req.query.userId;
      if (targetUserId !== undefined) {
        const numericUserId = Number(targetUserId);
        if (Number.isNaN(numericUserId)) {
          return res.status(400).json({ error: 'Invalid userId filter' });
        }
        params.push(numericUserId);
        conditions.push(`user_id = $${params.length}`);
      }
    } else {
      params.push(req.userId);
      conditions.push(`user_id = $${params.length}`);
      conditions.push('deleted_at IS NULL');
    }

    if (updatedAfter) {
      params.push(updatedAfter);
      conditions.push(`updated_at >= $${params.length}`);
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const routesResult = await pool.query(
      `SELECT * FROM routes ${where} ORDER BY start_time DESC`,
      params
    );
    const routeIds = routesResult.rows.map((row) => row.id);
    const pointsByRoute = await getPointsByRoute(routeIds);
    const mapOptions = {
      includeOwner: wantsAll,
      includePointSummary: true,
      includeStatsSummary: true,
    };
    const routes = routesResult.rows.map((row) =>
      mapRouteRow(row, pointsByRoute[row.id] || [], mapOptions)
    );
    res.json(routes);
  } catch (error) {
    console.error('GET /api/routes failed', error);
    res.status(500).json({ error: 'Failed to fetch routes' });
  }
});

app.get('/api/routes/public', ensureAuth, async (req, res) => {
  try {
    const limit = Math.min(Math.max(Number(req.query.limit) || PUBLIC_ROUTE_LIMIT, 5), 50);
    const sortKey = String(req.query.sort || 'recent').toLowerCase();
    let orderClause = 'r.start_time DESC';
    if (sortKey === 'distance') {
      orderClause = "COALESCE((r.stats->>'distance')::numeric, 0) DESC, r.start_time DESC";
    } else if (sortKey === 'likes') {
      orderClause = 'COALESCE(l.likes_count, 0) DESC, r.start_time DESC';
    } else if (sortKey === 'comments' || sortKey === 'comment') {
      orderClause =
        'COALESCE(total_threads, 0) DESC, COALESCE(l.likes_count, 0) DESC, r.start_time DESC';
    }

    const numericUserId = Number(req.userId);
    const currentUserId = Number.isFinite(numericUserId) ? numericUserId : null;
    const likeUserId = currentUserId ?? -1;

    const result = await pool.query(
      `SELECT
         r.id,
         r.title,
         r.start_time,
         r.end_time,
         r.stats,
         r.meta,
         r.campus_zone,
         r.start_campus,
         r.end_campus,
         r.created_at,
         r.updated_at,
         COALESCE(r.meta->>'startLabel', r.start_campus->>'displayName', r.start_campus->>'name', r.campus_zone, '起点未知') AS start_label,
         COALESCE(r.meta->>'endLabel', r.end_campus->>'displayName', r.end_campus->>'name', '终点未知') AS end_label,
         u.id AS user_id,
         u.nickname AS user_nickname,
         u.avatar AS user_avatar,
         COALESCE(l.likes_count, 0) AS likes_count,
         COALESCE(l.liked_by_current, false) AS liked_by_current,
         COALESCE(c.comments_count, 0) AS comments_count,
         COALESCE(c.replies_count, 0) AS replies_count,
         COALESCE(c.comments_count, 0) + COALESCE(c.replies_count, 0) AS total_threads
       FROM routes r
       LEFT JOIN users u ON u.id = r.user_id
       LEFT JOIN LATERAL (
         SELECT
           COUNT(*) AS likes_count,
           BOOL_OR(rl.user_id = $2::int) AS liked_by_current
         FROM route_likes rl
         WHERE rl.route_id = r.id
       ) l ON TRUE
       LEFT JOIN LATERAL (
         SELECT
           COUNT(*) AS comments_count,
           (SELECT COUNT(*) FROM route_comment_replies rcr WHERE rcr.route_id = r.id) AS replies_count
         FROM route_comments rc
         WHERE rc.route_id = r.id AND rc.is_deleted IS NOT TRUE
       ) c ON TRUE
       WHERE LOWER(r.privacy_level) = 'public' AND r.deleted_at IS NULL
       ORDER BY ${orderClause}
       LIMIT $1`,
      [limit, likeUserId]
    );
    const routes = result.rows.map(mapPublicRouteRow);
    const routeIds = routes.map((item) => item.id).filter(Boolean);
    const previews = await fetchCommentPreviews(routeIds, currentUserId, 3);
    const enrichedRoutes = routes.map((route) => ({
      ...route,
      commentPreviews: previews[route.id] || [],
    }));
    res.json({ routes: enrichedRoutes, sort: sortKey });
  } catch (error) {
    console.error('GET /api/routes/public failed', error);
    res.status(500).json({ error: 'Failed to fetch public routes' });
  }
});

app.get('/api/routes/:id', ensureAuth, async (req, res) => {
  const routeId = req.params.id;
  if (!routeId) return res.status(400).json({ error: 'Route id is required' });
  try {
    const result = await pool.query('SELECT * FROM routes WHERE id = $1', [routeId]);
    if (!result.rows.length) return res.status(404).json({ error: 'Route not found' });
    const row = result.rows[0];
    const isAdmin = req.role === 'admin';
    if (!isAdmin && row.user_id !== req.userId && row.privacy_level !== 'public') {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const pointsByRoute = await getPointsByRoute([routeId]);
    const mappedRoute = mapRouteRow(row, pointsByRoute[routeId] || [], {
      includeOwner: true,
      includePointSummary: true,
      includeStatsSummary: true,
    });
    res.json(mappedRoute);
  } catch (error) {
    console.error('GET /api/routes/:id failed', error);
    res.status(500).json({ error: 'Failed to fetch route' });
  }
});

app.put('/api/routes/:id', ensureAuth, async (req, res) => {
  const route = { ...(req.body || {}), id: req.params.id };
  const allowOverride = req.role === 'admin';
  try {
    const result = await persistRouteWithPoints(route, {
      actingUserId: req.userId,
      allowOwnerOverride: allowOverride,
      returnSnapshot: true,
    });
    const persistedRoute = result?.route || null;
    const lastSyncAt = Number(persistedRoute?.updatedAt) || Date.now();
    const statusCode = result?.wasCreated ? 201 : 200;
    res.status(statusCode).json({
      id: result?.id || route.id,
      route: persistedRoute,
      lastSyncAt,
      wasCreated: !!result?.wasCreated,
    });
  } catch (error) {
    const message = error?.message || 'Failed to save route';
    const normalized = message.toLowerCase();
    const isInputError =
      normalized.includes('required') ||
      normalized.includes('array') ||
      normalized.includes('owner') ||
      normalized.includes('points') ||
      normalized.includes('invalid');
    const statusFromError =
      Number.isInteger(error?.statusCode) && error.statusCode >= 400 && error.statusCode < 600
        ? error.statusCode
        : null;
    const status = statusFromError || (isInputError ? 400 : 500);
    console.error('PUT /api/routes/:id failed', {
      routeId: route.id,
      userId: req.userId,
      role: req.role,
      statusCode: status,
      message,
      details: error?.details,
      stack: error?.stack,
      code: error?.code,
      dbDetail: error?.detail,
      dbHint: error?.hint,
      dbConstraint: error?.constraint,
      payload: summarizeRoutePayloadForLog(route),
    });
    const responseBody = { error: message };
    if (error?.details !== undefined && status < 500) {
      responseBody.details = error.details;
    }
    res.status(status).json(responseBody);
  }
});

app.patch('/api/routes/:id', ensureAuth, async (req, res) => {
  const { id } = req.params;
  const patch = req.body || {};
  if (!id) return res.status(400).json({ error: 'Missing route id' });
  try {
    const result = await applyRoutePatch(id, patch, {
      isAdmin: req.role === 'admin',
      userId: req.userId,
    });
    if (!result) {
      return res.status(404).json({ error: 'Route not found' });
    }
    const lastSyncAt = Number(result.updatedAt) || Date.now();
    res.json({ id: result.id, lastSyncAt });
  } catch (error) {
    const message = error?.message || 'Failed to update route';
    const normalized = message.toLowerCase();
    const statusFromError =
      Number.isInteger(error?.statusCode) && error.statusCode >= 400 && error.statusCode < 600
        ? error.statusCode
        : null;
    let status = statusFromError || 500;
    if (!statusFromError) {
      if (normalized.includes('insufficient privileges')) {
        status = 403;
      } else if (normalized.includes('no updatable') || normalized.includes('required')) {
        status = 400;
      }
    }
    console.error('PATCH /api/routes/:id failed', {
      routeId: id,
      userId: req.userId,
      role: req.role,
      statusCode: status,
      message,
      details: error?.details,
      stack: error?.stack,
      patchKeys: Object.keys(patch || {}),
    });
    const responseBody = { error: message };
    if (error?.details !== undefined && status < 500) {
      responseBody.details = error.details;
    }
    res.status(status).json(responseBody);
  }
});

app.delete('/api/routes/:id', ensureAuth, async (req, res) => {
  const normalizedId = normalizeRouteId(req.params.id);
  if (!normalizedId) {
    return res.status(400).json({ error: 'Invalid route id' });
  }
  const lastSyncAt = Date.now();
  try {
    if (req.role === 'admin') {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const result = await client.query('DELETE FROM routes WHERE id = $1 RETURNING id', [
          normalizedId,
        ]);
        if (!result.rowCount) {
          await client.query('ROLLBACK');
          return res.status(404).json({ error: 'Route not found' });
        }
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
      return res.status(200).json({ id: normalizedId, lastSyncAt });
    } else {
      const normalizedUser = Number(req.userId);
      if (!Number.isFinite(normalizedUser) || normalizedUser <= 0) {
        return res.status(403).json({ error: 'User context required' });
      }
      const result = await pool.query(
        `UPDATE routes
           SET deleted_at = NOW(), updated_at = NOW()
         WHERE id = $1 AND user_id = $2
         RETURNING id, updated_at`,
        [normalizedId, normalizedUser]
      );
      if (!result.rowCount) {
        return res.status(404).json({ error: 'Route not found' });
      }
      const updatedAtValue =
        result.rows[0]?.updated_at instanceof Date ? result.rows[0].updated_at.getTime() : lastSyncAt;
      return res.status(200).json({ id: normalizedId, lastSyncAt: updatedAtValue });
    }
  } catch (error) {
    console.error('DELETE /api/routes/:id failed', {
      routeId: normalizedId,
      userId: req.userId,
      role: req.role,
      message: error?.message,
      stack: error?.stack,
    });
    res.status(500).json({ error: 'Failed to delete route' });
  }
});

app.post('/api/routes/:id/likes', ensureAuth, async (req, res) => {
  const routeId = req.params.id;
  if (!routeId) {
    return res.status(400).json({ error: 'Route id is required' });
  }
  if (!req.userId) {
    return res.status(403).json({ error: 'User context required' });
  }
  try {
    const route = await getRouteForSocial(routeId);
    if (!route) {
      return res.status(404).json({ error: 'Route not found' });
    }
    if (route.privacy_level !== 'public' && route.user_id !== req.userId) {
      return res.status(403).json({ error: 'Route is not public' });
    }
    await pool.query(
      `INSERT INTO route_likes (route_id, user_id)
       VALUES ($1, $2)
       ON CONFLICT (route_id, user_id) DO NOTHING`,
      [routeId, req.userId]
    );
    const stats = await fetchRouteSocialStats(routeId, req.userId);
    res.status(201).json(
      stats || { likes: 0, liked: true, comments: 0 }
    );
  } catch (error) {
    console.error('POST /api/routes/:id/likes failed', error);
    res.status(500).json({ error: 'Failed to like route' });
  }
});

app.delete('/api/routes/:id/likes', ensureAuth, async (req, res) => {
  const routeId = req.params.id;
  if (!routeId) {
    return res.status(400).json({ error: 'Route id is required' });
  }
  if (!req.userId) {
    return res.status(403).json({ error: 'User context required' });
  }
  try {
    const route = await getRouteForSocial(routeId);
    if (!route) {
      return res.status(404).json({ error: 'Route not found' });
    }
    if (route.privacy_level !== 'public' && route.user_id !== req.userId) {
      return res.status(403).json({ error: 'Route is not public' });
    }
    await pool.query(
      `DELETE FROM route_likes WHERE route_id = $1 AND user_id = $2`,
      [routeId, req.userId]
    );
    const stats = await fetchRouteSocialStats(routeId, req.userId);
    res.json(stats || { likes: 0, liked: false, comments: 0 });
  } catch (error) {
    console.error('DELETE /api/routes/:id/likes failed', error);
    res.status(500).json({ error: 'Failed to cancel like' });
  }
});

app.get('/api/routes/:id/comments', ensureAuth, async (req, res) => {
  const routeId = req.params.id;
  if (!routeId) {
    return res.status(400).json({ error: 'Route id is required' });
  }
  try {
    const route = await getRouteForSocial(routeId);
    if (!route) {
      return res.status(404).json({ error: 'Route not found' });
    }
    if (route.privacy_level !== 'public' && route.user_id !== req.userId) {
      return res.status(403).json({ error: 'Route is not public' });
    }
    const isAdmin = req.role === 'admin';
    const [comments, stats] = await Promise.all([
      fetchRouteComments(routeId, req.userId, {
        includeDeleted: isAdmin,
        isAdmin,
      }),
      fetchRouteSocialStats(routeId, req.userId),
    ]);
    const repliesTotal = comments.reduce(
      (acc, comment) => acc + (Array.isArray(comment.replies) ? comment.replies.length : 0),
      0
    );
    res.json({
      comments,
      total: stats ? stats.comments : comments.length + repliesTotal,
      topLevel: stats ? stats.commentsTopLevel : comments.length,
      replies: stats ? stats.commentsReplies : repliesTotal,
      stats: stats || null,
    });
  } catch (error) {
    console.error('GET /api/routes/:id/comments failed', error);
    res.status(500).json({ error: 'Failed to fetch comments' });
  }
});

app.post('/api/routes/:id/comments', ensureAuth, async (req, res) => {
  const routeId = req.params.id;
  if (!routeId) {
    return res.status(400).json({ error: 'Route id is required' });
  }
  if (!req.userId) {
    return res.status(403).json({ error: 'User context required' });
  }
  const rawContent = typeof req.body?.content === 'string' ? req.body.content.trim() : '';
  if (!rawContent) {
    return res.status(400).json({ error: 'Comment content is required' });
  }
  if (rawContent.length > 500) {
    return res.status(400).json({ error: 'Comment content is too long' });
  }
  const isAdmin = req.role === 'admin';
  try {
    const route = await getRouteForSocial(routeId);
    if (!route) {
      return res.status(404).json({ error: 'Route not found' });
    }
    if (route.privacy_level !== 'public' && route.user_id !== req.userId) {
      return res.status(403).json({ error: 'Route is not public' });
    }
    const inserted = await pool.query(
      `INSERT INTO route_comments (route_id, user_id, content)
       VALUES ($1, $2, $3)
       RETURNING id, created_at`,
      [routeId, req.userId, rawContent]
    );
    const insertedIdRaw = inserted.rows[0]?.id;
    const commentId = Number.isFinite(Number(insertedIdRaw))
      ? Number(insertedIdRaw)
      : insertedIdRaw;
    const [stats, comment] = await Promise.all([
      fetchRouteSocialStats(routeId, req.userId),
      fetchCommentDetail(commentId, req.userId, {
        isAdmin,
        includeDeleted: isAdmin,
      }),
    ]);
    res.status(201).json({
      ...(stats || {
        likes: 0,
        liked: false,
        comments: 1,
        commentsTopLevel: 1,
        commentsReplies: 0,
      }),
      comment: comment || {
        id: commentId,
        routeId,
        content: rawContent,
        createdAt: inserted.rows[0]?.created_at
          ? inserted.rows[0].created_at.getTime()
          : Date.now(),
        likes: 0,
        liked: false,
        repliesCount: 0,
        replies: [],
        isDeleted: false,
        deletedAt: null,
        canDelete: true,
        canModerate: Boolean(isAdmin),
      },
    });
  } catch (error) {
    console.error('POST /api/routes/:id/comments failed', error);
    res.status(500).json({ error: 'Failed to add comment' });
  }
});

app.post('/api/routes/:routeId/comments/:commentId/replies', ensureAuth, async (req, res) => {
  const routeId = req.params.routeId;
  const commentIdRaw = req.params.commentId;
  if (!routeId || !commentIdRaw) {
    return res.status(400).json({ error: 'Route id and comment id are required' });
  }
  if (!req.userId) {
    return res.status(403).json({ error: 'User context required' });
  }
  const rawContent = typeof req.body?.content === 'string' ? req.body.content.trim() : '';
  if (!rawContent) {
    return res.status(400).json({ error: 'Reply content is required' });
  }
  if (rawContent.length > 500) {
    return res.status(400).json({ error: 'Reply content is too long' });
  }
  const commentId = Number(commentIdRaw);
  if (!Number.isFinite(commentId)) {
    return res.status(400).json({ error: 'Invalid comment id' });
  }
  const isAdmin = req.role === 'admin';
  try {
    const commentMeta = await getCommentRouteMeta(commentId);
    if (!commentMeta) {
      return res.status(404).json({ error: 'Comment not found' });
    }
    if (commentMeta.is_deleted) {
      return res.status(404).json({ error: 'Comment not found' });
    }
    if (String(commentMeta.route_id) !== String(routeId)) {
      return res.status(400).json({ error: 'Comment does not belong to the specified route' });
    }
    if (commentMeta.privacy_level !== 'public' && commentMeta.user_id !== req.userId) {
      return res.status(403).json({ error: 'Route is not public' });
    }
    const inserted = await pool.query(
      `INSERT INTO route_comment_replies (comment_id, route_id, user_id, content)
       VALUES ($1, $2, $3, $4)
       RETURNING id`,
      [commentId, routeId, req.userId, rawContent]
    );
    const insertedReplyIdRaw = inserted.rows[0]?.id || null;
    const replyId = Number.isFinite(Number(insertedReplyIdRaw))
      ? Number(insertedReplyIdRaw)
      : insertedReplyIdRaw;
    const [stats, comment, reply] = await Promise.all([
      fetchRouteSocialStats(routeId, req.userId),
      fetchCommentDetail(commentId, req.userId, {
        isAdmin,
        includeDeleted: isAdmin,
      }),
      fetchReplyDetail(replyId),
    ]);
    res.status(201).json({
      ...(stats || {
        likes: 0,
        liked: false,
        comments: 1,
        commentsTopLevel: 1,
        commentsReplies: 0,
      }),
      comment,
      reply,
    });
  } catch (error) {
    console.error(
      'POST /api/routes/:routeId/comments/:commentId/replies failed',
      error
    );
    res.status(500).json({ error: 'Failed to add reply' });
  }
});

app.post('/api/comments/:id/likes', ensureAuth, async (req, res) => {
  const commentIdRaw = req.params.id;
  if (!commentIdRaw) {
    return res.status(400).json({ error: 'Comment id is required' });
  }
  if (!req.userId) {
    return res.status(403).json({ error: 'User context required' });
  }
  const commentId = Number(commentIdRaw);
  if (!Number.isFinite(commentId)) {
    return res.status(400).json({ error: 'Invalid comment id' });
  }
  const isAdmin = req.role === 'admin';
  try {
    const commentMeta = await getCommentRouteMeta(commentId);
    if (!commentMeta) {
      return res.status(404).json({ error: 'Comment not found' });
    }
    if (commentMeta.is_deleted && !isAdmin) {
      return res.status(404).json({ error: 'Comment not found' });
    }
    if (commentMeta.privacy_level !== 'public' && commentMeta.user_id !== req.userId) {
      return res.status(403).json({ error: 'Route is not public' });
    }
    await pool
      .query(
        `INSERT INTO route_comment_likes (comment_id, user_id)
         VALUES ($1, $2)
         ON CONFLICT (comment_id, user_id) DO NOTHING`,
        [commentId, req.userId]
      )
      .catch((error) => {
        if (error && error.code === '23503') {
          const err = new Error('Comment not found');
          err.statusCode = 404;
          throw err;
        }
        throw error;
      });
    const comment = await fetchCommentDetail(commentId, req.userId, {
      isAdmin,
      includeDeleted: isAdmin,
    });
    if (!comment) {
      return res.status(404).json({ error: 'Comment not found' });
    }
    res.status(201).json({ comment });
  } catch (error) {
    const status = error.statusCode || 500;
    if (status >= 500) {
      console.error('POST /api/comments/:id/likes failed', error);
    }
    res.status(status).json({ error: error.message || 'Failed to like comment' });
  }
});

app.delete('/api/comments/:id/likes', ensureAuth, async (req, res) => {
  const commentIdRaw = req.params.id;
  if (!commentIdRaw) {
    return res.status(400).json({ error: 'Comment id is required' });
  }
  if (!req.userId) {
    return res.status(403).json({ error: 'User context required' });
  }
  const commentId = Number(commentIdRaw);
  if (!Number.isFinite(commentId)) {
    return res.status(400).json({ error: 'Invalid comment id' });
  }
  const isAdmin = req.role === 'admin';
  try {
    const commentMeta = await getCommentRouteMeta(commentId);
    if (!commentMeta) {
      return res.status(404).json({ error: 'Comment not found' });
    }
    if (commentMeta.is_deleted && !isAdmin) {
      return res.status(404).json({ error: 'Comment not found' });
    }
    if (commentMeta.privacy_level !== 'public' && commentMeta.user_id !== req.userId) {
      return res.status(403).json({ error: 'Route is not public' });
    }
    await pool.query(
      `DELETE FROM route_comment_likes
       WHERE comment_id = $1 AND user_id = $2`,
      [commentId, req.userId]
    );
    const comment = await fetchCommentDetail(commentId, req.userId, {
      isAdmin,
      includeDeleted: isAdmin,
    });
    if (!comment) {
      return res.status(404).json({ error: 'Comment not found' });
    }
    res.json({ comment });
  } catch (error) {
    console.error('DELETE /api/comments/:id/likes failed', error);
    res.status(500).json({ error: 'Failed to cancel comment like' });
  }
});

app.delete('/api/comments/:id', ensureAuth, async (req, res) => {
  const commentIdRaw = req.params.id;
  if (!commentIdRaw) {
    return res.status(400).json({ error: 'Comment id is required' });
  }
  if (!req.userId) {
    return res.status(403).json({ error: 'User context required' });
  }
  const commentId = Number(commentIdRaw);
  if (!Number.isFinite(commentId)) {
    return res.status(400).json({ error: 'Invalid comment id' });
  }
  const isAdmin = req.role === 'admin';
  try {
    const commentMeta = await getCommentRouteMeta(commentId);
    if (!commentMeta) {
      return res.status(404).json({ error: 'Comment not found' });
    }
    const commentOwnerIdRaw = Number(commentMeta.comment_user_id);
    const commentOwnerId = Number.isFinite(commentOwnerIdRaw) ? commentOwnerIdRaw : null;
    if (!isAdmin && commentOwnerId !== req.userId) {
      return res.status(403).json({ error: 'Not allowed to delete this comment' });
    }
    const wantsHardDelete = isAdmin && parseBooleanFlag(req.query.hard);
    let hardDeleted = false;
    if (wantsHardDelete) {
      const result = await pool.query('DELETE FROM route_comments WHERE id = $1', [commentId]);
      if (!result.rowCount) {
        return res.status(404).json({ error: 'Comment not found' });
      }
      hardDeleted = true;
    } else if (!commentMeta.is_deleted) {
      await pool.query(
        `UPDATE route_comments
         SET is_deleted = TRUE, deleted_at = NOW()
         WHERE id = $1 AND is_deleted IS NOT TRUE`,
        [commentId]
      );
    }
    const stats = await fetchRouteSocialStats(commentMeta.route_id, req.userId);
    let comment = null;
    if (!hardDeleted) {
      comment = await fetchCommentDetail(commentId, req.userId, {
        isAdmin,
        includeDeleted: true,
      });
    }
    res.json({
      success: true,
      hardDeleted,
      routeId: commentMeta.route_id,
      commentId,
      comment: comment || null,
      stats: stats || null,
    });
  } catch (error) {
    console.error('DELETE /api/comments/:id failed', error);
    res.status(500).json({ error: 'Failed to delete comment' });
  }
});

app.post('/api/photos', ensureAuth, upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Missing file' });
  const url = buildPublicUrl(req.file.filename);
  try {
    const result = await pool.query(
      `INSERT INTO photos (user_id, url, original_name)
       VALUES ($1, $2, $3)
       RETURNING id, created_at`,
      [req.userId, url, req.file.originalname || null]
    );
    res.status(201).json({
      id: result.rows[0].id,
      url,
      createdAt: result.rows[0].created_at
        ? result.rows[0].created_at.getTime()
        : Date.now(),
    });
  } catch (error) {
    console.error('POST /api/photos failed', error);
    res.status(500).json({ error: 'Failed to store photo' });
  }
});

// === Admin APIs ===
app.get('/api/user/routes/manage', ensureAuth, async (req, res) => {
  if (!req.userId) {
    return res.status(403).json({ error: 'User context required' });
  }
  const includePoints = parseBooleanFlag(req.query.includePoints);
  const pagination = normalizePagination(req.query.page, req.query.pageSize);
  const filters = {
    routeId: req.query.routeId,
    startDate: req.query.startDate || req.query.from,
    endDate: req.query.endDate || req.query.to,
    minDistance: req.query.minDistance,
    maxDistance: req.query.maxDistance,
    minDuration: req.query.minDuration,
    maxDuration: req.query.maxDuration,
    keyword: req.query.keyword || req.query.search,
    privacyLevel: req.query.privacy || req.query.privacyLevel,
    sort: req.query.sort,
    order: req.query.order,
    userId: req.userId,
  };
  try {
    const { items, total } = await fetchAdminRoutes({
      filters,
      pagination,
      includePoints,
      includeDeleted: false,
    });
    const sortOrder = normalizeSortOrder(filters.order || req.query.order || 'desc', 'desc');
    res.json({
      items,
      pagination: {
        page: pagination.page,
        pageSize: pagination.pageSize,
        total,
      },
      sort: {
        key: filters.sort || 'startTime',
        order: sortOrder === 'ASC' ? 'asc' : 'desc',
      },
      filters: {
        includeDeleted: false,
        includePoints,
      },
    });
  } catch (error) {
    console.error('GET /api/user/routes/manage failed', error);
    res.status(500).json({ error: 'Failed to fetch user routes' });
  }
});

app.get('/api/admin/routes', ensureAuth, async (req, res) => {
  if (!ensureAdminRequest(req, res)) {
    return;
  }
  const includeDeleted = parseBooleanFlag(req.query.includeDeleted);
  const includePoints = parseBooleanFlag(req.query.includePoints);
  const pagination = normalizePagination(req.query.page, req.query.pageSize);
  const filters = {
    userId: req.query.userId,
    routeId: req.query.routeId,
    startDate: req.query.startDate || req.query.from,
    endDate: req.query.endDate || req.query.to,
    minDistance: req.query.minDistance,
    maxDistance: req.query.maxDistance,
    minDuration: req.query.minDuration,
    maxDuration: req.query.maxDuration,
    keyword: req.query.keyword || req.query.search,
    privacyLevel: req.query.privacy || req.query.privacyLevel,
    sort: req.query.sort,
    order: req.query.order,
  };
  try {
    const { items, total } = await fetchAdminRoutes({
      filters,
      pagination,
      includePoints,
      includeDeleted,
    });
    const sortOrder = normalizeSortOrder(filters.order || req.query.order || 'desc', 'desc');
    res.json({
      items,
      pagination: {
        page: pagination.page,
        pageSize: pagination.pageSize,
        total,
      },
      sort: {
        key: filters.sort || 'startTime',
        order: sortOrder === 'ASC' ? 'asc' : 'desc',
      },
      filters: {
        includeDeleted,
        includePoints,
      },
    });
  } catch (error) {
    console.error('GET /api/admin/routes failed', error);
    res.status(500).json({ error: 'Failed to fetch admin routes' });
  }
});

app.get('/api/admin/routes/:id', ensureAuth, async (req, res) => {
  if (!ensureAdminRequest(req, res)) {
    return;
  }
  const routeId = req.params.id;
  if (!routeId) {
    return res.status(400).json({ error: 'Route id is required' });
  }
  try {
    const result = await pool.query(
      `SELECT
         r.*,
         u.id AS owner_id,
         u.nickname AS owner_nickname,
         u.avatar AS owner_avatar,
         u.gender AS owner_gender,
         u.age_range AS owner_age_range,
         u.identity_label AS owner_identity_label
       FROM routes r
       LEFT JOIN users u ON u.id = r.user_id
       WHERE r.id = $1`,
      [routeId]
    );
    if (!result.rows.length) {
      return res.status(404).json({ error: 'Route not found' });
    }
    const pointsMap = await getPointsByRoute([routeId]);
    const route = mapRouteRow(result.rows[0], pointsMap[routeId] || [], {
      includeOwner: true,
      includePointSummary: true,
      includeStatsSummary: true,
    });
    res.json(route);
  } catch (error) {
    console.error('GET /api/admin/routes/:id failed', error);
    res.status(500).json({ error: 'Failed to fetch route detail' });
  }
});

app.post('/api/admin/routes', ensureAuth, async (req, res) => {
  if (!ensureAdminRequest(req, res)) {
    return;
  }
  const payload = { ...(req.body || {}) };
  if (!Array.isArray(payload.points)) {
    return res.status(400).json({ error: 'points array is required' });
  }
  const routeId =
    payload.id ||
    payload.routeId ||
    (typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : crypto.randomBytes(16).toString('hex'));
  payload.id = routeId;
  try {
    await persistRouteWithPoints(payload, { actingUserId: null, allowOwnerOverride: true });
    res.status(201).json({ id: routeId });
  } catch (error) {
    console.error('POST /api/admin/routes failed', error);
    const message = error?.message || 'Failed to save route';
    const normalized = message.toLowerCase();
    const isInputError =
      normalized.includes('required') ||
      normalized.includes('array') ||
      normalized.includes('owner') ||
      normalized.includes('points') ||
      normalized.includes('invalid');
    res.status(isInputError ? 400 : 500).json({ error: message });
  }
});

app.patch('/api/admin/routes/:id', ensureAuth, async (req, res) => {
  if (!ensureAdminRequest(req, res)) {
    return;
  }
  const routeId = req.params.id;
  if (!routeId) {
    return res.status(400).json({ error: 'Route id is required' });
  }
  const payload = { ...(req.body || {}) };
  if (payload.restore === true && payload.deletedAt === undefined) {
    payload.deletedAt = null;
  }
  if (Array.isArray(payload.points)) {
    try {
      await persistRouteWithPoints(
        { ...payload, id: routeId },
        { actingUserId: null, allowOwnerOverride: true }
      );
      return res.json({ id: routeId, pointsUpdated: true });
    } catch (error) {
      console.error('PATCH /api/admin/routes/:id failed to persist points', error);
      const message = error?.message || 'Failed to update route';
      const normalized = message.toLowerCase();
      const isInputError =
        normalized.includes('required') ||
        normalized.includes('array') ||
        normalized.includes('owner') ||
        normalized.includes('points') ||
        normalized.includes('invalid');
      return res.status(isInputError ? 400 : 500).json({ error: message });
    }
  }
  try {
    const result = await applyRoutePatch(routeId, payload, { isAdmin: true });
    if (!result) {
      return res.status(404).json({ error: 'Route not found' });
    }
    res.json({ id: result.id });
  } catch (error) {
    console.error('PATCH /api/admin/routes/:id failed', error);
    const message = error?.message || 'Failed to update route';
    const normalized = message.toLowerCase();
    const isInputError =
      normalized.includes('no updatable') || normalized.includes('required');
    res.status(isInputError ? 400 : 500).json({ error: message });
  }
});

app.post('/api/admin/routes/bulk-delete', ensureAuth, async (req, res) => {
  if (!ensureAdminRequest(req, res)) {
    return;
  }
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
        `UPDATE routes
         SET deleted_at = NOW(), updated_at = NOW()
         WHERE id = ANY($1::text[])`,
        [ids]
      );
    }
    res.json({
      ids,
      hardDelete,
      count: ids.length,
    });
  } catch (error) {
    console.error('POST /api/admin/routes/bulk-delete failed', error);
    res.status(500).json({ error: 'Failed to delete routes' });
  }
});

app.post('/api/admin/routes/export', ensureAuth, async (req, res) => {
  if (!ensureAdminRequest(req, res)) {
    return;
  }
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
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="routes-export-${label}.csv"`
      );
      res.send(csv);
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
        { header: 'Point Count', key: 'pointCount', width: 12 },
        { header: 'Privacy', key: 'privacyLevel', width: 12 },
        { header: 'Created At', key: 'createdAt', width: 20 },
        { header: 'Updated At', key: 'updatedAt', width: 20 },
      ];
      for (const route of items) {
        const statSummary = route.statSummary || {};
        sheet.addRow({
          id: route.id,
          ownerId: route.ownerId ?? route.userId ?? null,
          title: route.title,
          startTime: route.startTime ? new Date(route.startTime) : null,
          endTime: route.endTime ? new Date(route.endTime) : null,
          distance:
            statSummary.distance ?? route.stats?.distance ?? route.stats?.distance_m ?? null,
          duration:
            statSummary.duration ?? route.stats?.duration ?? route.stats?.duration_s ?? null,
          calories:
            statSummary.calories ?? route.stats?.calories ?? route.stats?.calories_kcal ?? null,
          pointCount: route.pointCount ?? (Array.isArray(route.points) ? route.points.length : null),
          privacyLevel: route.privacyLevel,
          createdAt: route.createdAt ? new Date(route.createdAt) : null,
          updatedAt: route.updatedAt ? new Date(route.updatedAt) : null,
        });
      }
      const buffer = await workbook.xlsx.writeBuffer();
      res.setHeader(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      );
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="routes-export-${label}.xlsx"`
      );
      res.send(Buffer.from(buffer));
      return;
    }
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="routes-export-${label}.json"`
    );
    res.send(
      JSON.stringify(
        {
          items,
          count: items.length,
          total,
          includePoints,
          generatedAt: Date.now(),
        },
        null,
        2
      )
    );
  } catch (error) {
    console.error('POST /api/admin/routes/export failed', error);
    res.status(500).json({ error: 'Failed to export routes' });
  }
});

app.get('/api/admin/users', ensureAuth, async (req, res) => {
  if (!ensureAdminRequest(req, res)) {
    return;
  }
  const pagination = normalizePagination(req.query.page, req.query.pageSize);
  const filters = {
    search: req.query.search || req.query.keyword,
    minRoutes: req.query.minRoutes,
    maxRoutes: req.query.maxRoutes,
    minDistance: req.query.minDistance,
    maxDistance: req.query.maxDistance,
    activeSince: req.query.activeSince || req.query.from,
    activeUntil: req.query.activeUntil || req.query.to,
    requireRoutes: parseBooleanFlag(req.query.requireRoutes || req.query.withRoutes),
    sort: req.query.sort,
    order: req.query.order,
  };
  if (parseBooleanFlag(req.query.includeEmpty)) {
    filters.requireRoutes = false;
  }
  try {
    const { items, total } = await fetchAdminUsers({
      filters,
      pagination,
    });
    const sortOrder = normalizeSortOrder(filters.order || req.query.order || 'desc', 'desc');
    res.json({
      items,
      pagination: {
        page: pagination.page,
        pageSize: pagination.pageSize,
        total,
      },
      sort: {
        key: filters.sort || 'lastActive',
        order: sortOrder === 'ASC' ? 'asc' : 'desc',
      },
    });
  } catch (error) {
    console.error('GET /api/admin/users failed', error);
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

app.get('/api/admin/users/:id', ensureAuth, async (req, res) => {
  if (!ensureAdminRequest(req, res)) {
    return;
  }
  const userId = req.params.id;
  if (!userId) {
    return res.status(400).json({ error: 'User id is required' });
  }
  const includeRoutes = !parseBooleanFlag(req.query.simple);
  const routeLimit = Math.max(Math.min(Number(req.query.routeLimit) || 50, 500), 1);
  try {
    const detail = await fetchAdminUserDetail(userId, {
      includeRoutes,
      routeLimit,
    });
    if (!detail) {
      return res.status(404).json({ error: 'User not found' });
    }
    res.json(detail);
  } catch (error) {
    console.error('GET /api/admin/users/:id failed', error);
    res.status(500).json({ error: 'Failed to fetch user detail' });
  }
});

app.get('/api/admin/analytics/summary', ensureAuth, async (req, res) => {
  if (!ensureAdminRequest(req, res)) {
    return;
  }
  const rangeDays = Number(req.query.rangeDays || req.query.range || 30);
  try {
    const summary = await computeAdminAnalyticsSummary(rangeDays);
    res.json(summary);
  } catch (error) {
    console.error('GET /api/admin/analytics/summary failed', error);
    res.status(500).json({ error: 'Failed to compute analytics summary' });
  }
});

app.get('/api/admin/analytics/timeseries', ensureAuth, async (req, res) => {
  if (!ensureAdminRequest(req, res)) {
    return;
  }
  const rangeDays = Number(req.query.rangeDays || req.query.range || 30);
  try {
    const series = await computeAdminAnalyticsTimeseries(rangeDays);
    res.json(series);
  } catch (error) {
    console.error('GET /api/admin/analytics/timeseries failed', error);
    res.status(500).json({ error: 'Failed to load analytics timeseries' });
  }
});

app.get('/api/admin/analytics/collection-distribution', ensureAuth, async (req, res) => {
  if (!ensureAdminRequest(req, res)) {
    return;
  }
  const rangeDays = Number(req.query.rangeDays || req.query.range || 30);
  try {
    const distribution = await computeCollectionDistribution(rangeDays);
    res.json(distribution);
  } catch (error) {
    console.error('GET /api/admin/analytics/collection-distribution failed', error);
    res.status(500).json({ error: 'Failed to compute collection distribution' });
  }
});

app.get('/api/admin/analytics/quality', ensureAuth, async (req, res) => {
  if (!ensureAdminRequest(req, res)) {
    return;
  }
  try {
    const metrics = await fetchRouteQualityMetrics();
    res.json(metrics);
  } catch (error) {
    console.error('GET /api/admin/analytics/quality failed', error);
    res.status(500).json({ error: 'Failed to load quality metrics' });
  }
});

app.get('/api/admin/announcements', ensureAuth, async (req, res) => {
  if (!ensureAdminRequest(req, res)) {
    return;
  }
  const pagination = normalizePagination(req.query.page, req.query.pageSize);
  const rawStatus = typeof req.query.status === 'string' ? req.query.status.trim().toLowerCase() : '';
  const params = [];
  let whereClause = '';
  if (rawStatus && ANNOUNCEMENT_STATUS_VALUES.has(rawStatus)) {
    params.push(rawStatus);
    whereClause = 'WHERE status = $1';
  }

  const listQuery = `
    SELECT *
    FROM announcements
    ${whereClause}
    ORDER BY publish_at DESC NULLS LAST, created_at DESC
    LIMIT $${params.length + 1}
    OFFSET $${params.length + 2}
  `;

  const countQuery = `
    SELECT COUNT(*) AS total
    FROM announcements
    ${whereClause}
  `;

  try {
    const [listResult, countResult] = await Promise.all([
      pool.query(listQuery, [...params, pagination.limit, pagination.offset]),
      pool.query(countQuery, params),
    ]);
    res.json({
      items: listResult.rows.map(mapAnnouncementRow),
      pagination: {
        page: pagination.page,
        pageSize: pagination.pageSize,
        total: Number(countResult.rows?.[0]?.total || 0),
      },
    });
  } catch (error) {
    console.error('GET /api/admin/announcements failed', error);
    res.status(500).json({ error: 'Failed to fetch announcements' });
  }
});

app.post('/api/admin/announcements', ensureAuth, async (req, res) => {
  if (!ensureAdminRequest(req, res)) {
    return;
  }
  const body = req.body || {};
  const title = typeof body.title === 'string' ? body.title.trim() : '';
  const content = typeof body.body === 'string' ? body.body.trim() : '';
  if (!title || !content) {
    return res.status(400).json({ error: 'Title and body are required' });
  }

  let status =
    typeof body.status === 'string' && body.status.trim()
      ? body.status.trim().toLowerCase()
      : 'draft';
  if (!ANNOUNCEMENT_STATUS_VALUES.has(status)) {
    status = 'draft';
  }

  let publishAt = null;
  if (body.publishAt) {
    const candidate = Number(body.publishAt);
    let date = null;
    if (Number.isFinite(candidate) && candidate > 0) {
      date = new Date(candidate);
    } else if (typeof body.publishAt === 'string') {
      const parsed = new Date(body.publishAt);
      if (!Number.isNaN(parsed.getTime())) {
        date = parsed;
      }
    }
    if (date && !Number.isNaN(date.getTime())) {
      publishAt = date;
    }
  }
  if (status === 'published' && !publishAt) {
    publishAt = new Date();
  }

  try {
    const result = await pool.query(
      `
        INSERT INTO announcements (title, body, status, publish_at)
        VALUES ($1, $2, $3, $4)
        RETURNING *
      `,
      [title, content, status, publishAt]
    );
    res.status(201).json(mapAnnouncementRow(result.rows[0]));
  } catch (error) {
    console.error('POST /api/admin/announcements failed', error);
    res.status(500).json({ error: 'Failed to create announcement' });
  }
});

app.patch('/api/admin/announcements/:id', ensureAuth, async (req, res) => {
  if (!ensureAdminRequest(req, res)) {
    return;
  }
  const id = Number(req.params.id);
  if (!Number.isFinite(id) || id <= 0) {
    return res.status(400).json({ error: 'Invalid announcement id' });
  }
  const body = req.body || {};
  const fields = [];
  const params = [];

  if (Object.prototype.hasOwnProperty.call(body, 'title')) {
    const title = typeof body.title === 'string' ? body.title.trim() : '';
    if (!title) {
      return res.status(400).json({ error: 'Title is required' });
    }
    params.push(title);
    fields.push(`title = $${params.length}`);
  }

  if (Object.prototype.hasOwnProperty.call(body, 'body')) {
    const content = typeof body.body === 'string' ? body.body.trim() : '';
    if (!content) {
      return res.status(400).json({ error: 'Body is required' });
    }
    params.push(content);
    fields.push(`body = $${params.length}`);
  }

  if (Object.prototype.hasOwnProperty.call(body, 'status')) {
    let status =
      typeof body.status === 'string' && body.status.trim()
        ? body.status.trim().toLowerCase()
        : '';
    if (status && !ANNOUNCEMENT_STATUS_VALUES.has(status)) {
      return res.status(400).json({ error: 'Invalid status value' });
    }
    if (status) {
      params.push(status);
      fields.push(`status = $${params.length}`);
    }
  }

  if (Object.prototype.hasOwnProperty.call(body, 'publishAt')) {
    let publishAt = null;
    if (body.publishAt) {
      const candidate = Number(body.publishAt);
      let date = null;
      if (Number.isFinite(candidate) && candidate > 0) {
        date = new Date(candidate);
      } else if (typeof body.publishAt === 'string') {
        const parsed = new Date(body.publishAt);
        if (!Number.isNaN(parsed.getTime())) {
          date = parsed;
        }
      }
      if (date && !Number.isNaN(date.getTime())) {
        publishAt = date;
      }
    }
    params.push(publishAt);
    fields.push(`publish_at = $${params.length}`);
  }

  if (!fields.length) {
    return res.status(400).json({ error: 'No updatable fields provided' });
  }

  fields.push('updated_at = NOW()');

  const query = `
    UPDATE announcements
    SET ${fields.join(', ')}
    WHERE id = $${params.length + 1}
    RETURNING *
  `;

  try {
    const result = await pool.query(query, [...params, id]);
    if (!result.rows.length) {
      return res.status(404).json({ error: 'Announcement not found' });
    }
    res.json(mapAnnouncementRow(result.rows[0]));
  } catch (error) {
    console.error('PATCH /api/admin/announcements/:id failed', error);
    res.status(500).json({ error: 'Failed to update announcement' });
  }
});

app.delete('/api/admin/announcements/:id', ensureAuth, async (req, res) => {
  if (!ensureAdminRequest(req, res)) {
    return;
  }
  const id = Number(req.params.id);
  if (!Number.isFinite(id) || id <= 0) {
    return res.status(400).json({ error: 'Invalid announcement id' });
  }
  try {
    const result = await pool.query('DELETE FROM announcements WHERE id = $1', [id]);
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Announcement not found' });
    }
    res.status(204).end();
  } catch (error) {
    console.error('DELETE /api/admin/announcements/:id failed', error);
    res.status(500).json({ error: 'Failed to delete announcement' });
  }
});

app.get('/api/admin/maintenance/backups', ensureAuth, async (req, res) => {
  if (!ensureAdminRequest(req, res)) {
    return;
  }
  try {
    const backups = await listAvailableBackups();
    res.json({
      backups: backups.map((item) => ({
        filename: item.filename,
        bytes: item.bytes,
        modifiedAt: item.modifiedAt,
        downloadPath: `/api/admin/maintenance/backup/${encodeURIComponent(item.filename)}`,
      })),
    });
  } catch (error) {
    console.error('GET /api/admin/maintenance/backups failed', error);
    res.status(500).json({ error: 'Failed to list backups' });
  }
});

app.post('/api/admin/maintenance/backup', ensureAuth, async (req, res) => {
  if (!ensureAdminRequest(req, res)) {
    return;
  }
  const inline = parseBooleanFlag(req.body?.inline);
  try {
    const snapshot = await buildBackupSnapshot();
    const meta = await saveBackupToDisk(snapshot);
    const tableCounts = Object.entries(snapshot.tables || {}).reduce((acc, [key, rows]) => {
      acc[key] = Array.isArray(rows) ? rows.length : 0;
      return acc;
    }, {});
    const response = {
      filename: meta.filename,
      bytes: meta.bytes,
      generatedAt: snapshot.generatedAt,
      tableCounts,
      downloadPath: `/api/admin/maintenance/backup/${encodeURIComponent(meta.filename)}`,
    };
    if (inline) {
      response.snapshot = snapshot;
    }
    res.json(response);
  } catch (error) {
    console.error('POST /api/admin/maintenance/backup failed', error);
    res.status(500).json({ error: 'Failed to create backup' });
  }
});

app.get('/api/admin/maintenance/backup/:filename', ensureAuth, async (req, res) => {
  if (!ensureAdminRequest(req, res)) {
    return;
  }
  const filename = req.params.filename;
  if (!filename) {
    return res.status(400).json({ error: 'Filename is required' });
  }
  const cleanName = path.basename(filename);
  const filepath = path.join(BACKUP_STORAGE_PATH, cleanName);
  try {
    await fs.promises.access(filepath, fs.constants.R_OK);
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${cleanName}"`);
    const stream = fs.createReadStream(filepath);
    stream.on('error', (error) => {
      console.error('Failed to stream backup file', error);
      if (!res.headersSent) {
        res.status(500).end('Failed to read backup file');
      } else {
        res.destroy(error);
      }
    });
    stream.pipe(res);
  } catch (error) {
    if (error.code === 'ENOENT') {
      return res.status(404).json({ error: 'Backup not found' });
    }
    console.error('GET /api/admin/maintenance/backup/:filename failed', error);
    res.status(500).json({ error: 'Failed to download backup' });
  }
});

app.post('/api/admin/maintenance/restore', ensureAuth, async (req, res) => {
  if (!ensureAdminRequest(req, res)) {
    return;
  }
  const body = req.body || {};
  const mode = String(body.mode || 'append').toLowerCase() === 'replace' ? 'replace' : 'append';
  try {
    let snapshot = null;
    if (body.filename) {
      snapshot = await loadBackupFromDisk(body.filename);
    } else if (body.snapshot) {
      snapshot = body.snapshot;
    } else if (body.data) {
      snapshot = body.data;
    } else if (body.tables) {
      snapshot = body;
    } else {
      return res.status(400).json({ error: 'Backup payload is required' });
    }
    await restoreBackupSnapshot(snapshot, { mode });
    res.json({
      restored: true,
      mode,
      tables: Object.keys(snapshot.tables || {}),
    });
  } catch (error) {
    console.error('POST /api/admin/maintenance/restore failed', error);
    res.status(500).json({ error: 'Failed to restore backup' });
  }
});

app.get('/api/metrics/daily', ensureAuth, async (req, res) => {
  try {
    const from = parseTimestamp(req.query.from);
    const to = parseTimestamp(req.query.to);
    const isAdmin = req.role === 'admin';
    const wantsAll = isAdmin && parseBooleanFlag(req.query.all);

    if (isAdmin && !wantsAll) {
      return res
        .status(400)
        .json({ error: 'Admin requests must include all=1 to fetch all metrics' });
    }

    const params = [];
    const conditions = [];

    if (wantsAll) {
      const targetUserId = req.query.userId;
      if (targetUserId !== undefined) {
        const numericUserId = Number(targetUserId);
        if (Number.isNaN(numericUserId)) {
          return res.status(400).json({ error: 'Invalid userId filter' });
        }
        params.push(numericUserId);
        conditions.push(`user_id = $${params.length}`);
      }
    } else {
      params.push(req.userId);
      conditions.push(`user_id = $${params.length}`);
      conditions.push('deleted_at IS NULL');
    }

    if (from) {
      params.push(from);
      conditions.push(`start_time >= $${params.length}`);
    }
    if (to) {
      params.push(to);
      conditions.push(`start_time <= $${params.length}`);
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const result = await pool.query(
      `SELECT
         date_trunc('day', start_time) AS day,
         COUNT(*) AS routes_count,
         COALESCE(SUM((stats->>'distance')::numeric), 0) AS total_distance,
         COALESCE(SUM((stats->>'duration')::numeric), 0) AS total_duration,
         COALESCE(SUM((stats->>'calories')::numeric), 0) AS total_calories
       FROM routes
       ${where}
       GROUP BY day
       ORDER BY day DESC
       LIMIT 60`,
      params
    );
    const metrics = result.rows.map((row) => ({
      date: row.day ? row.day.getTime() : null,
      routes: Number(row.routes_count || 0),
      totalDistance: Number(row.total_distance || 0),
      totalDuration: normalizeDurationAggregate(row.total_duration),
      totalCalories: Number(row.total_calories || 0),
    }));
    res.json(metrics);
  } catch (error) {
    console.error('GET /api/metrics/daily failed', error);
    res.status(500).json({ error: 'Failed to fetch metrics' });
  }
});

app.get('/api/geocode/regeo', ensureAuth, async (req, res) => {
  const latitude = normalizeCoordinate(req.query.lat, { min: -90, max: 90 });
  const longitude = normalizeCoordinate(req.query.lon, { min: -180, max: 180 });
  const radius = req.query.radius ? Number(req.query.radius) : 60;
  if (latitude === null || longitude === null) {
    return res.status(400).json({ error: 'Invalid coordinates' });
  }
  const cacheKey = buildGeocodeCacheKey('regeo', latitude, longitude, `r${Math.round(radius) || 0}`);
  try {
    const cached = getGeocodeCacheEntry(cacheKey);
    if (cached) {
      return res.json({ ...cached, _proxy: { cached: true, ttl: GEOCODE_CACHE_TTL_MS } });
    }
    const payload = await fetchAmapRegeo({
      latitude,
      longitude,
      radius,
      extensions: req.query.extensions || 'all',
    });
    setGeocodeCacheEntry(cacheKey, payload);
    res.json({ ...payload, _proxy: { cached: false, ttl: GEOCODE_CACHE_TTL_MS } });
  } catch (error) {
    console.error('GET /api/geocode/regeo failed', error);
    const status = error.statusCode || 502;
    res.status(status).json({ error: 'Failed to reverse geocode location' });
  }
});

app.get('/api/geocode/around', ensureAuth, async (req, res) => {
  const latitude = normalizeCoordinate(req.query.lat, { min: -90, max: 90 });
  const longitude = normalizeCoordinate(req.query.lon, { min: -180, max: 180 });
  if (latitude === null || longitude === null) {
    return res.status(400).json({ error: 'Invalid coordinates' });
  }
  const radius = req.query.radius ? Number(req.query.radius) : 80;
  const extraKey = [
    `r${Math.round(radius) || 0}`,
    req.query.types ? `t:${req.query.types}` : '',
    req.query.keywords ? `k:${req.query.keywords}` : '',
  ]
    .filter(Boolean)
    .join('|');
  const cacheKey = buildGeocodeCacheKey('around', latitude, longitude, extraKey);
  try {
    const cached = getGeocodeCacheEntry(cacheKey);
    if (cached) {
      return res.json({ ...cached, _proxy: { cached: true, ttl: GEOCODE_CACHE_TTL_MS } });
    }
    const payload = await fetchAmapAround({
      latitude,
      longitude,
      radius,
      types: req.query.types || '',
      keywords: req.query.keywords || '',
      sortrule: req.query.sortrule || 'distance',
      offset: req.query.offset ? Number(req.query.offset) : 20,
    });
    setGeocodeCacheEntry(cacheKey, payload);
    res.json({ ...payload, _proxy: { cached: false, ttl: GEOCODE_CACHE_TTL_MS } });
  } catch (error) {
    console.error('GET /api/geocode/around failed', error);
    const status = error.statusCode || 502;
    res.status(status).json({ error: 'Failed to fetch nearby POI' });
  }
});

app.get('/api/admin/geocode/metrics', ensureAuth, async (req, res) => {
  if (req.role !== 'admin') {
    return res.status(403).json({ error: 'Forbidden' });
  }
  try {
    res.json({
      cacheHits: geocodeMetrics.cacheHits,
      cacheMisses: geocodeMetrics.cacheMisses,
      amapRequests: geocodeMetrics.amapRequests,
      amapErrors: geocodeMetrics.amapErrors,
      namingLevels: geocodeMetrics.namingLevels,
      cacheSize: geocodeCache.size,
      ttlMs: GEOCODE_CACHE_TTL_MS,
      gridSize: GEOCODE_CACHE_GRID_SIZE,
      lastResetAt: geocodeMetrics.lastResetAt,
      updatedAt: Date.now(),
    });
  } catch (error) {
    console.error('GET /api/admin/geocode/metrics failed', error);
    res.status(500).json({ error: 'Failed to read geocode metrics' });
  }
});

app.get('/api/announcements/latest', ensureAuth, async (req, res) => {
  try {
    const result = await pool.query(
      `
        SELECT *
        FROM announcements
        WHERE status = 'published'
          AND (publish_at IS NULL OR publish_at <= NOW())
        ORDER BY publish_at DESC NULLS LAST, created_at DESC
        LIMIT 1
      `
    );
    if (!result.rows.length) {
      return res.status(204).end();
    }
    res.json(mapAnnouncementRow(result.rows[0]));
  } catch (error) {
    console.error('GET /api/announcements/latest failed', error);
    res.status(500).json({ error: 'Failed to fetch latest announcement' });
  }
});

app.get('/api/weather', ensureAuth, async (req, res) => {
  const latitude = normalizeCoordinate(req.query.lat, { min: -90, max: 90 });
  const longitude = normalizeCoordinate(req.query.lon, { min: -180, max: 180 });
  if (latitude === null || longitude === null) {
    return res.status(400).json({ error: 'Invalid coordinates' });
  }
  try {
    const [weather, air] = await Promise.all([
      fetchWeatherSnapshot(latitude, longitude),
      fetchAirQualitySnapshot(latitude, longitude).catch(() => ({
        aqi: null,
        pm25: null,
        pm10: null,
      })),
    ]);
    const aqiMeta = describeAqi(air.aqi);
    res.json({
      temperature: Number.isFinite(weather.temperature) ? Number(weather.temperature) : null,
      apparentTemperature: Number.isFinite(weather.apparentTemperature)
        ? Number(weather.apparentTemperature)
        : null,
      humidity: Number.isFinite(weather.humidity) ? Number(weather.humidity) : null,
      windSpeed: Number.isFinite(weather.windSpeed) ? Number(weather.windSpeed) : null,
      windDirection: Number.isFinite(weather.windDirection)
        ? Number(weather.windDirection)
        : null,
      weatherCode: weather.weatherCode,
      weatherText: describeWeather(weather.weatherCode),
      airQuality: {
        aqi: air.aqi !== null && air.aqi !== undefined ? Number(air.aqi) : null,
        level: aqiMeta.level,
        category: aqiMeta.category,
        pm25: air.pm25 !== null && air.pm25 !== undefined ? Number(air.pm25) : null,
        pm10: air.pm10 !== null && air.pm10 !== undefined ? Number(air.pm10) : null,
      },
      fetchedAt: weather.fetchedAt,
      suggestion: buildExerciseSuggestion({
        temperature: weather.temperature,
        aqi: air.aqi,
        weatherCode: weather.weatherCode,
        windSpeed: weather.windSpeed,
        humidity: weather.humidity,
      }),
    });
  } catch (error) {
    console.error('GET /api/weather failed', error);
    const status = error.statusCode || 502;
    res.status(status).json({ error: 'Failed to fetch weather data' });
  }
});

app.get('/api/geocode/reverse', ensureAuth, async (req, res) => {
  const latitude = normalizeCoordinate(req.query.lat, { min: -90, max: 90 });
  const longitude = normalizeCoordinate(req.query.lon, { min: -180, max: 180 });
  if (latitude === null || longitude === null) {
    return res.status(400).json({ error: 'Invalid coordinates' });
  }
  try {
    const cacheKey = buildGeocodeCacheKey('legacy-regeo', latitude, longitude, 'simple');
    const cached = getGeocodeCacheEntry(cacheKey);
    if (cached) {
      return res.json(cached);
    }
    let payload;
    try {
      payload = await fetchAmapRegeo({ latitude, longitude, radius: 60, extensions: 'all' });
    } catch (amapError) {
      console.warn('Legacy /api/geocode/reverse falling back to Nominatim', amapError.message);
      const fallback = await reverseGeocode(latitude, longitude);
      setGeocodeCacheEntry(cacheKey, fallback);
      return res.json(fallback);
    }
    const regeocode = payload.regeocode || {};
    const address = regeocode.addressComponent || {};
    const name =
      regeocode.formatted_address ||
      (Array.isArray(regeocode.aois) && regeocode.aois[0]?.name) ||
      (Array.isArray(regeocode.pois) && regeocode.pois[0]?.name) ||
      regeocode.road || address.neighborhood || address.district || address.city || '未知地点';
    const simplified = {
      name,
      displayName: regeocode.formatted_address || name,
      address: address,
      raw: payload,
    };
    setGeocodeCacheEntry(cacheKey, simplified);
    res.json(simplified);
  } catch (error) {
    console.error('GET /api/geocode/reverse failed', error);
    const fallbackLabel = buildCoordinateLabel(latitude, longitude);
    const fallbackPayload = {
      name: fallbackLabel,
      displayName: fallbackLabel,
      address: { latitude, longitude },
      raw: null,
      fallback: true,
    };
    res.status(200).json(fallbackPayload);
  }
});

// 404
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Listen
async function startServer() {
  try {
    await ensureDatabaseReady();
    app.listen(PORT, () => {
      console.log(`RouteLab API listening on port ${PORT}`);
    });
  } catch (error) {
    console.error('Failed to initialize server', error);
    process.exit(1);
  }
}

startServer();
