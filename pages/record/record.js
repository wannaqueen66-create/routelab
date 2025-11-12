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
const { inferActivityType, resolveActivityMeta } = require('../../utils/activity');
const { PURPOSE_OPTIONS, PURPOSE_MAP } = require('../../constants/purpose');

const DEFAULT_ACTIVITY_META = resolveActivityMeta(DEFAULT_ACTIVITY_TYPE);

const DEFAULT_CENTER = {
  latitude: 30.27415,
  longitude: 120.15515,
};

const MAX_PHOTOS = 9;

const ACTIVITY_ICONS = {
  walk: '??',
  run: '??',
  ride: '??',
};

const FINISH_PRIVACY_OPTIONS =
  PRIVACY_LEVELS.filter((item) => ['public', 'private'].includes(item.key)) || PRIVACY_LEVELS;

const ACTIVITY_CHOICES = ['walk', 'run', 'ride']
  .map((key) => ACTIVITY_TYPE_MAP[key] || resolveActivityMeta(key))
  .filter(Boolean);

const TOAST = {
  requireLocation: '请先获取定位权限',
  maxPhotos: '最多选择 9 张图片',
  startFailed: '无法开始记录，请稍后重试',
  routeSaved: '路线已保存',
  routeSaveFailed: '未能保存路线，请稍后重试',
  purposeRequired: '请选择本次运动的目的',
  purposeUpdated: '运动目的已更新',
};

