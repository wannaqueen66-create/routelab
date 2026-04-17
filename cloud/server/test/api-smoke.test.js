const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const supertest = require('supertest');
const jwt = require('jsonwebtoken');

process.env.NODE_ENV = process.env.NODE_ENV || 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret';
process.env.ADMIN_USER = process.env.ADMIN_USER || 'admin';
process.env.ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';
process.env.STORAGE_LOCAL_PATH = process.env.STORAGE_LOCAL_PATH || path.join(__dirname, '.tmp', 'uploads');
process.env.BACKUP_STORAGE_PATH = process.env.BACKUP_STORAGE_PATH || path.join(__dirname, '.tmp', 'backups');
process.env.STORAGE_BASE_URL = process.env.STORAGE_BASE_URL || 'https://example.test/static/uploads';
process.env.PUBLIC_APP_BASE_URL = process.env.PUBLIC_APP_BASE_URL || 'https://example.test';

const db = require('../src/db/index');
db.ensureDatabaseReady = async () => {};

let mockSurveyCompletionRow = null;
let insertedSurveyCompletion = null;

db.pool.query = async (sql, params = []) => {
  const normalized = String(sql || '').replace(/\s+/g, ' ').trim().toLowerCase();
  if (normalized.includes('from survey_completions')) {
    return { rows: mockSurveyCompletionRow ? [mockSurveyCompletionRow] : [] };
  }
  if (normalized.includes('insert into survey_completions')) {
    insertedSurveyCompletion = { sql, params };
    mockSurveyCompletionRow = {
      survey_key: params[1],
      survey_version: params[2],
      respondent_id: params[3],
      response_status: params[4],
      completed_at: params[5],
      updated_at: params[5],
    };
    return { rows: [] };
  }
  return { rows: [] };
};

const routeModel = require('../src/models/routeModel');

let mockPublicRoutes = [];
let mockPointsByRoute = {};
let mockRoutesByUserId = [];
let mockRouteById = null;

routeModel.getPublicRoutes = async () => mockPublicRoutes;
routeModel.getPointsByRoute = async () => mockPointsByRoute;
routeModel.getRoutesByUserId = async () => mockRoutesByUserId;
routeModel.getRouteById = async () => mockRouteById;
routeModel.createRoute = async (userId, route) => ({
  id: route.id,
  user_id: userId,
  client_id: route.clientId || null,
  name: route.name || null,
  activity_type: route.activityType || 'walk',
  purpose_code: route.purposeCode || null,
  privacy_level: route.privacyLevel || 'private',
  start_time: route.startTime || null,
  end_time: route.endTime || null,
  stats: route.stats || {},
  meta: route.meta || {},
  photos: route.photos || [],
  weather: route.weather || null,
  created_at: new Date(),
  updated_at: new Date(),
  deleted_at: null,
});
routeModel.updateRoute = async (id, userId, patch) => ({
  id,
  user_id: userId,
  client_id: null,
  name: patch.name || 'patched',
  activity_type: patch.activityType || 'walk',
  purpose_code: patch.purposeCode || null,
  privacy_level: patch.privacyLevel || 'private',
  start_time: null,
  end_time: null,
  stats: patch.stats || {},
  meta: patch.meta || {},
  photos: patch.photos || [],
  weather: null,
  created_at: new Date(),
  updated_at: new Date(),
  deleted_at: null,
});
routeModel.softDeleteRoute = async () => false;
routeModel.addLike = async () => ({});
routeModel.removeLike = async () => ({});
routeModel.addComment = async () => ({ id: 'comment-1', created_at: new Date() });
routeModel.getCommentsByRouteId = async () => [];
routeModel.softDeleteComment = async () => false;
routeModel.fetchRouteSocialStats = async () => ({ likes: 0, comments: 0, liked: false });
routeModel.getRouteForSocial = async () => null;

const { app, registerRoutes } = require('../src/server');
registerRoutes(app);
const request = supertest(app);

function signUserToken(userId = 'user-1') {
  return jwt.sign({ sub: userId, role: 'user' }, process.env.JWT_SECRET);
}

test('GET /api/user/surveys/powercx/status returns incomplete payload by default', async () => {
  mockSurveyCompletionRow = null;

  const response = await request
    .get('/api/user/surveys/powercx/status')
    .set('Authorization', `Bearer ${signUserToken('42')}`);

  assert.equal(response.status, 200);
  assert.equal(response.body.surveyKey, 'powercx');
  assert.equal(response.body.currentVersionCompleted, false);
  assert.equal(response.body.surveyVersion, 'powercx-kjzqe-v1');
});

