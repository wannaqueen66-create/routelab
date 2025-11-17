const {
  subscribe,
  getRoutes,
  updateRoutePrivacy,
  deleteRoute,
  syncRoutesFromCloud,
} = require('../../services/route-store');
const { PRIVACY_LEVELS, PRIVACY_LEVEL_MAP } = require('../../constants/privacy');
const { ACTIVITY_TYPE_MAP, DEFAULT_ACTIVITY_TYPE } = require('../../constants/activity');
const { formatDistance, formatCalories } = require('../../utils/format');
const { formatDuration, formatDate, formatClock } = require('../../utils/time');
const api = require('../../services/api');

const FILTER_TABS = [
  { key: 'all', label: '全部' },
  { key: 'recent', label: '最近七天' },
  { key: 'public', label: '公开分享' },
  { key: 'private', label: '仅自己可见' },
];

function normalizeRoute(route) {
  const activityType = route.meta?.activityType || DEFAULT_ACTIVITY_TYPE;
  const activityMeta = ACTIVITY_TYPE_MAP[activityType] || ACTIVITY_TYPE_MAP[DEFAULT_ACTIVITY_TYPE];
  const photos = Array.isArray(route.photos) ? route.photos : [];
  const startLabel = route.meta?.startLabel || route.campusZone || '起点未识别';
  const endLabel = route.meta?.endLabel || startLabel;
  const synced = route.synced === true;
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
    startLabel,
    endLabel,
    activityLabel: activityMeta.label,
    activityType,
    photosCount: photos.length,
    synced,
    syncPending: !synced,
    syncStatusLabel: synced ? '已同步' : '待同步',
  };
}

function isWeakPlaceName(name = '') {
  if (!name || typeof name !== 'string') return true;
  const s = name.trim();
  if (!s) return true;
  if (/^\d+(\.\d+)?\s*,\s*\d+(\.\d+)?$/.test(s)) return true;
  return s.includes('未识别') || s.includes('待定') || s.startsWith('坐标') || s.includes('离线轨迹');
}

Page({
  data: {
    filterTabs: FILTER_TABS,
    activeFilter: 'all',
    routes: [],
    empty: true,
    syncing: false,
  },
  onLoad() {
    this.rawRoutes = [];
    this.unsubscribe = subscribe((routes) => this.refresh(routes));
    this.refresh(getRoutes());
    this.syncFromCloud(true);
  },
  onUnload() {
    if (this.unsubscribe) {
      this.unsubscribe();
    }
  },
  syncFromCloud(showToast = false) {
    if (this.data.syncing) {
      return;
    }
    this.setData({ syncing: true });
    syncRoutesFromCloud()
      .then((routes) => {
        this.refresh(routes);
        if (showToast) {
          wx.showToast({ title: '已同步云端数据', icon: 'success' });
        }
      })
      .catch(() => {
        if (showToast) {
          wx.showToast({ title: '同步失败，请检查网络', icon: 'none' });
        }
      })
      .finally(() => {
        this.setData({ syncing: false });
      });
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
    this.resolveRoutePlaceNames(formatted);
  },
  resolveRoutePlaceNames(list = []) {
    if (!Array.isArray(list) || !list.length) return;
    const byId = new Map((this.rawRoutes || []).map((r) => [r.id, r]));
    list.forEach((item, index) => {
      const r = byId.get(item.id);
      if (!r || !Array.isArray(r.points) || r.points.length === 0) return;
      const needStart = isWeakPlaceName(item.startLabel);
      const needEnd = isWeakPlaceName(item.endLabel);
      if (!needStart && !needEnd) return;
      const start = r.points[0];
      const end = r.points[r.points.length - 1] || start;
      const tasks = [];
      if (needStart && start) tasks.push(api.reverseGeocodeSafe({ latitude: start.latitude, longitude: start.longitude }));
      else tasks.push(Promise.resolve({ displayName: item.startLabel }));
      if (needEnd && end) tasks.push(api.reverseGeocodeSafe({ latitude: end.latitude, longitude: end.longitude }));
      else tasks.push(Promise.resolve({ displayName: item.endLabel }));
      Promise.all(tasks)
        .then(([startRes, endRes]) => {
          const startLabel = startRes?.name || startRes?.displayName || item.startLabel;
          const endLabel = endRes?.name || endRes?.displayName || item.endLabel;
          this.setData({
            [`routes[${index}].startLabel`]: startLabel,
            [`routes[${index}].endLabel`]: endLabel,
          });
          this.setData({ [`routes[${index}].campusLabel`]: `${startLabel} · ${endLabel}` });
        })
        .catch(() => {});
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
    const privacyOptions = PRIVACY_LEVELS.map(
      (item) => `${item.label}${item.key === route.privacyLevel ? '（当前）' : ''}`
    );
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
      content: '删除后不可恢复，确认删除吗？',
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
  handleSyncTap() {
    this.syncFromCloud(true);
  },
});
