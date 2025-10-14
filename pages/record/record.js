const { checkLocationAuthorization, requestLocationAuthorization, openLocationSetting } = require('../../utils/permissions');
const tracker = require('../../services/tracker');
const { PRIVACY_LEVELS } = require('../../constants/privacy');
const {
  getCategoryNames,
  getAreaNames,
  getLocationNames,
  normalizeSelection,
  buildCampusDisplayName,
  findSelectionIndices,
} = require('../../constants/campus');
const { ACTIVITY_TYPES, DEFAULT_ACTIVITY_TYPE } = require('../../constants/activity');
const { getRecentSettings, saveRecentSettings } = require('../../utils/storage');
const { formatDistance, formatSpeed, formatCalories } = require('../../utils/format');
const { formatDuration } = require('../../utils/time');
const { estimateCalories } = require('../../utils/geo');

const DEFAULT_CENTER = {
  latitude: 30.27415,
  longitude: 120.15515,
};

const CATEGORY_NAMES = getCategoryNames();
const DEFAULT_SELECTION = normalizeSelection();

function buildPickerRange(selection) {
  const normalized = normalizeSelection(selection);
  const areaNames = getAreaNames(normalized.category);
  const locationNames = getLocationNames(normalized.category, normalized.area);
  return [CATEGORY_NAMES, areaNames, locationNames];
}

function buildPickerValue(selection) {
  const indices = findSelectionIndices(normalizeSelection(selection));
  return [indices.categoryIndex, indices.areaIndex, indices.locationIndex];
}

