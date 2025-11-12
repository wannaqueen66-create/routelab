export default function RouteFilters({
  filters,
  onChange,
  onApply,
  onReset,
  loading,
  isAdmin = true,
}) {
  const handleInputChange = (field) => (event) => {
    const value =
      event.target.type === 'checkbox' ? event.target.checked : event.target.value;
    onChange({ ...filters, [field]: value });
  };

  return (
    <div className="admin-card admin-filter-panel">
      <div className="admin-card-title">筛选条件</div>
      <div className="admin-filter-grid">
        <label>
          <span>关键词</span>
          <input
            type="text"
            value={filters.keyword || ''}
            placeholder="Title or note"
            onChange={handleInputChange('keyword')}
          />
        </label>
        <label>
          <span>用户 ID</span>
          <input
            type="number"
            value={filters.userId || ''}
            placeholder="Exact match"
            onChange={handleInputChange('userId')}
            disabled={!isAdmin}
          />
        </label>
        <label>
          <span>开始日期</span>
          <input
            type="date"
            value={filters.startDate || ''}
            onChange={handleInputChange('startDate')}
          />
        </label>
        <label>
          <span>结束日期</span>
          <input
            type="date"
            value={filters.endDate || ''}
            onChange={handleInputChange('endDate')}
          />
        </label>
        <label>
          <span>最小里程（米）</span>
          <input
            type="number"
            min="0"
            value={filters.minDistance || ''}
            onChange={handleInputChange('minDistance')}
          />
        </label>
        <label>
          <span>最大里程（米）</span>
          <input
            type="number"
            min="0"
            value={filters.maxDistance || ''}
            onChange={handleInputChange('maxDistance')}
          />
        </label>
        <label>
          <span>排序字段</span>
          <select value={filters.sort} onChange={handleInputChange('sort')}>
            <option value="startTime">开始时间</option>
            <option value="distance">轨迹距离</option>
            <option value="duration">运动时长</option>
            <option value="updatedAt">最近更新</option>
          </select>
        </label>
        <label>
          <span>排序方向</span>
          <select value={filters.order} onChange={handleInputChange('order')}>
            <option value="desc">降序</option>
            <option value="asc">升序</option>
          </select>
        </label>
      </div>
      <div className="admin-filter-actions">
        <label className="admin-checkbox">
          <input
            type="checkbox"
            checked={filters.includeDeleted}
            onChange={handleInputChange('includeDeleted')}
            disabled={!isAdmin}
          />
          <span>包含已删除记录</span>
        </label>
        <label className="admin-checkbox">
          <input
            type="checkbox"
            checked={filters.includePoints}
            onChange={handleInputChange('includePoints')}
          />
          <span>返回轨迹坐标</span>
        </label>
        <div className="admin-filter-buttons">
          <button type="button" onClick={onReset} disabled={loading}>
            重置
          </button>
          <button type="button" onClick={onApply} disabled={loading}>
            {loading ? '应用中...' : '应用筛选'}
          </button>
        </div>
      </div>
    </div>
  );
}
