import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import MapView from '../components/MapView';
import SummaryCards from '../components/admin/SummaryCards.jsx';
import AnalyticsPanels from '../components/admin/AnalyticsPanels.jsx';
import RouteFilters from '../components/admin/RouteFilters.jsx';
import RouteTable from '../components/admin/RouteTable.jsx';
import RouteDetailPanel from '../components/admin/RouteDetailPanel.jsx';
import UsersPanel from '../components/admin/UsersPanel.jsx';
import QualityMetrics from '../components/admin/QualityMetrics.jsx';
import FeedbackPanel from '../components/admin/FeedbackPanel.jsx';
import MaintenancePanel from '../components/admin/MaintenancePanel.jsx';
import {
  bulkDeleteRoutes,
  createAdminRoute,
  createBackup,
  deleteRouteById,
  downloadBackup,
  exportAdminRoutes,
  fetchAdminAnalyticsSummary,
  fetchAdminAnalyticsTimeseries,
  fetchAdminCollectionDistribution,
  fetchAdminQualityMetrics,
  fetchAdminRouteDetail,
  fetchAdminRoutes,
  fetchAdminUserDetail,
  fetchAdminUsers,
  listBackups,
  restoreBackup,
  updateAdminRoute,
} from '../api/client';
const ADMIN_TABS = [
  { id: 'routes', label: '轨迹概览' },
  { id: 'feedback', label: '反馈分析' },
  { id: 'users', label: '用户概览' },
  { id: 'maintenance', label: '后台维护' },
];

function createDefaultRouteFilters() {
  return {
    keyword: '',
    userId: '',
    startDate: '',
    endDate: '',
    minDistance: '',
    maxDistance: '',
    sort: 'startTime',
    order: 'desc',
    includeDeleted: false,
    includePoints: true,
  };
}

function createDefaultUserFilters() {
  return {
    search: '',
    sort: 'lastActive',
    order: 'desc',
    requireRoutes: true,
  };
}

const ENV_PAGE_SIZE = Number.parseInt(import.meta.env.VITE_ADMIN_PAGE_SIZE, 10);
const DEFAULT_PAGE_SIZE =
  Number.isFinite(ENV_PAGE_SIZE) && ENV_PAGE_SIZE > 0 ? ENV_PAGE_SIZE : 25;
const FILTER_DEBOUNCE_MS = 300;

function useBanner() {
  const [banner, setBanner] = useState(null);
  const show = useCallback((message, type = 'info') => {
    setBanner({ message, type });
    window.setTimeout(() => setBanner(null), 4000);
  }, []);
  return [banner, show];
}

function useDebouncedValue(value, delay = FILTER_DEBOUNCE_MS) {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delay);
    return () => window.clearTimeout(timer);
  }, [value, delay]);

  return debounced;
}

function downloadBlob(blob, filename) {
  if (typeof window === 'undefined') return;
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  window.URL.revokeObjectURL(url);
}

