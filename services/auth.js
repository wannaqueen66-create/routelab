const config = require('../config/saaa-config');
const logger = require('../utils/logger');
const {
  getAuthToken,
  setAuthToken,
  clearAuthToken,
  getLastSyncTimestamp,
  clearLastSyncTimestamp,
  setLastSyncTimestamp,
  getUserAccount,
  saveUserAccount,
  clearUserAccount,
} = require('../utils/storage');

const DEFAULT_TIMEOUT = config.api?.timeout || 15000;

function getBaseUrl() {
  const base = config.api?.baseUrl || config.apiBaseUrl || '';
  if (!base) {
    return '';
  }
  return base.endsWith('/') ? base.slice(0, -1) : base;
}

function buildUrl(path = '') {
  if (!path) {
    return getBaseUrl();
  }
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${getBaseUrl()}${normalizedPath}`;
}

let loginPromise = null;

function resolveLoginPromise(data) {
  loginPromise = null;
  return data;
}

function rejectLoginPromise(error) {
  loginPromise = null;
  return Promise.reject(error);
}

function persistAuthPayload(payload = {}) {
  if (!payload.token) {
    throw new Error('Login response missing token');
  }
  setAuthToken(payload.token);
  if (payload.user) {
    saveUserAccount(payload.user);
  } else {
    clearUserAccount();
  }
  if (payload.lastSyncAt) {
    setLastSyncTimestamp(payload.lastSyncAt);
  } else if (!getLastSyncTimestamp()) {
    setLastSyncTimestamp(Date.now());
  }
  return payload;
}

function requestWeChatLogin(code) {
  const url = buildUrl('/login/wechat');
  if (!url) {
    return Promise.reject(new Error('Cloud API base URL is not configured'));
  }
  return new Promise((resolve, reject) => {
    wx.request({
      url,
      method: 'POST',
      data: { code },
      timeout: DEFAULT_TIMEOUT,
      header: {
        'Content-Type': 'application/json',
      },
      success: (res) => {
        const statusCode = res.statusCode || 0;
        if (statusCode >= 200 && statusCode < 300 && res.data) {
          resolve(res.data);
          return;
        }
        const error = new Error(`Login failed with status ${statusCode}`);
        error.statusCode = statusCode;
        error.response = res.data;
        reject(error);
      },
      fail: (err) => reject(err),
    });
  }).then(persistAuthPayload);
}

function runLogin() {
  if (loginPromise) {
    return loginPromise;
  }
  loginPromise = new Promise((resolve, reject) => {
    wx.login({
      success: ({ code }) => {
        if (!code) {
          reject(new Error('微信登录未返回 code'));
          return;
        }
        requestWeChatLogin(code)
          .then(resolve)
          .catch(reject);
      },
      fail: (err) => reject(err),
    });
  })
    .then((payload) => {
      logger.info('WeChat login succeeded', { hasToken: Boolean(payload?.token) });
      return resolveLoginPromise(payload);
    })
    .catch((error) => {
      logger.warn('WeChat login failed', error?.errMsg || error?.message || error);
      clearAuthToken();
      return rejectLoginPromise(error);
    });
  return loginPromise;
}

function ensureLogin(force = false) {
  const token = getAuthToken();
  const account = getUserAccount();
  if (token && !force) {
    if (account && Number.isFinite(Number(account.id))) {
      return Promise.resolve({ token, user: account });
    }
    return runLogin();
  }
  return runLogin();
}

function refreshToken() {
  clearAuthToken();
  clearLastSyncTimestamp();
  clearUserAccount();
  return ensureLogin(true);
}

function getToken() {
  return getAuthToken();
}

function setToken(token) {
  setAuthToken(token);
  return token;
}

function clearToken() {
  clearAuthToken();
  clearLastSyncTimestamp();
  clearUserAccount();
}

function getAuthorizationHeader() {
  const token = getToken();
  return token ? `Bearer ${token}` : '';
}

module.exports = {
  ensureLogin,
  refreshToken,
  getToken,
  setToken,
  clearToken,
  getAuthorizationHeader,
  getBaseUrl,
  buildUrl,
};
