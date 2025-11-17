import { useEffect, useMemo } from 'react';
import {
  CircleMarker,
  MapContainer,
  Marker,
  Polyline,
  Popup,
  TileLayer,
  Tooltip,
  useMap,
} from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { gcj02ToWgs84 } from '../utils/coord.js';

// Fix Leaflet default icon loading in bundlers
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

const COLORS = ['#0ea5e9', '#10b981', '#6366f1', '#f97316', '#ec4899'];

const SEGMENT_STYLE_MAP = {
  foreground: (color) => ({
    color,
    weight: 4,
    opacity: 0.95,
  }),
  background: () => ({
    color: '#3b82f6',
    weight: 2.5,
    opacity: 0.7,
    dashArray: '2 6',
  }),
  screen_off: () => ({
    color: '#475569',
    weight: 3,
    opacity: 0.65,
    dashArray: '6 8',
  }),
  weak_signal: () => ({
    color: '#a855f7',
    weight: 3,
    opacity: 0.6,
    dashArray: '4 4',
  }),
  interp: () => ({
    color: '#f97316',
    weight: 4,
    opacity: 0.75,
    dashArray: '12 6',
  }),
};

function getSegmentType(prev, curr) {
  if (prev.source === 'interp' || curr.source === 'interp') {
    return 'interp';
  }
  const prevDetail = prev.sourceDetail;
  const currDetail = curr.sourceDetail;
  const details = [prevDetail, currDetail].filter(Boolean);
  if (details.includes('screen_off')) {
    return 'screen_off';
  }
  if (details.includes('background')) {
    return 'background';
  }
  if (details.includes('weak_signal')) {
    return 'weak_signal';
  }
  return 'foreground';
}

function getSegmentOptions(type, baseColor) {
  const factory = SEGMENT_STYLE_MAP[type] || SEGMENT_STYLE_MAP.foreground;
  return factory(type === 'foreground' ? baseColor : undefined);
}

function getPointVisual(point) {
  if (point.source === 'interp') {
    return { color: '#f97316', fillColor: '#fb923c' };
  }
  if (point.sourceDetail === 'screen_off') {
    return { color: '#475569', fillColor: '#94a3b8' };
  }
  if (point.sourceDetail === 'background') {
    return { color: '#2563eb', fillColor: '#60a5fa' };
  }
  if (point.sourceDetail === 'weak_signal') {
    return { color: '#a855f7', fillColor: '#c084fc' };
  }
  return { color: '#0ea5e9', fillColor: '#38bdf8' };
}

function toLatLng(point) {
  if (!point) {
    return null;
  }
  const { latitude, longitude } = point;
  if (latitude === undefined || longitude === undefined) {
    return null;
  }
  const converted = gcj02ToWgs84(latitude, longitude);
  if (!Number.isFinite(converted.latitude) || !Number.isFinite(converted.longitude)) {
    return null;
  }
  return [converted.latitude, converted.longitude];
}

function buildSegments(route, color) {
  const points =
    route?.points?.map((point) => ({
      latlng: toLatLng(point),
      source: point?.source === 'interp' ? 'interp' : 'gps',
      sourceDetail: point?.source_detail || point?.sourceDetail || null,
    })) || [];

  const valid = points.filter((point) => point.latlng);
  if (valid.length < 2) {
    return [];
  }

  const segments = [];
  let current = null;

  for (let index = 1; index < valid.length; index += 1) {
    const prev = valid[index - 1];
    const curr = valid[index];
    const type = getSegmentType(prev, curr);

    if (!current || current.type !== type) {
      current = {
        type,
        positions: [prev.latlng, curr.latlng],
      };
      segments.push(current);
    } else {
      current.positions.push(curr.latlng);
    }
  }

  return segments
    .filter((segment) => segment.positions.length > 1)
    .map((segment, index) => ({
      id: `${route.id}-${segment.type}-${index}`,
      routeId: route.id,
      positions: segment.positions,
      options: getSegmentOptions(segment.type, color),
    }));
}

function extractPausePoints(route) {
  const candidates =
    route?.pausePoints ||
    route?.meta?.pausePoints ||
    route?.meta?.pause_points ||
    [];
  if (!Array.isArray(candidates)) {
    return [];
  }
  return candidates
    .map((item) => ({
      latitude: Number(item.latitude),
      longitude: Number(item.longitude),
      timestamp:
        typeof item.timestamp === 'number' && Number.isFinite(item.timestamp)
          ? Number(item.timestamp)
          : null,
      reason: item.reason || item.pauseReason || null,
    }))
    .filter(
      (item) =>
        Number.isFinite(item.latitude) &&
        Number.isFinite(item.longitude) &&
        item.timestamp !== null
    );
}

function buildPauseReasonResolver(route) {
  if (!route) {
    return () => null;
  }
  const pauses = extractPausePoints(route);
  if (!pauses.length) {
    return () => null;
  }
  return (point) => {
    if (!point?.timestamp) {
      return null;
    }
    let best = null;
    let smallestDiff = Infinity;
    pauses.forEach((pause) => {
      const diff = Math.abs(pause.timestamp - point.timestamp);
      if (diff <= 15000 && diff < smallestDiff) {
        smallestDiff = diff;
        best = pause;
      }
    });
    return best?.reason || null;
  };
}

