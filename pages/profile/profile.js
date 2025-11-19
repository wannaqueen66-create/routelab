'use strict';

const {
  getRecentSettings,
  saveRecentSettings,
  getUserProfile,
  getUserAccount,
} = require('../../utils/storage');
const { getDefaultNickname, getAvatarColor, getInitialFromName } = require('../../utils/profile-meta');
const rewards = require('../../services/rewards');

function formatGender(value) {
  if (value === 'male') {
    return '男';
  }
  if (value === 'female') {
    return '女';
  }
  return '未填写';
}

const AGE_RANGE_LABELS = {
  under18: '18岁以下',
  '18_24': '18-24岁',
  '25_34': '25-34岁',
  '35_44': '35-44岁',
  '45_54': '45-54岁',
  '55_plus': '55岁及以上',
};

const IDENTITY_LABELS = {
  minor: '未成年',
  undergrad: '本科生',
  postgrad: '研究生',
  staff: '教职工',
  resident: '居民',
  other: '其他',
};

function formatAgeRange(value) {
  return AGE_RANGE_LABELS[value] || '未填写';
}

function formatIdentity(value) {
  return IDENTITY_LABELS[value] || '未填写';
}

Page({
  data: {
    avatarUrl: '',
    avatarColor: '#e2e8f0',
    avatarInitial: 'R',
    displayName: 'RouteLab 用户',
    shareStatus: '公开分享',
    userIdLabel: 'User ID: --',
    personalInfo: [],
    defaultPublic: true,
    totalPoints: 0,
    badgeIcon: '🏃',
    badgeLabel: '新手上路',
    badgeUnlockedText: '已获勋章：0/6',
    badgeNextHint: '再接再厉，继续加油！',
  },

  onShow() {
    this.refreshProfile();
  },

  refreshProfile() {
    const profile = getUserProfile() || {};
    const account = getUserAccount() || {};
    const settings = getRecentSettings() || {};
    const nickname =
      profile?.nickname ||
      account?.nickname ||
      account?.username ||
      account?.displayName ||
      getDefaultNickname(account);
    const avatarUrl = profile?.avatarUrl || account?.avatar || '';
    const avatarSeed = avatarUrl || account?.id || nickname;
    const initials = getInitialFromName(nickname || avatarSeed);
    const avatarColor = getAvatarColor(avatarSeed);
    const privacyLevel = settings.privacyLevel || 'public';
    const defaultPublic = privacyLevel !== 'private';
    const weightValue = Number(settings.weight);
    const weightText =
      Number.isFinite(weightValue) && weightValue > 0 ? `${weightValue} kg` : '未填写';

    const personalInfo = [
      { key: 'name', label: '姓名', value: nickname || '未填写' },
      { key: 'gender', label: '性别', value: formatGender(profile?.gender || account?.gender) },
      { key: 'ageRange', label: '年龄段', value: formatAgeRange(profile?.ageRange || account?.ageRange) },
      { key: 'identity', label: '身份标签', value: formatIdentity(profile?.identity || account?.identity) },
      { key: 'birthday', label: '生日', value: profile?.birthday || '未填写' },
      { key: 'weight', label: '体重', value: weightText },
      {
        key: 'height',
        label: '身高',
        value:
          profile?.height && Number.isFinite(Number(profile.height))
            ? `${Number(profile.height)} cm`
            : '未填写',
      },
    ];

    const achievementSnapshot = rewards.getAchievementSnapshot();
    const unlockedText = `已获勋章：${achievementSnapshot.unlockedCount}/${achievementSnapshot.badgeCount}`;
    const nextHint = achievementSnapshot.nextBadge
      ? `距 ${achievementSnapshot.nextBadge.icon} ${achievementSnapshot.nextBadge.label} 还差 ${achievementSnapshot.remainingToNext} 分`
      : '已解锁全部勋章';

    this.setData({
      avatarUrl,
      avatarColor,
      avatarInitial: initials,
      displayName: nickname,
      shareStatus: defaultPublic ? '公开分享' : '私密记录',
      userIdLabel: account?.id ? `User ID: ${account.id}` : 'User ID: --',
      personalInfo,
      defaultPublic,
      totalPoints: achievementSnapshot.totalPoints,
      badgeIcon: achievementSnapshot.badgeIcon,
      badgeLabel: achievementSnapshot.badgeLabel,
      badgeUnlockedText: unlockedText,
      badgeNextHint: nextHint,
    });
  },

  handleCompleteProfile() {
    wx.navigateTo({
      url: '/pages/profile-info/profile-info',
    });
  },

  handleDefaultPrivacyToggle(event) {
    const defaultPublic = Boolean(event?.detail?.value);
    const recent = getRecentSettings() || {};
    const nextPrivacy = defaultPublic ? 'public' : 'private';
    saveRecentSettings({
      ...recent,
      privacyLevel: nextPrivacy,
    });
    this.setData({ defaultPublic, shareStatus: defaultPublic ? '公开分享' : '私密记录' });
  },

  handleOpenFeedback() {
    wx.navigateTo({
      url: '/pages/feedback/feedback',
    });
  },

  handleOpenBadgeWall() {
    wx.navigateTo({
      url: '/pages/badges/badges',
    });
  },

  handleOpenAbout() {
    wx.showModal({
      title: '关于 RouteLab',
      content: 'RouteLab 致力于提供安全、可靠的校园轨迹记录与分享服务。',
      showCancel: false,
      confirmText: '知道了',
    });
  },
});
