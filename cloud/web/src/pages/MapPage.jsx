import { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Layers,
  X,
  List,
  ZoomIn,
  ZoomOut,
  Maximize2,
  Filter,
  Search,
  Calendar,
  User,
  Target,
  RotateCcw,
  ChevronDown,
  MapPin,
  Activity,
} from 'lucide-react';
import { MapContainer, TileLayer, Polyline, CircleMarker, Marker, Popup, useMap } from 'react-leaflet';
import { fetchAdminRoutes, fetchAdminRouteDetail, fetchAdminUsers } from '../api/client';
import { gcj02ToWgs84 } from '../utils/coord';
import { formatDistance, formatDuration } from '../utils/format';
import 'leaflet/dist/leaflet.css';

// Speed gradient colors (slow to fast)
const SPEED_COLORS = [
  '#4A90E2', // Slow - Blue
  '#52C41A', // Medium - Green
  '#FAAD14', // Fast - Yellow
  '#FF4D4F', // Very Fast - Red
];

// Trip purpose colors
const PURPOSE_COLORS = {
  commute: '#4A90E2',
  exercise: '#52C41A',
  leisure: '#FAAD14',
  business: '#722ED1',
  other: '#8C8C8C',
};

const PURPOSE_LABELS = {
  commute: '通勤',
  exercise: '运动健身',
  leisure: '休闲出行',
  business: '商务出行',
  other: '其他',
};

// Custom map controller
function MapController({ routes, selectedRoute, autoFit }) {
  const map = useMap();

  useEffect(() => {
    if (!autoFit) return;

    if (selectedRoute && selectedRoute.points?.length > 0) {
      const bounds = selectedRoute.points.map((p) => {
        const converted = gcj02ToWgs84(p.latitude, p.longitude);
        return [converted.latitude, converted.longitude];
      });
      if (bounds.length > 0) {
        map.fitBounds(bounds, { padding: [50, 50] });
      }
    } else if (routes.length > 0) {
      const allPoints = routes.flatMap((route) =>
        (route.points || []).map((p) => {
          const converted = gcj02ToWgs84(p.latitude, p.longitude);
          return [converted.latitude, converted.longitude];
        })
      );
      if (allPoints.length > 0) {
        map.fitBounds(allPoints, { padding: [50, 50] });
      }
    }
  }, [routes, selectedRoute, map, autoFit]);

  return null;
}

// Ensure Leaflet map correctly fills its container after layout/size changes
function MapResizeHandler({ dependencies = [] }) {
  const map = useMap();

  useEffect(() => {
    if (!map) return;
    // Defer to next tick so flex/layout animations have applied
    setTimeout(() => {
      map.invalidateSize();
    }, 0);
  }, [map, ...dependencies]);

  return null;
}

// Route polyline with speed gradient
function SpeedGradientPolyline({ points }) {
  if (!points || points.length < 2) return null;

  const segments = [];
  for (let i = 0; i < points.length - 1; i++) {
    const p1 = points[i];
    const p2 = points[i + 1];
    const converted1 = gcj02ToWgs84(p1.latitude, p1.longitude);
    const converted2 = gcj02ToWgs84(p2.latitude, p2.longitude);

    // Calculate speed and determine color
    const speed = p1.speed || 0;
    let colorIndex = 0;
    if (speed > 15) colorIndex = 3;
    else if (speed > 10) colorIndex = 2;
    else if (speed > 5) colorIndex = 1;

    segments.push({
      positions: [[converted1.latitude, converted1.longitude], [converted2.latitude, converted2.longitude]],
      color: SPEED_COLORS[colorIndex],
    });
  }

  return (
    <>
      {segments.map((segment, idx) => (
        <Polyline
          key={idx}
          positions={segment.positions}
          color={segment.color}
          weight={4}
          opacity={0.8}
        />
      ))}
    </>
  );
}

