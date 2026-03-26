import { useCallback, useEffect, useMemo, useState } from 'react';
import MapView from '../components/MapView';
import MetricsBoard from '../components/MetricsBoard';
import { fetchRoutes, fetchDailyMetrics } from '../api/client';

const INITIAL_STATE = {
  routes: [],
  metrics: [],
};

export default function Dashboard() {
  const [data, setData] = useState(INITIAL_STATE);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const loadData = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [routes, metrics] = await Promise.all([
        fetchRoutes({}),
        fetchDailyMetrics({ limit: 14 }),
      ]);
      setData({ routes, metrics });
    } catch (err) {
      setError(err?.response?.data?.error || err?.message || '加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const summary = useMemo(() => {
    const totalDistance = data.routes.reduce(
      (acc, route) => acc + (route.stats?.distance || 0),
      0
    );
    const totalDuration = data.routes.reduce(
      (acc, route) => acc + (route.stats?.duration || 0),
      0
    );
    const totalCalories = data.routes.reduce(
      (acc, route) => acc + (route.stats?.calories || 0),
      0
    );
    return {
      routes: data.routes.length,
      totalDistance,
      totalDuration,
      totalCalories,
    };
  }, [data.routes]);

  return (
    <main className="user-dashboard-layout">
      <section className="user-dashboard-map-card">
        <div className="user-dashboard-refresh-actions">
          <div>
            <h2>已采集轨迹</h2>
            <div className="user-dashboard-route-count">共 {summary.routes} 条</div>
          </div>
          <button type="button" onClick={loadData} disabled={loading}>
            {loading ? '刷新中...' : '刷新'}
          </button>
        </div>
        {error && <div className="user-dashboard-error-banner">{error}</div>}
        <div className="dashboard-map-shell">
          <MapView routes={data.routes} loading={loading} />
        </div>
      </section>
      <section className="user-dashboard-metrics-card">
        <h2>日常数据统计</h2>
        <MetricsBoard metrics={data.metrics} summary={summary} loading={loading} />
      </section>
    </main>
  );
}
