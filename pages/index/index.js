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
  updateRoutePrivacy,
  deleteRoute,
} = require('../../services/route-store');
const { summarizeRoutes } = require('../../services/analytics');
const { formatDuration, formatDate, formatClock, getWeekday } = require('../../utils/time');
const { formatDistance, formatCalories } = require('../../utils/format');
const { PRIVACY_LEVELS, PRIVACY_LEVEL_MAP } = require('../../constants/privacy');
const { ACTIVITY_TYPE_MAP, DEFAULT_ACTIVITY_TYPE } = require('../../constants/activity');
const api = require('../../services/api');
const geocodeLocal = require('../../services/geocode-local');
const { formatWind } = require('../../utils/wind');
const {
  getRecentSettings,
  getUserProfile,
  saveRecentSettings,
  getUserAccount,
} = require('../../utils/storage');
const { STORAGE_KEYS } = require('../../constants/storage');

const TAB_META = [
  { key: 'home', label: '首页', description: '记录运动', icon: '🏃' },
  { key: 'history', label: '历史', description: '回顾轨迹', icon: '🕘' },
  { key: 'profile', label: '我的', description: '统计与设置', icon: '👤' },
];

const HISTORY_FILTERS = [
  { key: 'all', label: '全部' },
  { key: 'recent', label: '最近七天' },
  { key: 'walk', label: '步行' },
  { key: 'ride', label: '骑行' },
  { key: 'public', label: '公开' },
  { key: 'private', label: '仅自己' },
];

const WEATHER_TEXT_MAP = {
  sunny: '晴朗',
  clear: '晴朗',
  cloudy: '多云',
  overcast: '阴天',
  rain: '有雨',
  rainy: '有雨',
  shower: '阵雨',
  snow: '有雪',
  windy: '有风',
  fog: '有雾',
};

const WEATHER_SUGGESTION_MAP = {
  'weather looks good. maintain your planned outdoor training.': '天气不错，可以放心进行户外训练。',
  'take a rest day or choose indoor workouts due to harsh weather.': '天气较差，建议休息或改为室内训练。',
  'light rain. consider waterproof gear if you head outside.': '有小雨，如需外出请准备防水装备。',
  'hot and humid. stay hydrated and avoid noon training.': '闷热潮湿，注意补水并避开正午训练。',
};

const HISTORY_RECENT_DAYS = 7;
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

function createWeatherState(overrides = {}) {
  return {
    loading: false,
    ready: false,
    temperature: '--',
    apparentTemperature: null,
    weatherText: '等待获取天气',
    humidityText: '--',
    windText: '--',
    airQualityText: '--',
    airQualityLevel: '',
    suggestion: '保持联网可获取实时运动建议',
    fetchedAt: null,
    error: '',
    cityText: '',
    sportAdviceLevel: 'neutral',
    sportAdviceLabel: '关注实时天气',
    sportAdviceColor: '#60a5fa',
    ...overrides,
  };
}

function formatAirQuality(airQuality = {}) {
  const value = Number(airQuality.value);
  if (!Number.isFinite(value)) {
    return airQuality.level || '--';
  }
  const level = airQuality.level || '良好';
  return `${level} · ${value.toFixed(0)}`;
}

function analyzeSportAdvice(payload = {}) {
  const text = `${payload.suggestion || ''}${payload.weatherText || ''}${payload.airQuality?.level || ''}`;
  const cautionKeywords = /(降温|雨|雾霾|谨慎|注意)/;
  const goodKeywords = /(晴|适宜|清爽|凉爽)/;
  let level = 'neutral';
  if (cautionKeywords.test(text)) level = 'caution';
  if (goodKeywords.test(text)) level = 'good';
  return {
    neutral: { label: '关注实时天气', color: '#60a5fa' },
    caution: { label: '注意补给与安全', color: '#f97316' },
    good: { label: '非常适合户外', color: '#34d399' },
  }[level];
}

function containsChinese(text = '') {
  return /[\u4e00-\u9fa5]/.test(text);
}

function ensureChineseText(text, fallback, dictionary = WEATHER_TEXT_MAP) {
  if (!text || typeof text !== 'string') {
    return fallback;
  }
  if (containsChinese(text)) {
    return text.trim();
  }
  const normalized = text.trim().toLowerCase();
  if (dictionary && dictionary[normalized]) {
    return dictionary[normalized];
  }
  return fallback;
}

