const { buildUrl } = require('./api');
const auth = require('./auth');
const logger = require('../utils/logger');

// Use try-catch to handle config loading failures gracefully
let config;
try {
  config = require('../config/saaa-config');
} catch (err) {
  console.warn('[MEDIA] Failed to load saaa-config, using defaults', err?.message || err);
  logger.warn('Failed to load saaa-config, using defaults', err?.message || err);
  config = {
    api: {
      uploadEndpoint: '/photos',
      staticBase: '',
    }
  };
}

const UPLOAD_ENDPOINT = config?.api?.uploadEndpoint || '/photos';
const STATIC_BASE = config?.api?.staticBase || '';

// Startup marker to confirm this code is loaded
console.log('[MEDIA] ========== MEDIA MODULE LOADED ==========');
console.log('[MEDIA] Upload endpoint:', UPLOAD_ENDPOINT);
console.log('[MEDIA] Static base:', STATIC_BASE);

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
  console.log('[MEDIA] uploadSinglePhoto called', { attempt, photoPath: photo?.path });

  if (!photo || !photo.path) {
    return Promise.resolve(photo);
  }
  if (photo.path.startsWith('http://') || photo.path.startsWith('https://')) {
    console.log('[MEDIA] Photo already uploaded, skipping');
    return Promise.resolve(photo);
  }
  if (!wx.uploadFile) {
    const error = new Error('wx.uploadFile is not available');
    error.code = 'UPLOAD_NOT_SUPPORTED';
    console.error('[MEDIA] wx.uploadFile NOT AVAILABLE!');
    logger.warn('Photo upload not supported', { code: error.code });
    return Promise.reject(error);
  }

  const url = buildUrl(UPLOAD_ENDPOINT);
  console.log('[MEDIA] Photo upload URL built', { url, endpoint: UPLOAD_ENDPOINT });
  logger.info('Photo upload URL', { url, endpoint: UPLOAD_ENDPOINT });

  if (!url) {
    const error = new Error('Upload endpoint URL is not configured');
    error.code = 'UPLOAD_URL_MISSING';
    console.error('[MEDIA] Upload URL is NULL!', { endpoint: UPLOAD_ENDPOINT });
    logger.warn('Photo upload URL missing', { endpoint: UPLOAD_ENDPOINT });
    return Promise.reject(error);
  }
  return auth
    .ensureLogin()
    .then(
      () => {
        console.log('[MEDIA] Starting upload attempt', { attempt, url });
        logger.info('Starting photo upload attempt', { attempt, path: photo.path, url });
        return new Promise((resolve, reject) => {
          const headers = {};
          const authorization = auth.getAuthorizationHeader();
          if (authorization) {
            headers.Authorization = authorization;
          }

          console.log('[MEDIA] Calling wx.uploadFile', {
            attempt,
            url,
            hasAuth: !!authorization,
            filePath: photo.path
          });
          logger.info('Photo upload request', {
            attempt,
            url,
            hasAuth: !!authorization,
            filePath: photo.path
          });

          wx.uploadFile({
            url,
            filePath: photo.path,
            name: 'file',
            header: headers,
            success: (res) => {
              console.log('[MEDIA] wx.uploadFile SUCCESS!', {
                statusCode: res.statusCode,
                dataType: typeof res.data
              });
              logger.info('Photo upload wx.uploadFile success callback', {
                attempt,
                statusCode: res.statusCode,
                dataType: typeof res.data,
                dataLength: res.data?.length
              });

              const payload = parseUploadResponse(res);

              if (payload?.url) {
                console.log('[MEDIA] Photo uploaded successfully!', { uploadedUrl: payload.url });
                logger.info('Photo uploaded successfully', {
                  attempt,
                  path: photo.path,
                  uploadedUrl: payload.url
                });
                resolve({
                  ...photo,
                  path: toAbsoluteUrl(payload.url),
                  uploaded: true,
                });
              } else {
                const error = new Error('Server response missing URL');
                error.code = 'UPLOAD_INVALID_RESPONSE';
                error.response = res;
                console.error('[MEDIA] Upload FAILED - Invalid response!', {
                  statusCode: res.statusCode,
                  responseData: res.data
                });
                logger.warn('Upload photo failed: invalid response', {
                  attempt,
                  error: error.message,
                  statusCode: res.statusCode,
                  responseData: res.data
                });
                reject(error);
              }
            },
            fail: (err) => {
              const error = new Error(err?.errMsg || err?.message || 'Upload failed');
              error.code = 'UPLOAD_NETWORK_ERROR';
              error.originalError = err;
              console.error('[MEDIA] wx.uploadFile FAILED!', {
                errMsg: err?.errMsg,
                errCode: err?.errCode
              });
              logger.warn('Upload photo failed: network error', {
                attempt,
                error: error.message,
                errMsg: err?.errMsg,
                errCode: err?.errCode
              });
              reject(error);
            },
          });
        });
      }
    )
    .catch((err) => {
      logger.warn('Photo upload error caught', {
        attempt,
        maxAttempts,
        errorCode: err?.code,
        errorMessage: err?.message || err?.errMsg
      });

      // Retry logic
      if (attempt < maxAttempts) {
        logger.info('Retrying photo upload', { attempt: attempt + 1, maxAttempts, path: photo.path });
        // Exponential backoff: wait 1s, 2s between retries
        const delayMs = Math.pow(2, attempt - 1) * 1000;
        return new Promise((resolve) => setTimeout(resolve, delayMs))
          .then(() => uploadSinglePhoto(photo, attempt + 1, maxAttempts));
      }

      // Final failure after all retries
      logger.warn('Upload photo failed after all retries', {
        attempts: maxAttempts,
        path: photo.path,
        error: err?.errMsg || err?.message || err,
        errorCode: err?.code
      });
      const finalError = new Error(`Photo upload failed after ${maxAttempts} attempts: ${err?.message || err?.errMsg || 'Unknown error'}`);
      finalError.code = err?.code || 'UPLOAD_FAILED';
      finalError.originalError = err;
      finalError.attempts = maxAttempts;
      return Promise.reject(finalError);
    });
}

function ensureRemotePhotos(photos = []) {
  console.log('[MEDIA] ========== ensureRemotePhotos CALLED ==========');
  console.log('[MEDIA] Photo count:', photos?.length || 0);
  console.log('[MEDIA] Photos:', photos);

  if (!Array.isArray(photos) || photos.length === 0) {
    console.log('[MEDIA] No photos to upload, returning empty array');
    return Promise.resolve([]);
  }

  logger.info('ensureRemotePhotos called', { photoCount: photos.length });

  console.log('[MEDIA] Starting Promise.all for', photos.length, 'photos');
  return Promise.all(photos.map((item) => uploadSinglePhoto(item || {})));
}

module.exports = {
  ensureRemotePhotos,
};
