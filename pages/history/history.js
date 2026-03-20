const { applyThemeMixin } = require('../../utils/theme');
const {
  subscribe,
  getRoutes,
  getSyncStatus,
  updateRoutePrivacy,
  deleteRoute,
  syncRoutesFromCloud,
  syncRoutesToCloud,
} = require('../../services/route-store');
const { PRIVACY_LEVELS, PRIVACY_LEVEL_MAP } = require('../../constants/privacy');
const { ACTIVITY_TYPE_MAP, DEFAULT_ACTIVITY_TYPE } = require('../../constants/activity');
const { formatDistance, formatCalories } = require('../../utils/format');
const { formatDuration, formatDate, formatClock } = require('../../utils/time');
const api = require('../../services/api');
const auth = require('../../services/auth');
const { classifySyncError } = require('../../services/history-formatter');

const FILTER_TABS = [
  { key: 'all', label: '全部' },
  { key: 'recent', label: '最近七天' },
  { key: 'public', label: '公开分享' },
  { key: 'private', label: '仅自己可见' },
];

const HISTORY_PAGE_SIZE = 20;

function normalizeRoute(route) {
  const activityType = route.meta?.activityType || DEFAULT_ACTIVITY_TYPE;
  const activityMeta = ACTIVITY_TYPE_MAP[activityType] || ACTIVITY_TYPE_MAP[DEFAULT_ACTIVITY_TYPE];
  const photos = Array.isArray(route.photos) ? route.photos : [];
  const startLabel = route.meta?.startLabel || route.campusZone || '起点未识别';
  const endLabel = route.meta?.endLabel || startLabel;
  const synced = route.synced === true;
  const previewPhoto = photos[0]?.path || photos[0] || '';
  const uploadError = route.uploadError && typeof route.uploadError === 'object' ? route.uploadError : null;
  const syncError = uploadError ? classifySyncError(uploadError) : null;
  const syncErrorAt = Number(uploadError?.at) || Number(route?.lastSyncAttemptAt) || 0;
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
    previewPhoto,
    synced,
    syncPending: !synced,
    syncStatusLabel: synced ? '已同步' : (syncError ? syncError.label : '待同步'),
    syncErrorType: syncError?.type || '',
    syncErrorHint: syncError?.hint || '',
    syncErrorMessage: uploadError?.message || '',
    syncErrorCode: uploadError?.statusCode || '',
    syncErrorAt: syncErrorAt > 0 ? `${formatDate(syncErrorAt)} ${formatClock(syncErrorAt)}` : '',
    syncErrorExpanded: false,
  };
}

function isWeakPlaceName(name = '') {
  if (!name || typeof name !== 'string') return true;
  const s = name.trim();
  if (!s) return true;
  if (/^\d+(\.\d+)?\s*,\s*\d+(\.\d+)?$/.test(s)) return true;
  return s.includes('未识别') || s.includes('待定') || s.startsWith('坐标') || s.includes('离线轨迹');
}

function getSyncActionLabel(errorType = '') {
  return errorType === 'auth' ? '重新登录并同步' : '重试同步';
}

function formatSyncSummary(status = {}) {
  const pending = Number(status.pending) || 0;
  const synced = Number(status.synced) || 0;
  const ts = Number(status.lastSyncAt) || 0;
  const lastSyncText = ts > 0 ? formatClock(ts) : '--';
  const rawError = status?.lastError && typeof status.lastError === 'object' ? status.lastError : null;
  const errorMessage = rawError?.message || '';
  const classified = rawError ? classifySyncError(rawError) : null;
  return {
    text: `待同步 ${pending} · 已同步 ${synced} · 上次同步 ${lastSyncText}`,
    errorMessage,
    errorType: classified?.type || '',
    errorHint: classified?.hint || '',
    actionLabel: getSyncActionLabel(classified?.type || ''),
  };
}

Page(applyThemeMixin({
  data: {
    filterTabs: FILTER_TABS,
    activeFilter: 'all',
    routes: [],
    empty: true,
    syncing: false,
    historyLoading: true,
    syncSummaryText: '待同步 0 · 已同步 0 · 上次同步 --',
    syncErrorText: '',
    syncErrorHint: '',
    syncErrorType: '',
    syncErrorActionLabel: '重试同步',
    hasMore: false,
  },
  onLoad() {
    this.rawRoutes = [];
    this.filteredRoutes = [];
    this.renderCount = HISTORY_PAGE_SIZE;
    this.unsubscribe = subscribe((routes) => this.refresh(routes));
    this.refresh(getRoutes());
    this.syncFromCloud(true);
  },
  onUnload() {
    if (this.unsubscribe) {
      this.unsubscribe();
    }
  },
  syncFromCloud(showToast = false, forceUploadFirst = false) {
    if (this.data.syncing) {
      return;
    }
    this.setData({ syncing: true });

    const runner = forceUploadFirst
      ? syncRoutesToCloud().then(() => syncRoutesFromCloud())
      : syncRoutesFromCloud();

    runner
      .then((routes) => {
        this.refresh(routes);
        if (showToast) {
          wx.showToast({ title: '已同步云端数据', icon: 'success' });
        }
      })
      .catch(() => {
        this.refresh(getRoutes());
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
    const syncSummary = formatSyncSummary(getSyncStatus());
    this.setData({
      syncSummaryText: syncSummary.text,
      syncErrorText: syncSummary.errorMessage || '',
      syncErrorHint: syncSummary.errorHint || '',
      syncErrorType: syncSummary.errorType || '',
      syncErrorActionLabel: syncSummary.actionLabel || '重试同步',
    });
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
    this.setData({ historyLoading: true });
    this.filteredRoutes = filtered.map(normalizeRoute);
    this.renderCount = HISTORY_PAGE_SIZE;
    this.applyRenderedRoutes();
  },

  applyRenderedRoutes() {
    const list = Array.isArray(this.filteredRoutes) ? this.filteredRoutes : [];
    const visible = list.slice(0, this.renderCount);
    const hasMore = list.length > visible.length;
    this.setData({
      routes: visible,
      empty: visible.length === 0,
      hasMore,
      historyLoading: false,
    });
    this.resolveRoutePlaceNames(visible);
  },

  handleLoadMore() {
    const total = Array.isArray(this.filteredRoutes) ? this.filteredRoutes.length : 0;
    if (this.renderCount >= total) {
      return;
    }
    this.renderCount += HISTORY_PAGE_SIZE;
    this.applyRenderedRoutes();
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

  handleForceSyncTap() {
    this.syncFromCloud(true, true);
  },

  handleToggleSyncError(event) {
    const { id } = event.currentTarget.dataset || {};
    if (!id) {
      return;
    }
    const index = (this.data.routes || []).findIndex((item) => item && item.id === id);
    if (index < 0) {
      return;
    }
    const current = !!this.data.routes[index].syncErrorExpanded;
    this.setData({ [`routes[${index}].syncErrorExpanded`]: !current });
  },

  handleSyncErrorAction() {
    if (this.data.syncing) {
      return;
    }
    if (this.data.syncErrorType === 'auth') {
      wx.showLoading({ title: '重新登录中', mask: true });
      auth
        .refreshToken()
        .then(() => {
          wx.hideLoading();
          this.syncFromCloud(true, true);
        })
        .catch(() => {
          wx.hideLoading();
          wx.showToast({ title: '重新登录失败，请稍后重试', icon: 'none' });
        });
      return;
    }
    this.handleForceSyncTap();
  },
}));
