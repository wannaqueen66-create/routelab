'use strict';

const { applyThemeMixin } = require('../../utils/theme');
const {
  getSurveyConfig,
  getSurveyCompletionState,
  buildSurveyWebviewUrl,
  resolveNextUrl,
  markSurveyCompleted,
} = require('../../services/survey-flow');

function formatCompletedAt(timestamp) {
  const candidate = Number(timestamp);
  if (!Number.isFinite(candidate) || candidate <= 0) {
    return '';
  }
  try {
    return new Date(candidate).toLocaleString('zh-CN');
  } catch (_) {
    return '';
  }
}

Page(applyThemeMixin({
  data: {
    surveyTitle: '开始记录前问卷',
    surveyVersion: '',
    surveyEnabled: false,
    surveyRequired: false,
    configValid: false,
    configError: '',
    nextUrl: '/pages/record/record',
    openedSurvey: false,
    alreadyCompleted: false,
    completedAtText: '',
    canContinue: false,
    loadingStatus: false,
    statusError: '',
    responseStatus: '',
    respondentId: '',
    callbackUrl: '',
    completionSource: '',
  },

  onLoad(options = {}) {
    this.nextUrl = resolveNextUrl(options.next || '');
    this.source = typeof options.source === 'string' ? options.source.trim() : 'manual';
    this.refreshSurveyState();
  },

  onShow() {
    this.refreshSurveyState();
  },

  refreshSurveyState() {
    const survey = getSurveyConfig();
    const openedSurvey = this.data.openedSurvey === true;

    this.setData({
      surveyTitle: survey.title,
      surveyVersion: survey.version,
      surveyEnabled: survey.enabled,
      surveyRequired: survey.enabled,
      configValid: survey.valid,
      configError: survey.errorMessage,
      nextUrl: this.nextUrl,
      callbackUrl: '',
      statusError: '',
    });

    if (!survey.enabled || !survey.valid) {
      this.setData({
        alreadyCompleted: false,
        completedAtText: '',
        responseStatus: '',
        respondentId: '',
        canContinue: false,
        loadingStatus: false,
      });
      return Promise.resolve();
    }

    this.setData({ loadingStatus: true, statusError: '' });
    return getSurveyCompletionState()
      .then((state) => {
        const alreadyCompleted = state.currentVersionCompleted === true;
        this.setData({
          surveyTitle: state.surveyTitle || survey.title,
          surveyVersion: state.surveyVersion || survey.version,
          surveyEnabled: state.surveyEnabled === true,
          surveyRequired: !alreadyCompleted,
          configValid: state.configValid !== false,
          configError: state.errorMessage || '',
          callbackUrl: state.callbackUrl || '',
          alreadyCompleted,
          completedAtText: formatCompletedAt(state.completedAt),
          responseStatus: state.responseStatus || '',
          respondentId: state.respondentId || '',
          completionSource: state.completionSource || '',
          canContinue: alreadyCompleted || openedSurvey,
          loadingStatus: false,
          statusError: '',
        });
      })
      .catch((error) => {
        this.setData({
          loadingStatus: false,
          alreadyCompleted: false,
          completedAtText: '',
          responseStatus: '',
          respondentId: '',
          canContinue: openedSurvey,
          statusError: error?.message || '无法获取服务端问卷状态，请检查网络后重试',
        });
      });
  },

  handleOpenSurvey() {
    const survey = getSurveyConfig();
    if (!survey.enabled) {
      wx.showToast({ title: '当前未启用问卷', icon: 'none' });
      return;
    }
    if (!survey.valid) {
      wx.showToast({ title: '问卷配置不完整', icon: 'none' });
      return;
    }

    wx.showLoading({ title: '正在打开问卷...' });
    buildSurveyWebviewUrl({ source: this.source || 'home_hero' })
      .then((url) => {
        this.setData({
          openedSurvey: true,
          canContinue: true,
        });
        wx.navigateTo({ url });
      })
      .catch((error) => {
        wx.showToast({
          title: error?.message || '问卷打开失败，请稍后重试',
          icon: 'none',
        });
      })
      .finally(() => {
        wx.hideLoading();
      });
  },

  handleConfirmContinue() {
    const survey = getSurveyConfig();
    if (!survey.enabled) {
      this.navigateToNext();
      return;
    }
    if (!survey.valid) {
      wx.showToast({ title: '问卷配置不完整', icon: 'none' });
      return;
    }
    if (!(this.data.openedSurvey || this.data.alreadyCompleted)) {
      wx.showToast({ title: '请先打开并完成问卷', icon: 'none' });
      return;
    }

    wx.showLoading({ title: '正在核验结果...' });
    getSurveyCompletionState()
      .then((state) => {
        const alreadyCompleted = state.currentVersionCompleted === true;
        this.setData({
          callbackUrl: state.callbackUrl || '',
          alreadyCompleted,
          completedAtText: formatCompletedAt(state.completedAt),
          responseStatus: state.responseStatus || '',
          respondentId: state.respondentId || '',
          completionSource: state.completionSource || '',
          canContinue: alreadyCompleted || this.data.openedSurvey,
          statusError: '',
        });
        if (alreadyCompleted) {
          this.navigateToNext();
          return;
        }
        wx.showToast({
          title: '服务端尚未确认问卷完成，请提交后再试',
          icon: 'none',
        });
      })
      .catch((error) => {
        this.setData({
          statusError: error?.message || '无法获取服务端问卷状态，请检查网络后重试',
        });
        wx.showToast({ title: '核验失败，请稍后重试', icon: 'none' });
      })
      .finally(() => {
        wx.hideLoading();
      });
  },

  handleRetryStatus() {
    this.refreshSurveyState();
  },

  handleManualComplete() {
    const survey = getSurveyConfig();
    if (!survey.enabled || !survey.valid) {
      wx.showToast({ title: '当前问卷不可用', icon: 'none' });
      return;
    }
    if (!this.data.openedSurvey) {
      wx.showToast({ title: '请先打开问卷并提交', icon: 'none' });
      return;
    }

    wx.showModal({
      title: '确认已提交问卷？',
      content: '如果你已经在 PowerCX 页面完成提交，但没有自动回跳，可以手动放行继续记录。',
      confirmText: '确认继续',
      cancelText: '再看看',
      success: (res) => {
        if (!res.confirm) {
          return;
        }
        wx.showLoading({ title: '正在放行...' });
        markSurveyCompleted()
          .then((state) => {
            this.setData({
              alreadyCompleted: true,
              completedAtText: formatCompletedAt(state.completedAt),
              responseStatus: state.responseStatus || '',
              respondentId: state.respondentId || '',
              completionSource: state.completionSource || 'local_manual',
              canContinue: true,
              statusError: '',
            });
            wx.showToast({ title: '已手动放行', icon: 'success' });
            setTimeout(() => this.navigateToNext(), 250);
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
    wx.navigateBack({
      fail: () => {
        wx.redirectTo({ url: '/pages/index/index' });
      },
    });
  },

  navigateToNext() {
    wx.redirectTo({ url: this.nextUrl });
  },
}));
