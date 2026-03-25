const {
  saveRoute: storageSaveRoute,
  getRoutes: storageGetRoutes,
  setRoutes: storageSetRoutes,
  enqueueOfflineFragment,
  clearOfflineQueue,
  getOfflineQueue,
  getLastSyncTimestamp,
  setLastSyncTimestamp,
} = require('../utils/storage');
const { calculateTotalDistance, estimateCalories } = require('../utils/geo');
const { inferActivityType } = require('../utils/activity');
const { generateRouteId } = require('../utils/id');
const { getActivityLevel } = require('./analytics');
const { formatDuration } = require('../utils/time');
const { ACTIVITY_TYPE_MAP, DEFAULT_ACTIVITY_TYPE } = require('../constants/activity');
const { PURPOSE_MAP } = require('../constants/purpose');
const api = require('./api');
const { ensureRemotePhotos } = require('./media');
const logger = require('../utils/logger');

const subscribers = new Set();
let lastSyncError = null;

function setLastSyncError(error, fallbackMessage = '同步失败，请稍后重试') {
  const message =
    (typeof error === 'string' && error) ||
    error?.errMsg ||
    error?.message ||
    fallbackMessage;
  lastSyncError = {
    message,
    at: Date.now(),
  };
}

function clearLastSyncError() {
  lastSyncError = null;
}

function normalizeRouteMetadata(route = {}, overrides = {}) {
  if (!route || typeof route !== 'object' || !route.id) {
    return null;
  }
  const base = { ...route, ...overrides };
  const deleted = base.deleted === true;
  const synced =
    deleted
      ? false
      : overrides.synced !== undefined
        ? !!overrides.synced
        : base.synced === true || base.pendingUpload === false;
  const remoteIdCandidate =
    typeof base.remoteId === 'string' && base.remoteId.trim() ? base.remoteId.trim() : null;
  const resolvedRemoteId = synced ? remoteIdCandidate || base.id : remoteIdCandidate;
  const pendingUpload =
    deleted
      ? false
      : overrides.pendingUpload !== undefined
        ? !!overrides.pendingUpload
        : !synced;
  const uploadError =
    overrides.uploadError !== undefined ? overrides.uploadError : base.uploadError || null;
  return {
    ...base,
    remoteId: resolvedRemoteId || null,
    synced,
    pendingUpload: synced ? false : pendingUpload,
    uploadError,
    deleted,
    deletedAt: deleted ? base.deletedAt || Date.now() : base.deletedAt || null,
    lastSyncedAt: synced ? base.lastSyncedAt || Date.now() : null,
  };
}

function saveRoute(route, overrides = {}) {
  const normalized = normalizeRouteMetadata(route, overrides);
  if (!normalized) {
    return null;
  }
  storageSaveRoute(normalized);
  return normalized;
}

function setRoutes(routes = []) {
  const normalized = (Array.isArray(routes) ? routes : [])
    .map((route) => normalizeRouteMetadata(route))
    .filter(Boolean);
  storageSetRoutes(normalized);
  return normalized;
}

function getRoutes(options = {}) {
  const includeDeleted = options && options.includeDeleted === true;
  const list = storageGetRoutes();
  if (!Array.isArray(list) || !list.length) {
    return [];
  }
  const normalized = list.map((route) => normalizeRouteMetadata(route)).filter(Boolean);
  if (includeDeleted) {
    return normalized;
  }
  return normalized.filter((route) => !route.deleted);
}

function updateRoute(id, patch = {}) {
  if (!id) {
    return null;
  }
  const list = storageGetRoutes();
  const index = list.findIndex((item) => item && item.id === id);
  if (index < 0) {
    return null;
  }
  const updated = normalizeRouteMetadata({ ...list[index], ...patch });
  if (!updated) {
    return null;
  }
  list.splice(index, 1, updated);
  storageSetRoutes(list);
  return updated;
}

function removeRoute(id) {
  if (!id) {
    return [];
  }
  const filtered = storageGetRoutes().filter((route) => route && route.id !== id);
  storageSetRoutes(filtered);
  return filtered;
}

function createDeletedStub(route, reason = 'remote_delete') {
  if (!route || !route.id) {
    return null;
  }
  return normalizeRouteMetadata(
    {
      id: route.id,
      remoteId: route.remoteId || route.id || null,
      title: route.title || '已删除记录',
      startTime: route.startTime || route.endTime || Date.now(),
      endTime: route.endTime || route.startTime || Date.now(),
      meta: {
        ...(route.meta || {}),
        deletedReason: reason,
      },
      stats: {},
      points: [],
      deleted: true,
      deletedAt: Date.now(),
    },
    { deleted: true, pendingUpload: false, synced: false }
  );
}

function notify() {
  const routes = getRoutes();
  subscribers.forEach((callback) => {
    try {
      callback(routes);
    } catch (err) {
      console.warn('RouteLab: route subscriber error', err);
    }
  });
}

function subscribe(callback) {
  if (typeof callback !== 'function') {
    return () => { };
  }
  subscribers.add(callback);
  try {
    callback(getRoutes());
  } catch (err) {
    console.warn('RouteLab: init subscriber failed', err);
  }
  return () => {
    subscribers.delete(callback);
  };
}

function buildRouteLogContext(route = {}) {
  return {
    id: route.id,
    title: route.title,
    startTime: route.startTime,
    endTime: route.endTime,
    activityType: route.meta?.activityType || route.activityType,
  };
}