test('POST /api/user/surveys/powercx/session returns survey start url', async () => {
  const response = await request
    .post('/api/user/surveys/powercx/session')
    .set('Authorization', `Bearer ${signUserToken('42')}`)
    .send({ source: 'home_hero' });

  assert.equal(response.status, 200);
  assert.equal(response.body.surveyKey, 'powercx');
  assert.match(response.body.startUrl, /^https:\/\/example\.test\/api\/public\/surveys\/powercx\/start\?state=/);
});

test('GET /api/public/surveys/powercx/start redirects to PowerCX and sets cookie', async () => {
  const sessionResponse = await request
    .post('/api/user/surveys/powercx/session')
    .set('Authorization', `Bearer ${signUserToken('42')}`)
    .send({ source: 'home_hero' });
  const startUrl = new URL(sessionResponse.body.startUrl);
  const state = startUrl.searchParams.get('state');

  const response = await request.get(`/api/public/surveys/powercx/start?state=${encodeURIComponent(state)}`);

  assert.equal(response.status, 302);
  assert.match(response.headers.location, /^https:\/\/www\.powercx\.com\/r\/6zl8y\?/);
  assert.match(response.headers.location, /userId=42/);
  assert.match(response.headers.location, /source=home_hero/);
  assert.ok(Array.isArray(response.headers['set-cookie']));
  assert.match(response.headers['set-cookie'][0], /rlab_powercx_state=/);
});

test('GET /api/public/surveys/powercx/complete stores completion for current user', async () => {
  mockSurveyCompletionRow = null;
  insertedSurveyCompletion = null;

  const sessionResponse = await request
    .post('/api/user/surveys/powercx/session')
    .set('Authorization', `Bearer ${signUserToken('42')}`)
    .send({ source: 'home_hero' });
  const startUrl = new URL(sessionResponse.body.startUrl);
  const state = startUrl.searchParams.get('state');

  const response = await request
    .get('/api/public/surveys/powercx/complete?respondentId=resp-001&status=complete')
    .set('Cookie', `rlab_powercx_state=${encodeURIComponent(state)}`);

  assert.equal(response.status, 200);
  assert.match(response.text, /问卷结果已同步/);
  assert.ok(insertedSurveyCompletion);
  assert.equal(String(insertedSurveyCompletion.params[0]), '42');
  assert.equal(insertedSurveyCompletion.params[1], 'powercx');
  assert.equal(insertedSurveyCompletion.params[2], 'powercx-kjzqe-v1');
  assert.equal(insertedSurveyCompletion.params[3], 'resp-001');
  assert.equal(insertedSurveyCompletion.params[4], 'complete');

  const statusResponse = await request
    .get('/api/user/surveys/powercx/status')
    .set('Authorization', `Bearer ${signUserToken('42')}`);

  assert.equal(statusResponse.status, 200);
  assert.equal(statusResponse.body.currentVersionCompleted, true);
  assert.equal(statusResponse.body.respondentId, 'resp-001');
  assert.equal(statusResponse.body.responseStatus, 'complete');
});

test('GET /api/ping returns ok payload', async () => {
  const response = await request.get('/api/ping');
  assert.equal(response.status, 200);
  assert.equal(response.body.status, 'ok');
  assert.equal(typeof response.body.time, 'number');
});

test('GET /api/routes requires auth', async () => {
  const response = await request.get('/api/routes');
  assert.equal(response.status, 401);
  assert.equal(response.body.error, 'Unauthorized');
});

test('GET /api/routes returns empty list for valid token', async () => {
  mockRoutesByUserId = [];
  mockPointsByRoute = {};

  const response = await request
    .get('/api/routes')
    .set('Authorization', `Bearer ${signUserToken('user-42')}`);

  assert.equal(response.status, 200);
  assert.deepEqual(response.body, { items: [], total: 0 });
});

test('POST /api/upload requires auth', async () => {
  const response = await request.post('/api/upload');
  assert.equal(response.status, 401);
  assert.equal(response.body.error, 'Unauthorized');
});

test('POST /api/upload returns 400 when authenticated request is missing file', async () => {
  const response = await request
    .post('/api/upload')
    .set('Authorization', `Bearer ${signUserToken('user-upload-1')}`);
  assert.equal(response.status, 400);
  assert.equal(response.body.error, 'No file uploaded');
});

