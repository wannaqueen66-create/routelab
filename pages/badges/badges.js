'use strict';

const rewards = require('../../services/rewards');

Page({
  data: {
    totalPoints: 0,
    badgeIcon: '🏃',
    badgeLabel: '新手上路',
    nextBadgeHint: '',
    badges: [],
  },

  onShow() {
    this.refreshBadgeWall();
  },

  refreshBadgeWall() {
    const snapshot = rewards.getAchievementSnapshot();
    const wall = rewards.getBadgeWallState();
    const hint = snapshot.nextBadge
      ? `再获得 ${snapshot.remainingToNext} 分可解锁 ${snapshot.nextBadge.icon} ${snapshot.nextBadge.label}`
      : '恭喜，已解锁全部勋章！';
    this.setData({
      totalPoints: snapshot.totalPoints,
      badgeIcon: snapshot.badgeIcon,
      badgeLabel: snapshot.badgeLabel,
      nextBadgeHint: hint,
      badges: wall,
    });
  },
});
