import { useEffect, useMemo, useState } from 'react';
import { formatDateTime, formatDistance, formatDuration } from '../../utils/format.js';

function extractPausePoints(route) {
  const raw =
    route?.pausePoints || route?.meta?.pausePoints || route?.meta?.pause_points || [];
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw
    .map((item) => ({
      latitude: Number(item.latitude),
      longitude: Number(item.longitude),
      timestamp:
        typeof item.timestamp === 'number' && Number.isFinite(item.timestamp)
          ? Number(item.timestamp)
          : null,
      reason: item.reason || item.pauseReason || null,
    }))
    .filter(
      (item) =>
        Number.isFinite(item.latitude) &&
        Number.isFinite(item.longitude) &&
        item.timestamp !== null
    );
}

function buildPauseResolver(route) {
  if (!route) {
    return () => null;
  }
  const pauses = extractPausePoints(route);
  if (!pauses.length) {
    return () => null;
  }
  return (point) => {
    if (!point?.timestamp) {
      return null;
    }
    let closest = null;
    let smallestGap = Infinity;
    pauses.forEach((pause) => {
      const diff = Math.abs(pause.timestamp - point.timestamp);
      if (diff <= 15000 && diff < smallestGap) {
        smallestGap = diff;
        closest = pause;
      }
    });
    return closest?.reason || null;
  };
}

function enhancePoints(route) {
  const rawPoints = Array.isArray(route?.points) ? route.points : [];
  const resolvePause = buildPauseResolver(route);
  return rawPoints.map((point) => {
    const source = point.source || 'gps';
    const sourceDetail = point.source_detail || point.sourceDetail || null;
    return {
      ...point,
      source,
      sourceDetail,
      interpMethod: point.interp_method || point.interpMethod || null,
      pauseReason: resolvePause(point),
    };
  });
}

function computePointStats(points) {
  const stats = {
    total: points.length,
    sources: {},
    details: {},
  };
  points.forEach((point) => {
    stats.sources[point.source] = (stats.sources[point.source] || 0) + 1;
    const detailKey = point.sourceDetail || 'none';
    stats.details[detailKey] = (stats.details[detailKey] || 0) + 1;
  });
  return stats;
}

function formatPercent(count, total) {
  if (total <= 0) {
    return '0.0%';
  }
  return `${((count / total) * 100).toFixed(1)}%`;
}

const SOURCE_LABELS = {
  gps: 'GPS',
  interp: '推测',
};

const SOURCE_DETAIL_LABELS = {
  none: '未标记',
  background: '后台',
  screen_off: '息屏',
  weak_signal: '弱信号',
  foreground: '前景',
};

const PRIVACY_LABELS = {
  private: '私密',
  public: '公开',
  friends: '好友',
};

const translateSource = (value) => SOURCE_LABELS[value] || value;
const translateSourceDetail = (value) => SOURCE_DETAIL_LABELS[value] || value || '未标记';

