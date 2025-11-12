import {
  ResponsiveContainer,
  LineChart,
  Line,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip as ChartTooltip,
  BarChart,
  Bar,
} from 'recharts';

function formatDate(value) {
  if (!value) return '-';
  try {
    return new Date(value).toLocaleDateString();
  } catch (error) {
    return '-';
  }
}

function formatDateTime(value) {
  if (!value) return '-';
  try {
    return new Date(value).toLocaleString();
  } catch (error) {
    return '-';
  }
}

export default function AnalyticsPanels({ timeseries, distribution, loading }) {
  const timeseriesData = timeseries?.series || [];
  const distributionData = distribution?.buckets || [];

  return (
    <div className="admin-analytics">
      <div className="admin-card">
        <div className="admin-card-title">路线采集趋势</div>
        <div style={{ height: 240 }}>
          {loading ? (
            <div className="admin-placeholder">数据加载中...</div>
          ) : timeseriesData.length ? (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={timeseriesData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="date" tickFormatter={formatDate} />
                <YAxis />
                <ChartTooltip labelFormatter={formatDateTime} />
                <Line type="monotone" dataKey="routes" stroke="#0ea5e9" name="轨迹数" />
                <Line type="monotone" dataKey="activeUsers" stroke="#6366f1" name="活跃用户" />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <div className="admin-placeholder">暂无统计数据</div>
          )}
        </div>
      </div>
      <div className="admin-card">
        <div className="admin-card-title">采样间隔分布</div>
        <div style={{ height: 240 }}>
          {loading ? (
            <div className="admin-placeholder">数据加载中...</div>
          ) : distributionData.length ? (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={distributionData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="bucket" />
                <YAxis />
                <ChartTooltip />
                <Bar dataKey="samples" fill="#10b981" name="样本数" />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="admin-placeholder">暂无区间数据</div>
          )}
        </div>
      </div>
    </div>
  );
}