test('POST /api/routes/sync returns sync payload', async () => {
  const now = Date.now();
  mockRoutesByUserId = [
    {
      id: 'route-sync-1',
      user_id: 42,
      client_id: 'local-1',
      name: 'Sync Route',
      activity_type: 'walk',
      purpose_code: null,
      privacy_level: 'private',
      start_time: new Date(now - 60 * 1000),
      end_time: new Date(now - 30 * 1000),
      stats: { distance: 120 },
      meta: { activityType: 'walk' },
      photos: [],
      weather: null,
      created_at: new Date(now - 60 * 1000),
      updated_at: new Date(now + 10 * 1000),
      deleted_at: null,
    },
  ];
  mockPointsByRoute = {
    'route-sync-1': [{ latitude: 31.2, longitude: 121.5, altitude: null, timestamp: new Date(now - 50 * 1000) }],
  };

  const response = await request
    .post('/api/routes/sync')
    .set('Authorization', `Bearer ${signUserToken('42')}`)
    .send({ lastSyncAt: now - 3600 * 1000, knownRemoteIds: ['route-sync-1', 'route-missing-2'] });

  assert.equal(response.status, 200);
  assert.ok(Array.isArray(response.body.items));
  assert.equal(response.body.items.length, 1);
  assert.equal(response.body.items[0].id, 'route-sync-1');
  assert.ok(Array.isArray(response.body.missingRemoteIds));
  assert.equal(response.body.missingRemoteIds.includes('route-missing-2'), true);
  assert.equal(response.body.hasMore, false);
  assert.equal(response.body.nextCursor, null);
});

test('POST /api/routes/sync supports cursor pagination', async () => {
  const now = Date.now();
  mockRoutesByUserId = [
    {
      id: 'route-page-2',
      user_id: 42,
      client_id: 'local-2',
      name: 'Route Page 2',
      activity_type: 'walk',
      purpose_code: null,
      privacy_level: 'private',
      start_time: new Date(now - 120000),
      end_time: new Date(now - 90000),
      stats: { distance: 220 },
      meta: { activityType: 'walk' },
      photos: [],
      weather: null,
      created_at: new Date(now - 120000),
      updated_at: new Date(now + 2000),
      deleted_at: null,
    },
    {
      id: 'route-page-3',
      user_id: 42,
      client_id: 'local-3',
      name: 'Route Page 3',
      activity_type: 'walk',
      purpose_code: null,
      privacy_level: 'private',
      start_time: new Date(now - 60000),
      end_time: new Date(now - 30000),
      stats: { distance: 320 },
      meta: { activityType: 'walk' },
      photos: [],
      weather: null,
      created_at: new Date(now - 60000),
      updated_at: new Date(now + 3000),
      deleted_at: null,
    },
  ];
  mockPointsByRoute = {
    'route-page-2': [{ latitude: 31.21, longitude: 121.51, altitude: null, timestamp: new Date(now - 110000) }],
    'route-page-3': [{ latitude: 31.22, longitude: 121.52, altitude: null, timestamp: new Date(now - 50000) }],
  };

  const response = await request
    .post('/api/routes/sync')
    .set('Authorization', `Bearer ${signUserToken('42')}`)
    .send({ lastSyncAt: now - 3600 * 1000, limit: 1, cursor: 0 });

  assert.equal(response.status, 200);
  assert.equal(response.body.items.length, 1);
  assert.equal(response.body.items[0].id, 'route-page-2');
  assert.equal(response.body.hasMore, true);
  assert.equal(response.body.nextCursor, 1);
});

test('PUT /api/routes/:id upserts route and returns payload', async () => {
  mockRouteById = null;

  const response = await request
    .put('/api/routes/route-upsert-1')
    .set('Authorization', `Bearer ${signUserToken('88')}`)
    .send({
      id: 'route-upsert-1',
      title: 'Upsert Route',
      activityType: 'walk',
      privacyLevel: 'private',
      points: [{ latitude: 31.2, longitude: 121.5, timestamp: Date.now() }],
      stats: { distance: 50 },
      meta: { activityType: 'walk' },
      photos: [],
    });

  assert.equal(response.status, 201);
  assert.equal(response.body.upserted, 'created');
  assert.ok(response.body.route);
  assert.equal(response.body.route.id, 'route-upsert-1');
});

test('POST /api/upload returns file metadata', async () => {
  fs.mkdirSync(process.env.STORAGE_LOCAL_PATH, { recursive: true });
  const filePath = path.join(__dirname, 'upload-fixture.txt');
  fs.writeFileSync(filePath, 'route-upload-smoke-test', 'utf8');

  const response = await request
    .post('/api/upload')
    .set('Authorization', `Bearer ${signUserToken('user-upload-2')}`)
    .attach('file', filePath);

  assert.equal(response.status, 200);
  assert.equal(response.body.originalName, 'upload-fixture.txt');
  assert.equal(typeof response.body.filename, 'string');
  assert.equal(typeof response.body.url, 'string');
  assert.match(response.body.url, /^https:\/\/example\.test\/static\/uploads\//);

  fs.rmSync(filePath, { force: true });
});
