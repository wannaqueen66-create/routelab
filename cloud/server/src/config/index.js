require('dotenv').config();
const path = require('path');

const PORT = Number(process.env.PORT) || 8080;
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
const QWEATHER_API_KEY = process.env.API_KEY || process.env.QWEATHER_API_KEY || '';
const QWEATHER_API_HOST = process.env.API_HOST || process.env.QWEATHER_API_HOST || '';
const LEGACY_QWEATHER_BASE = process.env.QWEATHER_BASE_URL || '';
const QWEATHER_BASE_URL = (() => {
  const normalizedHost = (QWEATHER_API_HOST || '').replace(/^https?:\/\//, '').replace(/\/+$/, '');
  if (normalizedHost) {
    return `https://${normalizedHost}/v7`;
  }
  if (LEGACY_QWEATHER_BASE) {
    const trimmed = LEGACY_QWEATHER_BASE.replace(/\/$/, '');
    return trimmed.endsWith('/v7') ? trimmed : `${trimmed}/v7`;
  }
  return '';
})();
const AQICN_TOKEN = process.env.AQICN_TOKEN || '';

const OPEN_METEO_WEATHER_BASE =
  (process.env.OPEN_METEO_WEATHER_BASE || 'https://api.open-meteo.com/v1/forecast').replace(
    /\/$/,
    ''
  );
const OPEN_METEO_AIR_BASE =
  (process.env.OPEN_METEO_AIR_BASE || 'https://air-quality-api.open-meteo.com/v1/air-quality').replace(
    /\/$/,
    ''
  );
const GEOCODE_OSM_BASE_URL =
  (process.env.GEOCODE_OSM_BASE_URL || 'https://nominatim.openstreetmap.org').replace(/\/$/, '');
const GEOCODE_OSM_USER_AGENT = process.env.GEOCODE_OSM_USER_AGENT || WEATHER_USER_AGENT;

const ACTIVITY_TYPE_DEFINITIONS = {
  walk: { key: 'walk', label: '步行' },
  run: { key: 'run', label: '跑步' },
  ride: { key: 'ride', label: '骑行' },
};
const ACTIVITY_TYPE_VALUES = new Set(Object.keys(ACTIVITY_TYPE_DEFINITIONS));
const DEFAULT_ACTIVITY_TYPE = 'walk';
const PURPOSE_TYPE_DEFINITIONS = {
  basketball: { key: 'basketball', label: '篮球' },
  football: { key: 'football', label: '足球' },
  run: { key: 'run', label: '跑步' },
  badminton: { key: 'badminton', label: '羽毛球' },
  table_tennis: { key: 'table_tennis', label: '乒乓球' },
  volleyball: { key: 'volleyball', label: '排球' },
  tennis: { key: 'tennis', label: '网球' },
  swimming: { key: 'swimming', label: '游泳' },
  gym: { key: 'gym', label: '健身' },
  yoga_pilates: { key: 'yoga_pilates', label: '瑜伽 / 普拉提' },
  martial_arts: { key: 'martial_arts', label: '武术类' },
  dance: { key: 'dance', label: '舞蹈类' },
  // legacy options kept for compatibility
  walk: { key: 'walk', label: '散步' },
  ride: { key: 'ride', label: '骑行' },
  hiking: { key: 'hiking', label: '爬山' },
  other: { key: 'other', label: '其他' },
  tabletennis: { key: 'tabletennis', label: '乒乓球' },
};
const PURPOSE_TYPE_VALUES = new Set(Object.keys(PURPOSE_TYPE_DEFINITIONS));

const USER_GENDER_VALUES = new Set(['male', 'female']);
const USER_AGE_RANGE_VALUES = new Set(['under18', '18_24', '25_34', '35_44', '45_54', '55_plus']);
const USER_IDENTITY_VALUES = new Set(['minor', 'undergrad', 'postgrad', 'staff', 'resident', 'other']);
const ANNOUNCEMENT_STATUS_VALUES = new Set(['draft', 'published']);
const ANNOUNCEMENT_DELIVERY_MODE_VALUES = new Set(['single', 'persistent']);
const ANNOUNCEMENT_TARGET_AUDIENCE_VALUES = new Set(['all', 'new_users']);
const FEEDBACK_STATUS_VALUES = new Set(['open', 'in_progress', 'resolved', 'closed']);

module.exports = {
  PORT,
  JWT_SECRET,
  WECHAT_APPID,
  WECHAT_SECRET,
  ADMIN_USER,
  ADMIN_PASSWORD,
  ADMIN_PASSWORD_HASH,
  TOKEN_EXPIRES_IN,
  STORAGE_LOCAL_PATH,
  STORAGE_BASE_URL,
  BACKUP_STORAGE_PATH,
  ADMIN_EXPORT_LIMIT,
  DEFAULT_PAGE_SIZE,
  WEATHER_USER_AGENT,
  PUBLIC_ROUTE_LIMIT,
  ADMIN_LOGIN_ENABLED,
  AMAP_WEB_KEY,
  AMAP_TIMEOUT_MS,
  GEOCODE_CACHE_TTL_MS,
  GEOCODE_CACHE_GRID_SIZE,
  QWEATHER_API_KEY,
  QWEATHER_API_HOST,
  QWEATHER_BASE_URL,
  AQICN_TOKEN,
  OPEN_METEO_WEATHER_BASE,
  OPEN_METEO_AIR_BASE,
  GEOCODE_OSM_BASE_URL,
  GEOCODE_OSM_USER_AGENT,
  ACTIVITY_TYPE_DEFINITIONS,
  ACTIVITY_TYPE_VALUES,
  DEFAULT_ACTIVITY_TYPE,
  PURPOSE_TYPE_DEFINITIONS,
  PURPOSE_TYPE_VALUES,
  USER_GENDER_VALUES,
  USER_AGE_RANGE_VALUES,
  USER_IDENTITY_VALUES,
  ANNOUNCEMENT_STATUS_VALUES,
  ANNOUNCEMENT_DELIVERY_MODE_VALUES,
  ANNOUNCEMENT_TARGET_AUDIENCE_VALUES,
  FEEDBACK_STATUS_VALUES
};
