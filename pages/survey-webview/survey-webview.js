'use strict';

function safeDecodeURIComponent(value = '') {
  const input = typeof value === 'string' ? value : '';
  if (!input) {
    return '';
  }
  try {
    return decodeURIComponent(input);
  } catch (_) {
    return input;
  }
}

Page({
  data: {
    url: '',
    error: '',
    ready: false,
  },

  onLoad(options = {}) {
    const url = safeDecodeURIComponent(options.url || '');
    const title = safeDecodeURIComponent(options.title || '') || '填写问卷';
    if (typeof wx.setNavigationBarTitle === 'function') {
      wx.setNavigationBarTitle({ title });
    }
    if (!/^https?:\/\/\S+$/i.test(url)) {
      this.setData({
        ready: false,
        error: '问卷链接无效，请返回上一页检查 survey.url 配置。',
      });
      return;
    }
    this.setData({
      url,
      error: '',
      ready: true,
    });
  },

  handleWebViewError() {
    this.setData({
      url: '',
      ready: false,
      error: '问卷加载失败，请检查业务域名、问卷链接或当前网络连接。',
    });
  },

  handleNavigateBack() {
    wx.navigateBack({
      fail: () => {
        wx.redirectTo({ url: '/pages/index/index' });
      },
    });
  },
});