function markRouteSyncFailed(id, error) {
  if (!id) {
    return null;
  }
  const message = error?.errMsg || error?.message || String(error);
  const patched = updateRoute(id, {
    pendingUpload: true,
    synced: false,
    uploadError: {
      message,
      statusCode: error?.statusCode || null,
      at: Date.now(),
    },
    lastSyncAttemptAt: Date.now(),
  });
  if (patched) {
    notify();
  }
  return patched;
}

function dropRouteFromLocalCache(id, { logContext = null, reason = 'upload_success' } = {}) {
  if (!id) {
    return false;
  }
  const routes = getRoutes();
  const exists = routes.some((item) => item && item.id === id);
  if (!exists) {
    return false;
  }
  try {
    removeRoute(id);
    notify();
    logger.info('Local cache route removed', {
      ...(logContext || { id }),
      reason,
    });
    return true;
  } catch (err) {
    logger.warn('Failed to remove route from local cache', {
      ...(logContext || { id }),
      reason,
      error: err?.errMsg || err?.message || err,
    });
    return false;
  }
}

function restoreRouteToLocalCache(route, options = {}) {
  const { logContext = null, reason = 'refresh_failed', overrides = {} } = options || {};
  if (!route || !route.id) {
    return false;
  }
  try {
    saveRoute({
      ...route,
      pendingUpload: overrides.pendingUpload ?? false,
      uploadError: overrides.uploadError ?? null,
      lastSyncedAt: overrides.lastSyncedAt ?? Date.now(),
      ...overrides,
    });
    notify();
    logger.info('Local cache restored', {
      ...(logContext || { id: route.id }),
      reason,
    });
    return true;
  } catch (err) {
    logger.warn('Failed to restore local cache', {
      ...(logContext || { id: route.id }),
      reason,
      error: err?.errMsg || err?.message || err,
    });
    return false;
  }
}

function normalizePhotoList(photos = []) {
  if (!photos) {
    return [];
  }
  const list = Array.isArray(photos) ? photos : [photos];
  return list
    .map((item) => {
      if (!item) {
        return null;
      }
      if (typeof item === 'string') {
        return { path: item, note: '' };
      }
      if (typeof item !== 'object') {
        return null;
      }
      const pathCandidate = item.path || item.url || item.fileId || item.tempFilePath;
      const path = typeof pathCandidate === 'string' ? pathCandidate : null;
      if (!path) {
        return null;
      }
      return {
        path,
        note: item.note || item.remark || '',
      };
    })
    .filter(Boolean);
}

function extractPhotoPath(photo) {
  if (!photo) {
    return null;
  }
  if (typeof photo === 'string') {
    return photo;
  }
  const candidate = photo.path || photo.url || photo.fileId || photo.tempFilePath;
  return typeof candidate === 'string' ? candidate : null;
}

function isRemotePhotoPath(path) {
  if (typeof path !== 'string') {
    return false;
  }
  const normalized = path.trim().toLowerCase();
  return normalized.startsWith('http://') || normalized.startsWith('https://');
}

function ensureRoutePhotosAreRemote(route) {
  console.log('[ROUTE-STORE ensureRoutePhotosAreRemote called', { routeId: route?.id, hasPhotos: !!route?.photos });

  if (!route?.photos || !route.photos.length) {
    console.log('[ROUTE-STORE] No photos in route, skipping upload');
    return Promise.resolve(route);
  }
  const normalizedPhotos = normalizePhotoList(route.photos);
  const hasLocalPhotos = normalizedPhotos.some((item) => !isRemotePhotoPath(extractPhotoPath(item)));

  console.log('[ROUTE-STORE] Photo check', { hasLocalPhotos, photoCount: normalizedPhotos.length });

  if (!hasLocalPhotos) {
    console.log('[ROUTE-STORE] All photos already remote, skipping upload');
    return Promise.resolve({ ...route, photos: normalizedPhotos });
  }

  console.log('[ROUTE-STORE] Starting photo upload for route sync', { routeId: route.id, photoCount: normalizedPhotos.length });
  logger.info('Starting photo upload for route sync', {
    routeId: route.id,
    photoCount: normalizedPhotos.length
  });

  return ensureRemotePhotos(normalizedPhotos)
    .then((uploaded) => {
      console.log('[ROUTE-STORE] Photos uploaded, processing result', { uploadedCount: uploaded?.length });

      const sanitized = normalizePhotoList(uploaded || normalizedPhotos);

      // Check if any photos failed to upload (still local)
      const stillHasLocal = sanitized.some((item) => !isRemotePhotoPath(extractPhotoPath(item)));
      if (stillHasLocal) {
        const localCount = sanitized.filter((item) => !isRemotePhotoPath(extractPhotoPath(item))).length;
        const error = new Error(`Photo upload incomplete: ${localCount} of ${sanitized.length} photos still have local paths`);
        error.code = 'PHOTO_UPLOAD_INCOMPLETE';
        error.localCount = localCount;
        error.totalCount = sanitized.length;
        console.error('[ROUTE-STORE] Photo upload incomplete!', { localCount, totalCount: sanitized.length });
        throw error;
      }

      console.log('[ROUTE-STORE] All photos uploaded successfully!', { photoCount: sanitized.length });
      logger.info('All photos uploaded successfully for route', {
        routeId: route.id,
        photoCount: sanitized.length
      });

      const patched = updateRoute(route.id, { photos: sanitized });
      console.log('[ROUTE-STORE] Route updated with remote photos', { patched: !!patched });
      if (patched) {
        notify();
        return patched;
      }
      return { ...route, photos: sanitized };
    })
    .catch((error) => {
      const errorMessage = error?.message || error?.errMsg || error;
      const errorCode = error?.code || 'UNKNOWN_ERROR';

      logger.warn('Upload photos before route sync failed', {
        id: route.id,
        error: errorMessage,
        code: errorCode,
        attempts: error?.attempts,
      });

      // Re-throw with enhanced error information
      const enhancedError = new Error(`Failed to upload photos for route sync: ${errorMessage}`);
      enhancedError.code = errorCode;
      enhancedError.routeId = route.id;
      enhancedError.originalError = error;
      throw enhancedError;
    });
}

