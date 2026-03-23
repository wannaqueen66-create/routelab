import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Users,
  Database,
  BarChart3,
  Megaphone,
  Shield,
  Search,
  Download,
  Upload,
  Trash2,
  RefreshCw,
  FileJson,
  FileSpreadsheet,
  FilePlus,
  ChevronLeft,
  ChevronRight,
  X,
  Check,
  AlertTriangle,
} from 'lucide-react';
import {
  fetchAdminUsers,
  fetchAdminRoutes,
  exportAdminRoutes,
  bulkDeleteRoutes,
  listBackups,
  createBackup,
  downloadBackup,
  fetchAdminAnalyticsSummary,
  fetchAdminQualityMetrics,
  fetchAdminRouteFeedbackSummary,
  fetchAdminAnnouncements,
  createAdminAnnouncement,
  updateAdminAnnouncement,
  deleteAdminAnnouncement,
  fetchAdminFeedback,
  updateAdminFeedback,
  fetchAdminUserDetail,
  updateAdminUser,
  updateAdminUserAchievements,
} from '../api/client';
import { formatDistance, formatDuration } from '../utils/format';

const GENDER_OPTIONS = [
  { value: '', label: '未设置' },
  { value: 'male', label: '男' },
  { value: 'female', label: '女' },
];

const AGE_RANGE_OPTIONS = [
  { value: '', label: '未设置' },
  { value: 'under18', label: '18岁以下' },
  { value: '18_24', label: '18-24岁' },
  { value: '25_34', label: '25-34岁' },
  { value: '35_44', label: '35-44岁' },
  { value: '45_54', label: '45-54岁' },
  { value: '55_plus', label: '55岁及以上' },
];

const IDENTITY_OPTIONS = [
  { value: '', label: '未设置' },
  { value: 'minor', label: '未成年' },
  { value: 'undergrad', label: '本科生' },
  { value: 'postgrad', label: '研究生' },
  { value: 'staff', label: '教职工' },
  { value: 'resident', label: '校内居民' },
  { value: 'other', label: '其他' },
];

const PURPOSE_OPTIONS = [
  { value: '', label: '不限' },
  { value: 'basketball', label: '篮球' },
  { value: 'football', label: '足球' },
  { value: 'run', label: '跑步' },
  { value: 'badminton', label: '羽毛球' },
  { value: 'table_tennis', label: '乒乓球' },
  { value: 'volleyball', label: '排球' },
  { value: 'tennis', label: '网球' },
  { value: 'swimming', label: '游泳' },
  { value: 'gym', label: '健身' },
  { value: 'yoga_pilates', label: '瑜伽 / 普拉提' },
  { value: 'martial_arts', label: '武术类' },
  { value: 'dance', label: '舞蹈类' },
  // legacy keys for backward compatibility
  { value: 'walk', label: '散步（旧）' },
  { value: 'ride', label: '骑行（旧）' },
  { value: 'hiking', label: '爬山（旧）' },
  { value: 'other', label: '其他（旧）' },
  { value: 'tabletennis', label: '乒乓球（旧键）' },
];

const EXPORT_FORMAT_STORAGE_KEY = 'routelab.admin.exportFormat';

function readInitialExportFormat() {
  if (typeof window === 'undefined' || !window.localStorage) {
    return 'json';
  }
  try {
    const stored = window.localStorage.getItem(EXPORT_FORMAT_STORAGE_KEY);
    return stored === 'csv' ? 'csv' : 'json';
  } catch (error) {
    console.warn('Failed to read export format from storage', error);
    return 'json';
  }
}

