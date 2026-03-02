const { buildUrl } = require('./api');
const auth = require('./auth');
const logger = require('../utils/logger');

let config;
try {
  config = require('../config/saaa-config');
} catch (err) {
  logger.warn('Failed to load saaa-config, using defaults', err?.message || err);
  config = {
    api: {
      uploadEndpoint: '/upload',
      staticBase: '',
    },
  };
}

const UPLOAD_ENDPOINT = config?.api?.uploadEndpoint || '/upload';
const STATIC_BASE = config?.api?.staticBase || '';

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

function uploadSinglePhoto(photo, attempt = 1, maxAttempts = 3) {
  if (!photo || !photo.path) {
    return Promise.resolve(photo);
  }
  if (photo.path.startsWith('http://') || photo.path.startsWith('https://')) {
    return Promise.resolve(photo);
  }
  if (!wx.uploadFile) {
    const error = new Error('wx.uploadFile is not available');
    error.code = 'UPLOAD_NOT_SUPPORTED';
    logger.warn('Photo upload not supported', { code: error.code });
    return Promise.reject(error);
  }

  const url = buildUrl(UPLOAD_ENDPOINT);
  logger.info('Photo upload URL', { url, endpoint: UPLOAD_ENDPOINT });

  if (!url) {
    const error = new Error('Upload endpoint URL is not configured');
    error.code = 'UPLOAD_URL_MISSING';
    logger.warn('Photo upload URL missing', { endpoint: UPLOAD_ENDPOINT });
    return Promise.reject(error);
  }

  return auth
    .ensureLogin()
    .then(() =>
      new Promise((resolve, reject) => {
        const headers = {};
        const authorization = auth.getAuthorizationHeader();
        if (authorization) {
          headers.Authorization = authorization;
        }

        logger.info('Photo upload request', {
          attempt,
          url,
          hasAuth: !!authorization,
          filePath: photo.path,
        });

        wx.uploadFile({
          url,
          filePath: photo.path,
          name: 'file',
          header: headers,
          success: (res) => {
            const payload = parseUploadResponse(res);

            if (payload?.url) {
              logger.info('Photo uploaded successfully', {
                attempt,
                path: photo.path,
                uploadedUrl: payload.url,
                statusCode: res.statusCode,
              });
              resolve({
                ...photo,
                path: toAbsoluteUrl(payload.url),
                uploaded: true,
              });
              return;
            }

            const error = new Error('Server response missing URL');
            error.code = 'UPLOAD_INVALID_RESPONSE';
            error.response = res;
            logger.warn('Upload photo failed: invalid response', {
              attempt,
              error: error.message,
              statusCode: res.statusCode,
              responseData: res.data,
            });
            reject(error);
          },
          fail: (err) => {
            const error = new Error(err?.errMsg || err?.message || 'Upload failed');
            error.code = 'UPLOAD_NETWORK_ERROR';
            error.originalError = err;
            logger.warn('Upload photo failed: network error', {
              attempt,
              error: error.message,
              errMsg: err?.errMsg,
              errCode: err?.errCode,
            });
            reject(error);
          },
        });
      })
    )
    .catch((err) => {
      logger.warn('Photo upload error caught', {
        attempt,
        maxAttempts,
        errorCode: err?.code,
        errorMessage: err?.message || err?.errMsg,
      });

      if (attempt < maxAttempts) {
        logger.info('Retrying photo upload', {
          attempt: attempt + 1,
          maxAttempts,
          path: photo.path,
        });
        const delayMs = Math.pow(2, attempt - 1) * 1000;
        return new Promise((resolve) => setTimeout(resolve, delayMs)).then(() =>
          uploadSinglePhoto(photo, attempt + 1, maxAttempts)
        );
      }

      logger.warn('Upload photo failed after all retries', {
        attempts: maxAttempts,
        path: photo.path,
        error: err?.errMsg || err?.message || err,
        errorCode: err?.code,
      });
      const finalError = new Error(
        `Photo upload failed after ${maxAttempts} attempts: ${err?.message || err?.errMsg || 'Unknown error'}`
      );
      finalError.code = err?.code || 'UPLOAD_FAILED';
      finalError.originalError = err;
      finalError.attempts = maxAttempts;
      return Promise.reject(finalError);
    });
}

function ensureRemotePhotos(photos = []) {
  if (!Array.isArray(photos) || photos.length === 0) {
    return Promise.resolve([]);
  }

  logger.info('ensureRemotePhotos called', { photoCount: photos.length });
  return Promise.all(photos.map((item) => uploadSinglePhoto(item || {})));
}

module.exports = {
  ensureRemotePhotos,
};
