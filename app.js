const {
    subscribe,
    getRoutes,
    flushOfflineFragments,
    storeRoute,
    createRoutePayload,
    syncRoutesFromCloud,
    syncRoutesToCloud,
  } = require('./services/route-store');
const auth = require('./services/auth');
const { getRecentSettings, getUserProfile, getUserAccount, saveAchievementStats, getThemePreference, setThemePreference } = require('./utils/storage');
const { saveRecentSettings, setKeepScreenPreference } = require('./utils/storage');
const {
  checkLocationAuthorization,
  requestLocationAuthorization,
  openLocationSetting,
  } = require('./utils/permissions');
  const logger = require('./utils/logger');
  const tracker = require('./services/tracker');
  const api = require('./services/api');
  
  function clonePoint(point) {
    if (!point) {
      return null;
    }
    return {
      latitude: Number(point.latitude),
      longitude: Number(point.longitude),
      speed: Number.isFinite(point.speed) ? Number(point.speed) : null,
      altitude: Number.isFinite(point.altitude) ? Number(point.altitude) : null,
      heading: Number.isFinite(point.heading) ? Number(point.heading) : null,
      accuracy: Number.isFinite(point.accuracy) ? Number(point.accuracy) : null,
      timestamp: point.timestamp || Date.now(),
      source: point.source || 'gps',
    };
  }
  
  function buildStoredProfileSnapshot() {
    const stored = getUserProfile?.() || {};
    const account = getUserAccount?.() || {};
    const nickname = (stored.nickname || account.nickname || '').trim();
    const avatarUrl = stored.avatarUrl || account.avatar || '';
    const gender = (stored.gender || account.gender || '').trim();
    const ageRange = (stored.ageRange || account.ageRange || '').trim();
    const identity = (stored.identity || account.identity || '').trim();
    return {
      nickname,
      avatarUrl,
      gender,
      ageRange,
      identity,
    };
  }
  
function isStoredProfileComplete(profile) {
  if (!profile || typeof profile !== 'object') {
    return false;
  }
  const REQUIRED_FIELDS = ['gender', 'ageRange', 'identity'];
  return REQUIRED_FIELDS.every((field) => {
    const value = typeof profile[field] === 'string' ? profile[field].trim() : '';
    return Boolean(value);
  });
}
  
