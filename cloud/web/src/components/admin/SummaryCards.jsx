export default function SummaryCards({ summary, loading }) {
  const items = [
    {
      label: '总轨迹数',
      value: summary?.totalRoutes ?? 0,
    },
    {
      label: '近期开启',
      value: summary?.newRoutes ?? 0,
      description: `${summary?.rangeDays ?? 30} 天内`,
    },
    {
      label: '活跃用户',
      value: summary?.activeUsers ?? 0,
    },
    {
      label: '累计距离',
      value: summary?.totalDistance ?? 0,
      formatter: (value) => {
        if (!Number.isFinite(value) || value <= 0) return '0 km';
        if (value >= 1000) return `${(value / 1000).toFixed(2)} km`;
        return `${value.toFixed(0)} m`;
      },
    },
    {
      label: '累计时长',
      value: summary?.totalDuration ?? 0,
      formatter: (value) => {
        if (!Number.isFinite(value) || value <= 0) return '0s';
        const seconds = Math.round(value);
        const h = Math.floor(seconds / 3600);
        const m = Math.floor((seconds % 3600) / 60);
        const s = seconds % 60;
        if (h > 0) return `${h}h ${m}m ${s}s`;
        if (m > 0) return `${m}m ${s}s`;
        return `${s}s`;
      },
    },
  ];

  return (
    <div className="admin-summary-grid">
      {items.map((item) => {
        const value = item.formatter ? item.formatter(item.value) : item.value;
        return (
          <div key={item.label} className="admin-card">
            <span className="admin-card-label">{item.label}</span>
            <strong className="admin-card-value">
              {loading ? '加载中...' : value}
            </strong>
            {item.description ? (
              <span className="admin-card-description">{item.description}</span>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
