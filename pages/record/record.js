'use strict';

const { applyThemeMixin } = require('../../utils/theme');
const { checkLocationAuthorization, requestLocationAuthorization, openLocationSetting } = require('../../utils/permissions');
const tracker = require('../../services/tracker');
const { PRIVACY_LEVELS } = require('../../constants/privacy');
const { DEFAULT_ACTIVITY_TYPE, ACTIVITY_TYPE_MAP } = require('../../constants/activity');
const { getRecentSettings, saveRecentSettings, getKeepScreenPreference } = require('../../utils/storage');
const api = require('../../services/api');
const { formatSpeed, formatCalories } = require('../../utils/format');
const { formatDuration, formatClock } = require('../../utils/time');
const { estimateCalories } = require('../../utils/geo');
const logger = require('../../utils/logger');
const media = require('../../services/media');
const { getSyncStatus } = require('../../services/route-store');
const { resolveActivityMeta } = require('../../utils/activity');
const { PURPOSE_OPTIONS, PURPOSE_MAP } = require('../../constants/purpose');
const rewards = require('../../services/rewards');
const { fetchAlternativeRoutes } = require('../../services/path-bridge');
const { calculateSegmentDistance } = require('../../utils/geo');

const app = typeof getApp === 'function' ? getApp() : null;

const ACTIVITY_CHOICES = [
  { key: 'walk', label: '步行', icon: '🚶' },
  { key: 'run', label: '跑步', icon: '🏃' },
  { key: 'ride', label: '骑行', icon: '🚴' },
];
const ACTIVITY_CHOICE_MAP = ACTIVITY_CHOICES.reduce((acc, item) => {
  acc[item.key] = item;
  return acc;
}, {});

const DEFAULT_CENTER = {
  latitude: 30.27415,
  longitude: 120.15515,
};

const MAP_AUTO_CENTER_INTERVAL_MS = 10000;

const MAX_PHOTOS = 9;

const MARKER_ICONS = {
  start: '/assets/icons/start.png',
  pause: '/assets/icons/pause.png',
  live: '/assets/icons/end.png',
};

const FINISH_PRIVACY_OPTIONS =
  PRIVACY_LEVELS.filter((item) => ['public', 'private'].includes(item.key)) || PRIVACY_LEVELS;

const SATISFACTION_CONFIG = [
  { score: 1, emoji: '\uD83D\uDE2D', label: '非常不满意', color: '#ef4444' },
  { score: 2, emoji: '\uD83D\uDE1E', label: '不满意', color: '#f97316' },
  { score: 3, emoji: '\uD83D\uDE15', label: '有点不满意', color: '#eab308' },
  { score: 4, emoji: '\uD83D\uDE10', label: '一般', color: '#a3a3a3' },
  { score: 5, emoji: '\uD83D\uDE42', label: '还不错', color: '#22c55e' },
  { score: 6, emoji: '\uD83D\uDE0A', label: '满意', color: '#3b82f6' },
  { score: 7, emoji: '\uD83E\uDD29', label: '非常满意', color: '#7c3aed' },
];

const PREFERENCE_OPTIONS = [
  { key: 'shorter_distance', icon: '\uD83D\uDCCF', label: '距离更短', selected: false },
  { key: 'faster', icon: '\u26A1', label: '更快 / 更少等待', selected: false },
  { key: 'comfortable', icon: '\uD83C\uDF3F', label: '更舒适', selected: false },
  { key: 'safer', icon: '\uD83D\uDEE1\uFE0F', label: '更安全', selected: false },
  { key: 'familiar', icon: '\uD83D\uDCCD', label: '更熟悉 / 习惯走', selected: false },
  { key: 'other', icon: '\uD83D\uDCAC', label: '其他原因', selected: false },
];

const ALT_ROUTE_COLORS = ['#f97316', '#22c55e', '#ec4899'];
const ALT_ROUTE_LABELS = ['A', 'B', 'C'];

const TOAST = {
  requireLocation: '请先获取定位权限',
  maxPhotos: '最多选择 9 张图片',
  startFailed: '无法开始记录，请稍后重试',
  routeSaved: '路线已保存到云端',
  routeSaveFailed: '未能保存路线，请稍后重试',
  routeSavedLocalOnly: '云端保存失败，已暂存本地',
  purposeRequired: '请选择本次运动的目的',
  purposeUpdated: '运动目的已更新',
  activityLocked: '开始记录后可设置行进方式',
  activityUpdated: '行进方式已更新',
  activityAuto: '已恢复自动识别',
  rewardInvalid: '记录已保存（用时或距离不足，未获得积分）',
  profileIncomplete: '请先完善个人信息',
};

function normalizePhotos(photos = []) {
  return photos.map((item) => {
    if (typeof item === 'string') {
      return { path: item, note: '', uploadState: 'pending', uploadError: '' };
    }
    return {
      path: item.path,
      note: item.note || '',
      uploadState: item.uploadState || 'pending',
      uploadError: item.uploadError || '',
    };
  });
}

function getSyncHintText() {
  try {
    const status = getSyncStatus() || {};
    const pending = Number(status.pending) || 0;
    const ts = Number(status.lastSyncAt) || 0;
    const lastSyncText = ts > 0 ? formatClock(ts) : '--';
    if (pending > 0) {
      return `待同步 ${pending} 条 · 上次同步 ${lastSyncText}`;
    }
    return `已同步 · 上次同步 ${lastSyncText}`;
  } catch (_) {
    return '同步状态暂不可用';
  }
}

function formatSpeedByActivity(activityKey, value) {
  if (activityKey === 'ride') {
    return `${value ? (value * 3.6).toFixed(1) : '0.0'} km/h`;
  }
  return formatSpeed(value);
}

function inferActivityByAverageSpeed(distance = 0, duration = 0) {
  const numericDistance = Number(distance);
  const numericDuration = Number(duration);
  if (!Number.isFinite(numericDistance) || !Number.isFinite(numericDuration)) {
    return null;
  }
  if (numericDistance < 15 || numericDuration < 5000) {
    return null;
  }
  const avgSpeed = numericDistance / (numericDuration / 1000);
  if (!Number.isFinite(avgSpeed) || avgSpeed <= 0.3) {
    return null;
  }
  if (avgSpeed < 2) {
    return 'walk';
  }
  if (avgSpeed <= 4) {
    return 'run';
  }
  return 'ride';
}