function formatWeatherPayload(payload = {}) {
  const advice = analyzeSportAdvice(payload);
  const weatherText = ensureChineseText(payload.weatherText, advice.label);
  const suggestion = ensureChineseText(payload.suggestion, advice.label, WEATHER_SUGGESTION_MAP);
  const apparent = Number(payload.apparentTemperature);
  const humidity = Number(payload.humidity);
  const windSpeed = Number(payload.windSpeed);
  return {
    loading: false,
    ready: true,
    temperature: Number.isFinite(payload.temperature)
      ? `${Number(payload.temperature).toFixed(1)}℃`
      : '--',
    apparentTemperature: Number.isFinite(apparent) ? `${apparent.toFixed(1)}℃` : null,
    weatherText,
    humidityText: Number.isFinite(humidity) ? `${Math.round(humidity)}%` : '--',
    windText: Number.isFinite(windSpeed) ? formatWind(windSpeed) : '--',
    airQualityText: formatAirQuality(payload.airQuality),
    airQualityLevel: payload.airQuality?.level || '',
    suggestion,
    fetchedAt: payload.fetchedAt || Date.now(),
    error: '',
    cityText: payload.cityName || '',
    sportAdviceLevel: advice.label,
    sportAdviceLabel: suggestion,
    sportAdviceColor: advice.color,
  };
}

function formatHistoryRoute(route) {
  if (!route || typeof route !== 'object') {
    return null;
  }
  const activityType = route.meta?.activityType || route.activityType || DEFAULT_ACTIVITY_TYPE;
  const activityMeta = ACTIVITY_TYPE_MAP[activityType] || ACTIVITY_TYPE_MAP[DEFAULT_ACTIVITY_TYPE];
  return {
    id: route.id,
    title: route.title || '未命名路线',
    distanceText: formatDistance(route.stats?.distance),
    durationText: formatDuration(route.stats?.duration),
    caloriesText: formatCalories(route.stats?.calories),
    privacyLevel: route.privacyLevel,
    privacyLabel: PRIVACY_LEVEL_MAP[route.privacyLevel]?.label || '未知',
    startDate: formatDate(route.startTime),
    weekLabel: getWeekday(route.startTime),
    startLabel: route.meta?.startLabel || route.campusZone || '起点待识别',
    endLabel: route.meta?.endLabel || '终点待识别',
    activityLabel: activityMeta.label,
    activityType,
    timeRange: `${formatClock(route.startTime)} - ${formatClock(route.endTime)}`,
    photosCount: Array.isArray(route.photos) ? route.photos.length : 0,
  };
}

function filterHistoryRoutes(routes = [], filterKey = 'all') {
  const list = Array.isArray(routes) ? routes.filter(Boolean) : [];
  if (filterKey === 'recent') {
    const threshold = Date.now() - HISTORY_RECENT_DAYS * 24 * 60 * 60 * 1000;
    return list.filter((route) => route.startTime >= threshold);
  }
  if (filterKey === 'walk') {
    return list.filter(
      (route) => (route.meta?.activityType || route.activityType || DEFAULT_ACTIVITY_TYPE) === 'walk'
    );
  }
  if (filterKey === 'ride') {
    return list.filter(
      (route) => (route.meta?.activityType || route.activityType || DEFAULT_ACTIVITY_TYPE) === 'ride'
    );
  }
  if (filterKey === 'public') {
    return list.filter((route) => route.privacyLevel === 'public');
  }
  if (filterKey === 'private') {
    return list.filter((route) => route.privacyLevel === 'private');
  }
  return list;
}

function createProfileCard({ overview, settings, profile, account }) {
  const nickname =
    profile?.nickname ||
    account?.nickname ||
    account?.username ||
    account?.displayName ||
    'RouteLab 用户';
  const privacyLevel = settings?.privacyLevel || 'private';
  return {
    nickname,
    avatarUrl: profile?.avatarUrl || account?.avatar,
    privacyLevel,
    privacyLabel: PRIVACY_LEVEL_MAP[privacyLevel]?.label || '仅自己可见',
    privacyDescription:
      privacyLevel === 'public'
        ? '默认将新轨迹同步到公开社区'
        : '仅自己可见，需要时可手动公开',
    totalDistance: overview.totalDistance,
    totalCount: overview.totalCount,
    totalCalories: overview.totalCalories,
    initial: nickname.charAt(0).toUpperCase(),
  };
}

function shouldFixPlaceName(name = '') {
  if (!name || typeof name !== 'string') return true;
  const value = name.trim();
  if (!value) return true;
  if (/^\d+(\.\d+)?\s*,\s*\d+(\.\d+)?$/.test(value)) return true;
  return value.includes('待') || value.includes('未') || value.includes('坐标');
}

const app = getApp();
const EMPTY_OVERVIEW = createOverview([]);
const EMPTY_PROGRESS = buildProgressFromOverview(EMPTY_OVERVIEW);
const DEFAULT_WEATHER = createWeatherState({ loading: true });
const DEFAULT_USER_CARD = createProfileCard({
  overview: EMPTY_OVERVIEW,
  settings: {},
  profile: null,
  account: null,
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
        userCard: createProfileCard({
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
      .catch(() => {})
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
    const userCard = createProfileCard({
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
        .catch(() => {});
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
    wx.navigateTo({ url: '/pages/record/record' });
  },

  handleNavigateHistory() {
    wx.navigateTo({ url: '/pages/history/history' });
  },

  handleNavigateProfile() {
    wx.navigateTo({ url: '/pages/profile/profile' });
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
