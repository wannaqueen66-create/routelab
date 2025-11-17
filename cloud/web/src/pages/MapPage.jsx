import { useState, useEffect, useRef } from 'react';
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
} from 'lucide-react';
import { MapContainer, TileLayer, Polyline, CircleMarker, Marker, Popup, useMap } from 'react-leaflet';
import { fetchAdminRoutes, fetchAdminRouteDetail } from '../api/client';
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

// Map controls component
function MapControls({ onZoomIn, onZoomOut, onReset }) {
  return (
    <div className="map-zoom-controls">
      <button className="map-control-btn" onClick={onZoomIn} title="放大">
        <ZoomIn size={18} />
      </button>
      <button className="map-control-btn" onClick={onZoomOut} title="缩小">
        <ZoomOut size={18} />
      </button>
      <button className="map-control-btn" onClick={onReset} title="重置视图">
        <Maximize2 size={18} />
      </button>
    </div>
  );
}

// Custom map controller
function MapController({ routes, selectedRoute, playbackPosition }) {
  const map = useMap();

  useEffect(() => {
    if (selectedRoute && selectedRoute.points?.length > 0) {
      const bounds = selectedRoute.points.map((p) => {
        const [lng, lat] = gcj02ToWgs84(p.longitude, p.latitude);
        return [lat, lng];
      });
      if (bounds.length > 0) {
        map.fitBounds(bounds, { padding: [50, 50] });
      }
    } else if (routes.length > 0) {
      const allPoints = routes.flatMap((route) =>
        (route.points || []).map((p) => {
          const [lng, lat] = gcj02ToWgs84(p.longitude, p.latitude);
          return [lat, lng];
        })
      );
      if (allPoints.length > 0) {
        map.fitBounds(allPoints, { padding: [50, 50] });
      }
    }
  }, [routes, selectedRoute, map]);

  return null;
}

// Route polyline with speed gradient
function SpeedGradientPolyline({ points }) {
  if (!points || points.length < 2) return null;

  const segments = [];
  for (let i = 0; i < points.length - 1; i++) {
    const p1 = points[i];
    const p2 = points[i + 1];
    const [lng1, lat1] = gcj02ToWgs84(p1.longitude, p1.latitude);
    const [lng2, lat2] = gcj02ToWgs84(p2.longitude, p2.latitude);

    // Calculate speed and determine color
    const speed = p1.speed || 0;
    let colorIndex = 0;
    if (speed > 15) colorIndex = 3;
    else if (speed > 10) colorIndex = 2;
    else if (speed > 5) colorIndex = 1;

    segments.push({
      positions: [[lat1, lng1], [lat2, lng2]],
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

// Heatmap layer (simplified version using circle markers)
function HeatmapLayer({ routes }) {
  if (!routes || routes.length === 0) return null;

  const points = [];
  routes.forEach((route) => {
    if (route.points) {
      // Sample every 10th point to reduce density
      for (let i = 0; i < route.points.length; i += 10) {
        const p = route.points[i];
        const [lng, lat] = gcj02ToWgs84(p.longitude, p.latitude);
        points.push([lat, lng]);
      }
    }
  });

  return (
    <>
      {points.map((point, idx) => (
        <CircleMarker
          key={idx}
          center={point}
          radius={8}
          fillColor="#FF4D4F"
          fillOpacity={0.3}
          stroke={false}
        />
      ))}
    </>
  );
}

export default function MapPage() {
  const [routes, setRoutes] = useState([]);
  const [selectedRoute, setSelectedRoute] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showRouteList, setShowRouteList] = useState(true);
  const [mapType, setMapType] = useState('standard');
  const [showHeatmap, setShowHeatmap] = useState(false);

  // Playback state
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackPosition, setPlaybackPosition] = useState(0);
  const [playbackSpeed, setPlaybackSpeed] = useState(1);
  const playbackRef = useRef(null);

  const mapRef = useRef(null);

  useEffect(() => {
    loadRoutes();
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

  const loadRoutes = async () => {
    try {
      setLoading(true);
      const data = await fetchAdminRoutes({
        limit: 50,
        include_points: true,
        sort_by: 'start_time',
        sort_order: 'desc',
      });
      setRoutes(data.routes || []);
    } catch (err) {
      console.error('Failed to load routes:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleRouteSelect = async (route) => {
    if (selectedRoute?.id === route.id) {
      setSelectedRoute(null);
      setIsPlaying(false);
      setPlaybackPosition(0);
    } else {
      try {
        const detail = await fetchAdminRouteDetail(route.id);
        setSelectedRoute(detail);
        setPlaybackPosition(0);
        setIsPlaying(false);
      } catch (err) {
        console.error('Failed to load route detail:', err);
      }
    }
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
    <div className="map-page">
      <div className="map-toolbar">
        <div className="map-controls">
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
          <select
            className="input"
            value={mapType}
            onChange={(e) => setMapType(e.target.value)}
            style={{ width: 'auto', padding: '6px 12px' }}
          >
            <option value="standard">标准地图</option>
            <option value="satellite">卫星图</option>
          </select>
        </div>
        <div className="map-stats">
          <span className="text-sm text-gray-600">
            共 <strong>{routes.length}</strong> 条轨迹
          </span>
        </div>
      </div>

      <div className="map-container">
        <div className="map-wrapper">
          <MapContainer
            center={[39.9, 116.4]}
            zoom={13}
            style={{ width: '100%', height: '100%' }}
            ref={mapRef}
          >
            <TileLayer
              url={tileUrl}
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
            />

            <MapController
              routes={routes}
              selectedRoute={selectedRoute}
              playbackPosition={playbackPosition}
            />

            {/* Show heatmap layer */}
            {showHeatmap && !selectedRoute && (
              <HeatmapLayer routes={routes} />
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
                      const [lng, lat] = gcj02ToWgs84(p.longitude, p.latitude);
                      return [lat, lng];
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
                      const [lng, lat] = gcj02ToWgs84(p.longitude, p.latitude);
                      return [lat, lng];
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
                      const [lng, lat] = gcj02ToWgs84(p.longitude, p.latitude);
                      return [lat, lng];
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
                  const [lng, lat] = gcj02ToWgs84(p.longitude, p.latitude);
                  return [lat, lng];
                });
                return (
                  <Polyline
                    key={route.id}
                    positions={positions}
                    color="#4A90E2"
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
                <span className="route-list-title">路线列表</span>
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
                    <div className="text-gray-500">暂无轨迹数据</div>
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
                        <span className="route-item-date">
                          {route.start_time
                            ? new Date(route.start_time).toLocaleDateString('zh-CN')
                            : ''}
                        </span>
                      </div>
                      <div className="route-item-stats">
                        <div className="route-stat">
                          <span>{formatDistance(route.stats?.distance_meters || 0)}</span>
                        </div>
                        <div className="route-stat">
                          <span>{formatDuration(route.stats?.duration_seconds || 0)}</span>
                        </div>
                        <div className="route-stat">
                          <span>{route.stats?.calories_kcal || 0} kcal</span>
                        </div>
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
              onClick={() => setSelectedRoute(null)}
              title="取消选择"
            >
              <X size={18} />
            </button>
          </motion.div>
        )}
      </div>
    </div>
  );
}
