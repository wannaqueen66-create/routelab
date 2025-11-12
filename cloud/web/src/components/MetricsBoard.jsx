import React from 'react';

// format meters to km with adaptive decimal digits
function formatDistance(meters = 0) {
  const value = Number(meters);
  if (!Number.isFinite(value) || value <= 0) return '0 km';
  const km = value / 1000;
  const digits = km >= 100 ? 0 : 2;
  return `${km.toFixed(digits)} km`;
}

// format seconds (or milliseconds) to h/m/s string
function formatDuration(raw = 0) {
  const v = Number(raw);
  if (!Number.isFinite(v) || v <= 0) return '0s';
  const seconds = v > 36 * 3600 ? Math.round(v / 1000) : Math.round(v);

  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;

  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function formatDate(ts) {
  if (!ts) return '-';
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return '-';
  return d.toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' });
}

export default function MetricsBoard({ summary = {}, metrics = [], loading = false }) {
  const totalRoutes = Number(summary.routes || 0);
  const totalDistance = formatDistance(summary.totalDistance || summary.totalDistance_m || 0);
  const totalDuration = formatDuration(summary.totalDuration || summary.totalDuration_s || 0);
  const totalCalories = Math.max(0, Math.round(Number(summary.totalCalories || 0)));

  return (
    <div className="metrics">
      <div className="metrics-grid">
        <div className="metric-item">
          <span>累计轨迹</span>
          <strong>{totalRoutes}</strong>
        </div>
        <div className="metric-item">
          <span>累计里程</span>
          <strong>{totalDistance}</strong>
        </div>
        <div className="metric-item">
          <span>总耗时</span>
          <strong>{totalDuration}</strong>
        </div>
        <div className="metric-item">
          <span>累计能量</span>
          <strong>{totalCalories} kcal</strong>
        </div>
      </div>

      <h3 style={{ marginTop: 16, fontSize: 15, color: '#475569' }}>最近日度统计</h3>
      <div className="metrics-list">
        {loading && <div>加载中...</div>}
        {!loading && (!metrics || metrics.length === 0) && <div>暂无每日统计</div>}
        {!loading &&
          metrics.map((item, idx) => {
            const dateText = formatDate(item.date || item.day || item.ts);
            const distText = formatDistance(item.totalDistance || item.distance_m || 0);
            const routesCnt = Number(item.routes || item.count || 0);

            return (
              <div
                key={item.date || item.day || idx}
                className="metric-item"
                style={{ display: 'flex', justifyContent: 'space-between' }}
              >
                <div>
                  <span>{dateText}</span>
                  <strong style={{ marginLeft: 8 }}>{distText}</strong>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <span>轨迹数</span>
                  <strong style={{ marginLeft: 8 }}>{routesCnt}</strong>
                </div>
              </div>
            );
          })}
      </div>
    </div>
  );
}
