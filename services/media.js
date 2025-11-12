const { buildUrl } = require('./api');
const auth = require('./auth');
const logger = require('../utils/logger');
const config = require('../config/saaa-config');

const UPLOAD_ENDPOINT = config.api?.uploadEndpoint || '/uploads';
const STATIC_BASE = config.api?.staticBase || '';

function toAbsoluteUrl(url) {
  if (!url) {
    return url;
  }
  if (url.startsWith('http://') || url.startsWith('https://')) {
    return url;
  }
  if (!STATIC_BASE) {
    return url;
  }
  const base = STATIC_BASE.endsWith('/') ? STATIC_BASE.slice(0, -1) : STATIC_BASE;
  const path = url.startsWith('/') ? url.slice(1) : url;
  return `${base}/${path}`;
}

function parseUploadResponse(res) {
  if (!res || !res.data) {
    return null;
  }
  try {
    return typeof res.data === 'string' ? JSON.parse(res.data) : res.data;
  } catch (err) {
    logger.warn('Parse upload response failed', err?.message || err);
    return null;
  }
}

function uploadSinglePhoto(photo) {
  if (!photo || !photo.path) {
    return Promise.resolve(photo);
  }
  if (photo.path.startsWith('http://') || photo.path.startsWith('https://')) {
    return Promise.resolve(photo);
  }
  if (!wx.uploadFile) {
    return Promise.resolve(photo);
  }
  const url = buildUrl(UPLOAD_ENDPOINT);
  if (!url) {
    return Promise.resolve(photo);
  }
  return auth
    .ensureLogin()
    .then(
      () =>
        new Promise((resolve) => {
          const headers = {};
          const authorization = auth.getAuthorizationHeader();
          if (authorization) {
            headers.Authorization = authorization;
          }
          wx.uploadFile({
            url,
            filePath: photo.path,
            name: 'file',
            header: headers,
            success: (res) => {
              const payload = parseUploadResponse(res);
              if (payload?.url) {
                resolve({
                  ...photo,
                  path: toAbsoluteUrl(payload.url),
                  uploaded: true,
                });
              } else {
                resolve(photo);
              }
            },
            fail: (err) => {
              logger.warn('Upload photo failed', err?.errMsg || err?.message || err);
              resolve(photo);
            },
          });
        })
    )
    .catch((err) => {
      logger.warn('Upload photo skipped', err?.errMsg || err?.message || err);
      return photo;
    });
}

function ensureRemotePhotos(photos = []) {
  if (!Array.isArray(photos) || photos.length === 0) {
    return Promise.resolve([]);
  }
  return Promise.all(photos.map((item) => uploadSinglePhoto(item || {})));
}

module.exports = {
  ensureRemotePhotos,
};
