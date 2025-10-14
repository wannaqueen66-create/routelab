const PRIVACY_LEVELS = [
  {
    key: 'public',
    label: '公开共享',
    description: '在榜单与精选路线中展示亮点，方便他人参考',
    badge: 'Campus Open',
  },
  {
    key: 'group',
    label: '群组可见',
    description: '仅对班级、社团或好友圈展示路线概要',
    badge: 'Group View',
  },
  {
    key: 'private',
    label: '仅自己可见',
    description: '仅保留在本机，隐去地图细节，便于个人回顾',
    badge: 'Solo Only',
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