function getActivityIcon(key) {
  if (!key) {
    return ACTIVITY_ICONS.walk;
  }
  return ACTIVITY_ICONS[key] || ACTIVITY_ICONS.walk;
}

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
    pausePoints: [],
    purposeOptions: PURPOSE_OPTIONS,
    purposeSelectionKey: '',
    purposeSelectionLabel: '未选择',
    purposeSelectionIcon: '',
    purposeSelectionDescription: '',
    purposePickerVisible: false,
    purposePendingKey: '',
    privacyOptions: FINISH_PRIVACY_OPTIONS,
    privacyIndex: 0,
    activityKey: DEFAULT_ACTIVITY_TYPE,
    activityLabel: DEFAULT_ACTIVITY_META.label,
    activityDescription: DEFAULT_ACTIVITY_META.description,
    activityStatusText: '准备开始',
    activityIcon: getActivityIcon(DEFAULT_ACTIVITY_TYPE),
    title: '',
    note: '',
    keepScreenOnPreferred: false,
    keepScreenSupported: typeof wx.setKeepScreenOn === 'function',
    locationAuthorized: true,
    hasRoutePoints: false,
    centerLatitude: DEFAULT_CENTER.latitude,
    centerLongitude: DEFAULT_CENTER.longitude,
    weight: 60,
    photos: [],
    locationScope: 'none',
    showLocationPrompt: false,
    locationPromptPending: false,
    uploading: false,
    finishSheetVisible: false,
    finishAutoPaused: false,
  },

  onLoad() {
    this.unsubscribe = tracker.subscribe((state) => this.updateState(state));
    this.applySettings();
    this.checkLocationPermission(true);
  },

  onShow() {
    this.checkLocationPermission(false);
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

  updateState(state = {}) {
    const stats = state.stats || {};
    const distance = stats.distance || 0;
    const duration = stats.duration || 0;
    const speed = stats.speed || 0;
    const points = Array.isArray(state.points) ? state.points : [];
    const isTracking = Boolean(state.active);
    const isPaused = Boolean(state.paused);

    let activityKey =
      state.detectedActivityType || inferActivityType({ distance, duration, speed, points }) || this.data.activityKey;
    if (!activityKey) {
      activityKey = DEFAULT_ACTIVITY_TYPE;
    }
    const activityMeta = resolveActivityMeta(activityKey) || ACTIVITY_TYPE_MAP[DEFAULT_ACTIVITY_TYPE];
    const weight = this.data.weight || 60;
    const durationText = formatDuration(duration);
    const distanceText = `${(distance / 1000).toFixed(1)} km`;
    const speedText = formatSpeedByActivity(activityMeta.key, speed);
    const caloriesValue = distance ? estimateCalories(distance, weight, activityMeta.key) : 0;
    const caloriesText = formatCalories(caloriesValue);
    const stepsText = activityMeta.key === 'ride' ? '--' : `${Math.round(distance / 0.75)}`;
    const hasPoints = points.length > 0;
    const latestPoint = hasPoints ? points[points.length - 1] : DEFAULT_CENTER;

    if (this.data.keepScreenSupported && this.data.keepScreenOnPreferred && isTracking) {
      try {
        wx.setKeepScreenOn({ keepScreenOn: true });
      } catch (error) {
        logger.warn('setKeepScreenOn failed', error?.errMsg || error);
      }
    }

    if (
      this.mapContext &&
      hasPoints &&
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

    const polyline = hasPoints
      ? [
          {
            points: points.map((point) => ({
              latitude: point.latitude,
              longitude: point.longitude,
            })),
            color: '#2B6CFF',
            width: 6,
            dottedLine: false,
          },
        ]
      : [];

    const pauseMarkers = Array.isArray(state.pausePoints)
      ? state.pausePoints.map((point, index) => ({
          id: `pause-${index}`,
          latitude: point.latitude,
          longitude: point.longitude,
          iconPath: '/assets/icons/pause-marker.png',
          width: 24,
          height: 24,
          anchor: { x: 0.5, y: 0.5 },
        }))
      : [];

    const startMarker = hasPoints
      ? [
          {
            id: 'start',
            latitude: points[0].latitude,
            longitude: points[0].longitude,
            iconPath: '/assets/icons/start-marker.png',
            width: 32,
            height: 32,
            anchor: { x: 0.5, y: 1 },
          },
        ]
      : [];

    const markers = [...startMarker, ...pauseMarkers];

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
      pausePoints: state.pausePoints || [],
      activityKey: activityMeta.key,
      activityLabel: activityMeta.label,
      activityDescription: activityMeta.description,
      activityStatusText: isTracking
        ? state.detectedActivityType
          ? `${activityMeta.label} · 自动识别`
          : '自动识别中'
        : '准备开始',
      activityIcon: getActivityIcon(activityMeta.key),
      hasRoutePoints: hasPoints,
      centerLatitude: latestPoint.latitude,
      centerLongitude: latestPoint.longitude,
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
    if (this.data.tracking) {
      return;
    }
    this.openPurposePicker();
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
    if (!meta && !this.data.tracking) {
      wx.showToast({ title: TOAST.purposeRequired, icon: 'none' });
      return;
    }
    const nextState = {
      purposePickerVisible: false,
      purposeSelectionKey: meta ? meta.key : '',
      purposeSelectionLabel: meta ? meta.label : '未选择',
      purposeSelectionIcon: meta ? meta.icon : '',
      purposeSelectionDescription: meta ? meta.description : '',
    };
    this.setData(nextState);
    if (this.data.tracking) {
      if (typeof tracker.updatePurposeType === 'function') {
        tracker.updatePurposeType(meta ? meta.key : '');
      }
      wx.showToast({ title: TOAST.purposeUpdated, icon: 'none' });
      return;
    }
    this.beginTrackingWithPurpose(meta ? meta.key : '');
  },

  beginTrackingWithPurpose(purposeKey) {
    if (!this.data.locationAuthorized) {
      this.setData({ showLocationPrompt: true });
      wx.showToast({ title: TOAST.requireLocation, icon: 'none' });
      return;
    }
    const weight = this.data.weight || 60;
    const privacyLevel = this.data.privacyOptions[this.data.privacyIndex]?.key || 'private';
    tracker
      .startTracking({
        privacyLevel,
        title: this.data.title,
        note: this.data.note,
        weight,
        purposeType: purposeKey,
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
    if (!this.data.locationAuthorized) {
      this.setData({ showLocationPrompt: true });
      wx.showToast({ title: TOAST.requireLocation, icon: 'none' });
      return;
    }
    this.openPurposePicker();
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
    this.finalizeTracking().then((success) => {
      if (success) {
        this.setData({
          finishSheetVisible: false,
          finishAutoPaused: false,
          photos: [],
        });
        setTimeout(() => {
          wx.switchTab({ url: '/pages/index/index' });
        }, 500);
      }
    });
  },

  finalizeTracking() {
    if (this.data.uploading) {
      return Promise.resolve(false);
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
        return success;
      })
      .catch((error) => {
        logger.warn('stopTracking failed', error?.errMsg || error);
        wx.showToast({ title: TOAST.routeSaveFailed, icon: 'none' });
        return false;
      })
      .finally(() => {
        this.setData({ uploading: false });
      });
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

  handleActivityTap() {
    if (this.data.tracking) {
      wx.showToast({ title: '记录中不能切换运动方式', icon: 'none' });
      return;
    }
    const itemList = ACTIVITY_CHOICES.map((item) => item.label);
    wx.showActionSheet({
      itemList,
      success: (res) => {
        const meta = ACTIVITY_CHOICES[res.tapIndex];
        if (!meta) {
          return;
        }
        this.setData({
          activityKey: meta.key,
          activityLabel: meta.label,
          activityDescription: meta.description,
          activityIcon: getActivityIcon(meta.key),
        });
      },
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