function normalizePausePoints(points = []) {
  return points
    .map((point) => {
      if (!point) {
        return null;
      }
      if (point.latitude === undefined || point.latitude === null) {
        return null;
      }
      if (point.longitude === undefined || point.longitude === null) {
        return null;
      }
      const latitude = typeof point.latitude === 'number' ? point.latitude : Number(point.latitude);
      const longitude = typeof point.longitude === 'number' ? point.longitude : Number(point.longitude);
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
        return null;
      }
      return {
        latitude,
        longitude,
        timestamp: point.timestamp || Date.now(),
        reason: point.reason || 'unknown',
        resumeAt: point.resumeAt || null,
        gapDuration: Number.isFinite(point.gapDuration) ? Number(point.gapDuration) : null,
      };
    })
    .filter(Boolean);
}

function getMaxUpdatedAt(routes = []) {
  return routes.reduce((acc, route) => {
    const updated = Number(route?.updatedAt) || 0;
    return updated > acc ? updated : acc;
  }, 0);
}

function formatPointLabel(point) {
  if (!point) {
    return '坐标未知';
  }
  const lat = Number(point.latitude);
  const lon = Number(point.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return '坐标未知';
  }
  return `坐标 ${lat.toFixed(4)}, ${lon.toFixed(4)}`;
}

function createRoutePayload({
  points = [],
  title,
  startTime,
  endTime,
  privacyLevel = 'private',
  note,
  activityType = DEFAULT_ACTIVITY_TYPE,
  photos = [],
  pausePoints = [],
  weight = 60,
  startLocation = null,
  endLocation = null,
  startLabel,
  endLabel,
  purposeType = '',
  confirmedEndLatitude = null,
  confirmedEndLongitude = null,
  confirmedEndDistanceMeters = null,
  rawEndLatitude = null,
  rawEndLongitude = null,
  feedbackSatisfactionScore = null,
  feedbackPreferenceLabels = null,
  feedbackReasonText = null,
  feedbackSource = 'wizard',
}) {
  const effectiveWeight = weight || 60;
  const safePhotos = normalizePhotoList(photos);
  const safePausePoints = normalizePausePoints(pausePoints);
  const trimmedPurpose = typeof purposeType === 'string' ? purposeType.trim() : '';
  const normalizedPurpose = trimmedPurpose && PURPOSE_MAP[trimmedPurpose] ? trimmedPurpose : '';
  const distance = calculateTotalDistance(points);
  const duration = Math.max(0, (endTime || Date.now()) - (startTime || Date.now()));
  const speed = duration ? distance / (duration / 1000) : 0;
  const inferredActivityType = inferActivityType({ distance, duration, speed, points });
  const normalizedProvidedActivity =
    typeof activityType === 'string' && ACTIVITY_TYPE_MAP[activityType] ? activityType : null;
  const finalActivityType =
    ACTIVITY_TYPE_MAP[inferredActivityType] && points.length >= 2
      ? inferredActivityType
      : normalizedProvidedActivity || inferredActivityType || DEFAULT_ACTIVITY_TYPE;
  const calories = estimateCalories(distance, effectiveWeight, finalActivityType);
  const steps = finalActivityType === 'walk' ? Math.round(distance / 0.75) : 0;
  const baseSpeed = speed || (duration ? distance / (duration / 1000) : 0);
  const pace = finalActivityType === 'ride' || !baseSpeed ? 0 : 1000 / baseSpeed;
  const activityMeta =
    ACTIVITY_TYPE_MAP[finalActivityType] || ACTIVITY_TYPE_MAP[DEFAULT_ACTIVITY_TYPE];
  const modeLabel = activityMeta ? `${activityMeta.label}记录` : '运动轨迹';
  const activityInference = {
    source: 'client',
    computedAt: Date.now(),
    averageSpeedKmh: Number((baseSpeed * 3.6).toFixed(1)),
    distanceKm: Number((distance / 1000).toFixed(2)),
    durationMinutes: Number((duration / 60000).toFixed(1)),
  };
  const startPoint = points.length ? points[0] : null;
  const endPoint = points.length ? points[points.length - 1] : null;

  const fallbackStart = formatPointLabel(startPoint);
  const fallbackEnd = endPoint ? formatPointLabel(endPoint) : fallbackStart;

  const finalStartLabel =
    startLabel ||
    startLocation?.name ||
    startLocation?.displayName ||
    fallbackStart;
  const finalEndLabel =
    endLabel ||
    endLocation?.name ||
    endLocation?.displayName ||
    fallbackEnd;

  return {
    id: generateRouteId(),
    title: title || modeLabel,
    startTime,
    endTime,
    privacyLevel,
    note: note || '',
    purposeType: normalizedPurpose,
    campusZone: finalStartLabel,
    campusMeta: null,
    points,
    stats: {
      distance,
      duration,
      speed,
      pace,
      steps,
      calories,
    },
    meta: {
      activityType: finalActivityType,
      activityLevel: getActivityLevel({ stats: { distance, duration } }),
      durationText: formatDuration(duration),
      modeLabel,
      startLabel: finalStartLabel,
      endLabel: finalEndLabel,
      startLocation: startLocation || null,
      endLocation: endLocation || null,
      startPoint,
      endPoint,
      weight: effectiveWeight,
      pausePoints: safePausePoints,
      activityInference,
      purposeType: normalizedPurpose,
    },
    photos: safePhotos,
    confirmedEndLatitude,
    confirmedEndLongitude,
    confirmedEndDistanceMeters,
    rawEndLatitude,
    rawEndLongitude,
    feedbackSatisfactionScore,
    feedbackPreferenceLabels,
    feedbackReasonText,
    feedbackSource,
    createdAt: Date.now(),
  };
}