function pickRoutePoints(route, pauseResolver) {
  if (!route || !Array.isArray(route.points)) {
    return [];
  }
  return route.points
    .map((point) => {
      const latlng = toLatLng(point);
      if (!latlng) {
        return null;
      }
      const source = point.source || 'gps';
      const sourceDetail = point.source_detail || point.sourceDetail || null;
      return {
        latlng,
        timestamp: point.timestamp || point.recordedAt || null,
        source,
        sourceDetail,
        interpMethod: point.interp_method || point.interpMethod || null,
        pauseReason: pauseResolver ? pauseResolver(point) : null,
      };
    })
    .filter(Boolean);
}

function FitBounds({ polylines, enabled }) {
  const map = useMap();

  useEffect(() => {
    if (!enabled || !map) {
      return;
    }
    const allPositions = polylines.flatMap((line) => line.positions);
    if (!allPositions.length) {
      return;
    }
    const bounds = L.latLngBounds(allPositions);
    map.fitBounds(bounds.pad(0.08), { animate: true });
  }, [enabled, map, polylines]);

  return null;
}

export default function MapView({
  routes,
  loading,
  selectedRouteId = null,
  onRouteClick,
  showRouteMarkers = true,
  showRoutePoints = false,
}) {
  const polylines = useMemo(() => {
    return routes.flatMap((route, index) =>
      buildSegments(route, COLORS[index % COLORS.length])
    );
  }, [routes]);

  const selectedRoute = useMemo(() => {
    if (!selectedRouteId) {
      return null;
    }
    return routes.find((route) => route.id === selectedRouteId) || null;
  }, [routes, selectedRouteId]);

  const pauseResolver = useMemo(() => buildPauseReasonResolver(selectedRoute), [selectedRoute]);

  const selectedPoints = useMemo(() => {
    if (!selectedRoute) {
      return [];
    }
    const points = pickRoutePoints(selectedRoute, pauseResolver);
    const limit = points.length > 400 ? 400 : points.length;
    return points.slice(0, limit);
  }, [pauseResolver, selectedRoute]);

  const center = useMemo(() => {
    if (selectedRoute) {
      const firstPoint = pickRoutePoints(selectedRoute, pauseResolver)[0];
      if (firstPoint) {
        return firstPoint.latlng;
      }
    }
    if (polylines.length) {
      return polylines[0].positions[0];
    }
    return [31.2304, 121.4737];
  }, [pauseResolver, polylines, selectedRoute]);

  if (!routes.length && !loading) {
    return <div className="map-container">暂无轨迹数据</div>;
  }

  return (
    <MapContainer center={center} zoom={13} className="map-container" scrollWheelZoom>
      <FitBounds polylines={polylines} enabled={routes.length > 0} />
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/">OpenStreetMap</a> contributors'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      {polylines.map((line) => {
        const selected = selectedRouteId && line.routeId === selectedRouteId;
        const baseOptions = line.options || {};
        const pathOptions = selected
          ? {
              ...baseOptions,
              weight: (baseOptions.weight || 4) + 1,
              opacity: 1,
              color: baseOptions.color || '#10b981',
            }
          : baseOptions;
        const eventHandlers = onRouteClick
          ? {
              click: () => onRouteClick(line.routeId),
            }
          : undefined;
        return (
          <Polyline
            key={line.id}
            pathOptions={pathOptions}
            positions={line.positions}
            eventHandlers={eventHandlers}
          >
            {onRouteClick ? <Tooltip direction="top">点击查看详情</Tooltip> : null}
          </Polyline>
        );
      })}
      {showRouteMarkers && selectedRoute && selectedPoints.length > 0 ? (
        <>
          <Marker position={selectedPoints[0].latlng}>
            <Popup>
              <div>
                <strong>起点</strong>
                <div>
                  时间：
                  {selectedRoute.startTime
                    ? new Date(selectedRoute.startTime).toLocaleString()
                    : '未知'}
                </div>
              </div>
            </Popup>
          </Marker>
          <Marker position={selectedPoints[selectedPoints.length - 1].latlng}>
            <Popup>
              <div>
                <strong>终点</strong>
                <div>
                  时间：
                  {selectedRoute.endTime
                    ? new Date(selectedRoute.endTime).toLocaleString()
                    : '未知'}
                </div>
              </div>
            </Popup>
          </Marker>
        </>
      ) : null}
      {showRoutePoints && selectedPoints.length
        ? selectedPoints.map((point, index) => {
            const visual = getPointVisual(point);
            return (
              <CircleMarker
                key={`point-${index}`}
                center={point.latlng}
                radius={3.4}
                pathOptions={{
                  ...visual,
                  weight: 1.5,
                  opacity: 0.9,
                  fillOpacity: 0.85,
                }}
              >
                <Tooltip direction="top">
                  <div style={{ fontSize: 12 }}>
                    <div>
                      时间：{point.timestamp ? new Date(point.timestamp).toLocaleString() : '未知'}
                    </div>
                    <div>source：{point.source || 'gps'}</div>
                    <div>source_detail：{point.sourceDetail || '无'}</div>
                    <div>interp_method：{point.interpMethod || '无'}</div>
                    <div>pause：{point.pauseReason || '无'}</div>
                  </div>
                </Tooltip>
              </CircleMarker>
            );
          })
        : null}
    </MapContainer>
  );
}
