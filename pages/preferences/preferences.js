'use strict';

const { PRIVACY_LEVELS } = require('../../constants/privacy');
const { getRecentSettings, saveRecentSettings, clearOfflineQueue } = require('../../utils/storage');
const api = require('../../services/api');

Page({
  data: {
    privacyOptions: PRIVACY_LEVELS,
    privacyIndex: Math.max(PRIVACY_LEVELS.findIndex((item) => item.key === 'private'), 0),
    weight: 60,
    autoSync: true,
    message: '',
  },

  onLoad() {
    const settings = getRecentSettings() || {};
    const privacyIndex = Math.max(
      PRIVACY_LEVELS.findIndex((item) => item.key === settings.privacyLevel),
      0
    );
    this.setData({
      privacyIndex,
      weight: settings.weight || 60,
      autoSync: settings.autoSync !== undefined ? settings.autoSync : true,
    });
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

  handleAutoSyncChange(event) {
    this.setData({
      autoSync: event.detail.value,
    });
  },

  handleSave() {
    const payload = {
      privacyLevel: this.data.privacyOptions[this.data.privacyIndex].key,
      weight: this.data.weight,
      autoSync: this.data.autoSync,
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
