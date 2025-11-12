function normalizeAuthSetting(authSetting = {}) {
  const hasForeground = !!authSetting['scope.userLocation'];
  const hasBackground = !!authSetting['scope.userLocationBackground'];
  return {
    authorized: hasForeground || hasBackground,
    foreground: hasForeground,
    background: hasBackground,
    scope: hasBackground ? 'background' : hasForeground ? 'foreground' : 'none',
  };
}

function checkLocationAuthorization() {
  return new Promise((resolve) => {
    if (typeof wx.getSetting !== 'function') {
      resolve({ authorized: false, scope: 'none', foreground: false, background: false });
      return;
    }
    wx.getSetting({
      success: (res) => {
        resolve(normalizeAuthSetting(res.authSetting || {}));
      },
      fail: () => {
        resolve({ authorized: false, scope: 'none', foreground: false, background: false });
      },
    });
  });
}

function requestLocationAuthorization() {
  return new Promise((resolve, reject) => {
    if (typeof wx.authorize !== 'function') {
      reject(new Error('authorize not supported'));
      return;
    }
    wx.authorize({
      scope: 'scope.userLocation',
      success: () => {
        checkLocationAuthorization().then(resolve).catch(() => resolve({ authorized: true, scope: 'foreground' }));
      },
      fail: (err) => reject(err || new Error('user denied')),
    });
  });
}

function openLocationSetting() {
  return new Promise((resolve, reject) => {
    if (typeof wx.openSetting !== 'function') {
      reject(new Error('openSetting not supported'));
      return;
    }
    wx.openSetting({
      success: (res) => {
        resolve(normalizeAuthSetting(res.authSetting || {}));
      },
      fail: reject,
    });
  });
}

function guideBackgroundLocationAuthorization() {
  return new Promise((resolve) => {
    if (typeof wx.showModal !== 'function') {
      resolve(false);
      return;
    }
    wx.showModal({
      title: '保持后台定位',
      content:
        '为确保息屏或切换到后台时继续记录轨迹，请在系统设置中为 RouteLab 选择“始终允许”定位权限（iOS）或开启后台定位权限。',
      confirmText: '前往设置',
      cancelText: '稍后',
      success: (res) => {
        if (res.confirm) {
          openLocationSetting()
            .then((status) => resolve(!!status.background))
            .catch(() => resolve(false));
        } else {
          resolve(false);
        }
      },
      fail: () => resolve(false),
    });
  });
}

module.exports = {
  checkLocationAuthorization,
  requestLocationAuthorization,
  openLocationSetting,
  guideBackgroundLocationAuthorization,
};
