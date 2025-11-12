import { useEffect, useState } from 'react';
import { formatDateTime, formatDistance, formatDuration } from '../../utils/format.js';

export default function RouteTable({
  routes,
  pagination,
  onPageChange,
  selectedRouteId,
  onSelect,
  onDelete,
  onBulkDelete,
  loading,
  canBulkDelete = true,
  canDelete = true,
}) {
  const [selection, setSelection] = useState([]);

  useEffect(() => {
    setSelection([]);
  }, [routes]);

  const toggleSelection = (routeId) => {
    setSelection((prev) =>
      prev.includes(routeId) ? prev.filter((id) => id !== routeId) : [...prev, routeId]
    );
  };

  const handleBulkDelete = () => {
    if (!canBulkDelete || !selection.length) {
      return;
    }
    if (window.confirm(`确定删除选中 ${selection.length} 条轨迹吗？`)) {
      onBulkDelete?.(selection);
    }
  };

  const selectableRoutes = routes.filter((route) => !route.deletedAt);
  const isAllSelected =
    canBulkDelete && selection.length > 0 && selection.length === selectableRoutes.length;

  const totalPages = Math.max(1, Math.ceil((pagination.total || 0) / pagination.pageSize));

  return (
    <div className="admin-card admin-route-table">
      <div className="admin-card-title">
        轨迹列表
        <div className="admin-table-actions">
          <button
            type="button"
            onClick={handleBulkDelete}
            disabled={!selection.length || loading || !canBulkDelete}
          >
            批量删除
          </button>
        </div>
      </div>
      <div className="admin-table-wrapper">
        <table>
          <thead>
            <tr>
              <th>
                <input
                  type="checkbox"
                  checked={isAllSelected}
                  onChange={(event) => {
                    if (!canBulkDelete) {
                      return;
                    }
                    if (event.target.checked) {
                      setSelection(selectableRoutes.map((route) => route.id));
                    } else {
                      setSelection([]);
                    }
                  }}
                  disabled={!canBulkDelete || !selectableRoutes.length || loading}
                />
              </th>
              <th>开始时间</th>
              <th>标题</th>
              <th>里程</th>
              <th>时长</th>
              <th>所属用户</th>
              <th>状态</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan="8" className="admin-placeholder">
                  数据加载中...
                </td>
              </tr>
            ) : routes.length ? (
              routes.map((route) => (
                <tr key={route.id} className={selectedRouteId === route.id ? 'is-selected' : ''}>
                  <td>
                    <input
                      type="checkbox"
                      checked={selection.includes(route.id)}
                      disabled={Boolean(route.deletedAt) || loading || !canBulkDelete}
                      onChange={() => toggleSelection(route.id)}
                    />
                  </td>
                  <td>{formatDateTime(route.startTime)}</td>
                  <td>{route.title || '-'}</td>
                  <td>{formatDistance(route.statSummary?.distance ?? route.stats?.distance)}</td>
                  <td>{formatDuration(route.statSummary?.duration ?? route.stats?.duration)}</td>
                  <td>{route.owner?.displayName || route.ownerId || 'N/A'}</td>
                  <td>{route.deletedAt ? '已删除' : '有效'}</td>
                  <td>
                    <button type="button" onClick={() => onSelect(route.id)}>
                      查看
                    </button>
                    <button
                      type="button"
                      onClick={() => onDelete(route.id)}
                      disabled={loading || !canDelete}
                      className="danger"
                    >
                      删除
                    </button>
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan="8" className="admin-placeholder">
                  暂无数据，请调整筛选条件
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="admin-table-footer">
        <div>
          第 {pagination.page} / {totalPages} 页
        </div>
        <div>
          <button
            type="button"
            onClick={() => onPageChange(pagination.page - 1)}
            disabled={pagination.page <= 1 || loading}
          >
            上一页
          </button>
          <button
            type="button"
            onClick={() => onPageChange(pagination.page + 1)}
            disabled={pagination.page >= totalPages || loading}
          >
            下一页
          </button>
        </div>
      </div>
    </div>
  );
}
