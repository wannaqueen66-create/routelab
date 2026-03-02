'use strict';

const {
  checkLocationAuthorization,
  requestLocationAuthorization,
  openLocationSetting,
} = require('../../utils/permissions');
const {
  subscribe,
  getRoutes,
  syncRoutesFromCloud,
  syncRoutesToCloud,
  updateRoutePrivacy,
  deleteRoute,
  getSyncStatus,
} = require('../../services/route-store');
const { summarizeRoutes } = require('../../services/analytics');
const { formatDuration } = require('../../utils/time');
const { formatDistance, formatCalories } = require('../../utils/format');
const { PRIVACY_LEVELS, PRIVACY_LEVEL_MAP } = require('../../constants/privacy');
const api = require('../../services/api');
const geocodeLocal = require('../../services/geocode-local');
const {
  getRecentSettings,
  getUserProfile,
  saveRecentSettings,
  getUserAccount,
  getLatestSeenAnnouncement,
  setLatestSeenAnnouncement,
} = require('../../utils/storage');

// 使用模块化的 UI 格式化逻辑
const {
  createWeatherState,
  formatWeatherPayload,
} = require('../../services/weather-local');
const { buildUserCard, createProfileCard } = require('../../services/user-card');
const {
  HISTORY_FILTERS,
  formatHistoryRoute,
  filterHistoryRoutes,
  formatSyncInfo,
  shouldFixPlaceName,
} = require('../../services/history-formatter');


const app = typeof getApp === 'function' ? getApp() : null;

const TAB_META = [
  { key: 'home', label: '首页', description: '记录运动', icon: '🏃' },
  { key: 'history', label: '历史', description: '回顾轨迹', icon: '🕒' },
  { key: 'profile', label: '我的', description: '个人中心', icon: '👤' },
];


const ACTIVITY_GOALS = {
  distance: 50000,
  count: 40,
  calories: 12000,
};

const GOAL_LABELS = {
  distance: formatDistance(ACTIVITY_GOALS.distance),
  count: `${ACTIVITY_GOALS.count} 次`,
  calories: formatCalories(ACTIVITY_GOALS.calories),
};

function clampPercent(value = 0) {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 100) return 100;
  return Math.round(value);
}

function createOverview(routes = []) {
  const list = Array.isArray(routes) ? routes.filter(Boolean) : [];
  const summary = summarizeRoutes(list);
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todayEnd = new Date(todayStart);
  todayEnd.setDate(todayEnd.getDate() + 1);
  const today = list.filter(
    (route) => route.startTime >= todayStart.getTime() && route.startTime < todayEnd.getTime()
  );
  const todaySummary = summarizeRoutes(today);
  const totalCalories = list.reduce((acc, route) => acc + (route.stats?.calories || 0), 0);
  const todayCalories = today.reduce((acc, route) => acc + (route.stats?.calories || 0), 0);
  return {
    totalCount: summary.count,
    totalCountValue: summary.count,
    totalDistance: formatDistance(summary.distance),
    totalDistanceValue: summary.distance,
    totalDuration: formatDuration(summary.duration),
    totalDurationValue: summary.duration,
    totalCalories: formatCalories(totalCalories),
    totalCaloriesValue: totalCalories,
    todayCount: todaySummary.count,
    todayCountValue: todaySummary.count,
    todayDistance: formatDistance(todaySummary.distance),
    todayDistanceValue: todaySummary.distance,
    todayDuration: formatDuration(todaySummary.duration),
    todayDurationValue: todaySummary.duration,
    todayCalories: formatCalories(todayCalories),
    todayCaloriesValue: todayCalories,
  };
}

function buildProgressFromOverview(overview = {}) {
  const toPercent = (value = 0, goal = 100) => {
    if (!goal || !Number.isFinite(goal) || goal <= 0) return 0;
    return clampPercent(((Number(value) || 0) / goal) * 100);
  };
  return {
    distance: toPercent(overview.totalDistanceValue, ACTIVITY_GOALS.distance),
    count: toPercent(overview.totalCountValue, ACTIVITY_GOALS.count),
    calories: toPercent(overview.totalCaloriesValue, ACTIVITY_GOALS.calories),
  };
}

const EMPTY_OVERVIEW = createOverview([]);
const EMPTY_PROGRESS = buildProgressFromOverview(EMPTY_OVERVIEW);
const DEFAULT_WEATHER = createWeatherState({ loading: true });
const DEFAULT_USER_CARD = buildUserCard({
  settings: {},
  profile: null,
  account: null,
  overview: EMPTY_OVERVIEW,
});