// Enhanced Heatmap layer
function HeatmapLayer({ routes, intensity = 'medium' }) {
  if (!routes || routes.length === 0) return null;

  const sampleRate = intensity === 'high' ? 5 : intensity === 'low' ? 20 : 10;
  const radius = intensity === 'high' ? 12 : intensity === 'low' ? 6 : 8;
  const opacity = intensity === 'high' ? 0.4 : intensity === 'low' ? 0.2 : 0.3;

  const points = [];
  routes.forEach((route) => {
    if (route.points) {
      for (let i = 0; i < route.points.length; i += sampleRate) {
        const p = route.points[i];
        const converted = gcj02ToWgs84(p.latitude, p.longitude);
        points.push([converted.latitude, converted.longitude]);
      }
    }
  });

  return (
    <>
      {points.map((point, idx) => (
        <CircleMarker
          key={idx}
          center={point}
          radius={radius}
          fillColor="#FF4D4F"
          fillOpacity={opacity}
          stroke={false}
        />
      ))}
    </>
  );
}

// Advanced Filter Panel Component
function FilterPanel({ filters, onFilterChange, onApply, onReset, users, loading }) {
  const [isExpanded, setIsExpanded] = useState(true);
  const [userSearch, setUserSearch] = useState('');
  const [showUserDropdown, setShowUserDropdown] = useState(false);

  const filteredUsers = users.filter(
    (u) =>
      u.id.toString().includes(userSearch) ||
      (u.name && u.name.toLowerCase().includes(userSearch.toLowerCase()))
  );

  return (
    <motion.div
      className="filter-panel"
      initial={{ opacity: 0, x: -20 }}
      animate={{ opacity: 1, x: 0 }}
    >
      <div className="filter-header" onClick={() => setIsExpanded(!isExpanded)}>
        <div className="filter-title">
          <Filter size={18} />
          <span>高级筛选</span>
        </div>
        <ChevronDown
          size={18}
          className={`filter-toggle ${isExpanded ? 'expanded' : ''}`}
        />
      </div>

      <AnimatePresence>
        {isExpanded && (
          <motion.div
            className="filter-content"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.3 }}
          >
            {/* User Filter */}
            <div className="filter-group">
              <label className="filter-label">
                <User size={14} />
                按用户筛选
              </label>
              <div className="user-search-wrapper">
                <input
                  type="text"
                  className="filter-input"
                  placeholder="输入用户ID或名称..."
                  value={userSearch}
                  onChange={(e) => {
                    setUserSearch(e.target.value);
                    setShowUserDropdown(true);
                  }}
                  onFocus={() => setShowUserDropdown(true)}
                />
                {showUserDropdown && userSearch && (
                  <div className="user-dropdown">
                    {filteredUsers.length > 0 ? (
                      filteredUsers.slice(0, 10).map((user) => (
                        <div
                          key={user.id}
                          className="user-option"
                          onClick={() => {
                            onFilterChange({ ...filters, userId: user.id.toString() });
                            setUserSearch(user.name || `用户 ${user.id}`);
                            setShowUserDropdown(false);
                          }}
                        >
                          <span className="user-id">#{user.id}</span>
                          <span className="user-name">{user.name || '未命名用户'}</span>
                        </div>
                      ))
                    ) : (
                      <div className="user-option no-result">未找到匹配用户</div>
                    )}
                  </div>
                )}
                {filters.userId && (
                  <button
                    className="clear-user-btn"
                    onClick={() => {
                      onFilterChange({ ...filters, userId: '' });
                      setUserSearch('');
                    }}
                  >
                    <X size={14} />
                  </button>
                )}
              </div>
            </div>

            {/* Date Range Filter */}
            <div className="filter-group">
              <label className="filter-label">
                <Calendar size={14} />
                日期时段
              </label>
              <div className="date-range-inputs">
                <input
                  type="date"
                  className="filter-input"
                  value={filters.startDate}
                  onChange={(e) =>
                    onFilterChange({ ...filters, startDate: e.target.value })
                  }
                  placeholder="开始日期"
                />
                <span className="date-separator">至</span>
                <input
                  type="date"
                  className="filter-input"
                  value={filters.endDate}
                  onChange={(e) =>
                    onFilterChange({ ...filters, endDate: e.target.value })
                  }
                  placeholder="结束日期"
                />
              </div>
            </div>

            {/* Trip Purpose Filter */}
            <div className="filter-group">
              <label className="filter-label">
                <Target size={14} />
                出行目的
              </label>
              <div className="purpose-tags">
                {Object.entries(PURPOSE_LABELS).map(([key, label]) => (
                  <button
                    key={key}
                    className={`purpose-tag ${filters.purpose === key ? 'active' : ''}`}
                    onClick={() =>
                      onFilterChange({
                        ...filters,
                        purpose: filters.purpose === key ? '' : key,
                      })
                    }
                    style={{
                      '--tag-color': PURPOSE_COLORS[key],
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {/* Distance Range Filter */}
            <div className="filter-group">
              <label className="filter-label">
                <MapPin size={14} />
                距离范围 (km)
              </label>
              <div className="range-inputs">
                <input
                  type="number"
                  className="filter-input"
                  placeholder="最小"
                  value={filters.minDistance}
                  onChange={(e) =>
                    onFilterChange({ ...filters, minDistance: e.target.value })
                  }
                  min="0"
                  step="0.1"
                />
                <span className="range-separator">-</span>
                <input
                  type="number"
                  className="filter-input"
                  placeholder="最大"
                  value={filters.maxDistance}
                  onChange={(e) =>
                    onFilterChange({ ...filters, maxDistance: e.target.value })
                  }
                  min="0"
                  step="0.1"
                />
              </div>
            </div>

            {/* Filter Actions */}
            <div className="filter-actions">
              <button
                className="btn btn-primary btn-sm"
                onClick={onApply}
                disabled={loading}
              >
                <Search size={14} />
                应用筛选
              </button>
              <button className="btn btn-outline btn-sm" onClick={onReset}>
                <RotateCcw size={14} />
                重置
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

// Statistics Summary Component
function StatsSummary({ routes, loading }) {
  const totalDistance = routes.reduce(
    (sum, r) => sum + (r.stats?.distance_meters || 0),
    0
  );
  const totalDuration = routes.reduce(
    (sum, r) => sum + (r.stats?.duration_seconds || 0),
    0
  );
  const uniqueUsers = new Set(routes.map((r) => r.user_id)).size;

  return (
    <div className="stats-summary">
      <div className="stat-item">
        <span className="stat-label">轨迹数</span>
        <span className="stat-value">{loading ? '--' : routes.length}</span>
      </div>
      <div className="stat-item">
        <span className="stat-label">用户数</span>
        <span className="stat-value">{loading ? '--' : uniqueUsers}</span>
      </div>
      <div className="stat-item">
        <span className="stat-label">总里程</span>
        <span className="stat-value">
          {loading ? '--' : formatDistance(totalDistance)}
        </span>
      </div>
      <div className="stat-item">
        <span className="stat-label">总时长</span>
        <span className="stat-value">
          {loading ? '--' : formatDuration(totalDuration)}
        </span>
      </div>
    </div>
  );
}

export default function MapPage() {
  const [routes, setRoutes] = useState([]);
  const [selectedRoute, setSelectedRoute] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showRouteList, setShowRouteList] = useState(false);
  const [showFilterPanel, setShowFilterPanel] = useState(true);
  const [mapType, setMapType] = useState('standard');
  const [showHeatmap, setShowHeatmap] = useState(true);
  const [heatmapIntensity, setHeatmapIntensity] = useState('medium');
  const [autoFit, setAutoFit] = useState(true);

  // Filter state
  const [filters, setFilters] = useState({
    userId: '',
    startDate: '',
    endDate: '',
    purpose: '',
    minDistance: '',
    maxDistance: '',
  });

  // Users for filter dropdown
  const [users, setUsers] = useState([]);

  // Playback state
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackPosition, setPlaybackPosition] = useState(0);
  const [playbackSpeed, setPlaybackSpeed] = useState(1);
  const playbackRef = useRef(null);

  const mapRef = useRef(null);

  useEffect(() => {
    loadInitialData();
  }, []);

  // Playback animation
  useEffect(() => {
    if (isPlaying && selectedRoute?.points?.length > 0) {
      playbackRef.current = setInterval(() => {
        setPlaybackPosition((prev) => {
          const next = prev + 1;
          if (next >= selectedRoute.points.length) {
            setIsPlaying(false);
            return selectedRoute.points.length - 1;
          }
          return next;
        });
      }, 100 / playbackSpeed);
    }

    return () => {
      if (playbackRef.current) {
        clearInterval(playbackRef.current);
      }
    };
  }, [isPlaying, selectedRoute, playbackSpeed]);

  const loadInitialData = async () => {
    try {
      setLoading(true);
      // Load both routes and users for filtering
      const [routesData, usersData] = await Promise.all([
        fetchAdminRoutes({
          pageSize: 100,
          includePoints: true,
          sort: 'startTime',
          order: 'desc',
        }),
        fetchAdminUsers({ pageSize: 100 }),
      ]);

      setRoutes(routesData.items || routesData.routes || []);
      setUsers(usersData.items || usersData.users || []);
    } catch (err) {
      console.error('Failed to load initial data:', err);
    } finally {
      setLoading(false);
    }
  };

  const loadRoutes = useCallback(async () => {
    try {
      setLoading(true);
      const params = {
        pageSize: 100,
        includePoints: true,
        sort: 'startTime',
        order: 'desc',
      };

      // Apply filters
      if (filters.userId) {
        params.userId = Number(filters.userId);
      }
      if (filters.startDate) {
        params.startDate = filters.startDate;
      }
      if (filters.endDate) {
        params.endDate = filters.endDate;
      }
      if (filters.minDistance) {
        params.minDistance = Number(filters.minDistance) * 1000; // Convert km to meters
      }
      if (filters.maxDistance) {
        params.maxDistance = Number(filters.maxDistance) * 1000;
      }

      const data = await fetchAdminRoutes(params);
      let filteredRoutes = data.items || data.routes || [];

      // Client-side purpose filtering (if not supported by API)
      if (filters.purpose) {
        filteredRoutes = filteredRoutes.filter(
          (route) => route.purpose === filters.purpose || route.trip_purpose === filters.purpose
        );
      }

      setRoutes(filteredRoutes);
      setAutoFit(true);
    } catch (err) {
      console.error('Failed to load routes:', err);
    } finally {
      setLoading(false);
    }
  }, [filters]);

  const handleRouteSelect = async (route) => {
    if (selectedRoute?.id === route.id) {
      setSelectedRoute(null);
      setIsPlaying(false);
      setPlaybackPosition(0);
      setAutoFit(true);
    } else {
      try {
        const detail = await fetchAdminRouteDetail(route.id);
        setSelectedRoute(detail);
        setPlaybackPosition(0);
        setIsPlaying(false);
        setAutoFit(true);
      } catch (err) {
        console.error('Failed to load route detail:', err);
      }
    }
  };

  const handleResetFilters = () => {
    setFilters({
      userId: '',
      startDate: '',
      endDate: '',
      purpose: '',
      minDistance: '',
      maxDistance: '',
    });
    loadInitialData();
  };

  const togglePlayback = () => {
    if (!selectedRoute) return;
    setIsPlaying(!isPlaying);
  };

  const resetPlayback = () => {
    setPlaybackPosition(0);
    setIsPlaying(false);
  };

  const skipForward = () => {
    if (!selectedRoute?.points) return;
    setPlaybackPosition((prev) =>
      Math.min(prev + 50, selectedRoute.points.length - 1)
    );
  };

  const skipBackward = () => {
    setPlaybackPosition((prev) => Math.max(prev - 50, 0));
  };

  const tileUrl = mapType === 'satellite'
    ? 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'
    : 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';

  return (
    <div className="map-page-admin">
      <div className="map-page-header">
        <div className="map-page-title">
          <MapPin size={24} />
          <h1>全局轨迹地图</h1>
        </div>
        <StatsSummary routes={routes} loading={loading} />
      </div>

      <div className="map-toolbar">
        <div className="map-controls">
          <button
            className={`btn btn-sm ${showFilterPanel ? 'btn-primary' : 'btn-outline'}`}
            onClick={() => setShowFilterPanel(!showFilterPanel)}
          >
            <Filter size={16} />
            筛选面板
          </button>
          <button
            className={`btn btn-sm ${showRouteList ? 'btn-primary' : 'btn-outline'}`}
            onClick={() => setShowRouteList(!showRouteList)}
          >
            <List size={16} />
            路线列表
          </button>
          <button
            className={`btn btn-sm ${showHeatmap ? 'btn-primary' : 'btn-outline'}`}
            onClick={() => setShowHeatmap(!showHeatmap)}
          >
            <Layers size={16} />
            热力图
          </button>
          {showHeatmap && (
            <select
              className="input input-sm"
              value={heatmapIntensity}
              onChange={(e) => setHeatmapIntensity(e.target.value)}
              style={{ width: 'auto' }}
            >
              <option value="low">低密度</option>
              <option value="medium">中密度</option>
              <option value="high">高密度</option>
            </select>
          )}
          <select
            className="input input-sm"
            value={mapType}
            onChange={(e) => setMapType(e.target.value)}
            style={{ width: 'auto' }}
          >
            <option value="standard">标准地图</option>
            <option value="satellite">卫星图</option>
          </select>
        </div>
      </div>

      <div className="map-content-wrapper">
        {/* Filter Panel */}
        <AnimatePresence>
          {showFilterPanel && (
            <FilterPanel
              filters={filters}
              onFilterChange={setFilters}
              onApply={loadRoutes}
              onReset={handleResetFilters}
              users={users}
              loading={loading}
            />
          )}
        </AnimatePresence>

        <div className="map-container">
          <div className="map-wrapper">
            <MapContainer
              center={[39.9, 116.4]}
              zoom={11}
              style={{ width: '100%', height: '100%' }}
              ref={mapRef}
            >
              <MapResizeHandler
                dependencies={[
                  routes.length,
                  showRouteList,
                  showFilterPanel,
                  mapType,
                ]}
              />
              <TileLayer
                url={tileUrl}
                attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
              />

              <MapController
                routes={routes}
                selectedRoute={selectedRoute}
                autoFit={autoFit}
              />

              {/* Show heatmap layer for aggregated view */}
              {showHeatmap && !selectedRoute && (
                <HeatmapLayer routes={routes} intensity={heatmapIntensity} />
              )}

              {/* Show all routes or selected route */}
              {selectedRoute ? (
                <>
                  <SpeedGradientPolyline points={selectedRoute.points || []} />

                  {/* Playback marker */}
                  {selectedRoute.points && playbackPosition < selectedRoute.points.length && (
                    <CircleMarker
                      center={(() => {
                        const p = selectedRoute.points[playbackPosition];
                        const converted = gcj02ToWgs84(p.latitude, p.longitude);
                        return [converted.latitude, converted.longitude];
                      })()}
                      radius={10}
                      fillColor="#FF4D4F"
                      fillOpacity={1}
                      color="#FFF"
                      weight={3}
                    >
                      <Popup>
                        <div>
                          <div>时间: {new Date(selectedRoute.points[playbackPosition].timestamp).toLocaleTimeString()}</div>
                          <div>速度: {(selectedRoute.points[playbackPosition].speed || 0).toFixed(1)} km/h</div>
                        </div>
                      </Popup>
                    </CircleMarker>
                  )}

                  {/* Start marker */}
                  {selectedRoute.points?.length > 0 && (
                    <CircleMarker
                      center={(() => {
                        const p = selectedRoute.points[0];
                        const converted = gcj02ToWgs84(p.latitude, p.longitude);
                        return [converted.latitude, converted.longitude];
                      })()}
                      radius={8}
                      fillColor="#52C41A"
                      fillOpacity={1}
                      color="#FFF"
                      weight={2}
                    >
                      <Popup>起点</Popup>
                    </CircleMarker>
                  )}

                  {/* End marker */}
                  {selectedRoute.points?.length > 1 && (
                    <CircleMarker
                      center={(() => {
                        const p = selectedRoute.points[selectedRoute.points.length - 1];
                        const converted = gcj02ToWgs84(p.latitude, p.longitude);
                        return [converted.latitude, converted.longitude];
                      })()}
                      radius={8}
                      fillColor="#FF4D4F"
                      fillOpacity={1}
                      color="#FFF"
                      weight={2}
                    >
                      <Popup>终点</Popup>
                    </CircleMarker>
                  )}
                </>
              ) : (
                routes.map((route) => {
                  if (!route.points || route.points.length < 2) return null;
                  const positions = route.points.map((p) => {
                    const converted = gcj02ToWgs84(p.latitude, p.longitude);
                    return [converted.latitude, converted.longitude];
                  });
                  const routeColor = route.purpose
                    ? PURPOSE_COLORS[route.purpose] || '#4A90E2'
                    : '#4A90E2';
                  return (
                    <Polyline
                      key={route.id}
                      positions={positions}
                      color={routeColor}
                      weight={3}
                      opacity={0.6}
                      eventHandlers={{
                        click: () => handleRouteSelect(route),
                      }}
                    />
                  );
                })
              )}
            </MapContainer>

            {/* Loading Overlay */}
            {loading && (
              <div className="map-loading-overlay">
                <div className="map-loading-spinner">
                  <Activity size={32} className="animate-spin" />
                  <span>加载轨迹数据...</span>
                </div>
              </div>
            )}
          </div>

          {/* Route List Panel */}
          <AnimatePresence>
            {showRouteList && (
              <motion.div
                className="route-list-panel"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 20 }}
              >
                <div className="route-list-header">
                  <span className="route-list-title">
                    路线列表
                    <span className="route-count">{routes.length}</span>
                  </span>
                  <button
                    className="btn btn-ghost btn-icon"
                    onClick={() => setShowRouteList(false)}
                  >
                    <X size={18} />
                  </button>
                </div>
                <div className="route-list-content">
                  {loading ? (
                    Array.from({ length: 5 }).map((_, i) => (
                      <div key={i} className="skeleton" style={{ height: '80px', marginBottom: '8px' }} />
                    ))
                  ) : routes.length === 0 ? (
                    <div className="empty-state p-4">
                      <div className="text-gray-500">暂无匹配的轨迹数据</div>
                      <button className="btn btn-sm btn-outline mt-2" onClick={handleResetFilters}>
                        重置筛选条件
                      </button>
                    </div>
                  ) : (
                    routes.map((route) => (
                      <motion.div
                        key={route.id}
                        className={`route-item ${selectedRoute?.id === route.id ? 'selected' : ''}`}
                        onClick={() => handleRouteSelect(route)}
                        whileHover={{ scale: 1.02 }}
                        whileTap={{ scale: 0.98 }}
                      >
                        <div className="route-item-header">
                          <span className="route-item-title">
                            {route.title || '未命名路线'}
                          </span>
                          <span className="route-item-user">
                            用户 #{route.user_id || route.userId}
                          </span>
                        </div>
                        <div className="route-item-date">
                          {route.start_time || route.startTime
                            ? new Date(route.start_time || route.startTime).toLocaleDateString('zh-CN')
                            : ''}
                        </div>
                        <div className="route-item-stats">
                          <div className="route-stat">
                            <span>{formatDistance(route.stats?.distance_meters || route.distance || 0)}</span>
                          </div>
                          <div className="route-stat">
                            <span>{formatDuration(route.stats?.duration_seconds || route.duration || 0)}</span>
                          </div>
                          {(route.purpose || route.trip_purpose) && (
                            <div
                              className="route-purpose-badge"
                              style={{
                                background: PURPOSE_COLORS[route.purpose || route.trip_purpose] || '#8C8C8C',
                              }}
                            >
                              {PURPOSE_LABELS[route.purpose || route.trip_purpose] || '其他'}
                            </div>
                          )}
                        </div>
                      </motion.div>
                    ))
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Playback Controls */}
          {selectedRoute && (
            <motion.div
              className="playback-controls"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
            >
              <button className="playback-btn" onClick={skipBackward} title="后退">
                <SkipBack size={18} />
              </button>
              <button className="playback-btn" onClick={togglePlayback} title={isPlaying ? '暂停' : '播放'}>
                {isPlaying ? <Pause size={20} /> : <Play size={20} />}
              </button>
              <button className="playback-btn" onClick={skipForward} title="前进">
                <SkipForward size={18} />
              </button>
              <input
                type="range"
                className="playback-slider"
                min={0}
                max={selectedRoute.points?.length - 1 || 0}
                value={playbackPosition}
                onChange={(e) => setPlaybackPosition(parseInt(e.target.value, 10))}
              />
              <div className="speed-control">
                <span>速度:</span>
                <select
                  value={playbackSpeed}
                  onChange={(e) => setPlaybackSpeed(parseFloat(e.target.value))}
                  style={{ border: 'none', background: 'transparent' }}
                >
                  <option value={0.5}>0.5x</option>
                  <option value={1}>1x</option>
                  <option value={2}>2x</option>
                  <option value={4}>4x</option>
                </select>
              </div>
              <button
                className="btn btn-ghost btn-icon"
                onClick={() => {
                  setSelectedRoute(null);
                  setAutoFit(true);
                }}
                title="取消选择"
              >
                <X size={18} />
              </button>
            </motion.div>
          )}
        </div>
      </div>
    </div>
  );
}
