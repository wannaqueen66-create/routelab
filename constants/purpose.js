const PURPOSE_OPTIONS = [
  { key: 'basketball', label: '篮球', icon: '🏀', description: '篮球训练或比赛' },
  { key: 'football', label: '足球', icon: '⚽', description: '足球训练或比赛' },
  { key: 'run', label: '跑步', icon: '🏃', description: '跑步或慢跑训练' },
  { key: 'badminton', label: '羽毛球', icon: '🏸', description: '羽毛球练习或课程' },
  { key: 'table_tennis', label: '乒乓球', icon: '🏓', description: '乒乓球训练或活动' },
  { key: 'volleyball', label: '排球', icon: '🏐', description: '排球训练或比赛' },
  { key: 'tennis', label: '网球', icon: '🎾', description: '网球练习或比赛' },
  { key: 'swimming', label: '游泳', icon: '🏊', description: '游泳或水上训练' },
  { key: 'gym', label: '健身', icon: '💪', description: '力量训练或综合健身' },
  { key: 'yoga_pilates', label: '瑜伽 / 普拉提', icon: '🧘', description: '瑜伽或普拉提练习' },
  { key: 'martial_arts', label: '武术类', icon: '🥋', description: '武术、搏击等训练' },
  { key: 'dance', label: '舞蹈类', icon: '💃', description: '舞蹈课程或练习' },
];

// 保留旧键值以兼容历史数据
const LEGACY_PURPOSE_OPTIONS = [
  { key: 'walk', label: '散步', icon: '🚶', description: '散步、慢行等轻松活动' },
  { key: 'ride', label: '骑行', icon: '🚴', description: '骑行、单车出行' },
  { key: 'hiking', label: '爬山', icon: '🥾', description: '登山、徒步等户外活动' },
  { key: 'other', label: '其他', icon: '⭐', description: '未列出的其他运动项目' },
  { key: 'tabletennis', label: '乒乓球', icon: '🏓', description: '旧版本乒乓球键兼容' },
];

const ALL_PURPOSE_OPTIONS = [...PURPOSE_OPTIONS, ...LEGACY_PURPOSE_OPTIONS];

const PURPOSE_MAP = ALL_PURPOSE_OPTIONS.reduce((acc, item) => {
  acc[item.key] = item;
  return acc;
}, {});

const DEFAULT_PURPOSE_KEY = PURPOSE_OPTIONS[0].key;

module.exports = {
  PURPOSE_OPTIONS,
  PURPOSE_MAP,
  DEFAULT_PURPOSE_KEY,
};