const ALLOWED_UPLOAD_INTERP_METHODS = new Set(['linear', 'snap_road', 'spline', 'gap_fill']);

function sanitizeTimestamp(value, fallback = null) {
  if (value === undefined || value === null) {
    return fallback ?? null;
  }
  if (value instanceof Date) {
    const time = value.getTime();
    return Number.isFinite(time) ? time : fallback ?? null;
  }
  const numeric = Number(value);
  if (Number.isFinite(numeric)) {
    return numeric;
  }
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return fallback ?? null;
}

function normalizePointSourceForUpload(value) {
  if (typeof value !== 'string') {
    return 'gps';
  }
  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return 'gps';
  }
  return normalized === 'interp' ? 'interp' : 'gps';
}

function normalizeSourceDetailForUpload(value) {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function normalizeInterpMethodForUpload(value) {
  if (typeof value !== 'string') {
    return null;
  }
  const method = value.trim().toLowerCase();
  if (!method) {
    return null;
  }
  return ALLOWED_UPLOAD_INTERP_METHODS.has(method) ? method : null;
}

function sanitizePointForUpload(point, fallbackTimestamp, previousTimestamp) {
  if (!point || typeof point !== 'object') {
    return null;
  }
  const latitude = Number(point.latitude);
  const longitude = Number(point.longitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return null;
  }
  const sanitized = {
    latitude,
    longitude,
  };
  if (Number.isFinite(Number(point.altitude))) {
    sanitized.altitude = Number(point.altitude);
  }
  if (Number.isFinite(Number(point.speed))) {
    sanitized.speed = Number(point.speed);
  }
  if (Number.isFinite(Number(point.heading))) {
    sanitized.heading = Number(point.heading);
  }
  if (Number.isFinite(Number(point.accuracy))) {
    sanitized.accuracy = Number(point.accuracy);
  }

  const timestamp = sanitizeTimestamp(point.timestamp ?? point.recordedAt ?? point.time, fallbackTimestamp ?? Date.now());
  sanitized.timestamp = timestamp !== null ? timestamp : Date.now();
  if (previousTimestamp !== null && sanitized.timestamp < previousTimestamp) {
    sanitized.timestamp = previousTimestamp;
  }

  const source = normalizePointSourceForUpload(point.source || point.sourceType);
  sanitized.source = source;
  const sourceDetail = normalizeSourceDetailForUpload(point.source_detail ?? point.sourceDetail ?? point.sourceDetailType);
  if (sourceDetail) {
    sanitized.source_detail = sourceDetail;
  }
  const interpMethod = normalizeInterpMethodForUpload(point.interp_method ?? point.interpMethod);
  if (source === 'interp' && interpMethod) {
    sanitized.interp_method = interpMethod;
  }

  return sanitized;
}

function normalizeActivityTypeForUpload(value) {
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized && ACTIVITY_TYPE_MAP[normalized]) {
      return normalized;
    }
  }
  return DEFAULT_ACTIVITY_TYPE;
}