function UserDetailModal({ userId, isOpen, onClose, onUpdated }) {
  const [detail, setDetail] = useState(null);
  const [form, setForm] = useState({
    nickname: '',
    gender: '',
    ageRange: '',
    identity: '',
    birthday: '',
    height: '',
    weight: '',
    points: '',
  });
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!isOpen || !userId) {
      setDetail(null);
      setError('');
      return;
    }
    let cancelled = false;
    const loadDetail = async () => {
      try {
        setLoading(true);
        setError('');
        const data = await fetchAdminUserDetail(userId);
        if (cancelled) return;
        setDetail(data);
        const profile = data?.profile || {};
        const achievements = data?.achievements || {};
        setForm({
          nickname: profile.nickname || '',
          gender: profile.gender || '',
          ageRange: profile.ageRange || '',
          identity: profile.identity || '',
          birthday: profile.birthday || '',
          height:
            profile.heightCm !== null && profile.heightCm !== undefined
              ? String(profile.heightCm)
              : '',
          weight:
            profile.weightKg !== null && profile.weightKg !== undefined
              ? String(profile.weightKg)
              : '',
          points:
            achievements.totalPoints !== undefined && achievements.totalPoints !== null
              ? String(achievements.totalPoints)
              : '',
        });
      } catch (err) {
        if (!cancelled) {
          console.error('Failed to load user detail:', err);
          setError('加载用户详情失败，请稍后重试');
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };
    loadDetail();
    return () => {
      cancelled = true;
    };
  }, [isOpen, userId]);

  const handleInputChange = (field) => (event) => {
    setForm((prev) => ({
      ...prev,
      [field]: event.target.value,
    }));
  };

  const handleSave = async () => {
    if (!userId) return;
    try {
      setSaving(true);
      setError('');
      const payload = {
        nickname: form.nickname || '',
        gender: form.gender || null,
        ageRange: form.ageRange || null,
        identity: form.identity || null,
        birthday: form.birthday || '',
        height: form.height ? Number(form.height) : null,
        weight: form.weight ? Number(form.weight) : null,
      };

      const requests = [updateAdminUser(userId, payload)];
      const pointsTrimmed = (form.points || '').trim();
      if (pointsTrimmed !== '' && !Number.isNaN(Number(pointsTrimmed))) {
        requests.push(
          updateAdminUserAchievements(userId, {
            totalPoints: Number(pointsTrimmed),
          })
        );
      }

      await Promise.all(requests);

      const updated = await fetchAdminUserDetail(userId);
      setDetail(updated);
      const profile = updated?.profile || {};
      const achievements = updated?.achievements || {};
      setForm({
        nickname: profile.nickname || '',
        gender: profile.gender || '',
        ageRange: profile.ageRange || '',
        identity: profile.identity || '',
        birthday: profile.birthday || '',
        height:
          profile.heightCm !== null && profile.heightCm !== undefined
            ? String(profile.heightCm)
            : '',
        weight:
          profile.weightKg !== null && profile.weightKg !== undefined
            ? String(profile.weightKg)
            : '',
        points:
          achievements.totalPoints !== undefined && achievements.totalPoints !== null
            ? String(achievements.totalPoints)
            : '',
      });
      if (onUpdated) {
        onUpdated();
      }
    } catch (err) {
      console.error('Failed to update user:', err);
      const message = err?.response?.data?.error || '保存失败，请检查填写内容';
      setError(message);
    } finally {
      setSaving(false);
    }
  };

  if (!isOpen) return null;

  const profile = detail?.profile || {};
  const routes = Array.isArray(detail?.routes) ? detail.routes : [];
  const achievements = detail?.achievements || {};

  return (
    <AnimatePresence>
      <motion.div
        className="modal-backdrop"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
      >
        <motion.div
          className="modal user-detail-modal"
          initial={{ x: 40, opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          exit={{ x: 40, opacity: 0 }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="modal-header">
            <h3 className="modal-title">用户详情</h3>
            <button className="btn btn-ghost btn-icon" onClick={onClose}>
              <X size={20} />
            </button>
          </div>
          <div className="modal-body">
            {loading ? (
              <div className="space-y-4">
                <div className="skeleton skeleton-text" />
                <div className="skeleton skeleton-text" />
                <div className="skeleton skeleton-text" />
              </div>
            ) : (
              <>
                <div className="user-summary-grid">
                  <div>
                    <div className="text-sm text-gray-500">用户 ID</div>
                    <div className="text-lg font-semibold">
                      {profile.id != null ? `#${profile.id}` : '-'}
                    </div>
                  </div>
                  <div>
                    <div className="text-sm text-gray-500">累计里程</div>
                    <div className="text-lg font-semibold">
                      {((profile.totalDistance || 0) / 1000).toFixed(1)} km
                    </div>
                  </div>
                  <div>
                    <div className="text-sm text-gray-500">累计轨迹</div>
                    <div className="text-lg font-semibold">
                      {profile.routesCount || 0}
                    </div>
                  </div>
                  <div>
                    <div className="text-sm text-gray-500">最后活跃</div>
                    <div className="text-lg font-semibold">
                      {profile.lastActiveAt
                        ? new Date(profile.lastActiveAt).toLocaleString('zh-CN')
                        : '-'}
                    </div>
                  </div>
                </div>

                <div className="user-detail-form">
                  <div className="form-row">
                    <label className="form-label">昵称</label>
                    <input
                      type="text"
                      className="form-input"
                      value={form.nickname}
                      onChange={handleInputChange('nickname')}
                    />
                  </div>
                  <div className="form-row-grid">
                    <div className="form-row">
                      <label className="form-label">性别</label>
                      <select
                        className="form-input"
                        value={form.gender}
                        onChange={handleInputChange('gender')}
                      >
                        {GENDER_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="form-row">
                      <label className="form-label">年龄段</label>
                      <select
                        className="form-input"
                        value={form.ageRange}
                        onChange={handleInputChange('ageRange')}
                      >
                        {AGE_RANGE_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="form-row">
                      <label className="form-label">身份</label>
                      <select
                        className="form-input"
                        value={form.identity}
                        onChange={handleInputChange('identity')}
                      >
                        {IDENTITY_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                  <div className="form-row-grid">
                    <div className="form-row">
                      <label className="form-label">生日</label>
                      <input
                        type="date"
                        className="form-input"
                        value={form.birthday || ''}
                        onChange={handleInputChange('birthday')}
                      />
                    </div>
                    <div className="form-row">
                      <label className="form-label">身高 (cm)</label>
                      <input
                        type="number"
                        className="form-input"
                        value={form.height}
                        onChange={handleInputChange('height')}
                        min="0"
                        max="300"
                      />
                    </div>
                    <div className="form-row">
                      <label className="form-label">体重 (kg)</label>
                      <input
                        type="number"
                        className="form-input"
                        value={form.weight}
                        onChange={handleInputChange('weight')}
                        min="0"
                        max="400"
                        step="0.1"
                      />
                    </div>
                  </div>
                  <div className="form-row">
                    <label className="form-label">积分总数</label>
                    <input
                      type="number"
                      className="form-input"
                      value={form.points}
                      onChange={handleInputChange('points')}
                      min="0"
                      step="1"
                    />
                  </div>
                </div>
                {error && <div className="alert alert-error mt-2 text-sm">{error}</div>}

                {Array.isArray(detail?.routes) && detail.routes.length > 0 && (
                  <div className="user-routes-table">
                    <div className="table-title mb-2">路线记录（前 {detail.routes.length} 条）</div>
                    <div className="table-container">
                      <table className="table">
                        <thead>
                          <tr>
                            <th>日期</th>
                            <th>标题</th>
                            <th>距离</th>
                            <th>时长</th>
                            <th>操作</th>
                          </tr>
                        </thead>
                        <tbody>
                          {detail.routes.map((route) => {
                            const distanceMeters =
                              route.statSummary?.distance ??
                              route.stats?.distance ??
                              route.stats?.distance_m ??
                              route.stats?.distance_meters ??
                              0;
                            const durationSeconds =
                              route.statSummary?.durationSeconds ??
                              route.statSummary?.duration ??
                              route.stats?.duration_seconds ??
                              (route.stats?.duration ? route.stats.duration / 1000 : 0);
                            return (
                              <tr key={route.id}>
                                <td>
                                  {route.startTime
                                    ? new Date(route.startTime).toLocaleString('zh-CN')
                                    : '-'}
                                </td>
                                <td>{route.title || '未命名路线'}</td>
                                <td>{formatDistance(distanceMeters)}</td>
                                <td>{formatDuration(durationSeconds)}</td>
                                <td>
                                  <button
                                    type="button"
                                    className="btn btn-xs btn-danger"
                                    onClick={async () => {
                                      if (
                                        typeof window !== 'undefined' &&
                                        window.confirm &&
                                        !window.confirm('确定删除该路线吗？此操作不可恢复')
                                      ) {
                                        return;
                                      }
                                      try {
                                        await bulkDeleteRoutes({ ids: [route.id], hardDelete: true });
                                        const next = await fetchAdminUserDetail(userId);
                                        setDetail(next);
                                      } catch (err) {
                                        // eslint-disable-next-line no-console
                                        console.error('Failed to delete route from user detail:', err);
                                        if (typeof window !== 'undefined' && window.alert) {
                                          window.alert('删除路线失败，请稍后重试');
                                        }
                                      }
                                    }}
                                  >
                                    删除
                                  </button>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
          <div className="modal-footer">
            <button className="btn btn-outline" onClick={onClose}>
              关闭
            </button>
            <button className="btn btn-primary" onClick={handleSave} disabled={saving || loading}>
              {saving ? (
                <>
                  <RefreshCw size={16} className="animate-spin" />
                  保存中...
                </>
              ) : (
                '保存修改'
              )}
            </button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}

// User Management Component
function UserManagement() {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [selectedUsers, setSelectedUsers] = useState([]);
  const [totalUsers, setTotalUsers] = useState(0);
  const [detailUserId, setDetailUserId] = useState(null);
  const pageSize = 10;

  useEffect(() => {
    loadUsers();
  }, [currentPage, searchTerm]);

  const loadUsers = async () => {
    try {
      setLoading(true);
      const data = await fetchAdminUsers({
        page: currentPage,
        pageSize,
        search: searchTerm,
      });
      setUsers(Array.isArray(data.items) ? data.items : []);
      setTotalUsers(Number(data.pagination?.total ?? 0));
    } catch (err) {
      console.error('Failed to load users:', err);
    } finally {
      setLoading(false);
    }
  };

  const toggleUserSelection = (userId) => {
    setSelectedUsers((prev) =>
      prev.includes(userId) ? prev.filter((id) => id !== userId) : [...prev, userId]
    );
  };

  const selectAll = () => {
    if (selectedUsers.length === users.length) {
      setSelectedUsers([]);
    } else {
      setSelectedUsers(users.map((u) => u.id));
    }
  };

  return (
    <div className="data-table">
      <div className="table-toolbar">
        <div className="table-search">
          <Search size={18} className="search-icon" />
          <input
            type="text"
            className="search-input w-full"
            placeholder="搜索用户..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
        <div className="table-actions">
          <button className="btn btn-sm btn-outline" onClick={loadUsers}>
            <RefreshCw size={16} />
            刷新
          </button>
          {selectedUsers.length > 0 && (
            <button className="btn btn-sm btn-danger">
              <Trash2 size={16} />
              删除 ({selectedUsers.length})
            </button>
          )}
        </div>
      </div>

      <div className="table-container">
        <table className="table">
          <thead>
            <tr>
              <th>
                <input
                  type="checkbox"
                  checked={selectedUsers.length === users.length && users.length > 0}
                  onChange={selectAll}
                />
              </th>
              <th>用户ID</th>
              <th>昵称</th>
              <th>注册时间</th>
              <th>路线数</th>
              <th>总里程</th>
              <th>最后活跃</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <tr key={i}>
                  <td colSpan={8}>
                    <div className="skeleton skeleton-text" />
                  </td>
                </tr>
              ))
            ) : users.length === 0 ? (
              <tr>
                <td colSpan={8} className="text-center p-8 text-gray-500">
                  暂无用户数据
                </td>
              </tr>
            ) : (
              users.map((user) => (
                <motion.tr
                  key={user.id}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  whileHover={{ backgroundColor: 'var(--gray-50)' }}
                >
                  <td>
                    <input
                      type="checkbox"
                      checked={selectedUsers.includes(user.id)}
                      onChange={() => toggleUserSelection(user.id)}
                    />
                  </td>
                  <td>
                    <span className="font-medium">{user.id}</span>
                  </td>
                  <td>
                    {user.displayName || user.nickname || '-'}
                  </td>
                  <td>
                    {user.createdAt
                      ? new Date(user.createdAt).toLocaleDateString('zh-CN')
                      : '-'}
                  </td>
                  <td>{user.routesCount || 0}</td>
                  <td>{((user.totalDistance || 0) / 1000).toFixed(1)} km</td>
                  <td>
                    {user.lastActiveAt
                      ? new Date(user.lastActiveAt).toLocaleDateString('zh-CN')
                      : '-'}
                  </td>
                  <td>
                    <button
                      className="btn btn-sm btn-ghost"
                      onClick={() => setDetailUserId(user.id)}
                    >
                      查看详情
                    </button>
                  </td>
                </motion.tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="table-pagination">
        <div className="pagination-info">
          {totalUsers > 0 ? (
            <>
              显示{' '}
              {(currentPage - 1) * pageSize + 1}
              {' - '}
              {Math.min(currentPage * pageSize, totalUsers)} 项（共 {totalUsers} 项，第{' '}
              {currentPage} / {Math.max(1, Math.ceil(totalUsers / pageSize))} 页）
            </>
          ) : (
            '暂无用户数据'
          )}
        </div>
        <div className="pagination-controls">
          <button
            className="pagination-btn"
            onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
            disabled={currentPage === 1}
          >
            <ChevronLeft size={16} />
          </button>
          <button className="pagination-btn active">{currentPage}</button>
          <button
            className="pagination-btn"
            onClick={() => setCurrentPage((p) => p + 1)}
            disabled={currentPage * pageSize >= totalUsers}
          >
            <ChevronRight size={16} />
          </button>
        </div>
      </div>

      <UserDetailModal
        userId={detailUserId}
        isOpen={detailUserId != null}
        onClose={() => setDetailUserId(null)}
        onUpdated={loadUsers}
      />
    </div>
  );
}

// Data Analysis Component
function DataAnalysis() {
  const [summary, setSummary] = useState(null);
  const [quality, setQuality] = useState(null);
  const [routeFeedback, setRouteFeedback] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadAnalytics();
  }, []);

  const loadAnalytics = async () => {
    try {
      setLoading(true);
      const [summaryData, qualityData, routeFeedbackData] = await Promise.all([
        fetchAdminAnalyticsSummary({ rangeDays: 30 }),
        fetchAdminQualityMetrics(),
        fetchAdminRouteFeedbackSummary({ rangeDays: 30 }),
      ]);
      setSummary(summaryData);
      setQuality(qualityData);
      setRouteFeedback(routeFeedbackData);
    } catch (err) {
      console.error('Failed to load analytics:', err);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="analytics-grid">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="skeleton skeleton-card" style={{ height: '120px' }} />
        ))}
      </div>
    );
  }

  return (
    <div className="analytics-container">
      <div className="analytics-grid">
        <div className="analytics-card">
          <div className="analytics-label">总路线数</div>
            <div className="analytics-value">{summary?.totalRoutes || 0}</div>
        </div>
        <div className="analytics-card">
          <div className="analytics-label">活跃用户</div>
            <div className="analytics-value">{summary?.activeUsers || 0}</div>
        </div>
        <div className="analytics-card">
          <div className="analytics-label">总采样点</div>
            <div className="analytics-value">
              {(quality?.totalPoints || 0).toLocaleString()}
            </div>
        </div>
        <div className="analytics-card">
          <div className="analytics-label">后台采集率</div>
            <div className="analytics-value">
              {((quality?.backgroundRatio || 0) * 100).toFixed(1)}%
            </div>
        </div>
        <div className="analytics-card">
          <div className="analytics-label">弱信号率</div>
            <div className="analytics-value">
              {((quality?.weakSignalRatio || 0) * 100).toFixed(1)}%
            </div>
        </div>
        <div className="analytics-card">
          <div className="analytics-label">插值点率</div>
            <div className="analytics-value">
              {((quality?.interpRatio || 0) * 100).toFixed(1)}%
            </div>
        </div>
      </div>

      <div className="admin-card" style={{ marginTop: 16 }}>
        <div className="admin-card-title">路径偏好统计（近 30 天）</div>
        <div className="analytics-grid">
          <div className="analytics-card">
            <div className="analytics-label">反馈样本数</div>
            <div className="analytics-value">{routeFeedback?.totalFeedback || 0}</div>
          </div>
          <div className="analytics-card">
            <div className="analytics-label">平均满意度</div>
            <div className="analytics-value">{(routeFeedback?.averageSatisfaction || 0).toFixed(2)}</div>
          </div>
        </div>
        <div style={{ marginTop: 16 }}>
          <div className="analytics-label" style={{ marginBottom: 8 }}>按偏好选项分布</div>
          {Array.isArray(routeFeedback?.byChoice) && routeFeedback.byChoice.length ? (
            <div className="flex flex-col gap-2">
              {routeFeedback.byChoice.map((item) => (
                <div key={item.choice} className="route-item-stats">
                  <span>{item.choice}</span>
                  <span>{item.count}</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="admin-placeholder">暂无路径偏好反馈数据</div>
          )}
        </div>
      </div>
    </div>
  );
}

function formatAnnouncementDateTime(timestamp) {
  if (!timestamp) return '';
  const date =
    timestamp instanceof Date ? timestamp : new Date(typeof timestamp === 'number' ? timestamp : Number(timestamp));
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    return '';
  }
  return date.toLocaleString('zh-CN');
}

function formatDateTimeLocalInput(timestamp) {
  if (!timestamp) return '';
  const date =
    timestamp instanceof Date ? timestamp : new Date(typeof timestamp === 'number' ? timestamp : Number(timestamp));
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    return '';
  }
  const pad = (value) => String(value).padStart(2, '0');
  const year = date.getFullYear();
  const month = pad(date.getMonth() + 1);
  const day = pad(date.getDate());
  const hours = pad(date.getHours());
  const minutes = pad(date.getMinutes());
  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

// Announcements Management Component
  function AnnouncementsManagement() {
  const [announcements, setAnnouncements] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({
    title: '',
    body: '',
    status: 'draft',
    deliveryMode: 'single',
    forceRead: false,
    linkUrl: '',
    publishAt: '',
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    loadAnnouncements();
  }, []);

  const loadAnnouncements = async () => {
    try {
      setLoading(true);
      const data = await fetchAdminAnnouncements({
        page: 1,
        pageSize: 50,
      });
      setAnnouncements(Array.isArray(data.items) ? data.items : []);
    } catch (error) {
      console.error('Failed to load announcements:', error);
    } finally {
      setLoading(false);
    }
  };

  const startCreate = () => {
    setEditing({ id: null });
    setForm({
      title: '',
      body: '',
      status: 'draft',
      deliveryMode: 'single',
      forceRead: false,
      linkUrl: '',
      publishAt: '',
    });
  };

  const startEdit = (item) => {
    setEditing(item);
    setForm({
      title: item.title || '',
      body: item.body || '',
      status: item.status || 'draft',
      deliveryMode: item.deliveryMode || 'single',
      forceRead: Boolean(item.forceRead),
      linkUrl: item.linkUrl || '',
      publishAt: item.publishAt ? formatDateTimeLocalInput(item.publishAt) : '',
    });
  };

  const handleFieldChange = (field, value) => {
    setForm((prev) => ({
      ...prev,
      [field]: value,
    }));
  };

  const handleSave = async () => {
    const title = (form.title || '').trim();
    const body = (form.body || '').trim();
    if (!title || !body) {
      if (typeof window !== 'undefined' && window.alert) {
        window.alert('公告标题和正文不能为空');
      }
      return;
    }
    const payload = {
      title,
      body,
      status: form.status || 'draft',
      deliveryMode: form.deliveryMode || 'single',
      forceRead: Boolean(form.forceRead),
      linkUrl: (form.linkUrl || '').trim(),
    };
    if (form.publishAt) {
      const date = new Date(form.publishAt);
      if (!Number.isNaN(date.getTime())) {
        payload.publishAt = date.toISOString();
      }
    }

    try {
      setSaving(true);
      if (editing && editing.id) {
        await updateAdminAnnouncement(editing.id, payload);
      } else {
        await createAdminAnnouncement(payload);
      }
      await loadAnnouncements();
      setEditing(null);
    } catch (error) {
      console.error('Failed to save announcement:', error);
      if (typeof window !== 'undefined' && window.alert) {
        const message =
          error?.response?.data?.error || error.message || '保存公告失败，请稍后重试';
        window.alert(message);
      }
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id) => {
    if (!id) return;
    if (typeof window !== 'undefined' && window.confirm) {
      const ok = window.confirm('确定要删除该公告吗？此操作不可恢复');
      if (!ok) return;
    }
    try {
      await deleteAdminAnnouncement(id);
      await loadAnnouncements();
      if (editing && editing.id === id) {
        setEditing(null);
      }
    } catch (error) {
      console.error('Failed to delete announcement:', error);
    }
  };

  const handleQuickStatusChange = async (item, nextStatus) => {
    if (!item?.id) return;
    const payload = { status: nextStatus };
    if (nextStatus === 'published' && !item.publishAt) {
      payload.publishAt = new Date().toISOString();
    }
    try {
      await updateAdminAnnouncement(item.id, payload);
      await loadAnnouncements();
    } catch (error) {
      console.error('Failed to update announcement status:', error);
    }
  };

  return (
    <div className="data-table">
      <div className="table-toolbar">
        <div className="table-title">
          <Megaphone size={18} />
          <span>系统公告</span>
        </div>
        <div className="table-actions">
          <button className="btn btn-sm btn-outline" onClick={loadAnnouncements}>
            <RefreshCw size={16} />
            刷新
          </button>
          <button className="btn btn-sm btn-primary" onClick={startCreate}>
            <FilePlus size={16} />
            新建公告
          </button>
        </div>
      </div>

      <div className="table-container">
        <table className="table">
          <thead>
            <tr>
              <th>标题</th>
              <th>类型</th>
              <th>状态</th>
              <th>发布时间</th>
              <th>创建时间</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              Array.from({ length: 3 }).map((_, index) => (
                <tr key={index}>
                  <td colSpan={6}>
                    <div className="skeleton skeleton-text" />
                  </td>
                </tr>
              ))
            ) : announcements.length === 0 ? (
              <tr>
                <td colSpan={6} className="text-center p-8 text-gray-500">
                  暂无公告，可点击“新建公告”发布系统通知
                </td>
              </tr>
            ) : (
              announcements.map((item) => (
                <tr key={item.id}>
                  <td>
                    <div className="font-medium">{item.title}</div>
                  </td>
                  <td>{item.deliveryMode === 'persistent' ? '常驻公告' : '一次性公告'}</td>
                  <td>
                    <span
                      className={`badge ${
                        item.status === 'published' ? 'badge-success' : 'badge-secondary'
                      }`}
                    >
                      {item.status === 'published' ? '已发布' : '草稿'}
                    </span>
                  </td>
                  <td>{formatAnnouncementDateTime(item.publishAt) || '未设置'}</td>
                  <td>{formatAnnouncementDateTime(item.createdAt) || '-'}</td>
                  <td className="flex gap-2">
                    <button
                      className="btn btn-sm btn-ghost"
                      type="button"
                      onClick={() => startEdit(item)}
                    >
                      编辑
                    </button>
                    {item.status === 'published' ? (
                      <button
                        className="btn btn-sm btn-outline"
                        type="button"
                        onClick={() => handleQuickStatusChange(item, 'draft')}
                      >
                        撤回
                      </button>
                    ) : (
                      <button
                        className="btn btn-sm btn-primary"
                        type="button"
                        onClick={() => handleQuickStatusChange(item, 'published')}
                      >
                        发布
                      </button>
                    )}
                    <button
                      className="btn btn-sm btn-danger"
                      type="button"
                      onClick={() => handleDelete(item.id)}
                    >
                      删除
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {editing && (
        <div className="announcement-editor">
          <div className="announcement-editor-row">
            <label className="announcement-editor-label" htmlFor="announcement-title">
              标题
            </label>
            <input
              id="announcement-title"
              className="announcement-editor-input"
              type="text"
              placeholder="请输入公告标题"
              value={form.title}
              onChange={(e) => handleFieldChange('title', e.target.value)}
            />
          </div>
          <div className="announcement-editor-row">
            <label className="announcement-editor-label" htmlFor="announcement-body">
              正文
            </label>
            <textarea
              id="announcement-body"
              className="announcement-editor-textarea"
              placeholder="输入要展示给用户的公告内容"
              value={form.body}
              onChange={(e) => handleFieldChange('body', e.target.value)}
            />
          </div>
          <div className="announcement-editor-row">
            <label
              className="announcement-editor-label"
              htmlFor="announcement-delivery-mode"
            >
              类型
            </label>
            <select
              id="announcement-delivery-mode"
              className="announcement-editor-select"
              value={form.deliveryMode}
              onChange={(e) => handleFieldChange('deliveryMode', e.target.value)}
            >
              <option value="single">一次性公告（每位用户只弹一次）</option>
              <option value="persistent">常驻公告（每次打开首页都会显示）</option>
            </select>
          </div>
          <div className="announcement-editor-row">
            <label className="announcement-editor-label" htmlFor="announcement-status">
              状态
            </label>
            <select
              id="announcement-status"
              className="announcement-editor-select"
              value={form.status}
              onChange={(e) => handleFieldChange('status', e.target.value)}
            >
              <option value="draft">草稿（未发布）</option>
              <option value="published">已发布</option>
            </select>
          </div>
          <div className="announcement-editor-row">
            <label className="announcement-editor-label" htmlFor="announcement-publish-at">
              发布时间（可选）
            </label>
            <input
              id="announcement-publish-at"
              className="announcement-editor-input"
              type="datetime-local"
              value={form.publishAt}
              onChange={(e) => handleFieldChange('publishAt', e.target.value)}
            />
          </div>
          <div className="announcement-editor-actions">
            <button
              type="button"
              className="btn btn-sm btn-outline"
              onClick={() => setEditing(null)}
              disabled={saving}
            >
              取消
            </button>
            <button
              type="button"
              className="btn btn-sm btn-primary"
              onClick={handleSave}
              disabled={saving}
            >
              {saving ? '保存中...' : '保存公告'}
            </button>
          </div>
        </div>
      )}
      </div>
    );
  }

  function FeedbackManagement() {
    const [tickets, setTickets] = useState([]);
    const [loading, setLoading] = useState(true);
    const [statusFilter, setStatusFilter] = useState('open');
    const [page, setPage] = useState(1);
    const [total, setTotal] = useState(0);
    const pageSize = 20;

    const loadTickets = async (pageOverride) => {
      const nextPage = pageOverride || page;
      try {
        setLoading(true);
        const data = await fetchAdminFeedback({
          page: nextPage,
          pageSize,
          status: statusFilter === 'all' ? undefined : statusFilter,
        });
        setTickets(Array.isArray(data.items) ? data.items : []);
        setTotal(Number(data.pagination?.total ?? 0));
      } catch (error) {
        console.error('Failed to load feedback tickets:', error);
      } finally {
        setLoading(false);
      }
    };

    useEffect(() => {
      loadTickets(1);
      setPage(1);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [statusFilter]);

    const handleStatusChange = async (ticket, nextStatus) => {
      try {
        await updateAdminFeedback(ticket.id, { status: nextStatus });
        loadTickets();
      } catch (error) {
        console.error('Failed to update feedback status:', error);
      }
    };

    const handleReplyChange = (id, value) => {
      setTickets((prev) =>
        prev.map((item) =>
          item.id === id
            ? {
                ...item,
                adminReplyDraft: value,
              }
            : item
        )
      );
    };

    const handleSaveReply = async (ticket) => {
      const reply = (ticket.adminReplyDraft ?? ticket.adminReply ?? '').trim();
      try {
        await updateAdminFeedback(ticket.id, { adminReply: reply });
        loadTickets();
      } catch (error) {
        console.error('Failed to save feedback reply:', error);
      }
    };

    const totalPages = Math.max(1, Math.ceil(total / pageSize));

    return (
      <div className="data-table">
        <div className="table-toolbar">
          <div className="table-title">
            <AlertTriangle size={18} />
            <span>用户反馈工单</span>
          </div>
          <div className="table-actions">
            <select
              className="announcement-editor-select"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
            >
              <option value="open">仅未处理</option>
              <option value="in_progress">处理中</option>
              <option value="resolved">已解决</option>
              <option value="closed">已关闭</option>
              <option value="all">全部状态</option>
            </select>
            <button className="btn btn-sm btn-outline" onClick={() => loadTickets(1)}>
              <RefreshCw size={16} />
              刷新
            </button>
          </div>
        </div>

        <div className="table-container">
          <table className="table">
            <thead>
              <tr>
                <th>ID</th>
                <th>用户ID</th>
                <th>分类</th>
                <th>标题</th>
                <th>内容</th>
                <th>联系方式</th>
                <th>状态</th>
                <th>管理员备注</th>
                <th>创建时间</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                Array.from({ length: 5 }).map((_, index) => (
                  <tr key={index}>
                    <td colSpan={10}>
                      <div className="skeleton skeleton-text" />
                    </td>
                  </tr>
                ))
              ) : tickets.length === 0 ? (
                <tr>
                  <td colSpan={10} className="text-center p-8 text-gray-500">
                    当前没有符合条件的反馈工单
                  </td>
                </tr>
              ) : (
                tickets.map((ticket) => (
                  <tr key={ticket.id}>
                    <td>#{ticket.id}</td>
                    <td>{ticket.userId || '-'}</td>
                    <td>{ticket.category || '-'}</td>
                    <td>{ticket.title}</td>
                    <td>
                      <div className="text-sm text-gray-700" style={{ maxWidth: 260 }}>
                        {ticket.content}
                      </div>
                    </td>
                    <td>{ticket.contact || '-'}</td>
                    <td>{ticket.status}</td>
                    <td>
                      <textarea
                        className="announcement-editor-textarea"
                        style={{ minHeight: 60 }}
                        value={ticket.adminReplyDraft ?? ticket.adminReply ?? ''}
                        onChange={(e) => handleReplyChange(ticket.id, e.target.value)}
                      />
                    </td>
                    <td>{formatAnnouncementDateTime(ticket.createdAt) || '-'}</td>
                    <td className="flex flex-col gap-2">
                      <button
                        type="button"
                        className="btn btn-sm btn-primary"
                        onClick={() => handleSaveReply(ticket)}
                      >
                        保存备注
                      </button>
                      <button
                        type="button"
                        className="btn btn-sm btn-outline"
                        onClick={() => handleStatusChange(ticket, 'in_progress')}
                        disabled={ticket.status === 'in_progress'}
                      >
                        标记处理中
                      </button>
                      <button
                        type="button"
                        className="btn btn-sm btn-outline"
                        onClick={() => handleStatusChange(ticket, 'resolved')}
                        disabled={ticket.status === 'resolved'}
                      >
                        标记已解决
                      </button>
                      <button
                        type="button"
                        className="btn btn-sm btn-outline"
                        onClick={() => handleStatusChange(ticket, 'closed')}
                        disabled={ticket.status === 'closed'}
                      >
                        关闭工单
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div className="table-pagination">
          <div className="pagination-info">
            共 {total} 条 | 第 {page} / {totalPages} 页
          </div>
          <div className="pagination-controls">
            <button
              className="pagination-btn"
              onClick={() => {
                const next = Math.max(1, page - 1);
                setPage(next);
                loadTickets(next);
              }}
              disabled={page <= 1}
            >
              <ChevronLeft size={16} />
            </button>
            <button className="pagination-btn active">{page}</button>
            <button
              className="pagination-btn"
              onClick={() => {
                const next = Math.min(totalPages, page + 1);
                setPage(next);
                loadTickets(next);
              }}
              disabled={page >= totalPages}
            >
              <ChevronRight size={16} />
            </button>
          </div>
        </div>
      </div>
    );
  }

// Backup Management Component
function BackupManagement() {
  const [backups, setBackups] = useState([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    loadBackups();
  }, []);

  const loadBackups = async () => {
    try {
      setLoading(true);
      const data = await listBackups();
      setBackups(data.backups || []);
    } catch (err) {
      console.error('Failed to load backups:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleCreateBackup = async () => {
    try {
      setCreating(true);
      await createBackup();
      await loadBackups();
    } catch (err) {
      console.error('Failed to create backup:', err);
    } finally {
      setCreating(false);
    }
  };

  const handleDownload = async (filename) => {
    try {
      const { blob, filename: name } = await downloadBackup(filename);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Failed to download backup:', err);
    }
  };

  return (
    <div className="backup-management">
      <div className="backup-actions">
        <button
          className="btn btn-primary"
          onClick={handleCreateBackup}
          disabled={creating}
        >
          {creating ? (
            <>
              <RefreshCw size={16} className="animate-spin" />
              创建中...
            </>
          ) : (
            <>
              <FilePlus size={16} />
              创建备份
            </>
          )}
        </button>
        <button className="btn btn-outline" onClick={loadBackups}>
          <RefreshCw size={16} />
          刷新列表
        </button>
      </div>

      <div className="backup-list">
        {loading ? (
          Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="skeleton" style={{ height: '60px', marginBottom: '8px' }} />
          ))
        ) : backups.length === 0 ? (
          <div className="empty-state p-8">
            <Database size={48} className="empty-state-icon" />
            <div className="empty-state-title">暂无备份</div>
            <div className="empty-state-description">
              点击"创建备份"按钮创建第一个数据备份
            </div>
          </div>
        ) : (
          backups.map((backup, idx) => (
            <motion.div
              key={backup.filename}
              className="backup-item"
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: idx * 0.1 }}
            >
              <div className="backup-info">
                <div className="backup-name">
                  <FileJson size={20} />
                  {backup.filename}
                </div>
                <div className="backup-meta">
                  <span>大小: {(backup.size_bytes / 1024).toFixed(1)} KB</span>
                  <span>
                    修改时间: {new Date(backup.modified_at).toLocaleString('zh-CN')}
                  </span>
                </div>
              </div>
              <div className="backup-actions">
                <button
                  className="btn btn-sm btn-outline"
                  onClick={() => handleDownload(backup.filename)}
                >
                  <Download size={16} />
                  下载
                </button>
              </div>
            </motion.div>
          ))
        )}
      </div>
    </div>
  );
}

// Export Modal Component
function ExportModal({ isOpen, onClose }) {
  const [format, setFormat] = useState(() => readInitialExportFormat());
  const [exporting, setExporting] = useState(false);
  const [filters, setFilters] = useState({
    userId: '',
    startDate: '',
    endDate: '',
    purpose: '',
    minDistance: '',
    maxDistance: '',
  });

  useEffect(() => {
    if (!isOpen) return;
    setFilters({
      userId: '',
      startDate: '',
      endDate: '',
      purpose: '',
      minDistance: '',
      maxDistance: '',
    });
  }, [isOpen]);

  const handleFormatChange = (nextFormat) => {
    setFormat(nextFormat);
    if (typeof window !== 'undefined' && window.localStorage) {
      try {
        window.localStorage.setItem(EXPORT_FORMAT_STORAGE_KEY, nextFormat);
      } catch (error) {
        console.warn('Failed to persist export format', error);
      }
    }
  };

  const handleFilterChange = (field) => (event) => {
    setFilters((prev) => ({
      ...prev,
      [field]: event.target.value,
    }));
  };

  const handleExport = async () => {
    try {
      setExporting(true);
      const payloadFilters = {};
      if (filters.userId) {
        const parsedId = Number(filters.userId);
        if (Number.isFinite(parsedId)) {
          payloadFilters.userId = parsedId;
        }
      }
      if (filters.startDate) {
        payloadFilters.startDate = filters.startDate;
      }
      if (filters.endDate) {
        payloadFilters.endDate = filters.endDate;
      }
      if (filters.minDistance) {
        payloadFilters.minDistance = Number(filters.minDistance) * 1000;
      }
      if (filters.maxDistance) {
        payloadFilters.maxDistance = Number(filters.maxDistance) * 1000;
      }
      if (filters.purpose) {
        payloadFilters.purpose = filters.purpose;
      }

      const { blob, filename } = await exportAdminRoutes({
        format,
        filters: payloadFilters,
        includePoints: true,
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
      onClose();
    } catch (err) {
      console.error('Export failed:', err);
    } finally {
      setExporting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <motion.div
        className="modal-backdrop"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
      >
        <motion.div
          className="modal export-modal"
          initial={{ scale: 0.9, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.9, opacity: 0 }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="modal-header">
            <h3 className="modal-title">导出数据</h3>
            <button className="btn btn-ghost btn-icon" onClick={onClose}>
              <X size={20} />
            </button>
          </div>
          <div className="modal-body">
            <div className="export-options">
              <div
                className={`export-option ${format === 'json' ? 'selected' : ''}`}
                onClick={() => handleFormatChange('json')}
              >
                <div className="export-option-icon">
                  <FileJson size={24} />
                </div>
                <div className="export-option-info">
                  <div className="export-option-name">JSON 格式</div>
                  <div className="export-option-desc">
                    完整数据，适合数据备份和迁移
                  </div>
                </div>
                {format === 'json' && <Check size={20} className="text-primary" />}
              </div>
              <div
                className={`export-option ${format === 'csv' ? 'selected' : ''}`}
                onClick={() => handleFormatChange('csv')}
              >
                <div className="export-option-icon">
                  <FileSpreadsheet size={24} />
                </div>
                <div className="export-option-info">
                  <div className="export-option-name">CSV 格式</div>
                  <div className="export-option-desc">
                    表格格式，适合Excel分析
                  </div>
                </div>
                {format === 'csv' && <Check size={20} className="text-primary" />}
              </div>
            </div>
            <div className="export-filters">
              <div className="export-filters-title">筛选条件（可选）</div>
              <div className="export-filters-grid">
                <label className="export-filter-field">
                  <span>用户 ID</span>
                  <input
                    type="number"
                    className="form-input"
                    placeholder="例如 1"
                    value={filters.userId}
                    onChange={handleFilterChange('userId')}
                    min="1"
                  />
                </label>
                <label className="export-filter-field">
                  <span>开始日期</span>
                  <input
                    type="date"
                    className="form-input"
                    value={filters.startDate}
                    onChange={handleFilterChange('startDate')}
                  />
                </label>
                <label className="export-filter-field">
                  <span>结束日期</span>
                  <input
                    type="date"
                    className="form-input"
                    value={filters.endDate}
                    onChange={handleFilterChange('endDate')}
                  />
                </label>
                <label className="export-filter-field">
                  <span>最小里程 (km)</span>
                  <input
                    type="number"
                    className="form-input"
                    placeholder="例如 1"
                    value={filters.minDistance}
                    onChange={handleFilterChange('minDistance')}
                    min="0"
                    step="0.1"
                  />
                </label>
                <label className="export-filter-field">
                  <span>最大里程 (km)</span>
                  <input
                    type="number"
                    className="form-input"
                    placeholder="不限"
                    value={filters.maxDistance}
                    onChange={handleFilterChange('maxDistance')}
                    min="0"
                    step="0.1"
                  />
                </label>
                <label className="export-filter-field">
                  <span>出行目的</span>
                  <select
                    className="form-input"
                    value={filters.purpose}
                    onChange={handleFilterChange('purpose')}
                  >
                    {PURPOSE_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            </div>
          </div>
          <div className="modal-footer">
            <button className="btn btn-outline" onClick={onClose}>
              取消
            </button>
            <button
              className="btn btn-primary"
              onClick={handleExport}
              disabled={exporting}
            >
              {exporting ? (
                <>
                  <RefreshCw size={16} className="animate-spin" />
                  导出中...
                </>
              ) : (
                <>
                  <Download size={16} />
                  开始导出
                </>
              )}
            </button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}

export default function AdminPage() {
  const [activeTab, setActiveTab] = useState('users');
  const [showExportModal, setShowExportModal] = useState(false);

  const tabs = [
    { id: 'users', label: '用户管理', icon: Users },
    { id: 'analytics', label: '数据分析', icon: BarChart3 },
    { id: 'feedback', label: '用户反馈', icon: AlertTriangle },
    { id: 'announcements', label: '系统公告', icon: Megaphone },
    { id: 'backup', label: '备份管理', icon: Database },
  ];

  return (
    <div className="admin-page">
      <motion.div
        className="admin-header"
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
      >
        <h1 className="admin-title">
          <Shield size={28} />
          管理后台
          <span className="badge badge-admin">管理员专属</span>
        </h1>
        <div className="admin-actions">
          <button
            className="btn btn-primary"
            onClick={() => setShowExportModal(true)}
          >
            <Download size={16} />
            导出数据
          </button>
        </div>
      </motion.div>

      <motion.div
        className="admin-tabs"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2 }}
      >
        <div className="admin-tab-header">
          <div className="tabs">
            {tabs.map((tab) => {
              const Icon = tab.icon;
              return (
                <button
                  key={tab.id}
                  className={`tab ${activeTab === tab.id ? 'tab-active' : ''}`}
                  onClick={() => setActiveTab(tab.id)}
                >
                  <Icon size={16} />
                  {tab.label}
                </button>
              );
            })}
          </div>
        </div>

        <div className="admin-tab-content">
          {activeTab === 'users' && <UserManagement />}
          {activeTab === 'analytics' && <DataAnalysis />}
          {activeTab === 'feedback' && <FeedbackManagement />}
          {activeTab === 'announcements' && <AnnouncementsManagement />}
          {activeTab === 'backup' && <BackupManagement />}
        </div>
      </motion.div>

      <ExportModal
        isOpen={showExportModal}
        onClose={() => setShowExportModal(false)}
      />
    </div>
  );
}
