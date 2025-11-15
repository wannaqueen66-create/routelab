'use strict';

const { checkLocationAuthorization, requestLocationAuthorization, openLocationSetting } = require('../../utils/permissions');
const tracker = require('../../services/tracker');
const { PRIVACY_LEVELS } = require('../../constants/privacy');
const { DEFAULT_ACTIVITY_TYPE, ACTIVITY_TYPE_MAP } = require('../../constants/activity');
const { getRecentSettings, saveRecentSettings, getKeepScreenPreference } = require('../../utils/storage');
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
    this.unsubscribe = tracker.subscribe((state) => this.updateState(state));
    this.applySettings();
    this.checkLocationPermission(true);
  },

  onShow() {
    this.checkLocationPermission(false).then(() => {
      if (this.data.locationAuthorized) {
        this.refreshCurrentLocation();
      }
    });
  },

  onReady() {
    this.mapContext = wx.createMapContext('routeMap', this);
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
    const latestPoint = hasRoutePoints ? routePoints[routePoints.length - 1] : DEFAULT_CENTER;
    const userLatitude = hasRoutePoints ? latestPoint.latitude : this.data.userLatitude;
    const userLongitude = hasRoutePoints ? latestPoint.longitude : this.data.userLongitude;

    if (this.data.keepScreenSupported && this.data.keepScreenOnPreferred && isTracking) {
      try {
        wx.setKeepScreenOn({ keepScreenOn: true });
      } catch (error) {
        logger.warn('setKeepScreenOn failed', error?.errMsg || error);
      }
    }

    if (
      this.mapContext &&
      hasRoutePoints &&
      isTracking &&
      !isPaused &&
      (latestPoint.latitude !== this.data.centerLatitude || latestPoint.longitude !== this.data.centerLongitude)
    ) {
      try {
        this.mapContext.moveToLocation({
          latitude: latestPoint.latitude,
          longitude: latestPoint.longitude,
        });
      } catch (error) {
        logger.warn('moveToLocation failed', error?.errMsg || error);
      }
    }

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
    const includePoints = routePoints.length
      ? routePoints.map((point) => ({ ...point }))
      : [];

    this.setData({
      tracking: isTracking,
      paused: isPaused,
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
      centerLatitude: latestPoint.latitude,
      centerLongitude: latestPoint.longitude,
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
    const shouldResume = this.data.finishAutoPaused && this.data.tracking;
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
    wx.previewImage({
      current: photos[Number(index)]?.path,
      urls: photos.map((item) => item.path),
    });
  },

  handleLocationPermissionAuthorize() {
    if (this.data.locationPromptPending) {
      return;
    }
    this.setData({ locationPromptPending: true });
    this.requestLocationAccess()
      .finally(() => {
        this.setData({ locationPromptPending: false });
      });
  },

  handleLocationPermissionOpenSettings() {
    if (this.data.locationPromptPending) {
      return;
    }
    this.setData({ locationPromptPending: true });
    openLocationSetting()
      .then(() => this.checkLocationPermission(false))
      .catch((error) => {
        logger.warn('openLocationSetting failed', error?.errMsg || error);
        wx.showToast({ title: TOAST.requireLocation, icon: 'none' });
      })
      .finally(() => {
        this.setData({ locationPromptPending: false });
      });
  },
});