function selectionFromValue(value) {
  const categoryName = CATEGORY_NAMES[value[0]] || CATEGORY_NAMES[0];
  const areaNames = getAreaNames(categoryName);
  const areaName = areaNames[value[1]] || areaNames[0];
  const locationNames = getLocationNames(categoryName, areaName);
  const locationName = locationNames[value[2]] || locationNames[0];
  return normalizeSelection({
    category: categoryName,
    area: areaName,
    location: locationName,
  });
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

const DEFAULT_PICKER_RANGE = buildPickerRange(DEFAULT_SELECTION);
const DEFAULT_PICKER_VALUE = buildPickerValue(DEFAULT_SELECTION);
const DEFAULT_LABEL = buildCampusDisplayName(DEFAULT_SELECTION);

Page({
  data: {
    tracking: false,
    paused: false,
    durationText: '00:00',
    distanceText: '0 m',
    speedText: '0 m/s',
    caloriesText: '0 kcal',
    stepsText: '0',
    polyline: [],
    markers: [],
    pausePoints: [],
    privacyOptions: PRIVACY_LEVELS,
    privacyIndex: 1,
    activityOptions: ACTIVITY_TYPES,
    activityIndex: ACTIVITY_TYPES.findIndex((item) => item.key === DEFAULT_ACTIVITY_TYPE),
    activityDescription: ACTIVITY_TYPES.find((item) => item.key === DEFAULT_ACTIVITY_TYPE)?.description || '',
    currentActivityKey: DEFAULT_ACTIVITY_TYPE,
    startPickerRange: DEFAULT_PICKER_RANGE,
    startPickerValue: DEFAULT_PICKER_VALUE,
    startSelection: DEFAULT_SELECTION,
    startSelectedText: DEFAULT_LABEL,
    endPickerRange: DEFAULT_PICKER_RANGE,
    endPickerValue: DEFAULT_PICKER_VALUE,
    endSelection: DEFAULT_SELECTION,
    endSelectedText: DEFAULT_LABEL,
    endSelectionDirty: false,
    title: '',
    note: '',
    locationAuthorized: true,
    hasRoutePoints: false,
    centerLatitude: DEFAULT_CENTER.latitude,
    centerLongitude: DEFAULT_CENTER.longitude,
    weight: 60,
    photos: [],
    startSelectionLocked: false,
  },
  onReady() {
    this.mapContext = wx.createMapContext('routeMap', this);
  },
  onShow() {
    if (!this.data.tracking) {
      this.applySettings();
    }
    this.checkLocationPermission(false);
  },
  onLoad() {
    this.unsubscribe = tracker.subscribe((state) => this.updateState(state));
    this.applySettings();
    this.checkLocationPermission(true);
  },
  onUnload() {
    if (this.unsubscribe) {
      this.unsubscribe();
    }
  },
  applySettings() {
    const settings = getRecentSettings() || {};
    const startSelection = normalizeSelection(
      settings.startCampusSelection || settings.campusSelection || DEFAULT_SELECTION
    );
    const endSelection = normalizeSelection(settings.endCampusSelection || startSelection);
    const activityKey = settings.activityType || this.data.currentActivityKey || DEFAULT_ACTIVITY_TYPE;
    const activityIndex = ACTIVITY_TYPES.findIndex((item) => item.key === activityKey);
    const activityMeta = ACTIVITY_TYPES[activityIndex] || ACTIVITY_TYPES[0];

    this.updateStartSelection(startSelection, {
      syncEnd: !settings.endCampusSelection,
    });
    this.updateEndSelection(endSelection, { markDirty: !!settings.endCampusSelection });

    this.setData({
      privacyIndex: Math.max(PRIVACY_LEVELS.findIndex((item) => item.key === settings.privacyLevel), 0),
      activityIndex,
      activityDescription: activityMeta.description,
      currentActivityKey: activityMeta.key,
      weight: settings.weight || this.data.weight,
      startSelectionLocked: false,
    });
  },
  checkLocationPermission(showPrompt) {
    checkLocationAuthorization().then(({ authorized }) => {
      const app = getApp();
      app.globalData.locationAuthorized = authorized;
      this.setData({ locationAuthorized: authorized });
      if (!authorized && showPrompt) {
        this.promptLocationSetting();
      }
    });
  },
  requestLocationAccess() {
    requestLocationAuthorization()
      .then(() => {
        const app = getApp();
        app.globalData.locationAuthorized = true;
        this.setData({ locationAuthorized: true });
      })
      .catch(() => {
        this.promptLocationSetting();
      });
  },
  promptLocationSetting() {
    wx.showModal({
      title: '\\u9700\\u8981\\u5b9a\\u4f4d\\u6743\\u9650',
      content: '\\u8bf7\\u5728\\u8bbe\\u7f6e\\u4e2d\\u5f00\\u542f\\u5b9a\\u4f4d\\u670d\\u52a1\\uff0c\\u4ee5\\u4fbf\\u8bb0\\u5f55\\u5b8c\\u6574\\u8f68\\u8ff9',
      confirmText: '\\u524d\\u5f80\\u8bbe\\u7f6e',
      cancelText: '\\u6211\\u77e5\\u9053\\u4e86',
      success: (res) => {
        if (res.confirm) {
          openLocationSetting()
            .then(({ authorized }) => {
              const app = getApp();
              app.globalData.locationAuthorized = authorized;
              this.setData({ locationAuthorized: authorized });
              if (!authorized) {
                wx.showToast({ title: '\\u672a\\u6388\\u4e88\\u5b9a\\u4f4d\\u6743\\u9650', icon: 'none' });
              }
            })
            .catch(() => {
              wx.showToast({ title: '\\u8bf7\\u5728\\u8bbe\\u7f6e\\u4e2d\\u5f00\\u542f\\u5b9a\\u4f4d', icon: 'none' });
            });
        }
      },
    });
  },
  updateState(state) {
    const activityKey = state.active
      ? state.options?.activityType || this.data.currentActivityKey
      : this.data.currentActivityKey;
    const activityIndex = ACTIVITY_TYPES.findIndex((item) => item.key === activityKey);
    const activityMeta = ACTIVITY_TYPES[activityIndex] || ACTIVITY_TYPES[0];
    const weight = this.data.weight;
    const distance = state.stats.distance || 0;
    const durationText = formatDuration(state.stats.duration);
    const distanceText = formatDistance(distance);
    const speedText =
      activityKey === 'ride'
        ? `${(state.stats.speed ? state.stats.speed * 3.6 : 0).toFixed(1)} km/h`
        : formatSpeed(state.stats.speed);
    const caloriesValue = distance ? estimateCalories(distance, weight, activityKey) : 0;
    const caloriesText = formatCalories(caloriesValue);
    const stepsText = activityKey === 'ride' ? '--' : `${Math.round(distance / 0.75)}`;
    const hasPoints = Array.isArray(state.points) && state.points.length > 0;
    const centerPoint = hasPoints ? state.points[state.points.length - 1] : DEFAULT_CENTER;

    const markers = [];
    if (hasPoints) {
      const startPoint = state.points[0];
      markers.push({
        id: 'start',
        latitude: startPoint.latitude,
        longitude: startPoint.longitude,
        iconPath: '/assets/icons/start.png',
        width: 28,
        height: 28,
        callout: {
          content: '鐠ч鍋?,
          color: '#ffffff',
          bgColor: '#22c55e',
          padding: 6,
          borderRadius: 16,
          display: 'ALWAYS',
        },
      });
      const endPoint = state.points[state.points.length - 1];
      markers.push({
        id: 'end',
        latitude: endPoint.latitude,
        longitude: endPoint.longitude,
        iconPath: '/assets/icons/end.png',
        width: 28,
        height: 28,
        callout: {
          content: '缂佸牏鍋?,
          color: '#ffffff',
          bgColor: '#ef4444',
          padding: 6,
          borderRadius: 16,
          display: 'ALWAYS',
        },
      });
    }

    (state.pausePoints || []).forEach((point, index) => {
      markers.push({
        id: `pause-${index}`,
        latitude: point.latitude,
        longitude: point.longitude,
        iconPath: '/assets/icons/pause.png',
        width: 24,
        height: 24,
        callout: {
          content: '閺嗗倸浠?,
          color: '#1e293b',
          bgColor: '#fde68a',
          padding: 4,
          borderRadius: 12,
          display: 'ALWAYS',
        },
      });
    });

    this.setData({
      tracking: state.active,
      paused: state.paused,
      durationText,
      distanceText,
      speedText,
      caloriesText,
      stepsText,
      hasRoutePoints: hasPoints,
      centerLatitude: centerPoint.latitude,
      centerLongitude: centerPoint.longitude,
      markers,
      activityIndex,
      activityDescription: activityMeta.description,
      currentActivityKey: activityMeta.key,
      pausePoints: state.pausePoints || [],
      polyline: hasPoints
        ? [
            {
              points: state.points.map((point) => ({
                latitude: point.latitude,
                longitude: point.longitude,
              })),
              color: '#60a5fa',
              width: 6,
              arrowLine: true,
            },
          ]
        : [],
    });

    if (hasPoints && this.mapContext && !state.paused) {
      this.mapContext.moveToLocation({
        latitude: centerPoint.latitude,
        longitude: centerPoint.longitude,
      });
    }
  },
  updateStartSelection(selection, { syncEnd = false } = {}) {
    const normalized = normalizeSelection(selection);
    const pickerRange = buildPickerRange(normalized);
    const pickerValue = buildPickerValue(normalized);
    this.setData({
      startSelection: normalized,
      startPickerRange: pickerRange,
      startPickerValue: pickerValue,
      startSelectedText: buildCampusDisplayName(normalized),
    });
    if (syncEnd) {
      this.updateEndSelection(normalized, { markDirty: false });
    }
  },
  updateEndSelection(selection, { markDirty = true } = {}) {
    const normalized = normalizeSelection(selection);
    const pickerRange = buildPickerRange(normalized);
    const pickerValue = buildPickerValue(normalized);
    this.setData({
      endSelection: normalized,
      endPickerRange: pickerRange,
      endPickerValue: pickerValue,
      endSelectedText: buildCampusDisplayName(normalized),
      endSelectionDirty: markDirty || this.data.endSelectionDirty,
    });
    if (!markDirty) {
      this.setData({ endSelectionDirty: false });
    }
  },
  handleActivitySelect(event) {
    if (this.data.tracking) {
      wx.showToast({
        title: '鐠佹澘缍嶆潻娑滎攽娑擃叏绱濋弳鍌欑瑝閺€顖涘瘮閸掑洦宕插Ο鈥崇础',
        icon: 'none',
      });
      return;
    }
    const { index } = event.currentTarget.dataset;
    const activity = this.data.activityOptions[Number(index)] || this.data.activityOptions[0];
    this.setData({
      activityIndex: Number(index),
      activityDescription: activity.description,
      currentActivityKey: activity.key,
    });
  },
  handleStartPickerColumnChange(event) {
    if (this.data.tracking) {
      return;
    }
    const { column, value } = event.detail;
    const currentValue = [...this.data.startPickerValue];
    currentValue[column] = value;
    if (column === 0) {
      const categoryName = CATEGORY_NAMES[value];
      const areaNames = getAreaNames(categoryName);
      const locationNames = getLocationNames(categoryName, areaNames[0]);
      this.setData({
        startPickerRange: [CATEGORY_NAMES, areaNames, locationNames],
        startPickerValue: [value, 0, 0],
      });
    } else if (column === 1) {
      const categoryIndex = currentValue[0];
      const categoryName = CATEGORY_NAMES[categoryIndex];
      const areaNames = getAreaNames(categoryName);
      const areaName = areaNames[value] || areaNames[0];
      const locationNames = getLocationNames(categoryName, areaName);
      this.setData({
        startPickerRange: [CATEGORY_NAMES, areaNames, locationNames],
        startPickerValue: [categoryIndex, value, 0],
      });
    } else {
      this.setData({ startPickerValue: currentValue });
    }
  },
  handleStartPickerChange(event) {
    if (this.data.tracking || this.data.startSelectionLocked) {
      wx.showToast({ title: '\u6b63\u5728\u8bb0\u5f55\uff0c\u65e0\u6cd5\u4fee\u6539\u8d77\u70b9', icon: 'none' });
      return;
    }
    const value = event.detail.value;
    const selection = selectionFromValue(value);
    this.updateStartSelection(selection, {
      syncEnd: !this.data.endSelectionDirty,
    });
    this.setData({ startSelectionLocked: false });
  },
  handleEndPickerColumnChange(event) {
    const { column, value } = event.detail;
    const currentValue = [...this.data.endPickerValue];
    currentValue[column] = value;
    if (column === 0) {
      const categoryName = CATEGORY_NAMES[value];
      const areaNames = getAreaNames(categoryName);
      const locationNames = getLocationNames(categoryName, areaNames[0]);
      this.setData({
        endPickerRange: [CATEGORY_NAMES, areaNames, locationNames],
        endPickerValue: [value, 0, 0],
      });
    } else if (column === 1) {
      const categoryIndex = currentValue[0];
      const categoryName = CATEGORY_NAMES[categoryIndex];
      const areaNames = getAreaNames(categoryName);
      const areaName = areaNames[value] || areaNames[0];
      const locationNames = getLocationNames(categoryName, areaName);
      this.setData({
        endPickerRange: [CATEGORY_NAMES, areaNames, locationNames],
        endPickerValue: [categoryIndex, value, 0],
      });
    } else {
      this.setData({ endPickerValue: currentValue });
    }
  },
  handleEndPickerChange(event) {
    const selection = selectionFromValue(event.detail.value);
    this.updateEndSelection(selection, { markDirty: true });
  },
  handleAddPhoto() {
    const maxPhotos = 9;
    const remain = maxPhotos - this.data.photos.length;
    if (remain <= 0) {
      wx.showToast({ title: '閺堚偓婢舵艾褰查柅澶嬪9瀵姷鍙庨悧?, icon: 'none' });
      return;
    }
    wx.chooseMedia({
      count: remain,
      mediaType: ['image'],
      sourceType: ['camera', 'album'],
      success: (res) => {
        const newPhotos = normalizePhotos((res.tempFiles || []).map((file) => file.tempFilePath));
        this.setData({
          photos: [...this.data.photos, ...newPhotos],
        });
      },
    });
  },
  handleRemovePhoto(event) {
    if (event.stopPropagation) {
      event.stopPropagation();
    }
    const { index } = event.currentTarget.dataset;
    const photos = [...this.data.photos];
    photos.splice(Number(index), 1);
    this.setData({ photos });
  },
  handlePreviewPhoto(event) {
    const { index } = event.currentTarget.dataset;
    const photos = this.data.photos;
    wx.previewImage({
      current: photos[Number(index)].path,
      urls: photos.map((item) => item.path),
    });
  },
  handlePhotoNoteInput(event) {
    const { index } = event.currentTarget.dataset;
    const value = event.detail.value;
    const photos = [...this.data.photos];
    if (photos[Number(index)]) {
      photos[Number(index)] = {
        ...photos[Number(index)],
        note: value,
      };
      this.setData({ photos });
    }
  },
  handleStart() {
    if (!this.data.startSelection) {
      wx.showToast({ title: '鐠囩兘鈧瀚ㄧ挧椋庡仯', icon: 'none' });
      return;
    }
    const weight = this.data.weight || 60;
    const activityType = this.data.activityOptions[this.data.activityIndex]?.key || DEFAULT_ACTIVITY_TYPE;
    tracker
      .startTracking({
        privacyLevel: this.data.privacyOptions[this.data.privacyIndex]?.key || 'group',
        startCampusMeta: this.data.startSelection,
        endCampusMeta: this.data.endSelection,
        title: this.data.title,
        note: this.data.note,
        activityType,
        weight,
      })
      .then(() => {
        const recent = getRecentSettings() || {};
        saveRecentSettings({
          ...recent,
          privacyLevel: this.data.privacyOptions[this.data.privacyIndex]?.key || 'group',
          startCampusSelection: this.data.startSelection,
          endCampusSelection: this.data.endSelection,
          activityType,
          weight,
        });
        this.setData({ locationAuthorized: true, photos: [], startSelectionLocked: true });
      })
      .catch((error) => {
        console.warn('RouteLab: start tracking failed', error);
        this.setData({ locationAuthorized: false, startSelectionLocked: false });
        wx.showModal({
          title: '闂団偓鐟曚礁鐣炬担宥嗘綀闂?,
          content: '鐠囧嘲鍘戠拋绋跨暰娴ｅ秵婀囬崝鈽呯礉娴犮儰绌剁拋鏉跨秿鐎瑰本鏆ｆ潪銊ㄦ姉',
          confirmText: '閸撳秴绶氱拋鍓х枂',
          success: (res) => {
            if (res.confirm) {
              wx.openSetting && wx.openSetting({});
            }
          },
        });
      });
  },
  handlePause() {
    tracker.pauseTracking();
  },
  handleResume() {
    tracker.resumeTracking();
  },
  handleStop() {
    const activityType = this.data.currentActivityKey || DEFAULT_ACTIVITY_TYPE;
    const route = tracker.stopTracking({
      title: this.data.title,
      note: this.data.note,
      privacyLevel: this.data.privacyOptions[this.data.privacyIndex]?.key || 'group',
      startCampusMeta: this.data.startSelection,
      endCampusMeta: this.data.endSelection,
      activityType,
      photos: this.data.photos,
      weight: this.data.weight || 60,
    });
    if (route) {
      wx.showToast({
        title: '\u8f68\u8ff9\u5df2\u4fdd\u5b58',
        icon: 'success',
      });
    }
    this.setData({
      title: '',
      note: '',
      photos: [],
      endSelectionDirty: false,
      startSelectionLocked: false,
    });
  },
  handleViewHistory() {
    wx.navigateTo({
      url: '/pages/history/history',
    });
  },
  handleOpenSettings() {
    wx.navigateTo({
      url: '/pages/profile/profile',
    });
  },
  handleMapTap() {
    if (!this.data.hasRoutePoints) {
      wx.showToast({
        title: '瀵偓婵顔囪ぐ鏇炴倵閸欘垱鐓￠惇瀣杽閺冩儼寤烘潻?,
        icon: 'none',
      });
    }
  },
});





