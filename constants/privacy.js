const PRIVACY_LEVELS = [
  {
    key: 'public',
    label: '公开分享',
    description: '向所有 RouteLab 用户展示完整轨迹详情，适合赛事、活动等需要共享的路线。',
    badge: 'Public',
  },
  {
    key: 'private',
    label: '仅自己可见',
    description: '仅本人在小程序内可见，但轨迹会同步到云端供管理员稽核与保障数据安全。',
    badge: 'Private',
  },
];

const PRIVACY_LEVEL_MAP = PRIVACY_LEVELS.reduce((acc, item) => {
  acc[item.key] = item;
  return acc;
}, {});

module.exports = {
  PRIVACY_LEVELS,
  PRIVACY_LEVEL_MAP,
};
