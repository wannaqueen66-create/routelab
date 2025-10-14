const { subscribe, getRoutes, updateRoutePrivacy, deleteRoute } = require('../../services/route-store');
const { PRIVACY_LEVELS, PRIVACY_LEVEL_MAP } = require('../../constants/privacy');
const { ACTIVITY_TYPE_MAP, DEFAULT_ACTIVITY_TYPE } = require('../../constants/activity');
const { buildCampusDisplayName } = require('../../constants/campus');
const { formatDistance, formatCalories } = require('../../utils/format');
const { formatDuration, formatDate, formatClock } = require('../../utils/time');

const FILTER_TABS = [
  { key: 'all', label: '全部' },
  { key: 'recent', label: '近7日' },
  { key: 'public', label: '公开' },
  { key: 'group', label: '群组' },
  { key: 'private', label: '仅自己' },
];

function normalizeRoute(route) {
  const activityType = route.meta?.activityType || DEFAULT_ACTIVITY_TYPE;
  const activityMeta = ACTIVITY_TYPE_MAP[activityType] || ACTIVITY_TYPE_MAP[DEFAULT_ACTIVITY_TYPE];
  const photos = Array.isArray(route.photos) ? route.photos : [];
  return {
    id: route.id,
    title: route.title,
    distanceText: formatDistance(route.stats?.distance),
    durationText: formatDuration(route.stats?.duration),
    caloriesText: formatCalories(route.stats?.calories),
    privacyLevel: route.privacyLevel,
    privacyLabel: PRIVACY_LEVEL_MAP[route.privacyLevel]?.label || '未知',
    startDate: formatDate(route.startTime),
    timeRange: `${formatClock(route.startTime)} - ${formatClock(route.endTime)}`,
    campusLabel: route.campusMeta ? buildCampusDisplayName(route.campusMeta) : route.campusZone,
    startLabel: route.meta?.startLabel || route.campusZone,
    endLabel: route.meta?.endLabel || route.campusZone,
    activityLabel: activityMeta.label,
    activityType,
    photosCount: photos.length,
  };
}

Page({
  data: {
    filterTabs: FILTER_TABS,
    activeFilter: 'all',
    routes: [],
    empty: true,
  },
  onLoad() {
    this.rawRoutes = [];
    this.unsubscribe = subscribe((routes) => this.refresh(routes));
    this.refresh(getRoutes());
  },
  onUnload() {
    if (this.unsubscribe) {
      this.unsubscribe();
    }
  },
  refresh(routes) {
    this.rawRoutes = routes || [];
    this.applyFilter(this.data.activeFilter);
  },
  applyFilter(filterKey) {
    const now = Date.now();
    const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000;
    const filtered = (this.rawRoutes || []).filter((route) => {
      if (filterKey === 'recent') {
        return route.startTime >= sevenDaysAgo;
      }
      if (filterKey === 'all') {
        return true;
      }
      return route.privacyLevel === filterKey;
    });
    const formatted = filtered.map(normalizeRoute);
    this.setData({
      routes: formatted,
      empty: formatted.length === 0,
    });
  },
  handleFilterTap(event) {
    const { key } = event.currentTarget.dataset;
    this.setData({ activeFilter: key });
    this.applyFilter(key);
  },
  handleRouteTap(event) {
    const { id } = event.currentTarget.dataset;
    wx.navigateTo({
      url: `/pages/route-detail/route-detail?id=${id}`,
    });
  },
  handleRouteLongPress(event) {
    const { id } = event.currentTarget.dataset;
    const route = this.rawRoutes.find((item) => item.id === id);
    if (!route) {
      return;
    }
    const privacyOptions = PRIVACY_LEVELS.map((item) => `${item.label}${item.key === route.privacyLevel ? ' ✓' : ''}`);
    wx.showActionSheet({
      alertText: '调整隐私或删除轨迹',
      itemList: [...privacyOptions, '删除本次轨迹'],
      success: (res) => {
        const index = res.tapIndex;
        if (index < privacyOptions.length) {
          const level = PRIVACY_LEVELS[index].key;
          updateRoutePrivacy(route.id, level);
          wx.showToast({ title: '隐私已更新', icon: 'success' });
        } else {
          this.confirmDelete(route.id);
        }
      },
    });
  },
  confirmDelete(routeId) {
    wx.showModal({
      title: '删除轨迹',
      content: '删除后不可恢复，确认删除？',
      confirmText: '删除',
      cancelText: '保留',
      confirmColor: '#dc2626',
      success: (res) => {
        if (res.confirm) {
          deleteRoute(routeId);
          wx.showToast({ title: '已删除', icon: 'none' });
        }
      },
    });
  },
});