export default function AdminDashboard() {
  const [activeTab, setActiveTab] = useState('routes');
  const [banner, showBanner] = useBanner();

  const [summary, setSummary] = useState(null);
  const [timeseries, setTimeseries] = useState(null);
  const [distribution, setDistribution] = useState(null);
  const [qualityMetrics, setQualityMetrics] = useState(null);
  const [loadingAnalytics, setLoadingAnalytics] = useState(false);

  const [routeFilters, setRouteFilters] = useState(() => createDefaultRouteFilters());
  const debouncedRouteFilters = useDebouncedValue(routeFilters);
  const [routePage, setRoutePage] = useState(1);
  const [routePageSize, setRoutePageSize] = useState(DEFAULT_PAGE_SIZE);
  const [routeTotal, setRouteTotal] = useState(0);
  const [routes, setRoutes] = useState([]);
  const [loadingRoutes, setLoadingRoutes] = useState(false);
  const [selectedRouteId, setSelectedRouteId] = useState(null);
  const [selectedRouteDetail, setSelectedRouteDetail] = useState(null);
  const [exportingRoute, setExportingRoute] = useState(false);
  const [importing, setImporting] = useState(false);
  const fileInputRef = useRef(null);
  const [routeReloadToken, setRouteReloadToken] = useState(0);

  const [userFilters, setUserFilters] = useState(() => createDefaultUserFilters());
  const [userPage, setUserPage] = useState(1);
  const [userTotal, setUserTotal] = useState(0);
  const [users, setUsers] = useState([]);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [selectedUser, setSelectedUser] = useState(null);

  const [backups, setBackups] = useState([]);
  const [loadingBackups, setLoadingBackups] = useState(false);
  const [restoring, setRestoring] = useState(false);

  const fetchRoutesApi = useMemo(() => fetchAdminRoutes, []);

  useEffect(() => {
    if (!ADMIN_TABS.some((tab) => tab.id === activeTab)) {
      setActiveTab('routes');
    }
  }, [activeTab]);

  const loadAnalytics = useCallback(async () => {
    setLoadingAnalytics(true);
    try {
      const [summaryData, timeseriesData, distributionData, qualityData] = await Promise.all([
        fetchAdminAnalyticsSummary(),
        fetchAdminAnalyticsTimeseries(),
        fetchAdminCollectionDistribution(),
        fetchAdminQualityMetrics(),
      ]);
      setSummary(summaryData);
      setTimeseries(timeseriesData);
      setDistribution(distributionData);
      setQualityMetrics(qualityData);
    } catch (error) {
      showBanner(error?.response?.data?.error || error.message || '加载统计数据失败', 'error');
    } finally {
      setLoadingAnalytics(false);
    }
  }, [showBanner]);

  const triggerRoutesReload = useCallback(() => {
    setRouteReloadToken((token) => token + 1);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const fetchRoutes = async () => {
      setLoadingRoutes(true);
      try {
        const queryParams = {
          ...debouncedRouteFilters,
          page: routePage,
          pageSize: routePageSize,
        };
        const requestParams = { ...queryParams };
        const rawUserId = requestParams.userId;
        const isEmptyUserId =
          rawUserId === undefined ||
          rawUserId === null ||
          (typeof rawUserId === 'string' && rawUserId.trim() === '');
        if (isEmptyUserId) {
          delete requestParams.userId;
        } else {
          const parsedUserId =
            typeof rawUserId === 'number' ? rawUserId : Number(rawUserId);
          if (Number.isFinite(parsedUserId)) {
            requestParams.userId = parsedUserId;
          } else {
            delete requestParams.userId;
          }
        }
        const data = await fetchRoutesApi(requestParams);
        if (cancelled) {
          return;
        }
        setRoutes(Array.isArray(data.items) ? data.items : []);
        setRouteTotal(data.pagination?.total ?? 0);
        const apiPageSize = Number(data.pagination?.pageSize);
        if (
          Number.isFinite(apiPageSize) &&
          apiPageSize > 0 &&
          apiPageSize !== routePageSize
        ) {
          setRoutePageSize(apiPageSize);
        }
      } catch (error) {
        if (!cancelled) {
          showBanner(error?.response?.data?.error || error.message || '加载轨迹失败', 'error');
        }
      } finally {
        if (!cancelled) {
          setLoadingRoutes(false);
        }
      }
    };
    fetchRoutes();
    return () => {
      cancelled = true;
    };
  }, [
    debouncedRouteFilters,
    routePage,
    routePageSize,
    fetchRoutesApi,
    showBanner,
    routeReloadToken,
  ]);

  const refreshRouteDetail = useCallback(
    async (routeId = selectedRouteId) => {
      if (!routeId) return;
      try {
        const detail = await fetchAdminRouteDetail(routeId);
        setSelectedRouteDetail(detail);
      } catch (error) {
        showBanner(error?.response?.data?.error || error.message || '加载轨迹详情失败', 'error');
      }
    },
    [selectedRouteId, showBanner]
  );

  const loadUsers = useCallback(async () => {
    setLoadingUsers(true);
    try {
      const data = await fetchAdminUsers({
        ...userFilters,
        page: userPage,
        pageSize: DEFAULT_PAGE_SIZE,
      });
      setUsers(Array.isArray(data.items) ? data.items : []);
      setUserTotal(data.pagination?.total ?? 0);
    } catch (error) {
      showBanner(error?.response?.data?.error || error.message || '加载用户失败', 'error');
    } finally {
      setLoadingUsers(false);
    }
  }, [userFilters, userPage, showBanner]);

  const loadBackups = useCallback(async () => {
    setLoadingBackups(true);
    try {
      const data = await listBackups();
      setBackups(Array.isArray(data.backups) ? data.backups : []);
    } catch (error) {
      showBanner(error?.response?.data?.error || error.message || '加载备份失败', 'error');
    } finally {
      setLoadingBackups(false);
    }
  }, [showBanner]);

  useEffect(() => {
    loadAnalytics();
  }, [loadAnalytics]);

  useEffect(() => {
    if (!selectedRouteId) {
      setSelectedRouteDetail(null);
      return;
    }
    refreshRouteDetail(selectedRouteId);
  }, [refreshRouteDetail, selectedRouteId]);

  useEffect(() => {
    if (activeTab === 'users') {
      loadUsers();
    }
    if (activeTab === 'maintenance') {
      loadBackups();
    }
  }, [activeTab, loadBackups, loadUsers]);

    const handleDeleteRoute = async (routeId) => {
    if (!window.confirm('确定删除当前选中的轨迹吗？此操作不可恢复')) {
      return;
    }
    try {
      await deleteRouteById(routeId);
      showBanner('轨迹已删除', 'success');
      triggerRoutesReload();
      if (selectedRouteId === routeId) {
        setSelectedRouteId(null);
        setSelectedRouteDetail(null);
      }
    } catch (error) {
      showBanner(error?.response?.data?.error || error.message || '删除失败', 'error');
    }
  };

    const handleRestoreRoute = async (routeId) => {
    try {
      await updateAdminRoute(routeId, { deletedAt: null });
      showBanner('轨迹已恢复', 'success');
      triggerRoutesReload();
      await refreshRouteDetail(routeId);
    } catch (error) {
      showBanner(error?.response?.data?.error || error.message || '恢复失败', 'error');
    }
  };

    const handleUpdateRoute = async (payload) => {
    if (!selectedRouteId) return;
    try {
      await updateAdminRoute(selectedRouteId, payload);
      showBanner('更新成功', 'success');
      await refreshRouteDetail(selectedRouteId);
      triggerRoutesReload();
    } catch (error) {
      showBanner(error?.response?.data?.error || error.message || '更新失败', 'error');
    }
  };

    const handleBulkDelete = async (ids) => {
    try {
      await bulkDeleteRoutes({ ids });
      showBanner('已删除选中的轨迹', 'success');
      triggerRoutesReload();
      if (ids.includes(selectedRouteId)) {
        setSelectedRouteId(null);
        setSelectedRouteDetail(null);
      }
    } catch (error) {
      showBanner(error?.response?.data?.error || error.message || '批量删除失败', 'error');
    }
  };

    const handleExportRoutes = async () => {
    try {
      showBanner('正在导出轨迹...', 'info');
      const result = await exportAdminRoutes({
        filters: { ...routeFilters },
        includePoints: routeFilters.includePoints,
        includeDeleted: routeFilters.includeDeleted,
      });
      downloadBlob(result.blob, result.filename || 'routes-export.json');
      showBanner('导出完成', 'success');
    } catch (error) {
      showBanner(error?.response?.data?.error || error.message || '导出失败', 'error');
    }
  };

  const handleExportRoute = async (route) => {
    setExportingRoute(true);
    try {
      const blob = new Blob([JSON.stringify(route, null, 2)], {
        type: 'application/json',
      });
      downloadBlob(blob, `${route.id || 'route'}-detail.json`);
    } finally {
      setExportingRoute(false);
    }
  };

    const handleImportRoutes = async (file) => {
    if (!file) return;
    try {
      setImporting(true);
      const text = await file.text();
      const payload = JSON.parse(text);
      const entries = Array.isArray(payload) ? payload : [payload];
      if (!entries.length) {
        throw new Error('文件中未找到轨迹数据');
      }
      for (const entry of entries) {
        const route = { ...entry };
        if (!Array.isArray(route.points) || !route.points.length) {
          throw new Error('轨迹缺少 points 字段');
        }
        const id =
          route.id ||
          route.routeId ||
          (typeof crypto !== 'undefined' && crypto.randomUUID
            ? crypto.randomUUID()
            : `${Date.now()}-${Math.random().toString(16).slice(2)}`);
        route.id = id;
        await createAdminRoute(route);
      }
      showBanner('导入完成', 'success');
      triggerRoutesReload();
    } catch (error) {
      showBanner(error?.response?.data?.error || error.message || '导入失败', 'error');
    } finally {
      setImporting(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

    const handleSelectUser = async (userId) => {
    if (!userId) {
      setSelectedUser(null);
      return;
    }
    try {
      const detail = await fetchAdminUserDetail(userId);
      setSelectedUser(detail);
    } catch (error) {
      showBanner(error?.response?.data?.error || error.message || '加载用户详情失败', 'error');
    }
  };

    const handleCreateBackup = async () => {
    try {
      await createBackup();
      showBanner('备份已创建', 'success');
      loadBackups();
    } catch (error) {
      showBanner(error?.response?.data?.error || error.message || '创建备份失败', 'error');
    }
  };

    const handleDownloadBackup = async (filename) => {
    if (!filename) return;
    try {
      const result = await downloadBackup(filename);
      downloadBlob(result.blob, result.filename || filename);
      showBanner('备份已下载', 'success');
    } catch (error) {
      showBanner(error?.response?.data?.error || error.message || '下载备份失败', 'error');
    }
  };

    const handleRestoreBackup = async (filename) => {
    if (!filename) return;
    if (!window.confirm('确定将该备份恢复到当前环境吗？此操作不可撤销')) {
      return;
    }
    try {
      setRestoring(true);
      await restoreBackup({ filename });
      showBanner('备份已恢复', 'success');
      triggerRoutesReload();
      loadAnalytics();
    } catch (error) {
      showBanner(error?.response?.data?.error || error.message || '恢复备份失败', 'error');
    } finally {
      setRestoring(false);
    }
  };

  const totalRoutePages = Math.max(1, Math.ceil(routeTotal / (routePageSize || 1)));
  const totalUserPages = Math.max(1, Math.ceil(userTotal / DEFAULT_PAGE_SIZE));
  const routeAnalytics = (
    <>
      <SummaryCards summary={summary} loading={loadingAnalytics} />
      <AnalyticsPanels
        timeseries={timeseries}
        distribution={distribution}
        loading={loadingAnalytics}
      />
      <QualityMetrics metrics={qualityMetrics} loading={loadingAnalytics} />
    </>
  );

  return (
    <div className="admin-dashboard">
      {banner ? <div className={`admin-banner ${banner.type}`}>{banner.message}</div> : null}
      <div className="admin-tabs">
        {ADMIN_TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            className={tab.id === activeTab ? 'is-active' : ''}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'routes' ? (
        <>
          {routeAnalytics}
          <RouteFilters
            filters={routeFilters}
            onChange={(next) => {
              setRouteFilters(next);
              setRoutePage(1);
            }}
            onApply={triggerRoutesReload}
            onReset={() => {
              setRouteFilters(createDefaultRouteFilters());
              setRoutePage(1);
            }}
            loading={loadingRoutes}
            isAdmin
          />
          <div className="admin-card admin-map-card">
            <div className="admin-card-title">
              地图预览
              <div className="admin-card-actions">
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={importing}
                >
                  {importing ? '导入中...' : '导入 JSON 轨迹'}
                </button>
                <button type="button" onClick={handleExportRoutes} disabled={loadingRoutes}>
                  导出筛选结果
                </button>
              </div>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept="application/json"
              style={{ display: 'none' }}
              onChange={(event) => handleImportRoutes(event.target.files?.[0] || null)}
            />
            <MapView
              routes={routes}
              loading={loadingRoutes}
              selectedRouteId={selectedRouteId}
              onRouteClick={setSelectedRouteId}
              showRouteMarkers
              showRoutePoints={Boolean(selectedRouteId)}
            />
          </div>
          <div className="admin-flex-layout">
            <RouteTable
              routes={routes}
              pagination={{ page: routePage, pageSize: routePageSize, total: routeTotal }}
              onPageChange={(next) => {
                if (next < 1 || next > totalRoutePages) return;
                setRoutePage(next);
              }}
              selectedRouteId={selectedRouteId}
              onSelect={setSelectedRouteId}
              onDelete={handleDeleteRoute}
              onBulkDelete={handleBulkDelete}
              loading={loadingRoutes}
              canBulkDelete
            />
            <RouteDetailPanel
              route={selectedRouteDetail}
              onClose={() => {
                setSelectedRouteId(null);
                setSelectedRouteDetail(null);
              }}
              onDelete={handleDeleteRoute}
              onRestore={handleRestoreRoute}
              onRefresh={() => refreshRouteDetail(selectedRouteId)}
              onUpdate={handleUpdateRoute}
              onExport={handleExportRoute}
              exporting={exportingRoute}
            />
          </div>
        </>
      ) : null}

      {activeTab === 'feedback' ? (
        <FeedbackPanel rangeDays={30} />
      ) : null}

      {activeTab === 'users' ? (
        <UsersPanel
          filters={userFilters}
          onFilterChange={(next) => {
            setUserFilters(next);
            setUserPage(1);
          }}
          users={users}
          pagination={{ page: userPage, pageSize: DEFAULT_PAGE_SIZE, total: userTotal }}
          onPageChange={(next) => {
            if (next < 1 || next > totalUserPages) return;
            setUserPage(next);
          }}
          loading={loadingUsers}
          onSelectUser={handleSelectUser}
          selectedUser={selectedUser}
        />
      ) : null}

      {activeTab === 'maintenance' ? (
        <MaintenancePanel
          backups={backups}
          loading={loadingBackups}
          onRefresh={loadBackups}
          onCreate={handleCreateBackup}
          onDownload={handleDownloadBackup}
          onRestore={handleRestoreBackup}
          restoring={restoring}
        />
      ) : null}
    </div>
  );
}































