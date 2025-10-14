function checkLocationAuthorization() {
  return new Promise((resolve) => {
    if (!wx.getSetting) {
      resolve({ authorized: false, scope: 'none' });
      return;
    }
    wx.getSetting({
      success: (res) => {
        const authSetting = res.authSetting || {};
        const hasForeground = !!authSetting['scope.userLocation'];
        const hasBackground = !!authSetting['scope.userLocationBackground'];
        resolve({
          authorized: hasForeground || hasBackground,
          scope: hasBackground ? 'background' : hasForeground ? 'foreground' : 'none',
        });
      },
      fail: () => {
        resolve({ authorized: false, scope: 'none' });
      },
    });
  });
}

function requestLocationAuthorization() {
  return new Promise((resolve, reject) => {
    if (!wx.authorize) {
      reject(new Error('authorize not supported'));
      return;
    }
    wx.authorize({
      scope: 'scope.userLocation',
      success: () => resolve({ authorized: true }),
      fail: (err) => reject(err || new Error('user denied')),
    });
  });
}

function openLocationSetting() {
  return new Promise((resolve, reject) => {
    if (!wx.openSetting) {
      reject(new Error('openSetting not supported'));
      return;
    }
    wx.openSetting({
      success: (res) => {
        const authSetting = res.authSetting || {};
        const hasForeground = !!authSetting['scope.userLocation'];
        const hasBackground = !!authSetting['scope.userLocationBackground'];
        resolve({ authorized: hasForeground || hasBackground });
      },
      fail: reject,
    });
  });
}

module.exports = {
  checkLocationAuthorization,
  requestLocationAuthorization,
  openLocationSetting,
};
