import { useState, useEffect } from 'react';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip as ChartTooltip,
  PieChart,
  Pie,
  Cell,
} from 'recharts';
import { fetchAdminFeedbackAnalytics } from '../../api/client';

const SATISFACTION_LABELS = {
  1: '非常不满意',
  2: '不满意',
  3: '有点不满意',
  4: '一般',
  5: '还不错',
  6: '满意',
  7: '非常满意',
};

const SATISFACTION_COLORS = {
  1: '#ef4444',
  2: '#f97316',
  3: '#eab308',
  4: '#a3a3a3',
  5: '#22c55e',
  6: '#3b82f6',
  7: '#7c3aed',
};

const PREFERENCE_LABELS = {
  shorter_distance: '距离更短',
  faster: '更快/更少等待',
  comfortable: '更舒适',
  safer: '更安全',
  familiar: '更熟悉/习惯走',
  other: '其他原因',
};

const PIE_COLORS = ['#2563eb', '#f97316', '#22c55e', '#ef4444', '#7c3aed', '#eab308'];

export default function FeedbackPanel({ rangeDays = 30 }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetchAdminFeedbackAnalytics({ rangeDays })
      .then((result) => setData(result))
      .catch((err) => console.error('fetchAdminFeedbackAnalytics failed', err))
      .finally(() => setLoading(false));
  }, [rangeDays]);

  if (loading) {
    return (
      <div className="admin-analytics">
        <div className="admin-card">
          <div className="admin-placeholder">反馈数据加载中...</div>
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="admin-analytics">
        <div className="admin-card">
          <div className="admin-placeholder">暂无反馈数据</div>
        </div>
      </div>
    );
  }

  const satisfactionData = (data.satisfaction ?? []).map((item) => ({
    score: item.score,
    label: SATISFACTION_LABELS[item.score] || `${item.score}分`,
    count: item.count,
    fill: SATISFACTION_COLORS[item.score] || '#94a3b8',
  }));

  const preferenceData = (data.preferences ?? []).map((item) => ({
    label: PREFERENCE_LABELS[item.label] || item.label,
    key: item.label,
    count: item.count,
  }));

  const summary = data.summary ?? {};

  return (
    <div className="admin-analytics">
      {/* Summary cards */}
      <div style={{ display: 'flex', gap: 16, marginBottom: 16, flexWrap: 'wrap' }}>
        <div className="admin-card" style={{ flex: 1, minWidth: 180 }}>
          <div className="admin-card-title">平均满意度</div>
          <div style={{ fontSize: 32, fontWeight: 700, color: '#2563eb' }}>
            {summary.averageScore ?? '-'} <span style={{ fontSize: 16, color: '#94a3b8' }}>/ 7</span>
          </div>
          <div style={{ fontSize: 13, color: '#64748b', marginTop: 4 }}>
            共 {summary.totalFeedback || 0} 条反馈
          </div>
        </div>
        <div className="admin-card" style={{ flex: 1, minWidth: 180 }}>
          <div className="admin-card-title">终点确认偏差</div>
          <div style={{ fontSize: 32, fontWeight: 700, color: '#f97316' }}>
            {summary.endPointConfirmation?.averageDistance ?? '-'} <span style={{ fontSize: 16, color: '#94a3b8' }}>m</span>
          </div>
          <div style={{ fontSize: 13, color: '#64748b', marginTop: 4 }}>
            共 {summary.endPointConfirmation?.totalConfirmed || 0} 次确认, 最大偏差 {summary.endPointConfirmation?.maxDistance ?? '-'}m
          </div>
        </div>
      </div>

      {/* Satisfaction distribution */}
      <div className="admin-card">
        <div className="admin-card-title">满意度评分分布</div>
        <div style={{ height: 240 }}>
          {satisfactionData.length ? (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={satisfactionData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="label" />
                <YAxis />
                <ChartTooltip />
                {satisfactionData.map((entry, index) => null)}
                <Bar dataKey="count" name="次数">
                  {satisfactionData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.fill} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="admin-placeholder">暂无满意度数据</div>
          )}
        </div>
      </div>

      {/* Preference breakdown */}
      <div className="admin-card">
        <div className="admin-card-title">路径选择偏好分布</div>
        <div style={{ height: 280, display: 'flex', alignItems: 'center', gap: 24 }}>
          {preferenceData.length ? (
            <>
              <ResponsiveContainer width="50%" height="100%">
                <PieChart>
                  <Pie
                    data={preferenceData}
                    dataKey="count"
                    nameKey="label"
                    cx="50%"
                    cy="50%"
                    outerRadius={90}
                    label={({ label, percent }) => `${label} ${(percent * 100).toFixed(0)}%`}
                  >
                    {preferenceData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={PIE_COLORS[index % PIE_COLORS.length]} />
                    ))}
                  </Pie>
                  <ChartTooltip />
                </PieChart>
              </ResponsiveContainer>
              <div style={{ flex: 1 }}>
                {preferenceData.map((item, idx) => (
                  <div key={item.key} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                    <div style={{ width: 12, height: 12, borderRadius: '50%', background: PIE_COLORS[idx % PIE_COLORS.length] }} />
                    <span style={{ fontSize: 14, color: '#334155' }}>{item.label}</span>
                    <span style={{ fontSize: 14, fontWeight: 600, marginLeft: 'auto' }}>{item.count}</span>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div className="admin-placeholder" style={{ flex: 1 }}>暂无偏好数据</div>
          )}
        </div>
      </div>
    </div>
  );
}
