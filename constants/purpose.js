const PURPOSE_OPTIONS = [
  {
    key: 'walk',
    label: '散步',
    icon: '🚶',
    description: '散步、慢行等轻松活动',
  },
  {
    key: 'run',
    label: '跑步',
    icon: '🏃',
    description: '跑步或慢跑训练',
  },
  {
    key: 'ride',
    label: '骑行',
    icon: '🚴',
    description: '骑行、单车出行',
  },
  {
    key: 'gym',
    label: '健身',
    icon: '💪',
    description: '健身房、力量训练',
  },
  {
    key: 'basketball',
    label: '篮球',
    icon: '🏀',
    description: '篮球运动或课程',
  },
  {
    key: 'football',
    label: '足球',
    icon: '⚽',
    description: '足球训练或比赛',
  },
  {
    key: 'badminton',
    label: '羽毛球',
    icon: '🏸',
    description: '羽毛球运动或课程',
  },
  {
    key: 'tableTennis',
    label: '乒乓球',
    icon: '🏓',
    description: '乒乓球训练或活动',
  },
  {
    key: 'tennis',
    label: '网球',
    icon: '🎾',
    description: '网球训练或比赛',
  },
  {
    key: 'volleyball',
    label: '排球',
    icon: '🏐',
    description: '排球训练或比赛',
  },
  {
    key: 'hiking',
    label: '爬山',
    icon: '🥾',
    description: '登山、徒步等户外活动',
  },
  {
    key: 'other',
    label: '其他',
    icon: '⭐',
    description: '未列出的其他运动项目',
  },
];

const PURPOSE_MAP = PURPOSE_OPTIONS.reduce((acc, item) => {
  acc[item.key] = item;
  return acc;
}, {});

const DEFAULT_PURPOSE_KEY = PURPOSE_OPTIONS[0].key;

module.exports = {
  PURPOSE_OPTIONS,
  PURPOSE_MAP,
  DEFAULT_PURPOSE_KEY,
};
