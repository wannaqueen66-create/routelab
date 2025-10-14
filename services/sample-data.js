const { storeRoute, createRoutePayload, getRoutes } = require('./route-store');
const { buildCampusDisplayName, normalizeSelection } = require('../constants/campus');

function buildRoute(baseTime, coordinates, meta) {
  const points = coordinates.map((coord, index) => ({
    latitude: coord[0],
    longitude: coord[1],
    speed: 1.8,
    accuracy: 5,
    timestamp: baseTime + index * 6 * 60 * 1000,
  }));
  return {
    ...meta,
    startTime: points[0].timestamp,
    endTime: points[points.length - 1].timestamp,
    points,
  };
}

function withCampusMeta(meta) {
  const selection = normalizeSelection(meta.campusMeta);
  return {
    ...meta,
    campusMeta: selection,
    campusZone: buildCampusDisplayName(selection),
  };
}

function generateSampleRoutes() {
  const now = Date.now();
  return [
    buildRoute(now - 2 * 24 * 60 * 60 * 1000, [
      [30.2736, 120.1549],
      [30.2739, 120.1558],
      [30.2745, 120.1564],
      [30.2750, 120.1555],
      [30.2741, 120.1548],
    ], withCampusMeta({
      title: 'Sunrise Track Walk',
      campusMeta: { category: '运动场', area: '东区', location: '东区田径场' },
      privacyLevel: 'public',
      note: 'Easy morning walk with friends, clear sky.',
      activityType: 'walk',
      weight: 60,
    })),
    buildRoute(now - 24 * 60 * 60 * 1000, [
      [30.2748, 120.1552],
      [30.2752, 120.1561],
      [30.2746, 120.1568],
      [30.2739, 120.1559],
      [30.2743, 120.1552],
    ], withCampusMeta({
      title: 'Library Coffee Ride',
      campusMeta: { category: '其他', area: '公共设施', location: '图书馆' },
      privacyLevel: 'group',
      note: 'Cycling to the library for a quick coffee break.',
      activityType: 'ride',
      weight: 65,
    })),
    buildRoute(now - 60 * 60 * 1000, [
      [30.2725, 120.1532],
      [30.2731, 120.1540],
      [30.2738, 120.1549],
      [30.2745, 120.1557],
      [30.2751, 120.1565],
    ], withCampusMeta({
      title: 'Dorm to Lab Walk',
      campusMeta: { category: '宿舍区', area: '东区', location: '东二' },
      privacyLevel: 'private',
      note: 'Heading to the robotics lab with teammates.',
      activityType: 'walk',
      weight: 58,
    })),
  ];
}

function ensureSeedRoutes() {
  const existing = getRoutes();
  if (existing.length) {
    return;
  }
  const samples = generateSampleRoutes();
  samples.forEach((sample) => {
    const payload = createRoutePayload({
      points: sample.points,
      title: sample.title,
      startTime: sample.startTime,
      endTime: sample.endTime,
      privacyLevel: sample.privacyLevel,
      note: sample.note,
      campusZone: sample.campusZone,
      campusMeta: sample.campusMeta,
      activityType: sample.activityType,
      weight: sample.weight,
    });
    storeRoute(payload);
  });
}

module.exports = {
  ensureSeedRoutes,
};