function sanitizeRouteForUpload(route) {
  if (!route || typeof route !== 'object' || !route.id) {
    return null;
  }

  const sourcePoints = Array.isArray(route.points) ? route.points : [];
  const sanitizedPoints = [];
  let lastTimestamp = sanitizeTimestamp(route.startTime, null);
  sourcePoints.forEach((point) => {
    const sanitized = sanitizePointForUpload(point, lastTimestamp, lastTimestamp);
    if (!sanitized) {
      return;
    }
    if (lastTimestamp !== null && sanitized.timestamp < lastTimestamp) {
      sanitized.timestamp = lastTimestamp;
    }
    sanitizedPoints.push(sanitized);
    lastTimestamp = sanitized.timestamp;
  });

  const startTime = sanitizeTimestamp(route.startTime, sanitizedPoints[0]?.timestamp ?? null);
  const endTime = sanitizeTimestamp(route.endTime, sanitizedPoints[sanitizedPoints.length - 1]?.timestamp ?? startTime);
  const activityType = normalizeActivityTypeForUpload(route.meta?.activityType || route.activityType);
  const weightCandidate = Number(route.meta?.weight ?? route.weight);
  const weight = Number.isFinite(weightCandidate) && weightCandidate > 0 ? weightCandidate : 60;
  const pausePoints = Array.isArray(route.meta?.pausePoints) ? normalizePausePoints(route.meta.pausePoints) : [];

  const base = createRoutePayload({
    points: sanitizedPoints,
    title: route.title,
    startTime,
    endTime,
    privacyLevel: route.privacyLevel || 'private',
    note: route.note,
    activityType,
    photos: route.photos,
    pausePoints,
    weight,
    startLocation: route.meta?.startLocation || null,
    endLocation: route.meta?.endLocation || null,
    startLabel: route.meta?.startLabel || route.campusZone,
    endLabel: route.meta?.endLabel,
    purposeType: route.purposeType || route.meta?.purposeType || '',
  });

  const stats = { ...base.stats };
  const meta = {
    ...route.meta,
    ...base.meta,
    activityType,
    pausePoints,
    startPoint: sanitizedPoints[0] || null,
    endPoint: sanitizedPoints[sanitizedPoints.length - 1] || null,
    weight,
  };
  meta.durationText = formatDuration(stats.duration);
  if (meta.startLocation === undefined) {
    meta.startLocation = base.meta.startLocation;
  }
  if (meta.endLocation === undefined) {
    meta.endLocation = base.meta.endLocation;
  }

  const sanitizedRoute = {
    ...route,
    id: route.id,
    points: sanitizedPoints,
    stats,
    meta,
    photos: base.photos,
    campusZone: route.campusZone || base.campusZone,
    campusMeta: route.campusMeta ?? base.campusMeta,
    startTime,
    endTime,
    privacyLevel: route.privacyLevel || base.privacyLevel,
  };
  const purposeFromRoute =
    typeof route.purposeType === 'string' && PURPOSE_MAP[route.purposeType] ? route.purposeType : '';
  const purposeFromMeta =
    typeof meta.purposeType === 'string' && PURPOSE_MAP[meta.purposeType] ? meta.purposeType : '';
  const resolvedPurpose = purposeFromRoute || purposeFromMeta;
  if (resolvedPurpose) {
    sanitizedRoute.purposeType = resolvedPurpose;
    sanitizedRoute.meta.purposeType = resolvedPurpose;
  } else {
    delete sanitizedRoute.purposeType;
    if (sanitizedRoute.meta && Object.prototype.hasOwnProperty.call(sanitizedRoute.meta, 'purposeType')) {
      delete sanitizedRoute.meta.purposeType;
    }
  }

  const createdAt = sanitizeTimestamp(route.createdAt);
  if (createdAt !== null) {
    sanitizedRoute.createdAt = createdAt;
  } else {
    delete sanitizedRoute.createdAt;
  }
  const updatedAt = sanitizeTimestamp(route.updatedAt);
  if (updatedAt !== null) {
    sanitizedRoute.updatedAt = updatedAt;
  } else {
    delete sanitizedRoute.updatedAt;
  }
  const deletedAt = sanitizeTimestamp(route.deletedAt);
  if (deletedAt !== null) {
    sanitizedRoute.deletedAt = deletedAt;
  } else {
    delete sanitizedRoute.deletedAt;
  }

  return sanitizedRoute;
}

function syncRouteToCloud(route) {
  console.log('[ROUTE-STORE] ========== syncRouteToCloud CALLED ==========');
  console.log('[ROUTE-STORE] Route ID:', route?.id);
  console.log('[ROUTE-STORE] Has photos:', route?.photos?.length || 0);

  if (!route?.id) {
    console.log('[ROUTE-STORE] No route ID, skipping sync');
    return Promise.resolve();
  }

  console.log('[ROUTE-STORE] Calling ensureRoutePhotosAreRemote...');
  return ensureRoutePhotosAreRemote(route).then((preparedRoute) => {
    console.log('[ROUTE-STORE] Photos ensured, preparing route for upload');

    const target = preparedRoute || route;
    const remoteId = target.remoteId || target.id;
    const payload = sanitizeRouteForUpload({
      ...target,
      id: remoteId,
      clientId: route.id,
    });

    console.log('[ROUTE-STORE] Payload created', { hasPayload: !!payload, remoteId });
    console.log('[ROUTE-STORE] Payload details:', {
      id: payload?.id,
      clientId: payload?.clientId,
      title: payload?.title,
      photoCount: payload?.photos?.length,
      photos: payload?.photos,
      pointsCount: payload?.points?.length,
      hasStats: !!payload?.stats,
      hasMeta: !!payload?.meta
    });

    if (!payload) {
      console.error('[ROUTE-STORE] Invalid payload, cannot sync!');
      logger.warn('Route sync skipped (invalid payload)', {
        id: route?.id,
      });
      return Promise.resolve();
    }

    const request = target.remoteId ? api.upsertRoute(payload) : api.createRoute(payload);
    console.log('[ROUTE-STORE] Calling API', { method: target.remoteId ? 'upsert' : 'create' });
    return request
      .then((response) => {
        console.log('[ROUTE-STORE] API call SUCCESS!', { hasResponse: !!response });

        if (response && typeof response === 'object') {
          const syncAt = Number(response.lastSyncAt);
          if (Number.isFinite(syncAt) && syncAt > 0) {
            setLastSyncTimestamp(syncAt);
          }
        }

        console.log('[ROUTE-STORE] ✅ Route synced to cloud successfully!', { routeId: route.id });
        logger.info('Route synced to cloud', { id: route.id });

        if (response && typeof response === 'object' && response.route) {
          return { ...response.route };
        }
        return { ...route, remoteId };
      })
      .catch((err) => {
        console.error('[ROUTE-STORE] ❌ API call FAILED!', {
          error: err?.errMsg || err?.message || err,
          statusCode: err?.statusCode
        });
        logger.warn('Route sync failed', {
          id: route.id,
          error: err?.errMsg || err?.message || err,
          statusCode: err?.statusCode,
          response: err?.response,
        });
        throw err;
      });
  }).catch((err) => {
    console.error('[ROUTE-STORE] ❌ syncRouteToCloud failed!', {
      error: err?.message || err?.errMsg,
      code: err?.code
    });
    throw err;
  });
}

