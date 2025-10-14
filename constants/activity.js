const ACTIVITY_TYPES = [
  {
    key: 'walk',
    label: '步行',
    description: '校园通勤、散步、慢跑等以步行为主的路线',
  },
  {
    key: 'ride',
    label: '骑行',
    description: '校园骑行、共享单车通勤及其他有轮出行',
  },
];

const ACTIVITY_TYPE_MAP = ACTIVITY_TYPES.reduce((acc, item) => {
  acc[item.key] = item;
  return acc;
}, {});

const DEFAULT_ACTIVITY_TYPE = 'walk';

module.exports = {
  ACTIVITY_TYPES,
  ACTIVITY_TYPE_MAP,
  DEFAULT_ACTIVITY_TYPE,
};
