/**
 * Theme mixin for pages.
 * Usage: call applyThemeMixin(pageConfig) before Page(pageConfig).
 */
function applyThemeMixin(config) {
  const origData = config.data || {};
  config.data = Object.assign({ theme: 'light' }, origData);

  const origOnLoad = config.onLoad;
  config.onLoad = function (options) {
    const app = getApp();
    this.setData({ theme: app.globalData.theme });
    this._themeListener = (t) => this.setData({ theme: t });
    app.onThemeUpdate(this._themeListener);
    if (origOnLoad) origOnLoad.call(this, options);
  };

  const origOnShow = config.onShow;
  config.onShow = function (options) {
    const app = getApp();
    if (app.globalData.theme !== this.data.theme) {
      this.setData({ theme: app.globalData.theme });
    }
    if (origOnShow) origOnShow.call(this, options);
  };

  const origOnUnload = config.onUnload;
  config.onUnload = function () {
    if (this._themeListener) {
      getApp().offThemeUpdate(this._themeListener);
    }
    if (origOnUnload) origOnUnload.call(this);
  };

  return config;
}

module.exports = { applyThemeMixin };
