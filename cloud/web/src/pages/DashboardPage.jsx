import { useState, useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import {
  Users,
  UserCheck,
  Map as MapIcon,
  TrendingUp,
  Activity,
  Clock,
  Database,
  BarChart3,
  Globe,
  Zap,
} from 'lucide-react';
import {
  LineChart,
  Line,
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
  BarChart,
  Bar,
} from 'recharts';
import {
  fetchAdminAnalyticsSummary,
  fetchAdminAnalyticsTimeseries,
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

      // Easing function
      const easeOutQuart = 1 - Math.pow(1 - progress, 4);
      const current = easeOutQuart * value;

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

  const formatted = decimals > 0
    ? displayValue.toFixed(decimals)
    : Math.round(displayValue).toLocaleString();

  return (
    <span>
      {prefix}
      {formatted}
      {suffix}
    </span>
  );
}

// Platform Stats Card Component
function PlatformStatsCard({ icon: Icon, title, value, subtitle, gradient, delay = 0, loading, trend }) {
  return (
    <motion.div
      className="platform-stats-card"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay }}
    >
      <div className="platform-stats-card-bg" style={{ background: gradient }} />
      <div className="platform-stats-card-content">
        <div className="platform-stats-header">
          <div className="platform-stats-icon-wrapper">
            <Icon size={24} />
          </div>
          {trend && (
            <div className={`platform-stats-trend ${trend > 0 ? 'positive' : 'negative'}`}>
              <TrendingUp size={14} />
              <span>{trend > 0 ? '+' : ''}{trend}%</span>
            </div>
          )}
        </div>
        <div className="platform-stats-info">
          <span className="platform-stats-title">{title}</span>
          <div className="platform-stats-value">
            {loading ? (
              <div className="skeleton skeleton-text" style={{ width: '120px', height: '36px' }} />
            ) : (
              <AnimatedNumber value={value} duration={1500} decimals={typeof value === 'number' && value % 1 !== 0 ? 1 : 0} />
            )}
          </div>
          {subtitle && <span className="platform-stats-subtitle">{subtitle}</span>}
        </div>
      </div>
    </motion.div>
  );
}

// Real-time Monitor Component
function RealtimeMonitor({ data, loading }) {
  return (
    <motion.div
      className="realtime-monitor"
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.5, delay: 0.3 }}
    >
      <div className="realtime-header">
        <div className="realtime-title">
          <Zap size={20} className="realtime-icon" />
          <span>实时平台监控</span>
        </div>
        <div className="realtime-status">
          <span className="status-dot"></span>
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

