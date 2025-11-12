const {
  saveRoute,
  getRoutes,
  setRoutes,
  updateRoute,
  removeRoute,
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
const logger = require('../utils/logger');

const subscribers = new Set();

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
    return () => {};
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
  if (!route?.id) {
    return Promise.resolve();
  }
  const payload = sanitizeRouteForUpload(route);
  if (!payload) {
    logger.warn('Route sync skipped (invalid payload)', {
      id: route?.id,
    });
    return Promise.resolve();
  }
  return api
    .upsertRoute(payload)
    .then((response) => {
      if (response && typeof response === 'object') {
        const syncAt = Number(response.lastSyncAt);
        if (Number.isFinite(syncAt) && syncAt > 0) {
          setLastSyncTimestamp(syncAt);
        }
      }
      logger.info('Route synced to cloud', { id: route.id });
      if (response && typeof response === 'object' && response.route) {
        return { ...response.route };
      }
      return { ...route };
    })
    .catch((err) => {
      logger.warn('Route sync failed', {
        id: route.id,
        error: err?.errMsg || err?.message || err,
        statusCode: err?.statusCode,
        response: err?.response,
      });
      throw err;
    });
}

function syncRoutesToCloud() {
  const routes = getRoutes();
  if (!routes.length) {
    return Promise.resolve([]);
  }
  const pending = routes.filter((route) => route && route.pendingUpload !== false && !route.deletedAt);
  if (!pending.length) {
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
      logger.warn('Some routes failed to sync', { failed, total: pending.length });
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
  const { deletedIds = [] } = options || {};
  const local = getRoutes();
  const deletionSet = new Set((Array.isArray(deletedIds) ? deletedIds : []).filter(Boolean));
  const remoteMap = new Map();
  const merged = [];

  (Array.isArray(remoteRoutes) ? remoteRoutes : []).forEach((route) => {
    if (!route || !route.id) {
      return;
    }
    if (route.deletedAt) {
      deletionSet.add(route.id);
      return;
    }
    remoteMap.set(route.id, {
      ...route,
      pendingUpload: false,
      uploadError: null,
    });
  });

  local.forEach((route) => {
    if (!route || !route.id) {
      return;
    }
    if (deletionSet.has(route.id)) {
      logger.info('Route removed locally due to remote deletion', { id: route.id });
      return;
    }
    if (remoteMap.has(route.id)) {
      merged.push(remoteMap.get(route.id));
      remoteMap.delete(route.id);
      return;
    }
    merged.push(route);
  });

  remoteMap.forEach((route) => {
    merged.push(route);
  });

  const sorted = merged.sort((a, b) => (b.startTime || 0) - (a.startTime || 0));
  setRoutes(sorted);
  notify();
  return sorted;
}

function syncRoutesFromCloud(options = {}) {
  const { forceFull = false, updatedAfter, includeDeleted = true, ...rest } = options || {};
  const lastSync = forceFull ? 0 : getLastSyncTimestamp();
  const effectiveUpdatedAfter = forceFull ? null : updatedAfter || lastSync;
  const query = { ...rest };
  if (effectiveUpdatedAfter) {
    query.updatedAfter = effectiveUpdatedAfter;
  }
  if (includeDeleted) {
    query.includeDeleted = true;
  }
  return api
    .listRoutes(query)
    .then((result) => {
      const list = Array.isArray(result?.items)
        ? result.items
        : Array.isArray(result)
        ? result
        : [];
      const meta = (result && typeof result === 'object' && !Array.isArray(result) ? result.meta : {}) || {};
      const remote = list.filter((item) => item && item.id);
      const deletedIds = new Set();
      if (Array.isArray(meta.deletedIds)) {
        meta.deletedIds.filter(Boolean).forEach((id) => deletedIds.add(id));
      }
      if (Array.isArray(meta.removedIds)) {
        meta.removedIds.filter(Boolean).forEach((id) => deletedIds.add(id));
      }
      remote.forEach((item) => {
        if (item?.id && item.deletedAt) {
          deletedIds.add(item.id);
        }
      });
      const merged = mergeRoutes(remote, { deletedIds: Array.from(deletedIds.values()) });
      const nonDeletedRemote = remote.filter((item) => item && !item.deletedAt);
      const remoteMax = getMaxUpdatedAt(nonDeletedRemote);
      const metaMax =
        Number(meta.maxUpdatedAt || meta.latestUpdatedAt || meta.updatedAt || meta.cursorUpdatedAt) || 0;
      const hasChanges = nonDeletedRemote.length > 0 || deletedIds.size > 0 || forceFull;
      const nextSyncPoint = hasChanges
        ? Math.max(remoteMax, metaMax, Date.now())
        : Math.max(lastSync, metaMax);
      setLastSyncTimestamp(nextSyncPoint || Date.now());
      return merged;
    })
    .catch((err) => {
      logger.warn('Fetch routes from cloud failed', err?.errMsg || err?.message || err);
      return getRoutes();
    });
}

function storeRoute(route) {
  const pendingRoute = {
    ...route,
    pendingUpload: true,
    uploadError: null,
    lastSyncAttemptAt: Date.now(),
  };
  const saved = saveRoute(pendingRoute);
  notify();
  const logContext = buildRouteLogContext(saved);
  logger.info('Route upload initiated after recording', logContext);
  syncRouteToCloud(saved)
    .then((cloudRoute) => {
      const removed = dropRouteFromLocalCache(saved.id, {
        logContext,
        reason: 'recording_upload',
      });
      if (!removed) {
        const patched = updateRoute(saved.id, {
          pendingUpload: false,
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
      return syncRoutesFromCloud({ updatedAfter: syncHint }).catch((error) => {
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
      });
    })
    .catch((error) => {
      markRouteSyncFailed(saved.id, error);
      logger.warn('Route upload failed after recording', {
        ...logContext,
        error: error?.errMsg || error?.message || error,
        statusCode: error?.statusCode,
      });
    });
  return saved;
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
      if (target) {
        restoreRouteToLocalCache(target, {
          logContext,
          reason: 'delete_sync_failed',
          overrides: {
            pendingUpload: target.pendingUpload ?? false,
            uploadError: target.uploadError ?? null,
            lastSyncedAt: target.lastSyncedAt ?? target.updatedAt ?? Date.now(),
          },
        });
      }
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
};