function syncRoutesToCloud() {
  const routes = getRoutes();
  if (!routes.length) {
    clearLastSyncError();
    return Promise.resolve([]);
  }
  const pending = routes.filter(
    (route) => route && route.pendingUpload !== false && route.deleted !== true && !route.deletedAt
  );
  if (!pending.length) {
    clearLastSyncError();
    return Promise.resolve(routes);
  }
  return Promise.allSettled(
    pending.map((route) => {
      const logContext = buildRouteLogContext(route);
      logger.info('Route upload initiated during batch sync', logContext);
      return syncRouteToCloud(route)
        .then((cloudRoute) => {
          const removed = dropRouteFromLocalCache(route.id, {
            logContext,
            reason: 'batch_upload',
          });
          if (!removed) {
            const patched = updateRoute(route.id, {
              pendingUpload: false,
              synced: true,
              remoteId: cloudRoute?.remoteId || cloudRoute?.id || route.remoteId || route.id,
              deleted: false,
              uploadError: null,
              lastSyncedAt: Date.now(),
              updatedAt: cloudRoute?.updatedAt || route.updatedAt,
            });
            if (patched) {
              notify();
            }
            logger.warn('Route upload finished but local cache retained', {
              ...logContext,
              reason: 'batch_upload',
            });
          }
          return {
            cloudRoute,
            sourceRoute: route,
            removed,
            logContext,
          };
        })
        .catch((error) => {
          markRouteSyncFailed(route.id, error);
          logger.warn('Route upload failed during batch sync', {
            ...logContext,
            error: error?.errMsg || error?.message || error,
            statusCode: error?.statusCode,
          });
          throw error;
        });
    })
  ).then((results) => {
    const failed = results.filter((item) => item.status === 'rejected').length;
    if (failed) {
      setLastSyncError('部分轨迹同步失败，请检查网络后重试');
      logger.warn('Some routes failed to sync', { failed, total: pending.length });
    } else {
      clearLastSyncError();
    }
    const fulfilled = results
      .filter((item) => item.status === 'fulfilled')
      .map((item) => item.value)
      .filter(Boolean);
    if (!fulfilled.length) {
      return getRoutes();
    }
    const syncHint = fulfilled.reduce((hint, item) => {
      const candidate =
        Number(item.cloudRoute?.updatedAt) ||
        Number(item.cloudRoute?.meta?.updatedAt) ||
        Number(item.sourceRoute?.updatedAt) ||
        Number(item.sourceRoute?.endTime) ||
        0;
      return candidate > hint ? candidate : hint;
    }, 0);
    const updatedAfter = syncHint || Date.now();
    return syncRoutesFromCloud({ updatedAfter }).catch((error) => {
      logger.warn('Post-batch refresh failed', {
        error: error?.errMsg || error?.message || error,
      });
      fulfilled.forEach((item) => {
        if (item.removed && item.cloudRoute) {
          restoreRouteToLocalCache(item.cloudRoute, {
            logContext: item.logContext,
            reason: 'post_batch_refresh_failed',
          });
        }
      });
      return getRoutes();
    });
  });
}

function mergeRoutes(remoteRoutes = [], options = {}) {
  const { deletedIds = [], missingRemoteIds = [] } = options || {};
  const localAll = getRoutes({ includeDeleted: true });
  const activeLocal = localAll.filter((route) => route && !route.deleted);
  const tombstoneMap = new Map();
  localAll.forEach((route) => {
    if (route && route.deleted) {
      tombstoneMap.set(route.id, route);
    }
  });
  const deletionSet = new Set(
    [
      ...(Array.isArray(deletedIds) ? deletedIds : []),
      ...(Array.isArray(missingRemoteIds) ? missingRemoteIds : []),
    ].filter(Boolean)
  );
  const remoteMap = new Map();
  const merged = [];

  (Array.isArray(remoteRoutes) ? remoteRoutes : []).forEach((route) => {
    if (!route || !route.id) {
      return;
    }
    if (route.deletedAt || route.deleted) {
      deletionSet.add(route.id);
      return;
    }
    remoteMap.set(
      route.id,
      normalizeRouteMetadata(route, {
        synced: true,
        pendingUpload: false,
        remoteId: route.remoteId || route.id,
        deleted: false,
      })
    );
  });

  activeLocal.forEach((route) => {
    if (!route || !route.id) {
      return;
    }
    if (deletionSet.has(route.id)) {
      logger.info('Route removed locally due to remote deletion', { id: route.id });
      const stub = createDeletedStub(route);
      if (stub) {
        tombstoneMap.set(route.id, stub);
      } else {
        tombstoneMap.delete(route.id);
      }
      return;
    }
    if (remoteMap.has(route.id)) {
      const remoteRecord = remoteMap.get(route.id);
      merged.push(
        normalizeRouteMetadata(remoteRecord, {
          synced: true,
          pendingUpload: false,
          remoteId: remoteRecord.remoteId || remoteRecord.id,
          deleted: false,
        })
      );
      remoteMap.delete(route.id);
      tombstoneMap.delete(route.id);
      return;
    }
    merged.push(normalizeRouteMetadata(route));
  });

  remoteMap.forEach((route, id) => {
    merged.push(
      normalizeRouteMetadata(route, {
        synced: true,
        pendingUpload: false,
        remoteId: route.remoteId || id,
        deleted: false,
      })
    );
  });

  const sorted = merged.sort((a, b) => (b.startTime || 0) - (a.startTime || 0));
  const tombstones = Array.from(tombstoneMap.values());
  setRoutes([...sorted, ...tombstones]);
  notify();
  return sorted;
}

