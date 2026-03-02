const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const supertest = require('supertest');
const jwt = require('jsonwebtoken');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret';
process.env.ADMIN_USER = process.env.ADMIN_USER || 'admin';
process.env.ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';
process.env.STORAGE_LOCAL_PATH = process.env.STORAGE_LOCAL_PATH || path.join(__dirname, '.tmp', 'uploads');
process.env.BACKUP_STORAGE_PATH = process.env.BACKUP_STORAGE_PATH || path.join(__dirname, '.tmp', 'backups');
process.env.STORAGE_BASE_URL = process.env.STORAGE_BASE_URL || 'https://example.test/static/uploads';

const db = require('../src/db/index');
db.ensureDatabaseReady = async () => {};
db.pool.query = async () => ({ rows: [] });

const routeModel = require('../src/models/routeModel');
routeModel.getPublicRoutes = async () => [];
routeModel.getPointsByRoute = async () => ({});
routeModel.getRoutesByUserId = async () => [];
routeModel.getRouteById = async () => null;
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
  const response = await request
    .get('/api/routes')
    .set('Authorization', `Bearer ${signUserToken('user-42')}`);

  assert.equal(response.status, 200);
  assert.deepEqual(response.body, { items: [], total: 0 });
});

test('POST /api/upload returns 400 when file is missing', async () => {
  const response = await request.post('/api/upload');
  assert.equal(response.status, 400);
  assert.equal(response.body.error, 'No file uploaded');
});

test('POST /api/upload returns file metadata', async () => {
  fs.mkdirSync(process.env.STORAGE_LOCAL_PATH, { recursive: true });
  const filePath = path.join(__dirname, 'upload-fixture.txt');
  fs.writeFileSync(filePath, 'route-upload-smoke-test', 'utf8');

  const response = await request
    .post('/api/upload')
    .attach('file', filePath);

  assert.equal(response.status, 200);
  assert.equal(response.body.originalName, 'upload-fixture.txt');
  assert.equal(typeof response.body.filename, 'string');
  assert.equal(typeof response.body.url, 'string');
  assert.match(response.body.url, /^https:\/\/example\.test\/static\/uploads\//);

  fs.rmSync(filePath, { force: true });
});