export default function RouteDetailPanel({
  route,
  onClose,
  onDelete,
  onRestore,
  onRefresh,
  onUpdate,
  onExport,
  exporting,
}) {
  const [note, setNote] = useState(route?.note || '');
  const [privacy, setPrivacy] = useState(route?.privacyLevel || 'private');
  const [sourceFilter, setSourceFilter] = useState('all');
  const [sourceDetailFilter, setSourceDetailFilter] = useState('all');

  useEffect(() => {
    setNote(route?.note || '');
    setPrivacy(route?.privacyLevel || 'private');
    setSourceFilter('all');
    setSourceDetailFilter('all');
  }, [route]);

  if (!route) {
    return (
      <div className="admin-detail-panel">
        <div className="admin-detail-header">
          <strong>轨迹详情</strong>
          <button type="button" onClick={onClose}>
            关闭
          </button>
        </div>
        <div className="admin-placeholder">请选择轨迹查看详情</div>
      </div>
    );
  }

  const points = useMemo(() => enhancePoints(route), [route]);
  const pointStats = useMemo(() => computePointStats(points), [points]);

  const sourceDetailOptions = useMemo(() => {
    const set = new Set();
    points.forEach((point) => {
      if (point.sourceDetail) {
        set.add(point.sourceDetail);
      } else {
        set.add('none');
      }
    });
    return Array.from(set).sort();
  }, [points]);

  const filteredPoints = useMemo(() => {
    return points.filter((point) => {
      if (sourceFilter !== 'all' && point.source !== sourceFilter) {
        return false;
      }
      if (sourceDetailFilter === 'none') {
        return !point.sourceDetail;
      }
      if (sourceDetailFilter !== 'all' && sourceDetailFilter !== 'none') {
        return point.sourceDetail === sourceDetailFilter;
      }
      return true;
    });
  }, [points, sourceFilter, sourceDetailFilter]);

  const displayPoints = filteredPoints.slice(0, 200);

  const renderSourceStat = (label, value) => {
    const count = pointStats.sources[value] || 0;
    return (
      <span key={value}>
        {label}: {count} ({formatPercent(count, pointStats.total)})
      </span>
    );
  };

  const renderDetailStat = (value) => {
    const count = pointStats.details[value] || 0;
    const label = translateSourceDetail(value);
    return (
      <span key={value}>
        {label}: {count} ({formatPercent(count, pointStats.total)})
      </span>
    );
  };

  const statusText = route.deletedAt ? '已删除' : '有效';
  const ownerText = route.owner?.displayName || route.ownerId || '未知';

  return (
    <div className="admin-detail-panel">
      <div className="admin-detail-header">
        <strong>{route.title || route.id}</strong>
        <button type="button" onClick={onClose}>
          关闭
        </button>
      </div>

      <div className="admin-detail-section">
        <div className="admin-detail-grid">
          <div>
            <span>开始时间</span>
            <strong>{formatDateTime(route.startTime)}</strong>
          </div>
          <div>
            <span>结束时间</span>
            <strong>{formatDateTime(route.endTime)}</strong>
          </div>
          <div>
            <span>里程</span>
            <strong>{formatDistance(route.statSummary?.distance ?? route.stats?.distance)}</strong>
          </div>
          <div>
            <span>耗时</span>
            <strong>{formatDuration(route.statSummary?.duration ?? route.stats?.duration)}</strong>
          </div>
          <div>
            <span>卡路里</span>
            <strong>{Math.round(route.statSummary?.calories ?? route.stats?.calories ?? 0)} kcal</strong>
          </div>
          <div>
            <span>采样点数</span>
            <strong>{route.pointCount ?? points.length}</strong>
          </div>
          <div>
            <span>所属用户</span>
            <strong>{ownerText}</strong>
          </div>
          <div>
            <span>状态</span>
            <strong>{statusText}</strong>
          </div>
        </div>
      </div>

      {route.feedbackSatisfactionScore != null ? (
        <div className="admin-detail-section">
          <div className="admin-detail-subtitle">路线反馈</div>
          <div className="admin-detail-grid">
            <div>
              <span>满意度评分</span>
              <strong>{route.feedbackSatisfactionScore} / 7</strong>
            </div>
            <div>
              <span>路径偏好</span>
              <strong>{(route.feedbackPreferenceLabels ?? []).join(', ') || '-'}</strong>
            </div>
            {route.feedbackReasonText ? (
              <div style={{ gridColumn: '1 / -1' }}>
                <span>其他原因</span>
                <strong>{route.feedbackReasonText}</strong>
              </div>
            ) : null}
            {route.confirmedEndLatitude != null && route.confirmedEndLongitude != null ? (
              <>
                <div>
                  <span>确认终点</span>
                  <strong>{route.confirmedEndLatitude.toFixed(5)}, {route.confirmedEndLongitude.toFixed(5)}</strong>
                </div>
                <div>
                  <span>GPS终点偏差</span>
                  <strong>{route.confirmedEndDistanceMeters != null ? `${Number(route.confirmedEndDistanceMeters).toFixed(1)}m` : '-'}</strong>
                </div>
              </>
            ) : null}
          </div>
        </div>
      ) : null}

      <div className="admin-detail-section">
        <div className="admin-detail-subtitle">备注与可见性</div>
        <div className="admin-form">
          <label>
            <span>备注</span>
            <textarea value={note} rows={3} onChange={(event) => setNote(event.target.value)} />
          </label>
          <label>
            <span>可见范围</span>
            <select value={privacy} onChange={(event) => setPrivacy(event.target.value)}>
              {Object.entries(PRIVACY_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <div className="admin-detail-actions">
            <button type="button" onClick={() => onUpdate({ note, privacyLevel: privacy })}>
              保存
            </button>
            <button type="button" onClick={onRefresh}>
              刷新详情
            </button>
          </div>
        </div>
      </div>

      <div className="admin-detail-section">
        <div className="admin-detail-subtitle">采样指标</div>
        <div className="admin-point-stats">
          <div>
            <strong>总计：</strong> {pointStats.total}
          </div>
          <div className="admin-point-stats__group">
            {renderSourceStat(translateSource('gps'), 'gps')}
            {renderSourceStat(translateSource('interp'), 'interp')}
          </div>
          <div className="admin-point-stats__group">
            {sourceDetailOptions.map((detail) => renderDetailStat(detail))}
          </div>
        </div>
        <div className="admin-point-filters">
          <label>
            来源
            <select value={sourceFilter} onChange={(event) => setSourceFilter(event.target.value)}>
              <option value="all">全部</option>
              <option value="gps">{translateSource('gps')}</option>
              <option value="interp">{translateSource('interp')}</option>
            </select>
          </label>
          <label>
            场景
            <select
              value={sourceDetailFilter}
              onChange={(event) => setSourceDetailFilter(event.target.value)}
            >
              <option value="all">全部</option>
              <option value="none">{translateSourceDetail('none')}</option>
              {sourceDetailOptions
                .filter((detail) => detail !== 'none')
                .map((detail) => (
                  <option key={detail} value={detail}>
                    {translateSourceDetail(detail)}
                  </option>
                ))}
            </select>
          </label>
        </div>
      </div>

      <div className="admin-detail-section">
        <div className="admin-detail-subtitle">
          采样点示例（展示 {displayPoints.length} / 共 {filteredPoints.length}）
        </div>
        <div className="admin-point-list">
          {displayPoints.length ? (
            displayPoints.map((point, index) => (
              <div key={`${route.id}-point-${index}`} className="admin-point-row">
                <span>{index + 1}.</span>
                <span>{formatDateTime(point.timestamp)}</span>
                <span>
                  {point.latitude?.toFixed(5)}, {point.longitude?.toFixed(5)}
                </span>
                <span>{translateSource(point.source || 'gps')}</span>
                <span>{translateSourceDetail(point.sourceDetail || 'none')}</span>
                <span>{point.interpMethod || '无'}</span>
                <span>{point.pauseReason || '无'}</span>
              </div>
            ))
          ) : (
            <div className="admin-placeholder">当前筛选无采样点</div>
          )}
        </div>
      </div>

      <div className="admin-detail-section">
        <div className="admin-detail-subtitle">操作</div>
        <div className="admin-detail-actions">
          <button type="button" onClick={() => onExport(route)} disabled={exporting}>
            {exporting ? '导出中...' : '导出 JSON'}
          </button>
          {route.deletedAt ? (
            <button type="button" onClick={() => onRestore(route.id)}>
              恢复
            </button>
          ) : (
            <button type="button" className="danger" onClick={() => onDelete(route.id)}>
              删除
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
