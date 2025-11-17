import { useState } from 'react';
import { formatDateTime } from '../../utils/format.js';

export default function MaintenancePanel({
  backups,
  loading,
  onRefresh,
  onCreate,
  onDownload,
  onRestore,
  restoring,
}) {
  const [pendingRestore, setPendingRestore] = useState('');

  const handleRestore = (filename) => {
    setPendingRestore(filename);
    onRestore(filename).finally(() => setPendingRestore(''));
  };

  return (
    <div className="admin-card">
      <div className="admin-card-title">数据备份与恢复</div>
      <div className="admin-maintenance-actions">
        <button type="button" onClick={onRefresh} disabled={loading}>
          {loading ? '刷新中...' : '刷新列表'}
        </button>
        <button type="button" onClick={onCreate} disabled={loading}>
          创建备份
        </button>
      </div>
      <div className="admin-table-wrapper">
        <table>
          <thead>
            <tr>
              <th>文件名</th>
              <th>大小</th>
              <th>生成时间</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan="4" className="admin-placeholder">
                  加载中...
                </td>
              </tr>
            ) : backups.length ? (
              backups.map((backup) => (
                <tr key={backup.filename}>
                  <td>{backup.filename}</td>
                  <td>{(backup.bytes / 1024).toFixed(1)} KB</td>
                  <td>{formatDateTime(backup.modifiedAt)}</td>
                  <td>
                    <button type="button" onClick={() => onDownload(backup.filename)}>
                      下载
                    </button>
                    <button
                      type="button"
                      className="danger"
                      onClick={() => handleRestore(backup.filename)}
                      disabled={restoring}
                    >
                      {restoring && pendingRestore === backup.filename ? '恢复中...' : '恢复'}
                    </button>
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan="4" className="admin-placeholder">
                  暂无备份记录
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="admin-note">
        提示：恢复操作默认为追加模式，不会移除现有数据。如需覆盖式恢复，可在 API 层使用
        mode=replace 参数。
      </p>
    </div>
  );
}
