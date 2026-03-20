'use strict';

const { PRIVACY_LEVELS } = require('../../constants/privacy');
const { getRecentSettings, saveRecentSettings, clearOfflineQueue, getThemePreference } = require('../../utils/storage');
const api = require('../../services/api');

Page({
  data: {
    theme: 'light',
    themeOptions: [
      { key: 'light', label: '浅色', icon: '☀️' },
      { key: 'dark', label: '深色', icon: '🌙' },
      { key: 'auto', label: '跟随系统', icon: '🔄' },
    ],
    themePreference: 'auto',
    privacyOptions: PRIVACY_LEVELS,
    privacyIndex: Math.max(PRIVACY_LEVELS.findIndex((item) => item.key === 'private'), 0),
    weight: 60,
    message: '',
  },

  onLoad() {
    const app = getApp();
    const settings = getRecentSettings() || {};
    const privacyIndex = Math.max(
      PRIVACY_LEVELS.findIndex((item) => item.key === settings.privacyLevel),
      0
    );
    this.setData({
      theme: app.globalData.theme,
      themePreference: getThemePreference(),
      privacyIndex,
      weight: settings.weight || 60,
    });
    this._themeListener = (t) => this.setData({ theme: t });
    app.onThemeUpdate(this._themeListener);
  },

  onUnload() {
    getApp().offThemeUpdate(this._themeListener);
  },

  handleThemeChange(e) {
    const key = e.currentTarget.dataset.key;
    if (!key) return;
    const app = getApp();
    app.setTheme(key);
    this.setData({ themePreference: key, theme: app.globalData.theme });
  },

  handlePrivacyChange(event) {
    this.setData({
      privacyIndex: Number(event.detail.value),
    });
  },

  handleWeightInput(event) {
    const weight = Number(event.detail.value) || 0;
    this.setData({
      weight,
    });
  },

  handleSave() {
    const payload = {
      privacyLevel: this.data.privacyOptions[this.data.privacyIndex].key,
      weight: this.data.weight,
      autoSync: true,
    };
    saveRecentSettings(payload);
    api.saveUserSettings(payload).catch(() => {});
    wx.showToast({
      title: '偏好设置已保存',
      icon: 'success',
    });
    this.setData({ message: '偏好设置已保存' });
  },

  handleClearOffline() {
    clearOfflineQueue();
    wx.showToast({
      title: '离线缓存已清理',
      icon: 'success',
    });
  },

  handleEditProfile() {
    wx.navigateTo({
      url: '/pages/profile-info/profile-info',
    });
  },
});