Page({
  data: {
    tabs: TAB_META,
    activeTab: TAB_META[0].key,
    networkConnected: true,
    weather: { ...DEFAULT_WEATHER },
    overview: EMPTY_OVERVIEW,
    progress: EMPTY_PROGRESS,
    goalLabels: GOAL_LABELS,
    historyFilters: HISTORY_FILTERS,
    historyActiveFilter: HISTORY_FILTERS[0].key,
    historyRoutes: [],
    historyEmpty: true,
    historySyncing: false,
    userCard: DEFAULT_USER_CARD,
    privacyLevel: 'private',
    showLocationPrompt: false,
    syncInfo: formatSyncInfo({}),
    syncBusy: false,
    announcementModalVisible: false,
    announcementModal: null,
  },

  onLoad() {
    this.app = app;
    this.settings = { ...getRecentSettings() };
    this.profile = getUserProfile();
    this.account = getUserAccount();
    this.routes = [];
    this.fetchingWeather = false;
    this.currentOverview = EMPTY_OVERVIEW;

    const initialRoutes =
      (this.app &&
        Array.isArray(this.app.globalData?.routes) &&
        this.app.globalData.routes.length &&
        this.app.globalData.routes) ||
      getRoutes() ||
      [];
    this.updateFromRoutes(initialRoutes);

    this.unsubscribe = subscribe((nextRoutes) => {
      this.updateFromRoutes(nextRoutes);
    });

    this.setData({
      networkConnected: this.app?.globalData?.networkConnected !== false,
      privacyLevel: this.settings.privacyLevel || 'private',
    });

    this.initNetworkListener();
    this.ensureWeather();
  },

  onShow() {
    if (this.app?.globalData) {
      this.setData({
        networkConnected: this.app.globalData.networkConnected !== false,
      });
    }
    const latestAccount = getUserAccount();
    if (latestAccount && latestAccount.id !== this.account?.id) {
      this.account = latestAccount;
      this.setData({
        userCard: buildUserCard({
          overview: this.currentOverview,
          settings: this.settings,
          profile: this.profile,
          account: this.account,
        }),
      });
    }
    const weather = this.data.weather || {};
    if (!weather.ready || (weather.fetchedAt && Date.now() - weather.fetchedAt > 30 * 60 * 1000)) {
      this.ensureWeather();
    }
    this.ensureAnnouncement();
  },

  onUnload() {
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }
    if (typeof wx.offNetworkStatusChange === 'function' && this.networkListener) {
      wx.offNetworkStatusChange(this.networkListener);
    }
  },

  onPullDownRefresh() {
    const tasks = [this.ensureWeather(true)];
    if (this.data.activeTab === 'history') {
      tasks.push(this.syncHistoryFromCloud(true));
    }
    return Promise.all(tasks)
      .catch(() => { })
      .finally(() => {
        if (typeof wx.stopPullDownRefresh === 'function') {
          wx.stopPullDownRefresh();
        }
      });
  },

  initNetworkListener() {
    if (typeof wx.onNetworkStatusChange !== 'function') {
      return;
    }
    this.networkListener = (res) => {
      this.setData({ networkConnected: res.isConnected });
    };
    wx.onNetworkStatusChange(this.networkListener);
  },

  updateFromRoutes(routes = []) {
    this.routes = Array.isArray(routes) ? routes : [];
    const latestAccount = getUserAccount();
    if (latestAccount) {
      this.account = latestAccount;
    }
    const overview = createOverview(this.routes);
    this.currentOverview = overview;
    const progress = buildProgressFromOverview(overview);
    const userCard = buildUserCard({
      overview,
      settings: this.settings,
      profile: this.profile,
      account: this.account,
    });
    this.setData({
      overview,
      progress,
      userCard,
    });
    this.refreshHistoryRoutes();
    this.refreshSyncInfo();
  },

  ensureWeather(force = false) {
    if (this.fetchingWeather && !force) {
      return Promise.resolve();
    }
    this.fetchingWeather = true;
    this.setData({
      weather: { ...this.data.weather, loading: true, error: '' },
    });
    return checkLocationAuthorization()
      .then(({ authorized }) => {
        if (!authorized) {
          this.setData({
            showLocationPrompt: true,
            weather: createWeatherState({
              loading: false,
              error: '需要开启定位权限以获取天气建议',
            }),
          });
          return null;
        }
        this.setData({ showLocationPrompt: false });
        return this.getCurrentLocation();
      })
      .then((coords) => {
        if (!coords) return null;
        return this.loadWeather(coords);
      })
      .catch((error) => {
        const message = error?.errMsg || error?.message || '暂时无法获取天气';
        this.setData({
          weather: createWeatherState({
            loading: false,
            error: message,
            suggestion: '稍后重试或检查网络',
          }),
        });
      })
      .finally(() => {
        this.fetchingWeather = false;
      });
  },

  ensureAnnouncement() {
    const lastSeen = getLatestSeenAnnouncement();
    const lastSeenId = lastSeen && Number(lastSeen.id);
    const isNewUser = !Array.isArray(this.routes) || this.routes.length === 0;

    return api
      .getActiveAnnouncements()
      .then((res) => {
        const list = Array.isArray(res?.items) ? res.items : [];
        if (!list.length) {
          this.setData({
            announcementModalVisible: false,
            announcementModal: null,
          });
          return;
        }

        const eligible = list.filter((item) => {
          const audience = (item.targetAudience || 'all').toLowerCase();
          if (audience === 'new_users' && !isNewUser) {
            return false;
          }
          return true;
        });

        if (!eligible.length) {
          return;
        }

        let candidate = null;

        // 1) 一次性公告优先，且只弹未读的
        const singles = eligible.filter((item) => item.deliveryMode !== 'persistent');
        if (singles.length) {
          candidate =
            singles.find((item) => {
              const id = Number(item.id);
              if (!Number.isFinite(id)) return false;
              if (Number.isFinite(lastSeenId) && id <= lastSeenId) {
                return false;
              }
              return true;
            }) || null;
        }

        // 2) 如果没有可弹的一次性公告，再看常驻公告
        if (!candidate) {
          const persistents = eligible.filter((item) => item.deliveryMode === 'persistent');
          if (persistents.length) {
            candidate = persistents[0];
          }
        }

        if (!candidate || !candidate.id) {
          return;
        }

        const publishAt =
          typeof candidate.publishAt === 'number' && Number.isFinite(candidate.publishAt)
            ? candidate.publishAt
            : null;
        const modalPayload = {
          id: Number(candidate.id),
          title: candidate.title || '系统公告',
          body: candidate.body || '',
          publishAt,
          publishAtText: publishAt ? new Date(publishAt).toLocaleString('zh-CN') : '',
          deliveryMode: candidate.deliveryMode || 'single',
          forceRead: !!candidate.forceRead,
          linkUrl: candidate.linkUrl || '',
        };
        this.latestAnnouncement = modalPayload;
        this.setData({
          announcementModalVisible: true,
          announcementModal: modalPayload,
        });
      })
      .catch(() => {
        // 静默忽略公告拉取错误，避免影响正常使用
      });
  },

  getCurrentLocation() {
    return new Promise((resolve, reject) => {
      if (typeof wx.getLocation !== 'function') {
        reject(new Error('当前环境不支持定位'));
        return;
      }
      wx.getLocation({
        type: 'gcj02',
        isHighAccuracy: true,
        success: (res) => resolve({ latitude: res.latitude, longitude: res.longitude }),
        fail: reject,
      });
    });
  },

  loadWeather({ latitude, longitude }) {
    return Promise.all([
      api.getWeatherSnapshotSafe({ latitude, longitude }),
      typeof geocodeLocal.getCityNameWithFallback === 'function'
        ? geocodeLocal.getCityNameWithFallback({ latitude, longitude }).catch(() => '')
        : Promise.resolve(''),
    ])
      .then(([payload, cityText]) => {
        const formatted = formatWeatherPayload(payload);
        this.setData({
          weather: {
            ...formatted,
            cityText: cityText || payload.cityName || payload.city || '',
          },
        });
      })
      .catch((error) => {
        const message = error?.errMsg || error?.message || '天气数据暂不可用';
        this.setData({
          weather: createWeatherState({
            loading: false,
            error: message,
            suggestion: '稍后再试或刷新页面',
          }),
        });
      });
  },

  refreshHistoryRoutes(filterKey = null) {
    const fallback = HISTORY_FILTERS[0]?.key || 'all';
    const nextFilter = filterKey || this.data.historyActiveFilter || fallback;
    const filtered = filterHistoryRoutes(this.routes, nextFilter).sort(
      (a, b) => (b.startTime || 0) - (a.startTime || 0)
    );
    const formatted = filtered.map(formatHistoryRoute).filter(Boolean);
    this.setData({
      historyRoutes: formatted,
      historyActiveFilter: nextFilter,
      historyEmpty: formatted.length === 0,
    });
    this.resolveHistoryRoutePlaces(formatted);
  },

  refreshSyncInfo() {
    try {
      const status = typeof getSyncStatus === 'function' ? getSyncStatus() : {};
      this.setData({ syncInfo: formatSyncInfo(status) });
    } catch (err) {
      this.setData({ syncInfo: formatSyncInfo({}) });
    }
  },

  resolveHistoryRoutePlaces(list = []) {
    if (!Array.isArray(list) || !list.length) {
      return;
    }
    const lookup = new Map((this.routes || []).map((route) => [route.id, route]));
    list.forEach((item, index) => {
      const raw = lookup.get(item.id);
      if (!raw || !Array.isArray(raw.points) || !raw.points.length) {
        return;
      }
      const needStart = shouldFixPlaceName(item.startLabel);
      const needEnd = shouldFixPlaceName(item.endLabel);
      if (!needStart && !needEnd) {
        return;
      }
      const startPoint = raw.points[0];
      const endPoint = raw.points[raw.points.length - 1] || startPoint;
      const tasks = [];
      if (needStart && startPoint) {
        tasks.push(api.reverseGeocodeSafe(startPoint));
      } else {
        tasks.push(Promise.resolve({ displayName: item.startLabel }));
      }
      if (needEnd && endPoint) {
        tasks.push(api.reverseGeocodeSafe(endPoint));
      } else {
        tasks.push(Promise.resolve({ displayName: item.endLabel }));
      }
      Promise.all(tasks)
        .then(([startRes, endRes]) => {
          const startLabel = startRes?.name || startRes?.displayName || item.startLabel;
          const endLabel = endRes?.name || endRes?.displayName || item.endLabel;
          this.setData({
            [`historyRoutes[${index}].startLabel`]: startLabel,
            [`historyRoutes[${index}].endLabel`]: endLabel,
          });
        })
        .catch(() => { });
    });
  },

  syncHistoryFromCloud(showToast = false) {
    if (this.data.historySyncing) {
      return Promise.resolve();
    }
    this.setData({ historySyncing: true });
    return syncRoutesFromCloud()
      .then(() => {
        if (showToast) {
          wx.showToast({ title: '已同步云端', icon: 'success' });
        }
      })
      .catch(() => {
        if (showToast) {
          wx.showToast({ title: '同步失败，请稍后再试', icon: 'none' });
        }
      })
      .finally(() => {
        this.setData({ historySyncing: false });
      });
  },

  handleHistorySync() {
    return this.syncHistoryFromCloud(true);
  },

  handleHistoryFilterChange(event) {
    const { key } = event.currentTarget.dataset || {};
    if (!key || key === this.data.historyActiveFilter) {
      return;
    }
    this.refreshHistoryRoutes(key);
  },

  handleHistoryRouteTap(event) {
    const { id } = event.currentTarget.dataset || {};
    if (!id) {
      return;
    }
    wx.navigateTo({
      url: `/pages/route-detail/route-detail?id=${id}`,
    });
  },

  handleHistoryRouteLongPress(event) {
    const { id } = event.currentTarget.dataset || {};
    if (!id) {
      return;
    }
    const route = (this.routes || []).find((item) => item && item.id === id);
    if (!route) {
      return;
    }
    const options = PRIVACY_LEVELS.map(
      (item) => `${item.label}${item.key === route.privacyLevel ? '（当前）' : ''}`
    );
    wx.showActionSheet({
      alertText: '调整隐私或删除轨迹',
      itemList: [...options, '删除该轨迹'],
      success: (res) => {
        const index = res.tapIndex;
        if (index < 0) {
          return;
        }
        if (index < options.length) {
          const level = PRIVACY_LEVELS[index].key;
          updateRoutePrivacy(route.id, level);
          wx.showToast({ title: '隐私已更新', icon: 'success' });
        } else {
          this.confirmHistoryRouteDelete(route.id);
        }
      },
    });
  },

  confirmHistoryRouteDelete(routeId) {
    wx.showModal({
      title: '删除轨迹',
      content: '删除后无法恢复，确认要删除这条轨迹吗？',
      confirmText: '删除',
      cancelText: '保留',
      confirmColor: '#dc2626',
      success: (res) => {
        if (res.confirm) {
          deleteRoute(routeId)
            .then(() => {
              wx.showToast({ title: '已删除', icon: 'none' });
            })
            .catch(() => {
              wx.showToast({ title: '删除失败，请重试', icon: 'none' });
            });
        }
      },
    });
  },

  handleTabChange(event) {
    const { key } = event.currentTarget.dataset || {};
    if (!key || key === this.data.activeTab) {
      return;
    }
    this.setData({ activeTab: key });
    if (key === 'history') {
      this.refreshHistoryRoutes();
    }
  },

  handleRefreshWeather() {
    return this.ensureWeather(true);
  },

  handleConfirmAnnouncement() {
    const modal = this.data.announcementModal;
    if (modal && modal.id) {
      try {
        setLatestSeenAnnouncement({ id: modal.id, seenAt: Date.now() });
      } catch (e) {
        // ignore storage errors
      }
    }
    this.setData({
      announcementModalVisible: false,
      announcementModal: null,
    });
  },

  handleSkipAnnouncement() {
    this.setData({
      announcementModalVisible: false,
      announcementModal: null,
    });
  },

  handleAnnouncementLinkTap() {
    const modal = this.data.announcementModal || {};
    const url = modal.linkUrl;
    if (!url || typeof url !== 'string') {
      return;
    }
    if (url.charAt(0) === '/') {
      try {
        wx.navigateTo({ url });
      } catch (e) {
        wx.showToast({ title: '无法打开链接', icon: 'none' });
      }
    } else {
      wx.showToast({ title: '暂不支持外部链接', icon: 'none' });
    }
  },

  handleManualSync() {
    if (this.data.syncBusy) {
      return;
    }
    this.setData({ syncBusy: true });
    syncRoutesToCloud()
      .catch((error) => {
        throw error;
      })
      .then(() => syncRoutesFromCloud({ forceFull: false }))
      .then(() => {
        this.refreshSyncInfo();
        wx.showToast({ title: '同步完成', icon: 'success' });
      })
      .catch(() => {
        wx.showToast({ title: '同步失败', icon: 'none' });
      })
      .finally(() => {
        this.setData({ syncBusy: false });
      });
  },

  handleRequestLocationAuthorize() {
    requestLocationAuthorization()
      .then(({ authorized }) => {
        const next = Boolean(authorized);
        this.setData({ showLocationPrompt: !next });
        if (next) {
          wx.showToast({ title: '定位已授权', icon: 'success' });
          this.ensureWeather(true);
        } else {
          wx.showToast({ title: '定位仍未开启', icon: 'none' });
        }
      })
      .catch(() => {
        wx.showToast({ title: '授权失败，请稍后再试', icon: 'none' });
      });
  },

  handleOpenLocationSetting() {
    openLocationSetting()
      .then((res) => {
        const authorized = Boolean(res?.authorized);
        this.setData({ showLocationPrompt: !authorized });
        if (authorized) {
          wx.showToast({ title: '定位权限已开启', icon: 'success' });
          this.ensureWeather(true);
        }
      })
      .catch(() => {
        wx.showToast({ title: '无法打开设置', icon: 'none' });
      });
  },

  handleNavigateRecord() {
    if (!this.ensureProfileReadyForRecordStart()) {
      return;
    }
    wx.navigateTo({ url: '/pages/record/record' });
  },

  ensureProfileReadyForRecordStart() {
    if (!app || typeof app.getProfileCompletionStatus !== 'function') {
      return true;
    }
    const { complete } = app.getProfileCompletionStatus();
    if (complete) {
      return true;
    }
    if (typeof app.checkAndPromptProfileCompletion === 'function') {
      app.checkAndPromptProfileCompletion('home_record');
    }
    return false;
  },

  handleNavigateHistory() {
    wx.navigateTo({ url: '/pages/history/history' });
  },

  handleCompleteProfile() {
    wx.navigateTo({
      url: '/pages/profile-info/profile-info',
    });
  },

  handleOpenFeedback() {
    wx.navigateTo({
      url: '/pages/feedback/feedback',
    });
  },

  handleOpenBadgeWall() {
    wx.navigateTo({
      url: '/pages/badges/badges',
    });
  },

  handleOpenAbout() {
    wx.showModal({
      title: '关于 RouteLab',
      content: 'RouteLab 致力于提供安全、可靠的校园轨迹记录与分享服务。',
      showCancel: false,
      confirmText: '知道了',
    });
  },

  handlePrivacySwitchChange(event) {
    const isPublic = Boolean(event?.detail?.value);
    const nextPrivacy = isPublic ? 'public' : 'private';
    const current = this.settings?.privacyLevel || 'private';
    if (current === nextPrivacy) {
      this.setData({ privacyLevel: nextPrivacy });
      return;
    }
    const nextSettings = {
      ...(this.settings || {}),
      privacyLevel: nextPrivacy,
    };
    this.settings = nextSettings;
    saveRecentSettings(nextSettings);
    this.setData({
      privacyLevel: nextPrivacy,
      userCard: createProfileCard({
        overview: this.currentOverview,
        settings: nextSettings,
        profile: this.profile,
        account: this.account,
      }),
    });
    wx.showToast({
      title: nextPrivacy === 'public' ? '默认公开已开启' : '默认公开已关闭',
      icon: 'none',
    });
  },
});
