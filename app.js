const { subscribe, getRoutes, flushOfflineFragments, storeRoute, createRoutePayload } = require('./services/route-store');
const { getRecentSettings } = require('./utils/storage');
const { ensureSeedRoutes } = require('./services/sample-data');
const { checkLocationAuthorization } = require('./utils/permissions');

App({
  globalData: {
    routes: [],
    networkConnected: true,
    locationAuthorized: false,
  },
  onLaunch() {
    this.globalData.routes = getRoutes();
    if (!this.globalData.routes.length) {
      ensureSeedRoutes();
      this.globalData.routes = getRoutes();
    }

    this.unsubscribe = subscribe((routes) => {
      this.globalData.routes = routes;
    });

    wx.onNetworkStatusChange &&
      wx.onNetworkStatusChange((res) => {
        this.globalData.networkConnected = res.isConnected;
        if (res.isConnected && this.shouldAutoSync()) {
          this.flushOfflineCache();
        }
      });

    if (this.shouldAutoSync()) {
      this.flushOfflineCache();
    }

    checkLocationAuthorization().then(({ authorized }) => {
      this.globalData.locationAuthorized = authorized;
    });
  },
  onUnload() {
    if (this.unsubscribe) {
      this.unsubscribe();
    }
  },
  shouldAutoSync() {
    const settings = getRecentSettings() || {};
    return settings.autoSync !== false;
  },
  flushOfflineCache() {
    const fragments = flushOfflineFragments();
    if (!fragments.length) {
      return;
    }
    const grouped = fragments.reduce((acc, fragment) => {
      const sessionId = fragment.sessionId || 'temp';
      if (!acc[sessionId]) {
        acc[sessionId] = [];
      }
      acc[sessionId].push(fragment);
      return acc;
    }, {});
    Object.keys(grouped).forEach((key) => {
      const sessionFragments = grouped[key];
      const points = sessionFragments
        .filter((item) => item.type === 'location' && item.point)
        .map((item) => item.point);
      if (points.length < 2) {
        return;
      }
      const payload = createRoutePayload({
        points,
        title: '\u79bb\u7ebf\u8865\u507f\u8f68\u8ff9',
        startTime: points[0].timestamp,
        endTime: points[points.length - 1].timestamp,
        privacyLevel: 'private',
        campusZone: '\u79bb\u7ebf\u8bb0\u5f55',
      });
      storeRoute(payload);
    });
  },
});