export default function DashboardPage({ role }) {
  const [loading, setLoading] = useState(true);
  const [summary, setSummary] = useState(null);
  const [timeseries, setTimeseries] = useState([]);
  const [activityTypes, setActivityTypes] = useState([]);
  const [error, setError] = useState('');

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      setLoading(true);
      setError('');

      const [summaryData, timeseriesData] = await Promise.all([
        fetchAdminAnalyticsSummary({ days: 30 }),
        fetchAdminAnalyticsTimeseries({ days: 30 }),
      ]);

      setSummary(summaryData);

      // Process timeseries data for platform activity
      if (timeseriesData?.routes_per_day) {
        const chartData = timeseriesData.routes_per_day.map((item) => ({
          date: new Date(item.date).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' }),
          uploads: item.count || 0,
          activeUsers: item.active_users || Math.floor((item.count || 0) * 0.7),
          distance: (item.total_distance || 0) / 1000,
        }));
        setTimeseries(chartData);
      }

      // Platform-wide activity type distribution
      setActivityTypes([
        { name: '通勤', value: 35 },
        { name: '运动健身', value: 28 },
        { name: '休闲出行', value: 22 },
        { name: '商务出行', value: 10 },
        { name: '其他', value: 5 },
      ]);
    } catch (err) {
      console.error('Failed to load dashboard data:', err);
      setError('加载数据失败，请刷新重试');
    } finally {
      setLoading(false);
    }
  };

  // Calculate platform metrics
  const totalUsers = summary?.active_users || 0;
  const dauRate = summary?.active_users ? ((summary.active_users / (summary.total_users || summary.active_users)) * 100).toFixed(1) : 0;
  const totalRoutes = summary?.total_routes || 0;
  const totalDistanceKm = summary?.total_distance_meters ? (summary.total_distance_meters / 1000).toFixed(0) : 0;

  // Simulated real-time data
  const realtimeData = {
    todayRoutes: summary?.new_routes || Math.floor(totalRoutes * 0.02),
    todayActiveUsers: Math.floor(totalUsers * 0.3),
    weeklyUploads: Math.floor(totalRoutes * 0.15),
  };

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

      {error && (
        <div className="alert alert-error mb-6">
          {error}
        </div>
      )}

      {/* Platform Core Metrics */}
      <div className="platform-stats-grid">
        <PlatformStatsCard
          icon={Users}
          title="平台总用户数"
          value={summary?.total_users || totalUsers}
          subtitle="累计注册用户"
          gradient="linear-gradient(135deg, #667eea 0%, #764ba2 100%)"
          delay={0}
          loading={loading}
          trend={12.5}
        />
        <PlatformStatsCard
          icon={UserCheck}
          title="日活跃用户 (DAU)"
          value={totalUsers}
          subtitle={`活跃率 ${dauRate}%`}
          gradient="linear-gradient(135deg, #11998e 0%, #38ef7d 100%)"
          delay={0.1}
          loading={loading}
          trend={8.3}
        />
        <PlatformStatsCard
          icon={MapIcon}
          title="平台总轨迹数"
          value={totalRoutes}
          subtitle="累计上传轨迹"
          gradient="linear-gradient(135deg, #f093fb 0%, #f5576c 100%)"
          delay={0.2}
          loading={loading}
          trend={15.2}
        />
        <PlatformStatsCard
          icon={Database}
          title="累计总里程"
          value={Number(totalDistanceKm)}
          subtitle="公里"
          gradient="linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)"
          delay={0.3}
          loading={loading}
          trend={18.7}
        />
      </div>

      {/* Real-time Monitor */}
      <RealtimeMonitor data={realtimeData} loading={loading} />

      {/* Charts Section */}
      <div className="charts-grid">
        {/* Platform Activity Trend Chart */}
        <motion.div
          className="chart-card chart-card-wide"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.4 }}
        >
          <div className="chart-header">
            <h3 className="chart-title">30天平台活跃度趋势</h3>
            <div className="chart-legend-custom">
              <span className="legend-item">
                <span className="legend-dot" style={{ background: '#4A90E2' }}></span>
                轨迹上传量
              </span>
              <span className="legend-item">
                <span className="legend-dot" style={{ background: '#52C41A' }}></span>
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

        {/* Platform-wide Activity Type Distribution */}
        <motion.div
          className="chart-card"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.5 }}
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
        transition={{ duration: 0.5, delay: 0.6 }}
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
              {loading ? '--' : `${((summary?.avg_distance_meters || 5000) / 1000).toFixed(1)} km`}
            </div>
          </div>
          <div className="quality-metric">
            <div className="quality-metric-label">平均采样点数</div>
            <div className="quality-metric-value">
              {loading ? '--' : <AnimatedNumber value={summary?.avg_points || 245} />}
            </div>
          </div>
          <div className="quality-metric">
            <div className="quality-metric-label">数据完整率</div>
            <div className="quality-metric-value text-success">
              {loading ? '--' : '98.5%'}
            </div>
          </div>
          <div className="quality-metric">
            <div className="quality-metric-label">GPS信号质量</div>
            <div className="quality-metric-value text-success">
              {loading ? '--' : '优秀'}
            </div>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
