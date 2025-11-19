import { useState, useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import {
  Users,
  UserCheck,
  Map as MapIcon,
  TrendingUp,
  Activity,
  Database,
  BarChart3,
  Globe,
  Zap,
} from 'lucide-react';
import {
  AreaChart,
  Area,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts';
import {
  fetchAdminAnalyticsSummary,
  fetchAdminAnalyticsTimeseries,
  fetchAdminPurposeDistribution,
  fetchAdminQualityMetrics,
} from '../api/client';

// Animated number counter
function AnimatedNumber({ value, duration = 1000, decimals = 0, prefix = '', suffix = '' }) {
  const [displayValue, setDisplayValue] = useState(0);
  const startTime = useRef(null);
  const animationRef = useRef(null);

  useEffect(() => {
    const animate = (timestamp) => {
      if (!startTime.current) startTime.current = timestamp;
      const progress = Math.min((timestamp - startTime.current) / duration, 1);
      const easeOutQuart = 1 - Math.pow(1 - progress, 4);
      const current = easeOutQuart * (Number(value) || 0);
      setDisplayValue(current);
      if (progress < 1) {
        animationRef.current = requestAnimationFrame(animate);
      }
    };
    startTime.current = null;
    animationRef.current = requestAnimationFrame(animate);
    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [value, duration]);

  const normalized = Number(displayValue) || 0;
  const formatted =
    decimals > 0 ? normalized.toFixed(decimals) : Math.round(normalized).toLocaleString();

  return (
    <span>
      {prefix}
      {formatted}
      {suffix}
    </span>
  );
}

// Platform Stats Card
function PlatformStatsCard({ icon: Icon, title, value, subtitle, gradient, loading, trend }) {
  const showTrend = typeof trend === 'number' && Number.isFinite(trend) && trend !== 0;
  return (
    <motion.div
      className="platform-stats-card"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
    >
      <div className="platform-stats-card-bg" style={{ background: gradient }} />
      <div className="platform-stats-card-content">
        <div className="platform-stats-header">
          <div className="platform-stats-icon-wrapper">
            <Icon size={24} />
          </div>
          {showTrend ? (
            <div className={`platform-stats-trend ${trend > 0 ? 'positive' : 'negative'}`}>
              <TrendingUp size={14} />
              <span>
                {trend > 0 ? '+' : ''}
                {trend.toFixed(1)}%
              </span>
            </div>
          ) : null}
        </div>
        <div className="platform-stats-info">
          <span className="platform-stats-title">{title}</span>
          <div className="platform-stats-value">
            {loading ? (
              <div className="skeleton skeleton-text" style={{ width: '120px', height: '36px' }} />
            ) : (
              <AnimatedNumber
                value={Number(value) || 0}
                duration={1200}
                decimals={typeof value === 'number' && value % 1 !== 0 ? 1 : 0}
              />
            )}
          </div>
          {subtitle ? <span className="platform-stats-subtitle">{subtitle}</span> : null}
        </div>
      </div>
    </motion.div>
  );
}

// Real-time Monitor
function RealtimeMonitor({ data, loading }) {
  return (
    <motion.div
      className="realtime-monitor"
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.4, delay: 0.2 }}
    >
      <div className="realtime-header">
        <div className="realtime-title">
          <Zap size={20} className="realtime-icon" />
          <span>实时平台监控</span>
        </div>
        <div className="realtime-status">
          <span className="status-dot" />
          <span>运行中</span>
        </div>
      </div>
      <div className="realtime-grid">
        <div className="realtime-item">
          <div className="realtime-label">今日新增轨迹</div>
          <div className="realtime-value">
            {loading ? '--' : <AnimatedNumber value={data?.todayRoutes || 0} />}
          </div>
        </div>
        <div className="realtime-item">
          <div className="realtime-label">今日活跃用户</div>
          <div className="realtime-value">
            {loading ? '--' : <AnimatedNumber value={data?.todayActiveUsers || 0} />}
          </div>
        </div>
        <div className="realtime-item">
          <div className="realtime-label">本周上传量</div>
          <div className="realtime-value">
            {loading ? '--' : <AnimatedNumber value={data?.weeklyUploads || 0} />}
          </div>
        </div>
        <div className="realtime-item">
          <div className="realtime-label">系统负载</div>
          <div className="realtime-value text-success">正常</div>
        </div>
      </div>
    </motion.div>
  );
}

const ACTIVITY_COLORS = ['#4A90E2', '#52C41A', '#FAAD14', '#FF4D4F', '#722ED1'];

export default function DashboardPage() {
  const [loading, setLoading] = useState(true);
  const [summary, setSummary] = useState(null);
  const [timeseries, setTimeseries] = useState([]);
  const [activityTypes, setActivityTypes] = useState([]);
  const [quality, setQuality] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadData = async () => {
    try {
      setLoading(true);
      setError('');

      const [summaryData, timeseriesData, purposeData, qualityData] = await Promise.all([
        fetchAdminAnalyticsSummary({ rangeDays: 30 }),
        fetchAdminAnalyticsTimeseries({ rangeDays: 30 }),
        fetchAdminPurposeDistribution({ rangeDays: 30 }),
        fetchAdminQualityMetrics(),
      ]);

      setSummary(summaryData || null);
      setQuality(qualityData || null);

      // Normalize timeseries
      let series = [];
      if (Array.isArray(timeseriesData?.series)) {
        series = timeseriesData.series;
      } else if (Array.isArray(timeseriesData?.routes_per_day)) {
        series = timeseriesData.routes_per_day.map((item) => ({
          date: item.date,
          routes: item.count,
          activeUsers: item.active_users,
          totalDistance: item.total_distance,
          totalDuration: item.total_duration,
        }));
      }
      const chartData = series.map((item) => {
        const dateValue = item.date instanceof Date ? item.date : new Date(Number(item.date));
        const label = Number.isNaN(dateValue.getTime())
          ? ''
          : dateValue.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
        return {
          date: label,
          uploads: Number(item.routes || 0),
          activeUsers: Number(item.activeUsers || 0),
          distance: Number(item.totalDistance || 0) / 1000,
        };
      });
      setTimeseries(chartData);

      // Purpose / activity distribution
      if (Array.isArray(purposeData?.buckets)) {
        const types = purposeData.buckets.map((bucket) => ({
          name: bucket.label || bucket.key || '未设置',
          value: Number(bucket.percentage ?? 0),
        }));
        setActivityTypes(types);
      } else {
        setActivityTypes([]);
      }
    } catch (err) {
      console.error('Failed to load dashboard data:', err);
      setError('加载数据失败，请刷新重试');
    } finally {
      setLoading(false);
    }
  };

  // ---- Derived metrics ----
  const totalUsers =
    (summary && (summary.totalUsers ?? summary.total_users)) != null
      ? summary.totalUsers ?? summary.total_users
      : 0;
  const totalRoutes =
    (summary && (summary.totalRoutes ?? summary.total_routes)) != null
      ? summary.totalRoutes ?? summary.total_routes
      : 0;
  const totalDistanceMeters =
    (summary && (summary.totalDistance ?? summary.total_distance_meters)) != null
      ? summary.totalDistance ?? summary.total_distance_meters
      : 0;
  const totalDistanceKm = totalDistanceMeters ? (totalDistanceMeters / 1000).toFixed(0) : '0';

  const lastPoint = timeseries.length ? timeseries[timeseries.length - 1] : null;
  const todayRoutes = lastPoint?.uploads || 0;
  const todayActiveUsers = lastPoint?.activeUsers || 0;

  const dauRate =
    totalUsers > 0 && todayActiveUsers >= 0
      ? ((todayActiveUsers / totalUsers) * 100).toFixed(1)
      : '0.0';

  const weeklyUploads = timeseries
    .slice(-7)
    .reduce((sum, item) => sum + (item.uploads || 0), 0);

  const realtimeData = {
    todayRoutes,
    todayActiveUsers,
    weeklyUploads,
  };

  // Quality overview metrics
  const averageDistanceMeters =
    (summary && (summary.averageDistance ?? summary.avg_distance_meters)) != null
      ? summary.averageDistance ?? summary.avg_distance_meters
      : null;
  const averageDistanceKm = averageDistanceMeters
    ? (averageDistanceMeters / 1000).toFixed(1)
    : null;

  const totalPoints = quality?.totalPoints || 0;
  const avgPointsPerRoute =
    totalRoutes > 0 && totalPoints > 0 ? Math.round(totalPoints / totalRoutes) : null;

  const backgroundRatio = quality?.backgroundRatio || 0;
  const weakSignalRatio = quality?.weakSignalRatio || 0;
  const interpRatio = quality?.interpRatio || 0;
  const completenessRatio = Math.max(
    0,
    1 - (backgroundRatio + weakSignalRatio + interpRatio)
  );

  let gpsQualityLabel = '';
  if (weakSignalRatio <= 0.05) {
    gpsQualityLabel = '优秀';
  } else if (weakSignalRatio <= 0.15) {
    gpsQualityLabel = '良好';
  } else if (weakSignalRatio > 0) {
    gpsQualityLabel = '一般';
  }

  return (
    <div className="admin-dashboard-page">
      <div className="dashboard-header">
        <div className="dashboard-title-section">
          <h1 className="dashboard-main-title">
            <Globe size={28} />
            平台数据概览
          </h1>
          <p className="dashboard-subtitle">RouteLab 运营管理中心</p>
        </div>
        <div className="dashboard-actions">
          <button className="btn btn-outline btn-sm" onClick={loadData} disabled={loading}>
            <Activity size={16} />
            刷新数据
          </button>
        </div>
      </div>

      {error ? <div className="alert alert-error mb-6">{error}</div> : null}

      {/* Platform Core Metrics */}
      <div className="platform-stats-grid">
        <PlatformStatsCard
          icon={Users}
          title="平台总用户数"
          value={totalUsers}
          subtitle="累计注册用户"
          gradient="linear-gradient(135deg, #667eea 0%, #764ba2 100%)"
          loading={loading}
        />
        <PlatformStatsCard
          icon={UserCheck}
          title="日活跃用户 (DAU)"
          value={todayActiveUsers}
          subtitle={`活跃率 ${dauRate}%`}
          gradient="linear-gradient(135deg, #11998e 0%, #38ef7d 100%)"
          loading={loading}
        />
        <PlatformStatsCard
          icon={MapIcon}
          title="平台总轨迹数"
          value={totalRoutes}
          subtitle="累计上传轨迹"
          gradient="linear-gradient(135deg, #f093fb 0%, #f5576c 100%)"
          loading={loading}
        />
        <PlatformStatsCard
          icon={Database}
          title="累计总里程"
          value={Number(totalDistanceKm)}
          subtitle="公里"
          gradient="linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)"
          loading={loading}
        />
      </div>

      {/* Real-time Monitor */}
      <RealtimeMonitor data={realtimeData} loading={loading} />

      {/* Charts Section */}
      <div className="charts-grid">
        {/* Activity trend */}
        <motion.div
          className="chart-card chart-card-wide"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.3 }}
        >
          <div className="chart-header">
            <h3 className="chart-title">30 天平台活跃度趋势</h3>
            <div className="chart-legend-custom">
              <span className="legend-item">
                <span className="legend-dot" style={{ background: '#4A90E2' }} />
                轨迹上传量
              </span>
              <span className="legend-item">
                <span className="legend-dot" style={{ background: '#52C41A' }} />
                活跃用户数
              </span>
            </div>
          </div>
          <div className="chart-body">
            {loading ? (
              <div className="skeleton skeleton-card" style={{ height: '320px' }} />
            ) : (
              <ResponsiveContainer width="100%" height={320}>
                <AreaChart data={timeseries}>
                  <defs>
                    <linearGradient id="colorUploads" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#4A90E2" stopOpacity={0.8} />
                      <stop offset="95%" stopColor="#4A90E2" stopOpacity={0.1} />
                    </linearGradient>
                    <linearGradient id="colorActiveUsers" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#52C41A" stopOpacity={0.8} />
                      <stop offset="95%" stopColor="#52C41A" stopOpacity={0.1} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--gray-200)" />
                  <XAxis
                    dataKey="date"
                    stroke="var(--gray-500)"
                    fontSize={12}
                    tickLine={false}
                  />
                  <YAxis stroke="var(--gray-500)" fontSize={12} tickLine={false} />
                  <Tooltip
                    contentStyle={{
                      background: 'var(--white)',
                      border: '1px solid var(--gray-200)',
                      borderRadius: 'var(--radius-md)',
                      boxShadow: 'var(--shadow-md)',
                    }}
                  />
                  <Area
                    type="monotone"
                    dataKey="uploads"
                    name="轨迹上传量"
                    stroke="#4A90E2"
                    strokeWidth={2}
                    fillOpacity={1}
                    fill="url(#colorUploads)"
                  />
                  <Area
                    type="monotone"
                    dataKey="activeUsers"
                    name="活跃用户数"
                    stroke="#52C41A"
                    strokeWidth={2}
                    fillOpacity={1}
                    fill="url(#colorActiveUsers)"
                  />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>
        </motion.div>

        {/* Purpose distribution */}
        <motion.div
          className="chart-card"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.4 }}
        >
          <div className="chart-header">
            <h3 className="chart-title">全平台出行目的分布</h3>
            <BarChart3 size={20} className="chart-icon" />
          </div>
          <div className="chart-body">
            {loading ? (
              <div className="skeleton skeleton-card" style={{ height: '300px' }} />
            ) : (
              <ResponsiveContainer width="100%" height={300}>
                <PieChart>
                  <Pie
                    data={activityTypes}
                    cx="50%"
                    cy="50%"
                    innerRadius={70}
                    outerRadius={110}
                    paddingAngle={3}
                    dataKey="value"
                  >
                    {activityTypes.map((entry, index) => (
                      <Cell
                        key={entry.name}
                        fill={ACTIVITY_COLORS[index % ACTIVITY_COLORS.length]}
                      />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{
                      background: 'var(--white)',
                      border: '1px solid var(--gray-200)',
                      borderRadius: 'var(--radius-md)',
                    }}
                    formatter={(value) => [`${value}%`, '占比']}
                  />
                  <Legend
                    verticalAlign="bottom"
                    height={36}
                    formatter={(value) => <span className="legend-label">{value}</span>}
                  />
                </PieChart>
              </ResponsiveContainer>
            )}
          </div>
        </motion.div>
      </div>

      {/* Data Quality Overview */}
      <motion.div
        className="quality-overview-card"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, delay: 0.5 }}
      >
        <div className="quality-header">
          <h3 className="quality-title">
            <Database size={20} />
            数据质量概览
          </h3>
        </div>
        <div className="quality-metrics-grid">
          <div className="quality-metric">
            <div className="quality-metric-label">平均轨迹长度</div>
            <div className="quality-metric-value">
              {loading
                ? '--'
                : averageDistanceKm != null
                ? `${averageDistanceKm} km`
                : '暂无数据'}
            </div>
          </div>
          <div className="quality-metric">
            <div className="quality-metric-label">平均采样点数</div>
            <div className="quality-metric-value">
              {loading ? (
                '--'
              ) : avgPointsPerRoute != null ? (
                <AnimatedNumber value={avgPointsPerRoute} />
              ) : (
                '暂无数据'
              )}
            </div>
          </div>
          <div className="quality-metric">
            <div className="quality-metric-label">数据完整度</div>
            <div className="quality-metric-value text-success">
              {loading ? '--' : `${(completenessRatio * 100).toFixed(1)}%`}
            </div>
          </div>
          <div className="quality-metric">
            <div className="quality-metric-label">GPS 信号质量</div>
            <div className="quality-metric-value text-success">
              {loading ? '--' : gpsQualityLabel || '暂无数据'}
            </div>
          </div>
        </div>
      </motion.div>
    </div>
  );
}

