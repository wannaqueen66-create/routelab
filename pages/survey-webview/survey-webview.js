'use strict';

const { applyThemeMixin } = require('../../utils/theme');
const { resolveNextUrl, markSurveyCompleted } = require('../../services/survey-flow');

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

Page(applyThemeMixin({
  data: {
    url: '',
    error: '',
    ready: false,
    title: '填写问卷',
  },

  onLoad(options = {}) {
    const url = safeDecodeURIComponent(options.url || '');
    const title = safeDecodeURIComponent(options.title || '') || '填写问卷';
    this.nextUrl = resolveNextUrl(options.next || '');
    if (!/^https?:\/\/\S+$/i.test(url)) {
      this.setData({
        ready: false,
        title,
        error: '问卷链接无效，请返回上一页检查 survey.url 配置。',
      });
      return;
    }
    this.setData({
      url,
      title,
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

  handleManualComplete() {
    wx.showModal({
      title: '确认已提交问卷？',
      content: '如果你已经在 PowerCX 页面完成提交，但没有自动回跳，可以直接继续记录。',
      confirmText: '继续记录',
      cancelText: '取消',
      success: (res) => {
        if (!res.confirm) {
          return;
        }
        wx.showLoading({ title: '正在放行...' });
        markSurveyCompleted()
          .then(() => {
            wx.showToast({ title: '已手动放行', icon: 'success' });
            setTimeout(() => {
              wx.redirectTo({ url: this.nextUrl || '/pages/record/record' });
            }, 250);
          })
          .catch((error) => {
            wx.showToast({
              title: error?.message || '手动放行失败',
              icon: 'none',
            });
          })
          .finally(() => {
            wx.hideLoading();
          });
      },
    });
  },

  handleNavigateBack() {
    wx.showActionSheet({
      itemList: ['已提交，继续记录', '返回上一页'],
      success: (res) => {
        if (res.tapIndex === 0) {
          this.handleManualComplete();
          return;
        }
        wx.navigateBack({
          fail: () => {
            wx.redirectTo({ url: '/pages/index/index' });
          },
        });
      },
      fail: () => {
        wx.navigateBack({
          fail: () => {
            wx.redirectTo({ url: '/pages/index/index' });
          },
        });
      },
    });
  },
}));
