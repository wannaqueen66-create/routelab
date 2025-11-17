import { useState, useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import {
  TrendingUp,
  Clock,
  Flame,
  Award,
  Activity,
  Users,
  Map as MapIcon,
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
} from 'recharts';
import {
  fetchAdminAnalyticsSummary,
  fetchAdminAnalyticsTimeseries,
  fetchDailyMetrics,
} from '../api/client';
import { formatDistance, formatDuration } from '../utils/format';

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

// Stats Card Component
function StatsCard({ icon: Icon, title, value, unit, gradient, delay = 0, loading }) {
  return (
    <motion.div
      className="stats-card"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay }}
    >
      <div className="stats-card-bg" style={{ background: gradient }} />
      <div className="stats-card-content">
        <div className="stats-icon-wrapper">
          <Icon size={24} />
        </div>
        <div className="stats-info">
          <span className="stats-title">{title}</span>
          <div className="stats-value">
            {loading ? (
              <div className="skeleton skeleton-text" style={{ width: '120px', height: '36px' }} />
            ) : (
              <>
                <AnimatedNumber value={value} duration={1500} decimals={unit === 'km' ? 1 : 0} />
                <span className="stats-unit">{unit}</span>
              </>
            )}
          </div>
        </div>
      </div>
    </motion.div>
  );
}

