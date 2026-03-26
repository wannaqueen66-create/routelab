import axios from 'axios';

const SESSION_STORAGE_KEY = 'routelab.session';
const LEGACY_TOKEN_KEY = 'routelab.token';

const getStorage = () => {
  if (typeof sessionStorage !== 'undefined') {
    return sessionStorage;
  }
  return null;
};

const resolveApiBaseUrl = () => {
  if (
    typeof __ROUTELAB_API_BASE_URL__ !== 'undefined' &&
    __ROUTELAB_API_BASE_URL__
  ) {
    return __ROUTELAB_API_BASE_URL__;
  }

  if (typeof globalThis !== 'undefined') {
    const fromGlobal = globalThis.__ROUTELAB_API_BASE_URL__;
    if (fromGlobal) {
      return fromGlobal;
    }
  }

  if (typeof process !== 'undefined' && process.env && process.env.VITE_API_BASE_URL) {
    return process.env.VITE_API_BASE_URL;
  }

  return 'http://localhost:4000/api';
};

const API_BASE_URL = resolveApiBaseUrl();

const readInitialSession = () => {
  const storage = getStorage();
  if (!storage) {
    return { token: '', role: 'user' };
  }

  const raw = storage.getItem(SESSION_STORAGE_KEY);
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      const token = typeof parsed.token === 'string' ? parsed.token : '';
      const role =
        typeof parsed.role === 'string' && parsed.role ? parsed.role : 'user';
      return { token, role };
    } catch (error) {
      console.warn('Failed to parse stored session', error);
    }
  }

  if (typeof localStorage !== 'undefined') {
    const legacyToken = localStorage.getItem(LEGACY_TOKEN_KEY);
    if (legacyToken) {
      localStorage.removeItem(LEGACY_TOKEN_KEY);
      return { token: legacyToken, role: 'user' };
    }
  }

  return { token: '', role: 'user' };
};

let session = readInitialSession();

const persistSession = () => {
  const storage = getStorage();
  if (!storage) {
    return;
  }

  if (session.token) {
    storage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
  } else {
    storage.removeItem(SESSION_STORAGE_KEY);
  }
  if (typeof localStorage !== 'undefined') {
    localStorage.removeItem(LEGACY_TOKEN_KEY);
  }
};

export function setSession(nextSession) {
  const token =
    typeof nextSession?.token === 'string' ? nextSession.token : '';
  const role =
    typeof nextSession?.role === 'string' && nextSession.role
      ? nextSession.role
      : 'user';
  session = { token, role };
  persistSession();
}

export function getSession() {
  return { ...session };
}

export function setAuthToken(nextToken) {
  setSession({ ...session, token: nextToken || '' });
}

export function getAuthToken() {
  return session.token;
}

export function getAuthRole() {
  return session.role;
}

export function clearSession(options = {}) {
  session = { token: '', role: 'user' };
  persistSession();
  if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
    window.dispatchEvent(
      new CustomEvent('routelab:auth-cleared', {
        detail: {
          reason: options.reason || '',
          message: options.message || '',
        },
      })
    );
  }
}

const client = axios.create({
  baseURL: API_BASE_URL,
  timeout: 12000,
});

client.interceptors.request.use((config) => {
  if (session.token) {
    config.headers.Authorization = `Bearer ${session.token}`;
  }
  return config;
});

client.interceptors.response.use(
  (response) => response,
  (error) => {
    const status = error?.response?.status;
    const serverMessage = error?.response?.data?.error || '';
    if ((status === 401 || status === 403) && session.token) {
      clearSession({
        reason: status === 401 ? 'unauthorized' : 'forbidden',
        message: serverMessage || '登录状态已失效，请重新登录',
      });
    }
    return Promise.reject(error);
  }
);

export async function loginAdmin(credentials) {
  const response = await client.post('/login/admin', credentials);
  return response.data;
}

export async function fetchRoutes(params = {}) {
  const response = await client.get('/routes', { params });
  return response.data;
}

export async function fetchDailyMetrics(params = {}) {
  const response = await client.get('/metrics/daily', { params });
  return response.data;
}

export async function fetchAdminRoutes(params = {}) {
  const response = await client.get('/admin/routes', { params });
  return response.data;
}

export async function fetchUserManagedRoutes(params = {}) {
  const response = await client.get('/user/routes/manage', { params });
  return response.data;
}

export async function fetchAdminRouteDetail(id) {
  if (!id) throw new Error('Route id is required');
  const response = await client.get(`/admin/routes/${id}`);
  return response.data;
}

export async function fetchRouteDetail(id) {
  if (!id) throw new Error('Route id is required');
  const response = await client.get(`/routes/${id}`);
  return response.data;
}

export async function createAdminRoute(payload) {
  const response = await client.post('/admin/routes', payload);
  return response.data;
}

