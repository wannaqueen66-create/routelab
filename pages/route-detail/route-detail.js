const { getRoutes, updateRoutePrivacy, deleteRoute } = require('../../services/route-store');
const { PRIVACY_LEVELS, PRIVACY_LEVEL_MAP } = require('../../constants/privacy');
const { ACTIVITY_TYPE_MAP, DEFAULT_ACTIVITY_TYPE } = require('../../constants/activity');
const { buildCampusDisplayName } = require('../../constants/campus');
const { formatDistance, formatSpeed, formatCalories } = require('../../utils/format');
const { formatDuration, formatDate, formatClock } = require('../../utils/time');
const { getActivityLevel } = require('../../services/analytics');
const { getActivityLevelMeta, ACTIVITY_LEVEL_LIST } = require('../../constants/activity-level');

function buildPolyline(points = []) {
  if (!Array.isArray(points) || !points.length) {
    return [];
  }
  return [
    {
      points: points.map((point) => ({
        latitude: point.latitude,
        longitude: point.longitude,
      })),
      color: '#0ea5e9',
      width: 6,
      arrowLine: true,
    },
  ];
}

function buildMarkers(points = [], pausePoints = []) {
  if (!Array.isArray(points) || !points.length) {
    return [];
  }
  const markers = [
    {
      id: 'start',
      latitude: points[0].latitude,
      longitude: points[0].longitude,
      iconPath: '/assets/icons/start.png',
      width: 28,
      height: 28,
      callout: {
        content: '起点',
        color: '#ffffff',
        bgColor: '#22c55e',
        padding: 6,
        borderRadius: 16,
        display: 'ALWAYS',
      },
    },
    {
      id: 'end',
      latitude: points[points.length - 1].latitude,
      longitude: points[points.length - 1].longitude,
      iconPath: '/assets/icons/end.png',
      width: 28,
      height: 28,
      callout: {
        content: '终点',
        color: '#ffffff',
        bgColor: '#ef4444',
        padding: 6,
        borderRadius: 16,
        display: 'ALWAYS',
      },
    },
  ];

  (pausePoints || []).forEach((point, index) => {
    if (!point) {
      return;
    }
    markers.push({
      id: `pause-${index}`,
      latitude: point.latitude,
      longitude: point.longitude,
      iconPath: '/assets/icons/pause.png',
      width: 24,
      height: 24,
      callout: {
        content: '暂停',
        color: '#1e293b',
        bgColor: '#fde68a',
        padding: 4,
        borderRadius: 12,
        display: 'ALWAYS',
      },
    });
  });

  return markers;
}

function normalizePhotos(photos = []) {
  if (!Array.isArray(photos)) {
    return [];
  }
  return photos.map((item) => {
    if (typeof item === 'string') {
      return { path: item, note: '' };
    }
    return {
      path: item?.path || item?.url || '',
      note: item?.note || '',
    };
  });
}

Page({
  data: {
    routeId: '',
    detail: null,
    polyline: [],
    markers: [],
    privacyOptions: PRIVACY_LEVELS,
    privacyIndex: 0,
    levelStandards: ACTIVITY_LEVEL_LIST,
  },
  onLoad(options) {
    this.routeId = options.id;
    this.refresh();
  },
  onShow() {
    this.refresh();
  },
  refresh() {
    const routes = getRoutes();
    const route = routes.find((item) => item.id === this.routeId);
    if (!route) {
      wx.showToast({
        title: '未找到轨迹',
        icon: 'none',
      });
      return;
    }

    const activityType = route.meta?.activityType || DEFAULT_ACTIVITY_TYPE;
    const activityMeta = ACTIVITY_TYPE_MAP[activityType] || ACTIVITY_TYPE_MAP[DEFAULT_ACTIVITY_TYPE];
    const campusLabel = route.campusMeta ? buildCampusDisplayName(route.campusMeta) : route.campusZone;
    const duration = formatDuration(route.stats?.duration);
    const distance = formatDistance(route.stats?.distance);
    const calories = formatCalories(route.stats?.calories);
    const steps = activityType === 'ride' ? '--' : Math.round((route.stats?.distance || 0) / 0.75);
    const paceOrSpeed =
      activityType === 'ride'
        ? `${route.stats?.speed ? (route.stats.speed * 3.6).toFixed(1) : '0.0'} km/h`
        : formatSpeed(route.stats?.speed);
    const photos = normalizePhotos(route.photos);
    const privacyIndex = Math.max(PRIVACY_LEVELS.findIndex((item) => item.key === route.privacyLevel), 0);
    const activityLevelKey = route.meta?.activityLevel || getActivityLevel(route);
    const activityLevelMeta = getActivityLevelMeta(activityLevelKey);

    this.setData({
      routeId: route.id,
      detail: {
        title: route.title,
        campusLabel,
        startDate: formatDate(route.startTime),
        timeRange: `${formatClock(route.startTime)} - ${formatClock(route.endTime)}`,
        duration,
        paceOrSpeed,
        distance,
        calories,
        steps,
        privacyLabel: PRIVACY_LEVEL_MAP[route.privacyLevel]?.label || '未知',
        note: route.note || '未填写备注',
        activityLabel: activityMeta.label,
        photos,
        activityLevel: activityLevelMeta,
      },
      polyline: buildPolyline(route.points),
      markers: buildMarkers(route.points, route.meta?.pausePoints),
      centerLatitude: route.points?.[0]?.latitude || 30.27415,
      centerLongitude: route.points?.[0]?.longitude || 120.15515,
      privacyIndex,
      levelStandards: ACTIVITY_LEVEL_LIST,
    });
  },
  handlePrivacyChange(event) {
    const index = Number(event.detail.value);
    const level = PRIVACY_LEVELS[index].key;
    updateRoutePrivacy(this.routeId, level);
    wx.showToast({
      title: '隐私已更新',
      icon: 'success',
    });
    this.refresh();
  },
  handleDelete() {
    wx.showModal({
      title: '删除轨迹',
      content: '确定删除本次轨迹？删除后不可恢复',
      confirmText: '删除',
      confirmColor: '#dc2626',
      success: (res) => {
        if (res.confirm) {
          deleteRoute(this.routeId);
          wx.showToast({
            title: '已删除',
            icon: 'none',
          });
          wx.navigateBack();
        }
      },
    });
  },
  handlePreviewPhoto(event) {
    const { index } = event.currentTarget.dataset;
    const photoIndex = Number(index);
    const photos = this.data.detail?.photos || [];
    const target = photos[photoIndex] || {};
    wx.previewImage({
      current: target.path,
      urls: photos.map((item) => item.path),
    });
  },
  onShareAppMessage() {
    if (!this.data.detail) {
      return {};
    }
    return {
      title: `RouteLab | ${this.data.detail.title}`,
      path: `/pages/route-detail/route-detail?id=${this.routeId}`,
    };
  },
});
