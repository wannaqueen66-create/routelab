import { formatDateTime, formatDistance } from '../../utils/format.js';

export default function UsersPanel({
  filters,
  onFilterChange,
  users,
  pagination,
  onPageChange,
  loading,
  onSelectUser,
  selectedUser,
}) {
  const handleInputChange = (field) => (event) => {
    const value =
      event.target.type === 'checkbox' ? event.target.checked : event.target.value;
    onFilterChange({ ...filters, [field]: value });
  };

  const totalPages = Math.max(1, Math.ceil((pagination.total || 0) / pagination.pageSize));

  return (
    <div className="admin-tab-split">
      <div className="admin-card admin-user-list">
        <div className="admin-card-title">用户列表</div>
        <div className="admin-filter-grid">
          <label>
            <span>搜索</span>
            <input
              type="text"
              value={filters.search || ''}
              placeholder="昵称 / ID"
              onChange={handleInputChange('search')}
            />
          </label>
          <label>
            <span>排序</span>
            <select value={filters.sort} onChange={handleInputChange('sort')}>
              <option value="lastActive">最近活跃</option>
              <option value="distance">累计里程</option>
              <option value="routes">轨迹数量</option>
              <option value="duration">累计时长</option>
            </select>
          </label>
          <label>
            <span>顺序</span>
            <select value={filters.order} onChange={handleInputChange('order')}>
              <option value="desc">降序</option>
              <option value="asc">升序</option>
            </select>
          </label>
          <label className="admin-checkbox">
            <input
              type="checkbox"
              checked={filters.requireRoutes}
              onChange={handleInputChange('requireRoutes')}
            />
            <span>仅显示有轨迹的用户</span>
          </label>
        </div>
        <div className="admin-table-wrapper">
          <table>
            <thead>
              <tr>
                <th>ID</th>
                <th>昵称</th>
                <th>轨迹数</th>
                <th>累计里程</th>
                <th>最近活跃</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan="6" className="admin-placeholder">
                    加载中...
                  </td>
                </tr>
              ) : users.length ? (
                users.map((user) => (
                  <tr
                    key={user.id}
                    className={selectedUser?.profile?.id === user.id ? 'is-selected' : ''}
                  >
                    <td>{user.id}</td>
                    <td>{user.displayName || user.nickname || '-'}</td>
                    <td>{user.routesCount}</td>
                    <td>{formatDistance(user.totalDistance)}</td>
                    <td>{formatDateTime(user.lastActiveAt)}</td>
                    <td>
                      <button type="button" onClick={() => onSelectUser(user.id)}>
                        查看详情
                      </button>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan="6" className="admin-placeholder">
                    暂无用户数据
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
      <div className="admin-card admin-user-detail">
        <div className="admin-card-title">用户详情</div>
        {selectedUser ? (
          <>
            <div className="admin-detail-grid">
              <div>
                <span>昵称</span>
                <strong>
                  {selectedUser.profile.displayName || selectedUser.profile.nickname || '-'}
                </strong>
              </div>
              <div>
                <span>累计轨迹</span>
                <strong>{selectedUser.profile.routesCount}</strong>
              </div>
              <div>
                <span>累计里程</span>
                <strong>{formatDistance(selectedUser.profile.totalDistance)}</strong>
              </div>
              <div>
                <span>最近活跃</span>
                <strong>{formatDateTime(selectedUser.profile.lastActiveAt)}</strong>
              </div>
            </div>
            <div className="admin-detail-section">
              <div className="admin-detail-subtitle">最新轨迹</div>
              <ul className="admin-simple-list">
                {selectedUser.routes && selectedUser.routes.length ? (
                  selectedUser.routes.slice(0, 10).map((route) => (
                    <li key={route.id}>
                      <strong>{route.title || route.id}</strong>
                      <span>
                        {formatDistance(route.statSummary?.distance ?? route.stats?.distance)}
                      </span>
                      <span>{formatDateTime(route.startTime)}</span>
                    </li>
                  ))
                ) : (
                  <li className="admin-placeholder">暂无轨迹</li>
                )}
              </ul>
            </div>
          </>
        ) : (
          <div className="admin-placeholder">请选择左侧用户查看详情</div>
        )}
      </div>
    </div>
  );
}