function syncRoutesFromCloud(options = {}) {
  const { forceFull = false, updatedAfter, includeDeleted = true, ...rest } = options || {};
  const lastSync = forceFull ? 0 : getLastSyncTimestamp();
  const effectiveUpdatedAfter = forceFull ? null : updatedAfter || lastSync;
  const knownRemoteIds = getRoutes({ includeDeleted: true })
    .filter((route) => route && route.synced && route.remoteId)
    .map((route) => route.remoteId);

  const pageLimit = Math.min(Math.max(Number(rest.limit) || 200, 1), 500);
  const maxPages = Math.min(Math.max(Number(rest.maxPages) || 50, 1), 200);
  let cursor = Math.max(Number(rest.cursor) || 0, 0);

  const aggregated = {
    items: [],
    deletedIds: new Set(),
    missingRemoteIds: new Set(),
    metaMax: 0,
    pagesFetched: 0,
  };

  const fetchPage = (pageIndex = 1) => {
    const payload = {
      lastSyncAt: effectiveUpdatedAfter || 0,
      includeDeleted: includeDeleted !== false,
      limit: pageLimit,
      knownRemoteIds,
      cursor,
    };

    return api.syncRoutes(payload).then((result) => {
      const list = Array.isArray(result?.items)
        ? result.items
        : Array.isArray(result)
          ? result
          : [];

      aggregated.pagesFetched = pageIndex;

      list.forEach((item) => {
        if (item && item.id) {
          aggregated.items.push(item);
        }
      });

      const deletedIds = Array.isArray(result?.deletedIds) ? result.deletedIds : [];
      const missingRemoteIds = Array.isArray(result?.missingRemoteIds) ? result.missingRemoteIds : [];
      deletedIds.forEach((id) => id && aggregated.deletedIds.add(id));
      missingRemoteIds.forEach((id) => id && aggregated.missingRemoteIds.add(id));

      const pageMetaMax =
        Number(
          result?.latestSyncAt ||
          result?.lastSyncAt ||
          result?.maxUpdatedAt ||
          result?.cursorUpdatedAt
        ) || 0;
      if (pageMetaMax > aggregated.metaMax) {
        aggregated.metaMax = pageMetaMax;
      }

      const nextCursorCandidate = Number(result?.nextCursor);
      const hasMore =
        result?.hasMore === true ||
        (Number.isFinite(nextCursorCandidate) && nextCursorCandidate > cursor);

      if (hasMore && pageIndex < maxPages) {
        cursor = Number.isFinite(nextCursorCandidate) ? nextCursorCandidate : cursor + pageLimit;
        return fetchPage(pageIndex + 1);
      }

      if (hasMore && pageIndex >= maxPages) {
        logger.warn('Route sync pagination stopped due to maxPages guard', {
          maxPages,
          cursor,
        });
      }

      return result;
    });
  };

  return fetchPage()
    .then(() => {
      const dedupedMap = new Map();
      aggregated.items.forEach((item) => {
        if (!item || !item.id) {
          return;
        }
        const existing = dedupedMap.get(item.id);
        if (!existing) {
          dedupedMap.set(item.id, item);
          return;
        }
        const existingUpdated = Number(existing.updatedAt || existing.createdAt || 0);
        const nextUpdated = Number(item.updatedAt || item.createdAt || 0);
        if (nextUpdated >= existingUpdated) {
          dedupedMap.set(item.id, item);
        }
      });

      const remote = Array.from(dedupedMap.values());
      const deletedIds = Array.from(aggregated.deletedIds);
      const missingRemoteIds = Array.from(aggregated.missingRemoteIds);

      const merged = mergeRoutes(remote, { deletedIds, missingRemoteIds });
      const nonDeletedRemote = remote.filter((item) => item && !item.deletedAt && !item.deleted);
      const remoteMax = getMaxUpdatedAt(nonDeletedRemote);
      const metaMax = aggregated.metaMax;
      const hasChanges =
        nonDeletedRemote.length > 0 || deletedIds.length > 0 || missingRemoteIds.length > 0 || forceFull;
      const nextSyncPoint = hasChanges
        ? Math.max(remoteMax, metaMax, Date.now())
        : Math.max(lastSync, metaMax);
      setLastSyncTimestamp(nextSyncPoint || Date.now());

      clearLastSyncError();
      logger.info('Route sync from cloud finished', {
        pagesFetched: aggregated.pagesFetched,
        remoteCount: remote.length,
        deletedCount: deletedIds.length,
        missingCount: missingRemoteIds.length,
      });

      return merged;
    })
    .catch((err) => {
      setLastSyncError(err, '从云端拉取轨迹失败');
      logger.warn('Fetch routes from cloud failed', err?.errMsg || err?.message || err);
      return getRoutes();
    });
}

