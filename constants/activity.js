const ACTIVITY_TYPES = [
  {
    key: 'walk',
    label: '步行',
    description: '校园通勤、散步、慢跑等以步行为主的路线',
  },
  {
    key: 'ride',
    label: '骑行',
    description: '校园骑行、共享单车通勤以及其他以车轮为主的出行方式',
  },
  {
    key: 'run',
    label: '跑步',
    description: '训练或比赛时的跑步记录，便于查看配速与心率变化',
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
