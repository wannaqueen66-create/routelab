const { PRIVACY_LEVELS } = require('../../constants/privacy');
const { CAMPUS_ZONES, buildCampusDisplayName, normalizeSelection } = require('../../constants/campus');
const { getRecentSettings, saveRecentSettings, clearOfflineQueue } = require('../../utils/storage');

function parseCampusZone(zone) {
  if (!zone || typeof zone !== 'string') {
    return null;
  }
  const parts = zone.split(' · ');
  if (parts.length < 3) {
    return null;
  }
  return normalizeSelection({
    category: parts[0],
    area: parts[1],
    location: parts[2],
  });
}

Page({
  data: {
    privacyOptions: PRIVACY_LEVELS,
    campusZones: CAMPUS_ZONES,
    privacyIndex: 1,
    zoneIndex: 0,
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
    const campusZone = settings.campusSelection ? buildCampusDisplayName(settings.campusSelection) : settings.campusZone;
    const zoneIndex = Math.max(CAMPUS_ZONES.indexOf(campusZone), 0);
    this.setData({
      privacyIndex,
      zoneIndex,
      weight: settings.weight || 60,
      autoSync: settings.autoSync !== undefined ? settings.autoSync : true,
    });
  },
  handlePrivacyChange(event) {
    this.setData({
      privacyIndex: Number(event.detail.value),
    });
  },
  handleZoneChange(event) {
    this.setData({
      zoneIndex: Number(event.detail.value),
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
      campusZone: this.data.campusZones[this.data.zoneIndex],
      campusSelection: parseCampusZone(this.data.campusZones[this.data.zoneIndex]),
      weight: this.data.weight,
      autoSync: this.data.autoSync,
    };
    saveRecentSettings(payload);
    this.setData({ message: '偏好设置已保存' });
    wx.showToast({
      title: '已保存',
      icon: 'success',
    });
  },
  handleClearOffline() {
    clearOfflineQueue();
    wx.showToast({
      title: '离线缓存已清空',
      icon: 'success',
    });
  },
});