// Heatmap Component for active hours
function ActivityHeatmap({ data }) {
  const days = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  const hours = Array.from({ length: 24 }, (_, i) => i);

  const getColor = (value) => {
    if (!value) return 'var(--gray-200)';
    const intensity = Math.min(value / 10, 1);
    return `rgba(74, 144, 226, ${0.2 + intensity * 0.8})`;
  };

  return (
    <div className="heatmap-container">
      <div className="heatmap-grid">
        <div className="heatmap-labels">
          {days.map((day) => (
            <div key={day} className="heatmap-day-label">{day}</div>
          ))}
        </div>
        <div className="heatmap-hours">
          {hours.map((hour) => (
            <div key={hour} className="heatmap-hour-label">
              {hour % 6 === 0 ? `${hour}:00` : ''}
            </div>
          ))}
        </div>
        <div className="heatmap-cells">
          {days.map((day, dayIndex) => (
            <div key={day} className="heatmap-row">
              {hours.map((hour) => {
                const value = data?.[dayIndex]?.[hour] || 0;
                return (
                  <div
                    key={`${day}-${hour}`}
                    className="heatmap-cell"
                    style={{ backgroundColor: getColor(value) }}
                    title={`${day} ${hour}:00 - ${value} 次活动`}
                  />
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

const ACTIVITY_COLORS = ['#4A90E2', '#52C41A', '#FAAD14', '#FF4D4F'];

export default function DashboardPage({ role }) {
  const [loading, setLoading] = useState(true);
  const [summary, setSummary] = useState(null);
  const [timeseries, setTimeseries] = useState([]);
  const [activityTypes, setActivityTypes] = useState([]);
  const [error, setError] = useState('');

  const isAdmin = role === 'admin';

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

      // Process timeseries data
      if (timeseriesData?.routes_per_day) {
        const chartData = timeseriesData.routes_per_day.map((item) => ({
          date: new Date(item.date).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' }),
          routes: item.count || 0,
          distance: (item.total_distance || 0) / 1000,
        }));
        setTimeseries(chartData);
      }

      // Mock activity type distribution
      setActivityTypes([
        { name: '跑步', value: 45, icon: '🏃' },
        { name: '骑行', value: 30, icon: '🚴' },
        { name: '步行', value: 20, icon: '🚶' },
        { name: '其他', value: 5, icon: '🏋️' },
      ]);
    } catch (err) {
      console.error('Failed to load dashboard data:', err);
      setError('加载数据失败');
    } finally {
      setLoading(false);
    }
  };

  // Mock heatmap data
  const heatmapData = Array.from({ length: 7 }, () =>
    Array.from({ length: 24 }, () => Math.floor(Math.random() * 15))
  );

  const totalDistance = summary?.total_distance_meters
    ? summary.total_distance_meters / 1000
    : 0;

  const totalDuration = summary?.total_duration_seconds
    ? Math.floor(summary.total_duration_seconds / 3600)
    : 0;

  const totalCalories = totalDistance * 60; // Rough estimate

  return (
    <div className="dashboard-page">
      {error && (
        <div className="alert alert-error mb-6">
          {error}
        </div>
      )}

      {/* Stats Cards */}
      <div className="stats-grid">
        <StatsCard
          icon={TrendingUp}
          title="总里程"
          value={totalDistance}
          unit="km"
          gradient="linear-gradient(135deg, #667eea 0%, #764ba2 100%)"
          delay={0}
          loading={loading}
        />
        <StatsCard
          icon={Clock}
          title="运动时长"
          value={totalDuration}
          unit="小时"
          gradient="linear-gradient(135deg, #11998e 0%, #38ef7d 100%)"
          delay={0.1}
          loading={loading}
        />
        <StatsCard
          icon={Flame}
          title="消耗卡路里"
          value={totalCalories}
          unit="kcal"
          gradient="linear-gradient(135deg, #f093fb 0%, #f5576c 100%)"
          delay={0.2}
          loading={loading}
        />
        <StatsCard
          icon={Award}
          title="当前积分"
          value={summary?.total_routes || 0}
          unit="分"
          gradient="linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)"
          delay={0.3}
          loading={loading}
        />
      </div>

      {/* Charts Section */}
      <div className="charts-grid">
        {/* Trend Chart */}
        <motion.div
          className="chart-card"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.4 }}
        >
          <div className="chart-header">
            <h3 className="chart-title">30天运动趋势</h3>
            <Activity size={20} className="chart-icon" />
          </div>
          <div className="chart-body">
            {loading ? (
              <div className="skeleton skeleton-card" style={{ height: '300px' }} />
            ) : (
              <ResponsiveContainer width="100%" height={300}>
                <AreaChart data={timeseries}>
                  <defs>
                    <linearGradient id="colorRoutes" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#4A90E2" stopOpacity={0.8} />
                      <stop offset="95%" stopColor="#4A90E2" stopOpacity={0.1} />
                    </linearGradient>
                    <linearGradient id="colorDistance" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#52C41A" stopOpacity={0.8} />
                      <stop offset="95%" stopColor="#52C41A" stopOpacity={0.1} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--gray-200)" />
                  <XAxis
                    dataKey="date"
                    stroke="var(--gray-500)"
                    fontSize={12}
                  />
                  <YAxis stroke="var(--gray-500)" fontSize={12} />
                  <Tooltip
                    contentStyle={{
                      background: 'var(--white)',
                      border: '1px solid var(--gray-200)',
                      borderRadius: 'var(--radius-md)',
                      boxShadow: 'var(--shadow-md)',
                    }}
                  />
                  <Legend />
                  <Area
                    type="monotone"
                    dataKey="routes"
                    name="路线数"
                    stroke="#4A90E2"
                    fillOpacity={1}
                    fill="url(#colorRoutes)"
                  />
                  <Area
                    type="monotone"
                    dataKey="distance"
                    name="距离(km)"
                    stroke="#52C41A"
                    fillOpacity={1}
                    fill="url(#colorDistance)"
                  />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>
        </motion.div>

        {/* Activity Type Distribution */}
        <motion.div
          className="chart-card"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.5 }}
        >
          <div className="chart-header">
            <h3 className="chart-title">运动类型分布</h3>
            <MapIcon size={20} className="chart-icon" />
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
                    innerRadius={60}
                    outerRadius={100}
                    paddingAngle={5}
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
                    formatter={(value) => [`${value}%`, '']}
                  />
                  <Legend
                    formatter={(value, entry) => {
                      const item = activityTypes.find((t) => t.name === value);
                      return `${item?.icon || ''} ${value}`;
                    }}
                  />
                </PieChart>
              </ResponsiveContainer>
            )}
          </div>
        </motion.div>
      </div>

      {/* Heatmap Section */}
      <motion.div
        className="chart-card"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.6 }}
      >
        <div className="chart-header">
          <h3 className="chart-title">活跃时段热力图</h3>
          <Clock size={20} className="chart-icon" />
        </div>
        <div className="chart-body">
          {loading ? (
            <div className="skeleton skeleton-card" style={{ height: '200px' }} />
          ) : (
            <ActivityHeatmap data={heatmapData} />
          )}
        </div>
      </motion.div>

      {/* Admin Monitor Panel */}
      {isAdmin && (
        <motion.div
          className="admin-monitor-panel"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.7 }}
        >
          <div className="panel-header">
            <h3 className="panel-title">系统监控面板</h3>
            <span className="badge badge-admin">管理员专属</span>
          </div>
          <div className="monitor-grid">
            <div className="monitor-item">
              <Users size={24} />
              <div className="monitor-info">
                <span className="monitor-label">活跃用户</span>
                <span className="monitor-value">
                  <AnimatedNumber value={summary?.active_users || 0} />
                </span>
              </div>
            </div>
            <div className="monitor-item">
              <MapIcon size={24} />
              <div className="monitor-info">
                <span className="monitor-label">总路线数</span>
                <span className="monitor-value">
                  <AnimatedNumber value={summary?.total_routes || 0} />
                </span>
              </div>
            </div>
            <div className="monitor-item">
              <Activity size={24} />
              <div className="monitor-info">
                <span className="monitor-label">今日新增</span>
                <span className="monitor-value">
                  <AnimatedNumber value={summary?.new_routes || 0} />
                </span>
              </div>
            </div>
            <div className="monitor-item">
              <TrendingUp size={24} />
              <div className="monitor-info">
                <span className="monitor-label">数据增长</span>
                <span className="monitor-value text-success">+12.5%</span>
              </div>
            </div>
          </div>
        </motion.div>
      )}
    </div>
  );
}
