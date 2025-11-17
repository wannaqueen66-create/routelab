import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Users,
  Database,
  BarChart3,
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
} from '../api/client';

// User Management Component
function UserManagement() {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [selectedUsers, setSelectedUsers] = useState([]);
  const pageSize = 10;

  useEffect(() => {
    loadUsers();
  }, [currentPage, searchTerm]);

  const loadUsers = async () => {
    try {
      setLoading(true);
      const data = await fetchAdminUsers({
        page: currentPage,
        limit: pageSize,
        search: searchTerm,
      });
      setUsers(data.users || []);
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
                    {user.created_at
                      ? new Date(user.created_at).toLocaleDateString('zh-CN')
                      : '-'}
                  </td>
                  <td>{user.routes_count || 0}</td>
                  <td>{((user.total_distance || 0) / 1000).toFixed(1)} km</td>
                  <td>
                    {user.last_active
                      ? new Date(user.last_active).toLocaleDateString('zh-CN')
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
            disabled={users.length < pageSize}
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
        fetchAdminAnalyticsSummary({ days: 30 }),
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
          <div className="analytics-value">{summary?.total_routes || 0}</div>
        </div>
        <div className="analytics-card">
          <div className="analytics-label">活跃用户</div>
          <div className="analytics-value">{summary?.active_users || 0}</div>
        </div>
        <div className="analytics-card">
          <div className="analytics-label">总采样点</div>
          <div className="analytics-value">
            {(quality?.total_points || 0).toLocaleString()}
          </div>
        </div>
        <div className="analytics-card">
          <div className="analytics-label">后台采集率</div>
          <div className="analytics-value">
            {((quality?.background_ratio || 0) * 100).toFixed(1)}%
          </div>
        </div>
        <div className="analytics-card">
          <div className="analytics-label">弱信号率</div>
          <div className="analytics-value">
            {((quality?.weak_signal_ratio || 0) * 100).toFixed(1)}%
          </div>
        </div>
        <div className="analytics-card">
          <div className="analytics-label">插值点率</div>
          <div className="analytics-value">
            {((quality?.interpolated_ratio || 0) * 100).toFixed(1)}%
          </div>
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