Page(applyThemeMixin({
  data: {
    tracking: false,
    paused: false,
    durationText: '00:00:00',
    distanceText: '0.0 km',
    speedText: '0.0 km/h',
    caloriesText: '0 kcal',
    stepsText: '0',
    polyline: [],
    markers: [],
    includePoints: [],
    pausePoints: [],
    purposeOptions: PURPOSE_OPTIONS,
    purposeSelectionKey: '',
    purposeSelectionLabel: '未选择',
    purposePickerVisible: false,
    purposePendingKey: '',
    purposeNoteTracking: '仅修改出行目的，不影响记录',
    purposeNoteIdle: '取消后不会开始记录',
    purposeConfirmTracking: '确定',
    purposeConfirmIdle: '开始记录',
    privacyOptions: FINISH_PRIVACY_OPTIONS,
    privacyIndex: 0,
    activityKey: DEFAULT_ACTIVITY_TYPE,
    activityLabel: '识别中',
    manualActivityKey: '',
    activityManual: false,
    title: '',
    note: '',
    keepScreenOnPreferred: false,
    keepScreenSupported: typeof wx.setKeepScreenOn === 'function',
    locationAuthorized: true,
    rewardModalVisible: false,
    rewardSummary: null,
    hasRoutePoints: false,
    centerLatitude: DEFAULT_CENTER.latitude,
    centerLongitude: DEFAULT_CENTER.longitude,
    userLatitude: null,
    userLongitude: null,
    mapScale: 16,
    weight: 60,
    photos: [],
    locationScope: 'none',
    showLocationPrompt: false,
    locationPromptPending: false,
    uploading: false,
    finishSheetVisible: false,
    finishAutoPaused: false,
    wizardVisible: false,
    wizardStep: 1,
    wizardEndLat: 0,
    wizardEndLng: 0,
    wizardMapScale: 18,
    wizardEndMarkers: [],
    wizardEndPolyline: [],
    wizardEndConfirmed: false,
    wizardEndDistText: '',
    wizardConfirmedEndLat: null,
    wizardConfirmedEndLng: null,
    wizardRawEndLat: null,
    wizardRawEndLng: null,
    wizardEndDistMeters: 0,
    satisfactionScore: 4,
    satisfactionEmoji: '\uD83D\uDE10',
    satisfactionLabel: '一般',
    satisfactionColor: '#a3a3a3',
    preferenceOptions: PREFERENCE_OPTIONS.map((o) => ({ ...o })),
    preferenceHasOther: false,
    preferenceHasSelection: false,
    feedbackReasonText: '',
    wizardLoadingRoutes: false,
    wizardRouteMapReady: false,
    wizardRouteCenterLat: 0,
    wizardRouteCenterLng: 0,
    wizardRouteMapScale: 15,
    wizardRouteMarkers: [],
    wizardRoutePolylines: [],
    wizardRouteIncludePoints: [],
    wizardAlternatives: [],
    wizardActualDistText: '',
    batchRetrying: false,
    batchRetryProgressText: '',
    locateAnimationActive: false,
    signalQualityLabel: '定位良好',
    syncHintText: '同步状态暂不可用',
  },

  onLoad() {
    this._lastAutoCenterAt = 0;
    this._lastUserMapInteractionAt = 0;
    this.unsubscribe = tracker.subscribe((state) => this.updateState(state));
    this.applySettings();
    this.setData({ syncHintText: getSyncHintText() });
    this.checkLocationPermission(true);
    // 记录当前页面栈深度，后续用于识别系统返回导致的离开
    if (typeof getCurrentPages === 'function') {
      this.__routeStackDepth = (getCurrentPages() || []).length;
    }
  },

  onShow() {
    this.setData({ syncHintText: getSyncHintText() });
    this.checkLocationPermission(false).then(() => {
      if (this.data.locationAuthorized) {
        this.refreshCurrentLocation();
      }
    });
    // 每次页面展示时刷新栈深度
    if (typeof getCurrentPages === 'function') {
      this.__routeStackDepth = (getCurrentPages() || []).length;
    }
  },

  onReady() {
    this.mapContext = wx.createMapContext('routeMap', this);
  },

  onHide() {
    // 显式通过本页返回按钮离开时，不重复弹窗
    if (this.__leavingExplicitly) {
      this.__leavingExplicitly = false;
      return;
    }
    // 系统返回 / 导航导致页面隐藏时，如果仍在记录中，则给出二次确认
    if (false && (this.data.tracking || this.data.paused)) {
      wx.showModal({
        title: '提示',
        content: '记录尚未结束，确定要退出吗？退出后本次记录将不会保存。',
        confirmText: '退出',
        cancelText: '继续记录',
        success: (res) => {
          if (res.confirm) {
            try {
              // 取消当前记录但不生成轨迹
              tracker.cancelTracking && tracker.cancelTracking().catch(() => {});
            } catch (error) {
              logger.warn('cancelTracking onHide failed', error?.errMsg || error);
            }
          } else {
            // 用户选择继续记录时，重新回到记录页
            wx.navigateTo({
              url: '/pages/record/record',
            });
          }
        },
      });
    }
  },

  onUnload() {
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }
  },

  applySettings() {
    const settings = getRecentSettings() || {};
    const keepScreenPreferred =
      typeof getKeepScreenPreference === 'function'
        ? !!getKeepScreenPreference()
        : !!settings.keepScreenPreferred;
    const storedPrivacyKey = settings.privacyLevel;
    const privacyIndex = this.data.privacyOptions.findIndex((item) => item.key === storedPrivacyKey);
    this.setData({
      keepScreenOnPreferred: keepScreenPreferred,
      privacyIndex: privacyIndex >= 0 ? privacyIndex : 0,
      weight: Number(settings.weight) > 0 ? Number(settings.weight) : this.data.weight,
    });
    if (keepScreenPreferred && this.data.keepScreenSupported) {
      try {
        wx.setKeepScreenOn({ keepScreenOn: true });
      } catch (error) {
        logger.warn('setKeepScreenOn init failed', error?.errMsg || error);
      }
    }
  },

  checkLocationPermission(initialPrompt = false) {
    return checkLocationAuthorization()
      .then((status) => {
        const authorized = !!status?.authorized;
        this.setData({
          locationAuthorized: authorized,
          locationScope: status?.scope || 'none',
          showLocationPrompt: initialPrompt ? !authorized : this.data.showLocationPrompt,
        });
        if (authorized) {
          this.refreshCurrentLocation();
        }
        return status;
      })
      .catch((error) => {
        logger.warn('checkLocationAuthorization failed', error?.errMsg || error);
        this.setData({
          locationAuthorized: false,
          locationScope: 'none',
          showLocationPrompt: initialPrompt ? true : this.data.showLocationPrompt,
        });
        return { authorized: false, scope: 'none' };
      });
  },

  requestLocationAccess() {
    return requestLocationAuthorization()
      .then((status) => {
        const authorized = !!status?.authorized;
        this.setData({
          locationAuthorized: authorized,
          locationScope: status?.scope || 'none',
          showLocationPrompt: !authorized,
        });
        if (authorized) {
          this.refreshCurrentLocation();
        }
        if (!authorized) {
          wx.showToast({ title: TOAST.requireLocation, icon: 'none' });
        }
        return status;
      })
      .catch((error) => {
        logger.warn('requestLocationAuthorization failed', error?.errMsg || error);
        wx.showToast({ title: TOAST.requireLocation, icon: 'none' });
        this.setData({
          locationAuthorized: false,
          locationScope: 'none',
          showLocationPrompt: true,
        });
        throw error;
      });
  },

  refreshCurrentLocation() {
    if (!this.data.locationAuthorized || typeof wx.getLocation !== 'function') {
      return Promise.resolve(null);
    }
    if (this.locationProbePromise) {
      return this.locationProbePromise;
    }
    this.locationProbePromise = new Promise((resolve) => {
      wx.getLocation({
        type: 'gcj02',
        isHighAccuracy: true,
        highAccuracyExpireTime: 5000,
        success: (res) => {
          if (res && Number.isFinite(res.latitude) && Number.isFinite(res.longitude)) {
            this.setData({
              centerLatitude: res.latitude,
              centerLongitude: res.longitude,
              userLatitude: res.latitude,
              userLongitude: res.longitude,
            });
          }
          resolve(res);
        },
        fail: (error) => {
          logger.warn('getLocation probe failed', error?.errMsg || error);
          resolve(null);
        },
        complete: () => {
          this.locationProbePromise = null;
        },
      });
    });
    return this.locationProbePromise;
  },

  updateState(state = {}) {
    const stats = state.stats || {};
    const distance = stats.distance || 0;
    const duration = stats.duration || 0;
    const speed = stats.speed || 0;
    const points = Array.isArray(state.points) ? state.points : [];
    const routePoints = points
      .map((point) => ({
        latitude: Number(point?.latitude),
        longitude: Number(point?.longitude),
      }))
      .filter(
        (point) => Number.isFinite(point.latitude) && Number.isFinite(point.longitude)
      );
    const isTracking = Boolean(state.active);
    const isPaused = Boolean(state.paused);

    const manualActivityKey = state?.options?.activityType || this.data.manualActivityKey || '';
    const hasManualActivity = Boolean(manualActivityKey && ACTIVITY_TYPE_MAP[manualActivityKey]);
    const inferredActivityKey =
      !hasManualActivity && isTracking ? inferActivityByAverageSpeed(distance, duration) : null;
    const resolvedActivityKey = hasManualActivity
      ? manualActivityKey
      : inferredActivityKey || DEFAULT_ACTIVITY_TYPE;
    const activityMeta = resolveActivityMeta(resolvedActivityKey) || ACTIVITY_TYPE_MAP[DEFAULT_ACTIVITY_TYPE];
    const activityLabel =
      hasManualActivity || (isTracking && inferredActivityKey) ? activityMeta.label : '识别中';
    const weight = this.data.weight || 60;
    const durationText = formatDuration(duration);
    const distanceText = `${(distance / 1000).toFixed(1)} km`;
    const speedText = formatSpeedByActivity(activityMeta.key, speed);
    const caloriesValue = distance ? estimateCalories(distance, weight, activityMeta.key) : 0;
    const caloriesText = formatCalories(caloriesValue);
    const stepsText = activityMeta.key === 'ride' ? '--' : `${Math.round(distance / 0.75)}`;
    const hasRoutePoints = routePoints.length > 0;
    const fallbackCenter = {
      latitude: Number.isFinite(this.data.userLatitude)
        ? this.data.userLatitude
        : DEFAULT_CENTER.latitude,
      longitude: Number.isFinite(this.data.userLongitude)
        ? this.data.userLongitude
        : DEFAULT_CENTER.longitude,
    };
    const latestPoint = hasRoutePoints ? routePoints[routePoints.length - 1] : fallbackCenter;
    const userLatitude = hasRoutePoints ? latestPoint.latitude : this.data.userLatitude;
    const userLongitude = hasRoutePoints ? latestPoint.longitude : this.data.userLongitude;

    if (this.data.keepScreenSupported && this.data.keepScreenOnPreferred && isTracking) {
      try {
        wx.setKeepScreenOn({ keepScreenOn: true });
      } catch (error) {
        logger.warn('setKeepScreenOn failed', error?.errMsg || error);
      }
    }

    const now = Date.now();
    const previousCenterLatitude = this.data.centerLatitude;
    const previousCenterLongitude = this.data.centerLongitude;
    let centerLatitude = previousCenterLatitude;
    let centerLongitude = previousCenterLongitude;
    const centerMissing =
      !Number.isFinite(previousCenterLatitude) || !Number.isFinite(previousCenterLongitude);

    const timeSinceLastAutoCenter = this._lastAutoCenterAt
      ? now - this._lastAutoCenterAt
      : Infinity;
    const timeSinceLastUserInteraction = this._lastUserMapInteractionAt
      ? now - this._lastUserMapInteractionAt
      : Infinity;

    const shouldAutoCenter =
      this.mapContext &&
      hasRoutePoints &&
      isTracking &&
      !isPaused &&
      (centerMissing ||
        (timeSinceLastAutoCenter >= MAP_AUTO_CENTER_INTERVAL_MS &&
          timeSinceLastUserInteraction >= MAP_AUTO_CENTER_INTERVAL_MS));

    if (shouldAutoCenter) {
      centerLatitude = latestPoint.latitude;
      centerLongitude = latestPoint.longitude;
      try {
        this.mapContext.moveToLocation({
          latitude: latestPoint.latitude,
          longitude: latestPoint.longitude,
        });
      } catch (error) {
        logger.warn('moveToLocation failed', error?.errMsg || error);
      }
      this._lastAutoCenterAt = now;
    }

    const shouldAutoFitRoute = (isPaused || !isTracking) && hasRoutePoints;

    const polyline = routePoints.length >= 2
      ? [
          {
            points: routePoints,
            color: '#2F6BFF',
            width: 4,
            dottedLine: false,
          },
        ]
      : [];

    const pauseMarkers = Array.isArray(state.pausePoints)
      ? state.pausePoints
          .map((point, index) => ({
            id: `pause-${index}`,
            latitude: Number(point?.latitude),
            longitude: Number(point?.longitude),
            iconPath: MARKER_ICONS.pause,
            width: 24,
            height: 24,
            anchor: { x: 0.5, y: 0.5 },
          }))
          .filter(
            (marker) => Number.isFinite(marker.latitude) && Number.isFinite(marker.longitude)
          )
      : [];

    const startMarker = hasRoutePoints
      ? [
          {
            id: 'start',
            latitude: routePoints[0].latitude,
            longitude: routePoints[0].longitude,
            iconPath: MARKER_ICONS.start,
            width: 32,
            height: 32,
            anchor: { x: 0.5, y: 1 },
          },
        ]
      : [];

    const liveMarker = hasRoutePoints
      ? [
          {
            id: 'live',
            latitude: latestPoint.latitude,
            longitude: latestPoint.longitude,
            iconPath: MARKER_ICONS.live,
            width: 28,
            height: 28,
            anchor: { x: 0.5, y: 1 },
          },
        ]
      : [];

    const markers = [...startMarker, ...pauseMarkers, ...liveMarker];
    const includePoints = shouldAutoFitRoute
      ? routePoints.map((point) => ({ ...point }))
      : [];

    // �� "������¼" �� �׶Σ�ҳ�治�ٱ����ڼ�¼״̬����������뿪ʱ����ʾδ����¼�Ի���
    const trackingFlag = this.data.finishSheetVisible ? false : isTracking;
    const pausedFlag = this.data.finishSheetVisible ? false : isPaused;

    const failedPhotoCount = normalizePhotos(this.data.photos).filter((item) => item.uploadError).length;
    const pendingPhotoCount = normalizePhotos(this.data.photos).filter((item) => !item.uploadError).length;
    const syncHintBase = getSyncHintText();
    const syncHintText = failedPhotoCount > 0
      ? `${syncHintBase} · ${failedPhotoCount} 张图片待重试`
      : pendingPhotoCount > 0
        ? `${syncHintBase} · ${pendingPhotoCount} 张图片待上传`
        : syncHintBase;

    this.setData({
      tracking: trackingFlag,
      paused: pausedFlag,
      signalQualityLabel: state.signalQuality === 'weak' ? '定位较弱' : '定位良好',
      syncHintText,
      durationText,
      distanceText,
      speedText,
      caloriesText,
      stepsText,
      polyline,
      markers,
      includePoints,
      pausePoints: state.pausePoints || [],
      activityKey: activityMeta.key,
      activityLabel,
      manualActivityKey: hasManualActivity ? manualActivityKey : '',
      activityManual: hasManualActivity,
      hasRoutePoints: hasRoutePoints,
      centerLatitude: Number.isFinite(centerLatitude) ? centerLatitude : latestPoint.latitude,
      centerLongitude: Number.isFinite(centerLongitude) ? centerLongitude : latestPoint.longitude,
      userLatitude,
      userLongitude,
    });
  },

  handleMapTap() {
    if (!this.data.hasRoutePoints) {
      wx.showToast({ title: '开始记录后可查看路线', icon: 'none' });
      return;
    }
    if (this.mapContext) {
      this.mapContext.moveToLocation({
        latitude: this.data.centerLatitude,
        longitude: this.data.centerLongitude,
      });
    }
  },

  handleMapRegionChange(event) {
    const detail = (event && event.detail) || {};
    const eventType = event?.type || detail.type;
    const causedBy = event?.causedBy || detail.causedBy || '';
    if (eventType === 'end' && (causedBy === 'drag' || causedBy === 'scale')) {
      this._lastUserMapInteractionAt = Date.now();
    }
  },

  openPurposePicker() {
    const fallback = this.data.purposeSelectionKey || this.data.purposePendingKey || '';
    this.setData({
      purposePickerVisible: true,
      purposePendingKey: fallback,
    });
  },

  handleOpenPurposePicker() {
    this.openPurposePicker();
  },

  handleActivityCellTap() {
    if (!this.data.tracking) {
      wx.showToast({ title: TOAST.activityLocked, icon: 'none' });
      return;
    }
    const options = [...ACTIVITY_CHOICES, { key: '', label: '恢复自动识别', icon: '🔄' }];
    wx.showActionSheet({
      itemList: options.map((item) => `${item.icon} ${item.label}`),
      success: (res) => {
        const choice = options[res.tapIndex];
        if (!choice) {
          return;
        }
        this.applyManualActivity(choice.key);
      },
    });
  },

  applyManualActivity(activityKey = '') {
    const normalized =
      activityKey && ACTIVITY_CHOICE_MAP[activityKey] ? activityKey : '';
    const isManual = Boolean(normalized);
    const manualLabel = isManual ? ACTIVITY_CHOICE_MAP[normalized].label : null;
    this.setData({
      manualActivityKey: normalized,
      activityManual: isManual,
      activityLabel: isManual ? manualLabel : '识别中',
    });
    if (typeof tracker.updateActivityTypeOverride === 'function') {
      tracker.updateActivityTypeOverride(normalized);
    }
    const toastText = isManual
      ? `${TOAST.activityUpdated}${manualLabel ? `（${manualLabel}）` : ''}`
      : TOAST.activityAuto;
    wx.showToast({ title: toastText, icon: 'none' });
  },

  handlePurposeTap(event) {
    const { key } = event.currentTarget.dataset || {};
    this.setData({ purposePendingKey: key });
  },

  handlePurposeCancel() {
    this.setData({ purposePickerVisible: false });
  },

  handlePurposeConfirm() {
    const pendingKey = this.data.purposePendingKey;
    const meta = pendingKey && PURPOSE_MAP[pendingKey] ? PURPOSE_MAP[pendingKey] : null;
    const previousKey = this.data.purposeSelectionKey || '';
    const nextKey = meta ? meta.key : previousKey;
    if (!nextKey && !this.data.tracking) {
      wx.showToast({ title: TOAST.purposeRequired, icon: 'none' });
      return;
    }
    const nextState = {
      purposePickerVisible: false,
      purposeSelectionKey: nextKey || '',
      purposeSelectionLabel: meta ? meta.label : (PURPOSE_MAP[nextKey]?.label || '未选择'),
      purposePendingKey: nextKey || '',
    };
    this.setData(nextState);
    if (this.data.tracking) {
      if (typeof tracker.updatePurposeType === 'function') {
        tracker.updatePurposeType(nextKey || '');
      }
      wx.showToast({ title: TOAST.purposeUpdated, icon: 'none' });
      return;
    }
    this.beginTrackingWithPurpose(nextKey || '');
  },

  beginTrackingWithPurpose(purposeKey) {
    if (!purposeKey || !PURPOSE_MAP[purposeKey]) {
      wx.showToast({ title: TOAST.purposeRequired, icon: 'none' });
      this.openPurposePicker();
      return;
    }
    if (!this.data.locationAuthorized) {
      this.setData({ showLocationPrompt: true });
      wx.showToast({ title: TOAST.requireLocation, icon: 'none' });
      return;
    }
    const weight = this.data.weight || 60;
    const privacyLevel = this.data.privacyOptions[this.data.privacyIndex]?.key || 'private';
    this.setData({ manualActivityKey: '', activityManual: false });
    if (typeof tracker.updateActivityTypeOverride === 'function') {
      tracker.updateActivityTypeOverride('');
    }
    tracker
      .startTracking({
        privacyLevel,
        title: this.data.title,
        note: this.data.note,
        weight,
        purposeType: purposeKey,
        activityType: '',
      })
      .then(() => {
        const recent = getRecentSettings() || {};
        saveRecentSettings({
          ...recent,
          privacyLevel,
          weight,
          keepScreenPreferred: this.data.keepScreenOnPreferred,
        });
        api
          .saveUserSettings({
            privacyLevel,
            weight,
            autoSync: recent.autoSync,
            keepScreenPreferred: this.data.keepScreenOnPreferred,
          })
          .catch(() => {});
        this.setData({ photos: [] });
      })
      .catch((error) => {
        logger.warn('startTracking failed', error?.errMsg || error);
        if (error?.code === 'PURPOSE_REQUIRED') {
          wx.showToast({ title: TOAST.purposeRequired, icon: 'none' });
          this.openPurposePicker();
          return;
        }
        wx.showToast({ title: TOAST.startFailed, icon: 'none' });
      });
  },

  handleStart() {
    if (!this.ensureProfileReadyForTracking()) {
      return;
    }
    if (!this.data.locationAuthorized) {
      this.setData({ showLocationPrompt: true });
      wx.showToast({ title: TOAST.requireLocation, icon: 'none' });
      return;
    }
    this.refreshCurrentLocation();
    this.openPurposePicker();
  },

  handleLocateTap() {
    const latitude = Number(this.data.userLatitude);
    const longitude = Number(this.data.userLongitude);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      wx.showToast({ title: '正在获取位置...', icon: 'none' });
      this.refreshCurrentLocation();
      return;
    }
    this.setData({ locateAnimationActive: true });
    if (this.mapContext) {
      this.mapContext.moveToLocation({ latitude, longitude });
    }
    setTimeout(() => {
      this.setData({ locateAnimationActive: false });
    }, 300);
  },

  // 专供自定义导航栏返回按钮使用的安全返回逻辑
  handleNavigateBackConfirm() {
    if (this.data.tracking || this.data.paused) {
      wx.showModal({
        title: '提示',
        content: '记录尚未结束，确定要退出吗？退出后本次记录将不会保存。',
        confirmText: '退出',
        cancelText: '继续记录',
        success: (res) => {
          if (res.confirm) {
            // 标记为主动离开，避免 onHide 再次弹窗
            this.__leavingExplicitly = true;
            try {
              // 主动取消当前记录，不保存为轨迹
              tracker.cancelTracking && tracker.cancelTracking().catch(() => {});
            } catch (error) {
              logger.warn(
                'cancelTracking on navigateBackConfirm failed',
                error?.errMsg || error
              );
            }
            wx.navigateBack({
              fail: () => wx.switchTab({ url: '/pages/index/index' }),
            });
          }
        },
      });
      return;
    }
    wx.navigateBack({ fail: () => wx.switchTab({ url: '/pages/index/index' }) });
  },

  handleNavigateBack() {
    if (this.data.tracking || this.data.paused) {
      wx.showModal({
        title: '提示',
        content: '记录尚未完成，确定要退出吗？退出后当前数据将丢失。',
        confirmText: '退出',
        cancelText: '继续记录',
        success: (res) => {
          if (res.confirm) {
            wx.navigateBack({ fail: () => wx.switchTab({ url: '/pages/index/index' }) });
          }
        },
      });
      return;
    }
    wx.navigateBack({ fail: () => wx.switchTab({ url: '/pages/index/index' }) });
  },

  handlePause() {
    tracker.pauseTracking();
  },

  handleResume() {
    tracker.resumeTracking();
  },

  handleFinishPrompt() {
    if (!this.data.tracking) {
      return;
    }

    // Refresh privacy preference
    try {
      const settings = typeof getRecentSettings === 'function' ? getRecentSettings() || {} : {};
      const storedPrivacyKey = settings.privacyLevel;
      if (storedPrivacyKey && Array.isArray(this.data.privacyOptions)) {
        const index = this.data.privacyOptions.findIndex(
          (item) => item && item.key === storedPrivacyKey
        );
        if (index >= 0 && index !== this.data.privacyIndex) {
          this.setData({ privacyIndex: index });
        }
      }
    } catch (error) {
      logger.warn('refresh privacy before finish failed', error?.errMsg || error?.message || error);
    }

    const autoPaused = !this.data.paused;
    if (autoPaused) {
      tracker.pauseTracking();
    }

    // Get the last GPS point as raw end point
    const state = tracker.getTrackerState ? tracker.getTrackerState() : {};
    const points = state.points || [];
    const lastPoint = points.length ? points[points.length - 1] : null;
    const endLat = lastPoint ? lastPoint.latitude : this.data.centerLatitude;
    const endLng = lastPoint ? lastPoint.longitude : this.data.centerLongitude;
    const startPoint = points.length ? points[0] : null;

    // Build polyline for the end point confirmation map
    const endPolyline = this.data.polyline && this.data.polyline.length ? this.data.polyline : [];

    // GPS end marker
    const gpsEndMarker = {
      id: 900,
      latitude: endLat,
      longitude: endLng,
      iconPath: '/assets/icons/end.png',
      width: 28,
      height: 28,
      callout: { content: 'GPS\u7EC8\u70B9', bgColor: '#94a3b8', color: '#ffffff', borderRadius: 8, padding: 6, fontSize: 12, display: 'ALWAYS' },
    };

    this.setData({
      finishAutoPaused: autoPaused,
      wizardVisible: true,
      wizardStep: 1,
      wizardEndLat: endLat,
      wizardEndLng: endLng,
      wizardMapScale: 18,
      wizardEndMarkers: [gpsEndMarker],
      wizardEndPolyline: endPolyline,
      wizardEndConfirmed: false,
      wizardEndDistText: '',
      wizardConfirmedEndLat: null,
      wizardConfirmedEndLng: null,
      wizardRawEndLat: endLat,
      wizardRawEndLng: endLng,
      wizardEndDistMeters: 0,
      satisfactionScore: 4,
      satisfactionEmoji: SATISFACTION_CONFIG[3].emoji,
      satisfactionLabel: SATISFACTION_CONFIG[3].label,
      satisfactionColor: SATISFACTION_CONFIG[3].color,
      preferenceOptions: PREFERENCE_OPTIONS.map((o) => ({ ...o, selected: false })),
      preferenceHasOther: false,
      preferenceHasSelection: false,
      feedbackReasonText: '',
      wizardLoadingRoutes: false,
      wizardRouteMapReady: false,
      wizardAlternatives: [],
    });

    // Store route points info for later steps
    this._wizardStartPoint = startPoint;
    this._wizardEndPoint = lastPoint;
    this._wizardPoints = points;
  },

  handleWizardCancel() {
    const shouldResume = this.data.finishAutoPaused;
    this.setData({
      wizardVisible: false,
      wizardStep: 1,
      finishAutoPaused: false,
    });
    if (shouldResume) {
      tracker.resumeTracking();
    }
  },

  handleWizardPrev() {
    const step = this.data.wizardStep;
    if (step <= 1) {
      return;
    }
    this.setData({ wizardStep: step - 1 });
  },

  handleWizardNext() {
    const step = this.data.wizardStep;
    if (step >= 4) {
      return;
    }
    const nextStep = step + 1;
    this.setData({ wizardStep: nextStep });

    // When entering step 3, fetch alternative routes
    if (nextStep === 3) {
      this.loadAlternativeRoutes();
    }
  },

  // ── Step 1: End Point Confirmation ──

  handleWizardMapTap(event) {
    const { latitude, longitude } = event.detail || {};
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      return;
    }

    const rawLat = this.data.wizardRawEndLat;
    const rawLng = this.data.wizardRawEndLng;
    const distMeters = calculateSegmentDistance(
      { latitude: rawLat, longitude: rawLng },
      { latitude, longitude }
    );
    const distText = distMeters >= 1000
      ? `${(distMeters / 1000).toFixed(1)}km`
      : `${Math.round(distMeters)}m`;

    // GPS end marker
    const gpsMarker = {
      id: 900,
      latitude: rawLat,
      longitude: rawLng,
      iconPath: '/assets/icons/end.png',
      width: 24,
      height: 24,
      callout: { content: 'GPS\u7EC8\u70B9', bgColor: '#94a3b8', color: '#ffffff', borderRadius: 8, padding: 6, fontSize: 11, display: 'ALWAYS' },
    };

    // User confirmed end marker
    const confirmedMarker = {
      id: 901,
      latitude,
      longitude,
      iconPath: '/assets/icons/start.png',
      width: 32,
      height: 32,
      callout: { content: '\u786E\u8BA4\u7EC8\u70B9', bgColor: '#2563eb', color: '#ffffff', borderRadius: 8, padding: 6, fontSize: 12, display: 'ALWAYS' },
    };

    this.setData({
      wizardEndConfirmed: true,
      wizardConfirmedEndLat: latitude,
      wizardConfirmedEndLng: longitude,
      wizardEndDistMeters: distMeters,
      wizardEndDistText: distText,
      wizardEndMarkers: [gpsMarker, confirmedMarker],
    });
  },

  // ── Step 2: Satisfaction Rating ──

  handleSatisfactionChanging(event) {
    this._updateSatisfaction(event.detail.value);
  },

  handleSatisfactionChange(event) {
    this._updateSatisfaction(event.detail.value);
  },

  handleSatisfactionTick(event) {
    const val = Number(event.currentTarget.dataset.val);
    if (val >= 1 && val <= 7) {
      this._updateSatisfaction(val);
    }
  },

  _updateSatisfaction(score) {
    const safeScore = Math.max(1, Math.min(7, Math.round(Number(score) || 4)));
    const cfg = SATISFACTION_CONFIG[safeScore - 1] || SATISFACTION_CONFIG[3];
    this.setData({
      satisfactionScore: safeScore,
      satisfactionEmoji: cfg.emoji,
      satisfactionLabel: cfg.label,
      satisfactionColor: cfg.color,
    });
  },

  // ── Step 3: Route Preference Survey ──

  handlePreferenceToggle(event) {
    const key = event.currentTarget.dataset.key;
    const options = this.data.preferenceOptions.map((o) => {
      if (o.key === key) {
        return { ...o, selected: !o.selected };
      }
      return { ...o };
    });
    const hasOther = options.some((o) => o.key === 'other' && o.selected);
    const hasSelection = options.some((o) => o.selected);
    this.setData({
      preferenceOptions: options,
      preferenceHasOther: hasOther,
      preferenceHasSelection: hasSelection,
    });
  },

  handleFeedbackReasonInput(event) {
    this.setData({ feedbackReasonText: event.detail.value || '' });
  },

  loadAlternativeRoutes() {
    if (this.data.wizardRouteMapReady || this.data.wizardLoadingRoutes) {
      return;
    }
    const startPoint = this._wizardStartPoint;
    const endPoint = this._wizardEndPoint;
    const points = this._wizardPoints || [];

    if (!startPoint || !endPoint) {
      this.setData({ wizardRouteMapReady: true });
      return;
    }

    // Determine activity mode for route fetching
    const mode = this.data.activityKey === 'ride' ? 'ride' : 'walk';

    // Actual route distance
    const actualDist = Number(this.data.distanceText.replace(/[^0-9.]/g, '')) || 0;
    const actualDistText = actualDist > 0 ? `${actualDist} km` : this.data.distanceText;

    this.setData({ wizardLoadingRoutes: true, wizardActualDistText: actualDistText });

    fetchAlternativeRoutes({ start: startPoint, end: endPoint, mode })
      .then((result) => {
        const alternatives = (result.alternatives || []).slice(0, 3);

        // Build polylines: actual route (blue) + alternatives (orange, green, pink)
        const polylines = [];

        // Actual user route
        if (points.length >= 2) {
          polylines.push({
            points: points.map((p) => ({ latitude: p.latitude, longitude: p.longitude })),
            color: '#2563eb',
            width: 6,
            arrowLine: true,
          });
        }

        // Alternative routes
        const altData = alternatives.map((alt, idx) => {
          const color = ALT_ROUTE_COLORS[idx] || '#9ca3af';
          const label = ALT_ROUTE_LABELS[idx] || String(idx + 1);
          polylines.push({
            points: alt.points,
            color,
            width: 4,
            dottedLine: true,
          });
          const distKm = alt.distance >= 1000
            ? `${(alt.distance / 1000).toFixed(1)}km`
            : `${Math.round(alt.distance)}m`;
          const durMin = alt.duration >= 60
            ? `${Math.round(alt.duration / 60)}\u5206\u949F`
            : `${alt.duration}\u79D2`;
          return { label, color, distText: distKm, durText: durMin, index: idx };
        });

        // Include points for auto-fit
        const allPoints = [];
        if (startPoint) allPoints.push({ latitude: startPoint.latitude, longitude: startPoint.longitude });
        if (endPoint) allPoints.push({ latitude: endPoint.latitude, longitude: endPoint.longitude });

        // Start/end markers
        const markers = [
          {
            id: 800,
            latitude: startPoint.latitude,
            longitude: startPoint.longitude,
            iconPath: '/assets/icons/start.png',
            width: 28,
            height: 28,
            callout: { content: '\u8D77\u70B9', bgColor: '#22c55e', color: '#ffffff', borderRadius: 8, padding: 6, fontSize: 12, display: 'ALWAYS' },
          },
          {
            id: 801,
            latitude: endPoint.latitude,
            longitude: endPoint.longitude,
            iconPath: '/assets/icons/end.png',
            width: 28,
            height: 28,
            callout: { content: '\u7EC8\u70B9', bgColor: '#ef4444', color: '#ffffff', borderRadius: 8, padding: 6, fontSize: 12, display: 'ALWAYS' },
          },
        ];

        const centerLat = (startPoint.latitude + endPoint.latitude) / 2;
        const centerLng = (startPoint.longitude + endPoint.longitude) / 2;

        this.setData({
          wizardLoadingRoutes: false,
          wizardRouteMapReady: true,
          wizardRouteCenterLat: centerLat,
          wizardRouteCenterLng: centerLng,
          wizardRouteMapScale: 15,
          wizardRouteMarkers: markers,
          wizardRoutePolylines: polylines,
          wizardRouteIncludePoints: allPoints,
          wizardAlternatives: altData,
        });
      })
      .catch((error) => {
        logger.warn('loadAlternativeRoutes failed', error?.errMsg || error?.message || error);
        this.setData({
          wizardLoadingRoutes: false,
          wizardRouteMapReady: true,
          wizardAlternatives: [],
        });
      });
  },

  // ── Step 4: Save ──

  handleWizardSave() {
    if (this.data.uploading) {
      return;
    }

    // Collect feedback data
    const feedbackMeta = {
      confirmedEndLatitude: this.data.wizardConfirmedEndLat,
      confirmedEndLongitude: this.data.wizardConfirmedEndLng,
      confirmedEndDistanceMeters: this.data.wizardEndDistMeters || null,
      rawEndLatitude: this.data.wizardRawEndLat,
      rawEndLongitude: this.data.wizardRawEndLng,
      feedbackSatisfactionScore: this.data.satisfactionScore,
      feedbackPreferenceLabels: this.data.preferenceOptions
        .filter((o) => o.selected)
        .map((o) => o.key),
      feedbackReasonText: this.data.feedbackReasonText || null,
      feedbackSource: 'wizard',
    };

    this._wizardFeedbackMeta = feedbackMeta;
    this.finalizeTracking().then((result) => {
      const { success, route } = result || {};
      if (!success) {
        this.setData({
          wizardVisible: false,
          wizardStep: 1,
          finishAutoPaused: false,
          photos: [],
        });
        return;
      }
      this.setData({ photos: [] });
      this.handleRouteReward(route);
    });
  },

  handleFinishCancel() {
    this.handleWizardCancel();
  },

  handleFinishSave() {
    this.handleWizardSave();
  },

  ensureProfileReadyForTracking() {
    if (!app || typeof app.getProfileCompletionStatus !== 'function') {
      return true;
    }
    const { complete } = app.getProfileCompletionStatus();
    if (complete) {
      return true;
    }
    if (typeof app.checkAndPromptProfileCompletion === 'function') {
      app.checkAndPromptProfileCompletion('record_start');
    } else {
      wx.showToast({ title: TOAST.profileIncomplete, icon: 'none' });
    }
    return false;
  },

  finalizeTracking() {
    if (this.data.uploading) {
      return Promise.resolve({ success: false, route: null });
    }
    const privacyLevel = this.data.privacyOptions[this.data.privacyIndex]?.key || 'private';
    const weight = this.data.weight || 60;
    this.setData({ uploading: true });
    return media
      .ensureRemotePhotos(this.data.photos, { continueOnError: true })
      .then((uploadedPhotos) => {
        const normalizedUploaded = normalizePhotos(uploadedPhotos || []);
        const failedCount = normalizedUploaded.filter((item) => item.uploadError).length;
        this.setData({
          photos: normalizedUploaded,
          syncHintText: getSyncHintText(),
        });
        if (failedCount > 0) {
          wx.showToast({ title: `${failedCount} 张图片上传失败，可稍后重试`, icon: 'none' });
        }
        const feedbackMeta = this._wizardFeedbackMeta || {};
        return tracker.stopTracking({
          title: this.data.title,
          note: this.data.note,
          privacyLevel,
          photos: normalizedUploaded.filter((item) => !item.uploadError),
          weight,
          purposeType: this.data.purposeSelectionKey,
          confirmedEndLatitude: feedbackMeta.confirmedEndLatitude || null,
          confirmedEndLongitude: feedbackMeta.confirmedEndLongitude || null,
          confirmedEndDistanceMeters: feedbackMeta.confirmedEndDistanceMeters || null,
          rawEndLatitude: feedbackMeta.rawEndLatitude || null,
          rawEndLongitude: feedbackMeta.rawEndLongitude || null,
          feedbackSatisfactionScore: feedbackMeta.feedbackSatisfactionScore || null,
          feedbackPreferenceLabels: feedbackMeta.feedbackPreferenceLabels || null,
          feedbackReasonText: feedbackMeta.feedbackReasonText || null,
          feedbackSource: feedbackMeta.feedbackSource || 'wizard',
        });
      })
      .then((result) => {
        const route = result?.route || null;
        const cloudSaved = result?.cloudSaved === true;
        const localFallback = result?.localFallback === true;
        if (cloudSaved) {
          wx.showToast({
            title: TOAST.routeSaved,
            icon: 'success',
          });
          return { success: true, route, cloudSaved: true, localFallback: false };
        }
        if (localFallback && route) {
          wx.showToast({
            title: TOAST.routeSavedLocalOnly,
            icon: 'none',
          });
          return { success: false, route, cloudSaved: false, localFallback: true };
        }
        wx.showToast({ title: TOAST.routeSaveFailed, icon: 'none' });
        return { success: false, route: null, cloudSaved: false, localFallback: false };
      })
      .catch((error) => {
        logger.warn('stopTracking failed', error?.errMsg || error);
        wx.showToast({ title: TOAST.routeSaveFailed, icon: 'none' });
        return { success: false, route: null };
      })
      .finally(() => {
        this.setData({ uploading: false });
      });
  },

  handleRouteReward(route) {
    if (!route || !route.id) {
      this.setData({ wizardVisible: false, wizardStep: 1 });
      wx.switchTab({ url: '/pages/index/index' });
      return;
    }
    let rewardResult = null;
    try {
      rewardResult = rewards.awardPointsForRoute(route);
    } catch (error) {
      logger.warn('awardPointsForRoute failed', error?.errMsg || error?.message || error);
    }
    if (!rewardResult || !rewardResult.evaluation) {
      this.setData({ wizardVisible: false, wizardStep: 1 });
      wx.switchTab({ url: '/pages/index/index' });
      return;
    }
    if (!rewardResult.evaluation.valid || rewardResult.pointsAwarded <= 0) {
      wx.showToast({ title: TOAST.rewardInvalid, icon: 'none' });
      setTimeout(() => {
        this.setData({ wizardVisible: false, wizardStep: 1 });
        wx.switchTab({ url: '/pages/index/index' });
      }, 800);
      return;
    }
    const distanceMeters = Number(route?.stats?.distance) || 0;
    const distanceText = `${(distanceMeters / 1000).toFixed(1)} km`;
    const durationText = this.formatRewardDuration(route?.stats?.duration);
    const summary = {
      title: rewardResult.hasPhoto ? '\uD83C\uDF89 \u5B8C\u6210\u8BB0\u5F55\u5E76\u6253\u5361\uFF01' : '\uD83C\uDF89 \u5B8C\u6210\u8BB0\u5F55\uFF01',
      distanceText,
      durationText,
      hasPhoto: rewardResult.hasPhoto,
      photoCount: rewardResult.photoCount || 0,
      gainedPoints: rewardResult.pointsAwarded,
      totalPoints: rewardResult.totalPoints,
      starIcons: rewardResult.pointsAwarded === 2 ? '\u2B50\u2B50' : '\u2B50',
    };
    this.setData({
      wizardStep: 5,
      rewardSummary: summary,
    });
  },

  formatRewardDuration(durationMs) {
    const duration = Number(durationMs) || 0;
    if (duration <= 0) {
      return '00:00';
    }
    const totalSeconds = Math.floor(duration / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    const pad = (value) => (value < 10 ? `0${value}` : `${value}`);
    if (hours > 0) {
      return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
    }
    return `${pad(minutes)}:${pad(seconds)}`;
  },

  handleRewardConfirm() {
    this.setData({
      wizardVisible: false,
      wizardStep: 1,
      rewardModalVisible: false,
      rewardSummary: null,
    });
    wx.switchTab({ url: '/pages/index/index' });
  },

  handleTitleInput(event) {
    this.setData({ title: event.detail.value });
  },

  handleNoteInput(event) {
    this.setData({ note: event.detail.value });
  },

  handlePrivacyChange(event) {
    const key = event.detail.value;
    const index = this.data.privacyOptions.findIndex((item) => item.key === key);
    if (index >= 0) {
      this.setData({ privacyIndex: index });
    }
  },

  handleKeepScreenToggle(event) {
    const keepOn = Boolean(event?.detail?.value);
    this.setData({ keepScreenOnPreferred: keepOn });
    if (typeof tracker.setKeepScreenPreference === 'function') {
      tracker.setKeepScreenPreference(keepOn);
    }
    const recent = getRecentSettings() || {};
    saveRecentSettings({ ...recent, keepScreenPreferred: keepOn });
    api
      .saveUserSettings({
        privacyLevel: recent.privacyLevel,
        weight: recent.weight,
        autoSync: recent.autoSync,
        keepScreenPreferred: keepOn,
      })
      .catch(() => {});
    if (typeof wx.setKeepScreenOn === 'function') {
      try {
        wx.setKeepScreenOn({ keepScreenOn: keepOn });
      } catch (error) {
        logger.warn('setKeepScreenOn toggle failed', error?.errMsg || error);
      }
    }
  },

  handleAddPhoto() {
    if (this.data.photos.length >= MAX_PHOTOS) {
      wx.showToast({ title: TOAST.maxPhotos, icon: 'none' });
      return;
    }
    // ��ͼǰ����ǰ��¼״̬����ʱ�ر� tracking ���Դ� onHide �ж�
    const trackingBeforePhoto = this.data.tracking;
    const pausedBeforePhoto = this.data.paused;
    if (trackingBeforePhoto || pausedBeforePhoto) {
      this.__hidePromptStateBackup = {
        tracking: trackingBeforePhoto,
        paused: pausedBeforePhoto,
      };
      this.setData({
        tracking: false,
        paused: false,
      });
    } else {
      this.__hidePromptStateBackup = null;
    }
    wx.chooseMedia({
      count: MAX_PHOTOS - this.data.photos.length,
      mediaType: ['image'],
      sourceType: ['camera'],
      sizeType: ['compressed'],
      success: (res) => {
        const newPhotos = res.tempFiles.map((file) => ({
          path: file.tempFilePath,
          note: '',
          uploadState: 'pending',
          uploadError: '',
        }));
        const normalized = normalizePhotos([...this.data.photos, ...newPhotos]);
        this.setData({ photos: normalized, syncHintText: getSyncHintText() });
      },
      complete: () => {
        const backup = this.__hidePromptStateBackup;
        this.__hidePromptStateBackup = null;
        if (backup && (backup.tracking || backup.paused)) {
          this.setData({
            tracking: backup.tracking,
            paused: backup.paused,
          });
        }
      },
    });
  },

  handleRemovePhoto(event) {
    const { index } = event.currentTarget.dataset || {};
    const nextPhotos = this.data.photos.filter((_, i) => i !== Number(index));
    this.setData({ photos: nextPhotos, syncHintText: getSyncHintText() });
  },

  handleRetryPhoto(event) {
    const { index, silent } = event.currentTarget.dataset || {};
    const targetIndex = Number(index);
    const silentMode = silent === true || silent === 'true';
    if (!Number.isFinite(targetIndex) || targetIndex < 0) {
      return Promise.resolve(false);
    }

    const photos = normalizePhotos(this.data.photos);
    const target = photos[targetIndex];
    if (!target || !target.path) {
      return Promise.resolve(false);
    }

    const nextPhotos = photos.map((item, i) => {
      if (i !== targetIndex) {
        return item;
      }
      return {
        ...item,
        uploadState: 'uploading',
        uploadError: '',
      };
    });
    this.setData({ photos: nextPhotos, syncHintText: getSyncHintText() });

    return media
      .uploadSinglePhoto({ path: target.path, note: target.note || '' })
      .then((uploaded) => {
        const afterSuccess = normalizePhotos(this.data.photos).map((item, i) => {
          if (i !== targetIndex) {
            return item;
          }
          return {
            ...item,
            path: uploaded.path || item.path,
            uploadState: 'done',
            uploadError: '',
          };
        });
        this.setData({ photos: afterSuccess, syncHintText: getSyncHintText() });
        if (!silentMode) {
          wx.showToast({ title: '图片重传成功', icon: 'success' });
        }
        return true;
      })
      .catch((error) => {
        const message = error?.message || error?.errMsg || '重传失败';
        const afterFail = normalizePhotos(this.data.photos).map((item, i) => {
          if (i !== targetIndex) {
            return item;
          }
          return {
            ...item,
            uploadState: 'failed',
            uploadError: message,
          };
        });
        this.setData({ photos: afterFail, syncHintText: getSyncHintText() });
        if (!silentMode) {
          wx.showToast({ title: '图片重传失败', icon: 'none' });
        }
        return false;
      });
  },

  handleRetryAllPhotos() {
    if (this._batchRetrying) {
      return;
    }
    const photos = normalizePhotos(this.data.photos);
    const failedIndices = [];
    photos.forEach((item, index) => {
      if (item && item.uploadError) {
        failedIndices.push(index);
      }
    });
    if (!failedIndices.length) {
      wx.showToast({ title: '没有需要重传的图片', icon: 'none' });
      return;
    }

    this._batchRetrying = true;
    this.setData({
      batchRetrying: true,
      batchRetryProgressText: `重传中 0/${failedIndices.length}`,
    });

    const retrySequentially = (cursor = 0, successCount = 0) => {
      if (cursor >= failedIndices.length) {
        this._batchRetrying = false;
        this.setData({
          batchRetrying: false,
          batchRetryProgressText: `已完成 ${successCount}/${failedIndices.length}`,
        });
        wx.showToast({ title: `批量重传完成(${successCount}/${failedIndices.length})`, icon: 'none' });
        return;
      }

      this
        .handleRetryPhoto({ currentTarget: { dataset: { index: failedIndices[cursor], silent: true } } })
        .then((ok) => {
          const nextCursor = cursor + 1;
          const nextSuccess = successCount + (ok ? 1 : 0);
          this.setData({
            batchRetryProgressText: `重传中 ${nextCursor}/${failedIndices.length}（成功 ${nextSuccess}）`,
          });
          setTimeout(() => retrySequentially(nextCursor, nextSuccess), 120);
        })
        .catch(() => {
          const nextCursor = cursor + 1;
          this.setData({
            batchRetryProgressText: `重传中 ${nextCursor}/${failedIndices.length}（成功 ${successCount}）`,
          });
          setTimeout(() => retrySequentially(nextCursor, successCount), 120);
        });
    };

    retrySequentially(0, 0);
  },

  handlePreviewPhoto(event) {
    const { index } = event.currentTarget.dataset || {};
    const photos = this.data.photos;
    if (!photos.length) {
      return;
    }
    const trackingBeforePreview = this.data.tracking;
    const pausedBeforePreview = this.data.paused;
    if (trackingBeforePreview || pausedBeforePreview) {
      this.__hidePromptStateBackup = {
        tracking: trackingBeforePreview,
        paused: pausedBeforePreview,
      };
      this.setData({
        tracking: false,
        paused: false,
      });
    } else {
      this.__hidePromptStateBackup = null;
    }
    wx.previewImage({
      current: photos[Number(index)]?.path,
      urls: photos.map((item) => item.path),
      complete: () => {
        const backup = this.__hidePromptStateBackup;
        this.__hidePromptStateBackup = null;
        if (backup && (backup.tracking || backup.paused)) {
          this.setData({
            tracking: backup.tracking,
            paused: backup.paused,
          });
        }
      },
    });
  },

  handleLocationPermissionAuthorize() {
    if (this.data.locationPromptPending) {
      return;
    }
    this.setData({ locationPromptPending: true });
    const trackingBefore = this.data.tracking;
    const pausedBefore = this.data.paused;
    if (trackingBefore || pausedBefore) {
      this.__hidePromptStateBackup = {
        tracking: trackingBefore,
        paused: pausedBefore,
      };
      this.setData({
        tracking: false,
        paused: false,
      });
    } else {
      this.__hidePromptStateBackup = null;
    }
    this.requestLocationAccess().finally(() => {
      this.setData({ locationPromptPending: false });
      const backup = this.__hidePromptStateBackup;
      this.__hidePromptStateBackup = null;
      if (backup && (backup.tracking || backup.paused)) {
        this.setData({
          tracking: backup.tracking,
          paused: backup.paused,
        });
      }
    });
  },

  handleLocationPermissionOpenSettings() {
    if (this.data.locationPromptPending) {
      return;
    }
    this.setData({ locationPromptPending: true });
    const trackingBefore = this.data.tracking;
    const pausedBefore = this.data.paused;
    if (trackingBefore || pausedBefore) {
      this.__hidePromptStateBackup = {
        tracking: trackingBefore,
        paused: pausedBefore,
      };
      this.setData({
        tracking: false,
        paused: false,
      });
    } else {
      this.__hidePromptStateBackup = null;
    }
    openLocationSetting()
      .then(() => this.checkLocationPermission(false))
      .catch((error) => {
        logger.warn('openLocationSetting failed', error?.errMsg || error);
        wx.showToast({ title: TOAST.requireLocation, icon: 'none' });
      })
      .finally(() => {
        this.setData({ locationPromptPending: false });
        const backup = this.__hidePromptStateBackup;
        this.__hidePromptStateBackup = null;
        if (backup && (backup.tracking || backup.paused)) {
          this.setData({
            tracking: backup.tracking,
            paused: backup.paused,
          });
        }
      });
  },
}));

