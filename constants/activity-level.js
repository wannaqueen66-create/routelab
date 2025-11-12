const ACTIVITY_LEVELS = {
  sedentary: {
    key: 'sedentary',
    label: '轻松节奏',
    summary: '单次距离 ≤ 1.2 km 或 ≤ 20 min',
    description: '适合偶尔出行或短距离通勤，记录轻松稳定的步行节奏。',
    color: '#94a3b8',
  },
  moderate: {
    key: 'moderate',
    label: '均衡节奏',
    summary: '距离 1.2-4 km 或 20-40 min',
    description: '保持效率又不过度透支，适合大多数日常穿梭与锻炼安排。',
    color: '#38bdf8',
  },
  high: {
    key: 'high',
    label: '活力节奏',
    summary: '单次距离 ≥ 4 km 或 ≥ 40 min',
    description: '持续性强、强度高，展现出极佳的校园活跃度。',
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