App({
  _themeListeners: [],

  globalData: {
    routes: [],
    networkConnected: true,
      locationAuthorized: false,
      loggedIn: false,
      profileComplete: false,
      profileSnapshot: null,
      theme: 'light',
    },

    buildProfileSnapshot() {
      return buildStoredProfileSnapshot();
    },
    getProfileCompletionStatus() {
      const snapshot = buildStoredProfileSnapshot();
      const complete = isStoredProfileComplete(snapshot);
      this.globalData.profileComplete = complete;
      this.globalData.profileSnapshot = snapshot;
      return { complete, snapshot };
    },
    checkAndPromptProfileCompletion(reason = 'manual') {
      if (typeof wx === 'undefined' || typeof wx.showModal !== 'function') {
        return;
      }
      const now = Date.now();
      if (this.profilePrompting) {
        return;
      }
      if (this.lastProfilePromptAt && now - this.lastProfilePromptAt < 5000) {
        return;
      }
      const { complete } = this.getProfileCompletionStatus();
      if (complete) {
        return;
      }
      const pages =
        typeof getCurrentPages === 'function' ? getCurrentPages() : [];
      const topPage =
        Array.isArray(pages) && pages.length ? pages[pages.length - 1] : null;
      if (topPage && topPage.route === 'pages/profile-info/profile-info') {
        return;
      }
      this.profilePrompting = true;
      this.lastProfilePromptAt = now;
      wx.showModal({
        title: '完善个人信息',
        content: '为了提供更准确的服务，请填写性别、年龄段和身份标签等资料。',
        confirmText: '去完善',
        cancelText: '稍后',
        success: (res) => {
          if (res.confirm) {
            wx.navigateTo({
              url: '/pages/profile-info/profile-info',
            });
          }
        },
        complete: () => {
          this.profilePrompting = false;
          this.lastProfilePromptAt = Date.now();
        },
      });
    },
  
    resolveTheme() {
      const pref = getThemePreference();
      let effective = 'light';
      if (pref === 'dark') {
        effective = 'dark';
      } else if (pref === 'auto') {
        try {
          const sysInfo = wx.getSystemInfoSync();
          effective = sysInfo.theme === 'dark' ? 'dark' : 'light';
        } catch (_) {
          effective = 'light';
        }
      }
      this.globalData.theme = effective;
      this._themeListeners.forEach((cb) => {
        try { cb(effective); } catch (_) {}
      });
      return effective;
    },

    setTheme(preference) {
      setThemePreference(preference);
      return this.resolveTheme();
    },

    onThemeUpdate(cb) {
      if (typeof cb === 'function' && !this._themeListeners.includes(cb)) {
        this._themeListeners.push(cb);
      }
    },

    offThemeUpdate(cb) {
      this._themeListeners = this._themeListeners.filter((fn) => fn !== cb);
    },

    onLaunch() {
      logger.ensureLogFile();
      logger.info('App launch');

      this.resolveTheme();
      if (typeof wx.onThemeChange === 'function') {
        wx.onThemeChange(() => {
          if (getThemePreference() === 'auto') {
            this.resolveTheme();
          }
        });
      }

      this.profilePrompting = false;
      this.lastProfilePromptAt = 0;
      this.getProfileCompletionStatus();
  
      this.globalData.routes = getRoutes();
  
      this.unsubscribe = subscribe((routes) => {
        this.globalData.routes = routes;
      });
  
      const runInitialSync = () => {
        if (this.shouldAutoSync()) {
          this.flushOfflineCache()
            .then(() => this.pushLocalToCloud())
            .then(() => this.syncFromCloud(false, { forceFull: true }))
            .catch((error) => logger.warn('Auto sync on launch failed', error?.message || error));
        } else {
          this.syncFromCloud(false, { forceFull: true }).catch(() => {});
        }
      };
  
      this.ensurePrerequisites()
        .then(() =>
          Promise.all([
            api
              .getUserAchievements()
              .then((payload) => {
                if (payload && typeof payload === 'object') {
                  saveAchievementStats(payload);
                }
              })
              .catch(() => {}),
            api
              .getUserSettings()
              .then((settings) => {
                if (settings && typeof settings === 'object') {
                  const local = {
                    privacyLevel: settings.privacyLevel,
                    weight: settings.weight,
                    autoSync: true,
                    keepScreenPreferred: Boolean(settings.keepScreenPreferred),
                  };
                  saveRecentSettings(local);
                  setKeepScreenPreference(Boolean(settings.keepScreenPreferred));
                }
              })
              .catch(() => {}),
          ]).then(() => {
            runInitialSync();
          })
        )
        .catch((error) => {
          logger.warn('Prerequisite check incomplete', error?.errMsg || error?.message || error);
        });
  
      if (typeof wx.onNetworkStatusChange === 'function') {
        wx.onNetworkStatusChange((res) => {
          this.globalData.networkConnected = res.isConnected;
          logger.info('Network status changed', { connected: res.isConnected });
          if (res.isConnected && this.shouldAutoSync()) {
            this.flushOfflineCache()
              .then(() => this.pushLocalToCloud())
              .then(() => this.syncFromCloud(false))
              .catch((error) => logger.warn('Auto sync after reconnect failed', error?.message || error));
          }
        });
      }

    },
  
    onShow(options) {
      if (typeof tracker.handleAppShow === 'function') {
        tracker
          .handleAppShow(options || {})
          .catch((error) => logger.warn('Auto resume tracking failed', error?.errMsg || error?.message || error));
      }
      this.checkAndPromptProfileCompletion('app_show');
    },
  
    onHide() {
      if (typeof tracker.handleAppHide === 'function') {
        let reason = 'background';
        try {
          if (typeof tracker.getKeepScreenPreference === 'function' && !tracker.getKeepScreenPreference()) {
            reason = 'screen_off';
          }
        } catch (_) {
          reason = 'background';
        }
        tracker
          .handleAppHide({ reason })
          .catch((error) => logger.warn('Auto pause tracking failed', error?.errMsg || error?.message || error));
      }
    },
  
    ensurePrerequisites() {
      return this.ensureInitialLogin()
        .then(() => this.ensureLocationAccess())
        .catch((error) => {
          logger.warn('Failed to satisfy prerequisites', error?.errMsg || error?.message || error);
          throw error;
        });
    },
  
    ensureInitialLogin(attempt = 0) {
      const force = attempt > 0;
      return auth
        .ensureLogin(force)
        .then((payload) => {
          this.globalData.loggedIn = true;
          this.checkAndPromptProfileCompletion('login');
          return payload;
        })
        .catch((error) => {
          this.globalData.loggedIn = false;
          logger.warn('Login attempt failed', error?.errMsg || error?.message || error);
          if (attempt >= 2) {
            wx.showToast({ title: '登录失败，请稍后再试', icon: 'none' });
            return Promise.reject(error);
          }
          return this.promptLoginRetry().then((shouldRetry) => {
            if (!shouldRetry) {
              wx.showToast({ title: '未登录，部分功能不可用', icon: 'none' });
              return Promise.reject(error);
            }
            return this.ensureInitialLogin(attempt + 1);
          });
        });
    },
  
    promptLoginRetry() {
      return new Promise((resolve) => {
        wx.showModal({
          title: '需要登录',
          content: '请登录账号后继续使用全部功能。',
          confirmText: '重新登录',
          cancelText: '暂不',
          success: (res) => {
            resolve(res.confirm);
          },
          fail: () => resolve(false),
        });
      });
    },
  
    ensureLocationAccess(attempt = 0) {
      return checkLocationAuthorization()
        .then((res) => {
          this.globalData.locationAuthorized = res.authorized;
          if (res.authorized) {
            return true;
          }
          if (attempt >= 1) {
            wx.showToast({ title: '定位权限未开启，部分功能不可用', icon: 'none' });
            const error = new Error('Location authorization denied');
            error.code = 'LOCATION_DENIED';
            return Promise.reject(error);
          }
          return this.promptLocationAuthorization(res.scope || 'none').then(() =>
            this.ensureLocationAccess(attempt + 1)
          );
        })
        .catch((error) => {
          logger.warn('Check location authorization failed', error?.errMsg || error?.message || error);
          return Promise.reject(error);
        });
    },
  
    promptLocationAuthorization(scope = 'none') {
      return new Promise((resolve) => {
        wx.showModal({
          title: '需要定位权限',
          content: '请在设置中开启定位权限后继续使用轨迹记录和天气等功能。',
          confirmText: '去设置',
          cancelText: '暂不',
          success: (res) => {
            if (!res.confirm) {
              resolve(false);
              return;
            }
            const action =
              scope === 'none'
                ? requestLocationAuthorization().catch((error) => {
                    logger.warn('Request location authorization failed', error?.errMsg || error?.message || error);
                    return openLocationSetting();
                  })
                : openLocationSetting();
            action
              .then(() => resolve(true))
              .catch((error) => {
                logger.warn('Open location setting failed', error?.errMsg || error?.message || error);
                wx.showToast({ title: '无法开启定位权限', icon: 'none' });
                resolve(false);
              });
          },
          fail: () => resolve(false),
        });
      });
    },

    onUnload() {
      if (typeof tracker.applyKeepScreenState === 'function') {
        tracker.applyKeepScreenState({ force: true }).catch(() => {});
      }
      if (typeof this.unsubscribe === 'function') {
        this.unsubscribe();
      }
    },
  
    shouldAutoSync() {
      return true;
    },
  
    flushOfflineCache() {
      const fragments = flushOfflineFragments();
      if (!fragments.length) {
        logger.info('No offline fragments to flush');
        return Promise.resolve([]);
      }
  
      const grouped = fragments.reduce((acc, fragment) => {
        const sessionId = fragment.sessionId || 'temp';
        acc[sessionId] = acc[sessionId] || [];
        acc[sessionId].push(fragment);
        return acc;
      }, {});
  
      const createdRoutes = [];
      Object.keys(grouped).forEach((sessionId) => {
        const sessionFragments = grouped[sessionId];
        const points = sessionFragments
          .filter((item) => item.type === 'location' && item.point)
          .map((item) => clonePoint(item.point))
          .filter(Boolean);
  
        if (points.length < 2) {
          logger.warn('Skip flushing offline session (insufficient points)', {
            sessionId,
            fragments: sessionFragments.length,
            points: points.length,
          });
          return;
        }
  
        const startPoint = points[0];
        const endPoint = points[points.length - 1];
  
        const payload = createRoutePayload({
          points,
          title: '离线轨迹记录',
          startTime: startPoint.timestamp,
          endTime: endPoint.timestamp,
          privacyLevel: 'private',
          startLabel: '离线轨迹起点',
          endLabel: '离线轨迹终点',
          startLocation: { name: '离线轨迹起点', displayName: '', address: null, raw: null },
          endLocation: { name: '离线轨迹终点', displayName: '', address: null, raw: null },
        });
  
        createdRoutes.push(storeRoute(payload));
        logger.info('Flushed offline fragments to route', {
          sessionId,
          fragments: sessionFragments.length,
          points: points.length,
        });
      });
  
      return Promise.resolve(createdRoutes);
    },
  
    pushLocalToCloud() {
      return syncRoutesToCloud().catch((error) => {
        logger.warn('Sync local routes to cloud failed', error?.message || error);
      });
    },
  
    syncFromCloud(showToast = false, options = {}) {
      return syncRoutesFromCloud(options)
        .then((routes) => {
          this.globalData.routes = routes;
          if (showToast) {
            wx.showToast({ title: '已同步云端', icon: 'success' });
          }
          return routes;
        })
        .catch((error) => {
          logger.warn('Sync from cloud failed', error?.message || error);
          if (showToast) {
            wx.showToast({ title: '同步云端失败', icon: 'none' });
          }
          return this.globalData.routes;
        });
    },
  });
