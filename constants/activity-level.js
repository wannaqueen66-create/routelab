const ACTIVITY_LEVELS = {
  sedentary: {
    key: 'sedentary',
    label: '轻松节奏',
    summary: '单次距离≤1.2 km，时长≤20分钟',
    description: '适合偶尔出行或短距离通勤，更多是随性步行为主。',
    color: '#94a3b8',
  },
  moderate: {
    key: 'moderate',
    label: '均衡节奏',
    summary: '距离在1.2-4 km或时长在20-40分钟之间',
    description: '既有效率又不过度透支，适合大部分日常穿梭与运动安排。',
    color: '#38bdf8',
  },
  high: {
    key: 'high',
    label: '活力节奏',
    summary: '单次距离≥4 km或时长≥40分钟',
    description: '持续性强、强度较高，展现出极佳的校园活跃度。',
    color: '#f97316',
  },
};

const ACTIVITY_LEVEL_LIST = Object.keys(ACTIVITY_LEVELS).map((key) => ACTIVITY_LEVELS[key]);

function getActivityLevelMeta(level) {
  return ACTIVITY_LEVELS[level] || ACTIVITY_LEVELS.moderate;
}

module.exports = {
  ACTIVITY_LEVELS,
  ACTIVITY_LEVEL_LIST,
  getActivityLevelMeta,
};
