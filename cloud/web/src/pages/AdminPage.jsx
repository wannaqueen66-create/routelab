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
  fetchAdminAnnouncements,
  createAdminAnnouncement,
  updateAdminAnnouncement,
  deleteAdminAnnouncement,
} from '../api/client';

// User Management Component
function UserManagement() {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [selectedUsers, setSelectedUsers] = useState([]);
  const [totalUsers, setTotalUsers] = useState(0);
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
                  <td colSpan={7}>
                    <div className="skeleton skeleton-text" />
                  </td>
                </tr>
              ))
            ) : users.length === 0 ? (
              <tr>
                <td colSpan={7} className="text-center p-8 text-gray-500">
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
                    <button className="btn btn-sm btn-ghost">查看详情</button>
                  </td>
                </motion.tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="table-pagination">
        <div className="pagination-info">
          显示 {(currentPage - 1) * pageSize + 1} - {currentPage * pageSize} 项
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
    </div>
  );
}

// Data Analysis Component
function DataAnalysis() {
  const [summary, setSummary] = useState(null);
  const [quality, setQuality] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadAnalytics();
  }, []);

  const loadAnalytics = async () => {
    try {
      setLoading(true);
      const [summaryData, qualityData] = await Promise.all([
        fetchAdminAnalyticsSummary({ rangeDays: 30 }),
        fetchAdminQualityMetrics(),
      ]);
      setSummary(summaryData);
      setQuality(qualityData);
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
      publishAt: '',
    });
  };

  const startEdit = (item) => {
    setEditing(item);
    setForm({
      title: item.title || '',
      body: item.body || '',
      status: item.status || 'draft',
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
                  <td colSpan={5}>
                    <div className="skeleton skeleton-text" />
                  </td>
                </tr>
              ))
            ) : announcements.length === 0 ? (
              <tr>
                <td colSpan={5} className="text-center p-8 text-gray-500">
                  暂无公告，可点击“新建公告”发布系统通知
                </td>
              </tr>
            ) : (
              announcements.map((item) => (
                <tr key={item.id}>
                  <td>
                    <div className="font-medium">{item.title}</div>
                  </td>
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
  const [format, setFormat] = useState('json');
  const [exporting, setExporting] = useState(false);

  const handleExport = async () => {
    try {
      setExporting(true);
      const { blob, filename } = await exportAdminRoutes({ format });
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
                onClick={() => setFormat('json')}
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
                onClick={() => setFormat('csv')}
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