function storeRoute(route, options = {}) {
  const { syncImmediately = true } = options || {};
  const pendingRoute = {
    ...route,
    pendingUpload: true,
    synced: false,
    remoteId: route.remoteId || null,
    deleted: false,
    uploadError: null,
    lastSyncAttemptAt: Date.now(),
  };
  const saved = saveRoute(pendingRoute);
  notify();

  if (!syncImmediately) {
    return Promise.resolve({
      route: saved,
      cloudSaved: false,
      localFallback: true,
      syncError: null,
    });
  }

  const logContext = buildRouteLogContext(saved);
  logger.info('Route upload initiated after recording', logContext);
  return syncRouteToCloud(saved)
    .then((cloudRoute) => {
      const removed = dropRouteFromLocalCache(saved.id, {
        logContext,
        reason: 'recording_upload',
      });
      if (!removed) {
        const patched = updateRoute(saved.id, {
          pendingUpload: false,
          synced: true,
          remoteId: cloudRoute?.remoteId || cloudRoute?.id || saved.remoteId || saved.id,
          deleted: false,
          uploadError: null,
          lastSyncedAt: Date.now(),
          updatedAt: cloudRoute?.updatedAt || saved.updatedAt,
        });
        if (patched) {
          notify();
        }
        logger.warn('Route upload finished but local cache retained', {
          ...logContext,
          reason: 'recording_upload',
        });
      }
      logger.info('Route upload finished after recording', {
        ...logContext,
        removedFromCache: removed,
      });
      const syncHint = cloudRoute?.updatedAt || saved.updatedAt || saved.endTime || Date.now();
      return syncRoutesFromCloud({ updatedAfter: syncHint })
        .catch((error) => {
          logger.warn('Post-upload refresh failed', {
            ...logContext,
            error: error?.errMsg || error?.message || error,
          });
          if (cloudRoute && removed) {
            restoreRouteToLocalCache(cloudRoute, {
              logContext,
              reason: 'post_upload_refresh_failed',
            });
          }
          return null;
        })
        .then(() => ({
          route: cloudRoute || saved,
          cloudSaved: true,
          localFallback: false,
          syncError: null,
        }));
    })
    .catch((error) => {
      markRouteSyncFailed(saved.id, error);
      logger.warn('Route upload failed after recording', {
        ...logContext,
        error: error?.errMsg || error?.message || error,
        statusCode: error?.statusCode,
      });
      return {
        route: saved,
        cloudSaved: false,
        localFallback: true,
        syncError: error,
      };
    });
}

function updateRoutePrivacy(id, privacyLevel) {
  const updated = updateRoute(id, {
    privacyLevel,
  });
  notify();
  if (updated) {
    api
      .patchRoute(id, { privacyLevel })
      .then((payload) => {
        const syncAt = Number(payload?.lastSyncAt);
        if (Number.isFinite(syncAt) && syncAt > 0) {
          setLastSyncTimestamp(syncAt);
        }
        return payload;
      })
      .catch((err) =>
        logger.warn('Update privacy sync failed', {
          id,
          error: err?.errMsg || err?.message || err,
        })
      );
  }
  return updated;
}

function deleteRoute(id) {
  if (!id) {
    return Promise.resolve(null);
  }
  const currentRoutes = getRoutes();
  const target = currentRoutes.find((item) => item && item.id === id) || null;
  const logContext = target ? buildRouteLogContext(target) : { id };
  logger.info('Route deletion initiated', logContext);
  const removed = dropRouteFromLocalCache(id, {
    logContext,
    reason: 'user_delete_request',
  });

  // 对于尚未成功同步到云端的记录（synced: false），
  // 直接视为本地软删除：仅从小程序端移除，不再调用云端 DELETE。
  // 这样可以避免云端返回 404 时重新恢复本地记录，导致“删不掉”的体验。
  if (!target || target.synced !== true) {
    return Promise.resolve(null);
  }

  return api
    .removeRoute(id)
    .then((response) => {
      const syncAt = Number(response?.lastSyncAt);
      if (Number.isFinite(syncAt) && syncAt > 0) {
        setLastSyncTimestamp(syncAt);
      }
      logger.info('Route deletion synced to cloud', {
        ...logContext,
        removedFromCache: removed,
      });
      const syncHint = target?.updatedAt || target?.endTime || Date.now();
      return syncRoutesFromCloud({ updatedAfter: syncHint }).catch((error) => {
        logger.warn('Post-deletion refresh failed', {
          ...logContext,
          error: error?.errMsg || error?.message || error,
        });
        return null;
      });
    })
    .catch((err) => {
      logger.warn('Delete route sync failed', {
        ...logContext,
        error: err?.errMsg || err?.message || err,
        statusCode: err?.statusCode,
      });
      // 云端删除失败时不再恢复本地记录，保持“用户视角已删除”的软删除语义。
      // 管理员仍然可以在云端后台看到这条记录（若云端数据存在）。
      return null;
    });
}

function cacheFragment(fragment) {
  enqueueOfflineFragment(fragment);
}

function flushOfflineFragments() {
  const fragments = getOfflineQueue();
  if (!Array.isArray(fragments) || !fragments.length) {
    return [];
  }
  clearOfflineQueue();
  return fragments;
}

function getSyncStatus() {
  const allRoutes = getRoutes({ includeDeleted: true });
  const pending = allRoutes.filter((route) => route && route.pendingUpload && !route.deleted).length;
  const synced = allRoutes.filter((route) => route && route.synced && !route.deleted).length;
  const deleted = allRoutes.filter((route) => route && route.deleted).length;
  return {
    pending,
    synced,
    deleted,
    total: allRoutes.filter((route) => route && !route.deleted).length,
    lastSyncAt: getLastSyncTimestamp(),
    lastError: lastSyncError,
  };
}

module.exports = {
  subscribe,
  storeRoute,
  getRoutes,
  createRoutePayload,
  updateRoutePrivacy,
  deleteRoute,
  cacheFragment,
  flushOfflineFragments,
  syncRoutesToCloud,
  syncRoutesFromCloud,
  syncRouteToCloud,
  getSyncStatus,
};







