const { applyThemeMixin } = require('../../utils/theme');
const { subscribe, getRoutes } = require('../../services/route-store');
const { buildComparisonSummary, getActivityLevel } = require('../../services/analytics');
const { formatDistance, formatCalories } = require('../../utils/format');
const { formatDuration } = require('../../utils/time');
const { buildCampusDisplayName } = require('../../constants/campus');
const { PRIVACY_LEVEL_MAP } = require('../../constants/privacy');

const LEVEL_META = {
  sedentary: {
    title: '久坐人群',
    description: '短距离、时间短，适合刚开始动起来的同学',
  },
  moderate: {
    title: '常态人群',
    description: '稳步通勤或散步，保持较均衡的活动节奏',
  },
  high: {
    title: '高活跃人群',
    description: '长距离或高强度跑步，适合训练型运动者',
  },
};

function formatAverageDuration(duration) {
  if (!duration) {
    return '—';
  }
  return formatDuration(duration);
}

function buildSummaryCards(summary) {
  return [
    {
      key: 'sedentary',
      title: '久坐人群',
      distance: `${(summary.sedentary.avgDistance / 1000 || 0).toFixed(1)} km`,
      duration: formatAverageDuration(summary.sedentary.avgDuration),
      count: summary.sedentary.count,
    },
    {
      key: 'moderate',
      title: '常态人群',
      distance: `${(summary.moderate.avgDistance / 1000 || 0).toFixed(1)} km`,
      duration: formatAverageDuration(summary.moderate.avgDuration),
      count: summary.moderate.count,
    },
    {
      key: 'high',
      title: '高活跃人群',
      distance: `${(summary.high.avgDistance / 1000 || 0).toFixed(1)} km`,
      duration: formatAverageDuration(summary.high.avgDuration),
      count: summary.high.count,
    },
  ];
}

function buildInsights(summary) {
  const distanceDelta = summary.high.avgDistance - summary.sedentary.avgDistance;
  const durationDelta = summary.high.avgDuration - summary.sedentary.avgDuration;
  const moderateDistance = summary.moderate.avgDistance;
  return [
    `高活跃人群的平均里程比久坐人群多 ${(distanceDelta / 1000 || 0).toFixed(1)} km`,
    `高活跃人群平均时长高出 ${(durationDelta / 60000 || 0).toFixed(0)} 分钟`,
    `常态人群建议维持 ${(moderateDistance / 1000 || 0).toFixed(1)} km 的日常步行量`,
  ];
}

function normalizeRoute(route) {
  return {
    id: route.id,
    title: route.title,
    distance: formatDistance(route.stats?.distance),
    duration: formatDuration(route.stats?.duration),
    calories: formatCalories(route.stats?.calories),
    campusLabel: route.campusMeta ? buildCampusDisplayName(route.campusMeta) : route.campusZone,
    privacyLabel: PRIVACY_LEVEL_MAP[route.privacyLevel]?.label || route.privacyLevel,
  };
}

Page(applyThemeMixin({
  data: {
    summaryCards: [],
    selectedLevel: 'high',
    levelTitle: LEVEL_META.high.title,
    levelDescription: LEVEL_META.high.description,
    levelRoutes: [],
    insights: [],
  },
  onLoad() {
    this.rawRoutes = [];
    this.unsubscribe = subscribe((routes) => this.refresh(routes));
    this.refresh(getRoutes());
  },
  onUnload() {
    if (this.unsubscribe) {
      this.unsubscribe();
    }
  },
  refresh(routes) {
    this.rawRoutes = routes || [];
    const summary = buildComparisonSummary(routes);
    const summaryCards = buildSummaryCards(summary);
    const insights = buildInsights(summary);
    this.setData({
      summaryCards,
      insights,
    });
    this.updateLevelRoutes(this.data.selectedLevel || 'high');
  },
  handleSummaryTap(event) {
    const { key } = event.currentTarget.dataset;
    this.updateLevelRoutes(key);
  },
  updateLevelRoutes(level) {
    const filtered = (this.rawRoutes || []).filter((route) => getActivityLevel(route) === level);
    const levelRoutes = filtered.map(normalizeRoute);
    const meta = LEVEL_META[level] || LEVEL_META.moderate;
    this.setData({
      selectedLevel: level,
      levelTitle: meta.title,
      levelDescription: meta.description,
      levelRoutes,
    });
  },
}));
