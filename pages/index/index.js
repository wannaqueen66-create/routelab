const { checkLocationAuthorization, requestLocationAuthorization, openLocationSetting } = require('../../utils/permissions');
const { subscribe, getRoutes } = require('../../services/route-store');
const { pickBestLoops, summarizeRoutes } = require('../../services/analytics');
const { formatDuration, formatDate, getWeekday } = require('../../utils/time');
const { formatDistance, formatCalories } = require('../../utils/format');
const { buildCampusDisplayName } = require('../../constants/campus');
const { PRIVACY_LEVEL_MAP } = require('../../constants/privacy');

function createOverview(routes) {
  const summary = summarizeRoutes(routes);
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todayEnd = new Date(todayStart);
  todayEnd.setDate(todayEnd.getDate() + 1);

  const todayRoutes = routes.filter(
    (route) => route.startTime >= todayStart.getTime() && route.startTime < todayEnd.getTime()
  );
  const todaySummary = summarizeRoutes(todayRoutes);

  return {
    totalCount: summary.count,
    totalDistance: formatDistance(summary.distance),
    totalDuration: formatDuration(summary.duration),
    totalCalories: formatCalories(
      routes.reduce((acc, route) => acc + (route.stats?.calories || 0), 0)
    ),
    todayDistance: formatDistance(todaySummary.distance),
    todayDuration: formatDuration(todaySummary.duration),
    todayCount: todaySummary.count,
  };
}

function normalizeLoop(route) {
  if (!route) {
    return null;
  }
  return {
    id: route.id,
    title: route.title,
    distance: formatDistance(route.stats?.distance),
    duration: formatDuration(route.stats?.duration),
    campusLabel: route.campusMeta ? buildCampusDisplayName(route.campusMeta) : route.campusZone,
    date: formatDate(route.startTime),
  };
}

Page({
  data: {
    overview: {
      totalCount: 0,
      totalDistance: '0 m',
      totalDuration: '00:00',
      totalCalories: '0 kcal',
      todayDistance: '0 m',
      todayDuration: '00:00',
      todayCount: 0,
    },
    bestLoops: {
      commute: null,
      run: null,
    },
    recentRoutes: [],
    networkConnected: true,
    locationAuthorized: true,
    showLocationPrompt: false,
  },
  onLoad() {
    const app = getApp();
    this.setData({
      networkConnected: app.globalData.networkConnected,
      locationAuthorized: app.globalData.locationAuthorized,
      showLocationPrompt: !app.globalData.locationAuthorized,
    });
    this.unsubscribe = subscribe((routes) => this.refresh(routes));
    this.refresh(getRoutes());
    this.ensureLocationPermission(true);
  },
  onShow() {
    this.refresh(getRoutes());
    this.ensureLocationPermission(false);
  },
  onUnload() {
    if (this.unsubscribe) {
      this.unsubscribe();
    }
  },
  refresh(routes) {
    const overview = createOverview(routes);
    const bestLoops = pickBestLoops(routes);
    const sortedRoutes = routes.slice(0, 3).map((route) => ({
      id: route.id,
      title: route.title,
      distance: formatDistance(route.stats?.distance),
      duration: formatDuration(route.stats?.duration),
      startDate: formatDate(route.startTime),
      week: getWeekday(route.startTime),
      privacyLabel: PRIVACY_LEVEL_MAP[route.privacyLevel]?.label || route.privacyLevel,
      campusLabel: route.campusMeta ? buildCampusDisplayName(route.campusMeta) : route.campusZone,
    }));
    this.setData({
      overview,
      bestLoops: {
        commute: normalizeLoop(bestLoops.commute),
        run: normalizeLoop(bestLoops.run),
      },
      recentRoutes: sortedRoutes,
    });
  },
  ensureLocationPermission(showPrompt = false) {
    checkLocationAuthorization().then(({ authorized }) => {
      const app = getApp();
      app.globalData.locationAuthorized = authorized;
      this.setData({
        locationAuthorized: authorized,
        showLocationPrompt: showPrompt ? !authorized : this.data.showLocationPrompt,
      });
    });
  },
  handleNavigateRecord() {
    wx.navigateTo({
      url: '/pages/record/record',
    });
  },
  handleNavigateHistory() {
    wx.navigateTo({
      url: '/pages/history/history',
    });
  },
  handleRequestLocationAuthorize() {
    requestLocationAuthorization()
      .then(() => {
        this.ensureLocationPermission();
      })
      .catch(() => {
        this.handleOpenLocationSetting();
      });
  },
  handleOpenLocationSetting() {
    openLocationSetting()
      .then(({ authorized }) => {
        const app = getApp();
        app.globalData.locationAuthorized = authorized;
        this.setData({
          locationAuthorized: authorized,
          showLocationPrompt: !authorized,
        });
        if (!authorized) {
          wx.showToast({ title: '开启定位后方可使用', icon: 'none' });
        }
      })
      .catch(() => {
        wx.showToast({ title: '请在设置中开启定位', icon: 'none' });
      });
  },
  handleNavigateRoute(event) {
    const { id } = event.currentTarget.dataset;
    if (!id) {
      return;
    }
    wx.navigateTo({
      url: `/pages/route-detail/route-detail?id=${id}`,
    });
  },
});






