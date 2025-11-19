'use strict';

const { checkLocationAuthorization, requestLocationAuthorization, openLocationSetting } = require('../../utils/permissions');
const tracker = require('../../services/tracker');
const { PRIVACY_LEVELS } = require('../../constants/privacy');
const { DEFAULT_ACTIVITY_TYPE, ACTIVITY_TYPE_MAP } = require('../../constants/activity');
const { getRecentSettings, saveRecentSettings, getKeepScreenPreference } = require('../../utils/storage');
const api = require('../../services/api');
const { formatSpeed, formatCalories } = require('../../utils/format');
const { formatDuration } = require('../../utils/time');
const { estimateCalories } = require('../../utils/geo');
const logger = require('../../utils/logger');
const media = require('../../services/media');
const { resolveActivityMeta } = require('../../utils/activity');
const { PURPOSE_OPTIONS, PURPOSE_MAP } = require('../../constants/purpose');
const rewards = require('../../services/rewards');

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

const TOAST = {
  requireLocation: '请先获取定位权限',
  maxPhotos: '最多选择 9 张图片',
  startFailed: '无法开始记录，请稍后重试',
  routeSaved: '路线已保存',
  routeSaveFailed: '未能保存路线，请稍后重试',
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
      return { path: item, note: '' };
    }
    return {
      path: item.path,
      note: item.note || '',
    };
  });
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

Page({
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
    locateAnimationActive: false,
  },

  onLoad() {
    this._lastAutoCenterAt = 0;
    this._lastUserMapInteractionAt = 0;
    this.unsubscribe = tracker.subscribe((state) => this.updateState(state));
    this.applySettings();
    this.checkLocationPermission(true);
    // 记录当前页面栈深度，后续用于识别系统返回导致的离开
    if (typeof getCurrentPages === 'function') {
      this.__routeStackDepth = (getCurrentPages() || []).length;
    }
  },

  onShow() {
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

    this.setData({
      tracking: trackingFlag,
      paused: pausedFlag,
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

    // 打开完成面板前刷新一次隐私偏好，默认值与个人主页设置保持一致
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
      logger.warn(
        'refresh privacy from settings before finish failed',
        error?.errMsg || error?.message || error
      );
    }

    const autoPaused = !this.data.paused;
    if (autoPaused) {
      tracker.pauseTracking();
    }
    this.setData({
      finishSheetVisible: true,
      finishAutoPaused: autoPaused,
    });
  },

  handleFinishCancel() {
    // ������¼������ѡ��ȡ��ʱ������Ƿ��Զ�����¼ʱ��Ҫ�ָ�
    const shouldResume = this.data.finishAutoPaused;
    this.setData({
      finishSheetVisible: false,
      finishAutoPaused: false,
    });
    if (shouldResume) {
      tracker.resumeTracking();
    }
  },

  handleFinishSave() {
    if (this.data.uploading) {
      return;
    }
    this.finalizeTracking().then((result) => {
      const { success, route } = result || {};
      if (!success) {
        return;
      }
      this.setData({
        finishSheetVisible: false,
        finishAutoPaused: false,
        photos: [],
      });
      this.handleRouteReward(route);
    });
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
      .ensureRemotePhotos(this.data.photos)
      .then((uploadedPhotos) =>
        tracker.stopTracking({
          title: this.data.title,
          note: this.data.note,
          privacyLevel,
          photos: uploadedPhotos,
          weight,
          purposeType: this.data.purposeSelectionKey,
        })
      )
      .then((route) => {
        const success = Boolean(route);
        wx.showToast({
          title: success ? TOAST.routeSaved : TOAST.routeSaveFailed,
          icon: success ? 'success' : 'none',
        });
        return { success, route: success ? route : null };
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
      wx.switchTab({ url: '/pages/index/index' });
      return;
    }
    if (!rewardResult.evaluation.valid || rewardResult.pointsAwarded <= 0) {
      wx.showToast({ title: TOAST.rewardInvalid, icon: 'none' });
      setTimeout(() => {
        wx.switchTab({ url: '/pages/index/index' });
      }, 800);
      return;
    }
    const distanceMeters = Number(route?.stats?.distance) || 0;
    const distanceText = `${(distanceMeters / 1000).toFixed(1)} km`;
    const durationText = this.formatRewardDuration(route?.stats?.duration);
    const summary = {
      title: rewardResult.hasPhoto ? '🎉 完成记录并打卡！' : '🎉 完成记录！',
      distanceText,
      durationText,
      hasPhoto: rewardResult.hasPhoto,
      photoCount: rewardResult.photoCount || 0,
      gainedPoints: rewardResult.pointsAwarded,
      totalPoints: rewardResult.totalPoints,
      starIcons: rewardResult.pointsAwarded === 2 ? '⭐⭐' : '⭐',
    };
    this.setData({
      rewardModalVisible: true,
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
        const newPhotos = res.tempFiles.map((file) => ({ path: file.tempFilePath, note: '' }));
        const normalized = normalizePhotos([...this.data.photos, ...newPhotos]);
        this.setData({ photos: normalized });
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
    this.setData({ photos: nextPhotos });
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
});