export async function updateAdminRoute(id, payload) {
  if (!id) throw new Error('Route id is required');
  const response = await client.patch(`/admin/routes/${id}`, payload);
  return response.data;
}

export async function upsertAdminRoute(id, payload) {
  if (!id) throw new Error('Route id is required');
  const response = await client.patch(`/admin/routes/${id}`, payload);
  return response.data;
}

export async function bulkDeleteRoutes(payload) {
  const response = await client.post('/admin/routes/bulk-delete', payload);
  return response.data;
}

export async function deleteRouteById(id, options = {}) {
  if (!id) throw new Error('Route id is required');
  const response = await client.delete(`/routes/${id}`, { params: options });
  return response.data;
}

export async function exportAdminRoutes(payload = {}) {
  const response = await client.post('/admin/routes/export', payload, {
    responseType: 'blob',
  });
  const disposition = response.headers['content-disposition'] || '';
  let filename = `routes-export-${Date.now()}.dat`;
  const match = disposition.match(/filename="?([^"]+)"?/i);
  if (match && match[1]) {
    filename = decodeURIComponent(match[1]);
  }
  return {
    blob: response.data,
    filename,
    contentType: response.headers['content-type'],
  };
}

export async function fetchAdminUsers(params = {}) {
  const response = await client.get('/admin/users', { params });
  return response.data;
}

export async function fetchAdminUserDetail(id, params = {}) {
  if (!id) throw new Error('User id is required');
  const response = await client.get(`/admin/users/${id}`, { params });
  return response.data;
}

export async function updateAdminUser(id, payload = {}) {
  if (!id) throw new Error('User id is required');
  const response = await client.patch(`/admin/users/${id}`, payload);
  return response.data;
}

export async function updateAdminUserAchievements(id, payload = {}) {
  if (!id) throw new Error('User id is required');
  const response = await client.patch(`/admin/users/${id}/achievements`, payload);
  return response.data;
}

export async function fetchAdminAnalyticsSummary(params = {}) {
  const response = await client.get('/admin/analytics/summary', { params });
  return response.data;
}

export async function fetchAdminAnalyticsTimeseries(params = {}) {
  const response = await client.get('/admin/analytics/timeseries', { params });
  return response.data;
}

export async function fetchAdminCollectionDistribution(params = {}) {
  const response = await client.get('/admin/analytics/collection-distribution', {
    params,
  });
  return response.data;
}

export async function fetchAdminQualityMetrics(params = {}) {
  const response = await client.get('/admin/analytics/quality', { params });
  return response.data;
}

export async function fetchAdminPurposeDistribution(params = {}) {
  const response = await client.get('/admin/analytics/purpose-distribution', {
    params,
  });
  return response.data;
}

export async function fetchAdminFeedbackAnalytics(params = {}) {
  const response = await client.get('/admin/analytics/feedback', { params });
  return response.data;
}

export async function fetchAdminRouteFeedbackSummary(params = {}) {
  const response = await client.get('/admin/analytics/route-feedback-summary', {
    params,
  });
  return response.data;
}

export async function fetchAdminAnnouncements(params = {}) {
  const response = await client.get('/admin/announcements', { params });
  return response.data;
}

export async function createAdminAnnouncement(payload = {}) {
  const response = await client.post('/admin/announcements', payload);
  return response.data;
}

export async function updateAdminAnnouncement(id, payload = {}) {
  if (!id) throw new Error('Announcement id is required');
  const response = await client.patch(`/admin/announcements/${id}`, payload);
  return response.data;
}

export async function deleteAdminAnnouncement(id) {
  if (!id) throw new Error('Announcement id is required');
  const response = await client.delete(`/admin/announcements/${id}`);
  return response.data;
}

export async function fetchLatestAnnouncement() {
  const response = await client.get('/announcements/latest');
  return response.data;
}

export async function fetchAdminFeedback(params = {}) {
  const response = await client.get('/admin/feedback', { params });
  return response.data;
}

export async function updateAdminFeedback(id, payload = {}) {
  if (!id) throw new Error('Feedback id is required');
  const response = await client.patch(`/admin/feedback/${id}`, payload);
  return response.data;
}

export async function listBackups() {
  const response = await client.get('/admin/maintenance/backups');
  return response.data;
}

export async function createBackup(options = {}) {
  const response = await client.post('/admin/maintenance/backup', options);
  return response.data;
}

export async function downloadBackup(filename) {
  if (!filename) throw new Error('Backup filename is required');
  const response = await client.get(`/admin/maintenance/backup/${encodeURIComponent(filename)}`, {
    responseType: 'blob',
  });
  return {
    blob: response.data,
    filename,
    contentType: response.headers['content-type'],
  };
}

export async function restoreBackup(payload = {}) {
  const response = await client.post('/admin/maintenance/restore', payload);
  return response.data;
}

export default client;
