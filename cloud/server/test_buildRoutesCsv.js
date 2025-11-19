const fs = require('fs');

function serializeCsvValue(value) {
  if (value === null || value === undefined) {
    return '';
  }
  if (typeof value === 'object') {
    const json = JSON.stringify(value);
    return `"${json.replace(/"/g, '""')}"`;
  }
  const str = String(value);
  if (/[",\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function buildRoutesCsv(items = []) {
  const headers = [
    'id',
    'userId',
    'title',
    'startTime',
    'endTime',
    'distance',
    'duration',
    'calories',
    'pointCount',
    'purposeType',
    'privacyLevel',
    'createdAt',
    'updatedAt',
    'deletedAt',
    'points',
  ];
  const lines = [headers.join(',')];
  items.forEach((route) => {
    const statSummary = route.statSummary || {};
    let pointsCell = '';
    if (Array.isArray(route.points) && route.points.length) {
      pointsCell = route.points
        .map((point) => {
          const lat = Number(point.latitude);
          const lon = Number(point.longitude);
          if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
            return null;
          }
          return `${lon},${lat}`;
        })
        .filter(Boolean)
        .join(' ; ');
    }
    const line = [
      route.id,
      route.ownerId ?? route.userId ?? null,
      route.title,
      route.startTime ? new Date(route.startTime).toISOString() : '',
      route.endTime ? new Date(route.endTime).toISOString() : '',
      statSummary.distance ?? route.stats?.distance ?? null,
      statSummary.duration ?? route.stats?.duration ?? null,
      statSummary.calories ?? route.stats?.calories ?? null,
      route.pointCount ?? (Array.isArray(route.points) ? route.points.length : null),
      route.purposeType ?? route.meta?.purposeType ?? null,
      route.privacyLevel,
      route.createdAt ? new Date(route.createdAt).toISOString() : '',
      route.updatedAt ? new Date(route.updatedAt).toISOString() : '',
      route.deletedAt ? new Date(route.deletedAt).toISOString() : '',
      pointsCell,
    ].map(serializeCsvValue);
    lines.push(line.join(','));
  });
  return lines.join('\n');
}

const now = Date.now();
const routes = [
  {
    id: 'rt_1',
    ownerId: 24,
    title: '有结束时间',
    startTime: now - 20000,
    endTime: now - 10000,
    stats: { distance: 0, duration: 12.322, calories: 0 },
    pointCount: 1,
    points: [{ longitude: 113.4057, latitude: 23.12345 }],
    purposeType: 'walk',
    privacyLevel: 'public',
    createdAt: now - 5000,
    updatedAt: now - 3000,
    deletedAt: null,
  },
  {
    id: 'rt_2',
    ownerId: 10,
    title: '无结束时间',
    startTime: now - 40000,
    endTime: null,
    stats: { distance: 491.08, duration: 455.44, calories: 22 },
    pointCount: 41,
    points: [
      { longitude: 113.34285, latitude: 23.11111 },
      { longitude: 113.34290, latitude: 23.11122 },
    ],
    purposeType: 'walk',
    privacyLevel: 'public',
    createdAt: now - 6000,
    updatedAt: now - 1000,
    deletedAt: null,
  },
];

const csv = buildRoutesCsv(routes);
fs.writeFileSync('test_routes_export.csv', csv, 'utf8');
console.log(csv);

