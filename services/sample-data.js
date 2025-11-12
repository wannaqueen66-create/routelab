const { storeRoute, createRoutePayload, getRoutes } = require('./route-store');

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

function generateSampleRoutes() {
  const now = Date.now();
  return [
    buildRoute(
      now - 2 * 24 * 60 * 60 * 1000,
      [
        [30.2736, 120.1549],
        [30.2739, 120.1558],
        [30.2745, 120.1564],
        [30.275, 120.1555],
        [30.2741, 120.1548],
      ],
      {
        title: 'Sunrise Track Walk',
        startLabel: '东区操场',
        endLabel: '东区操场',
        privacyLevel: 'public',
        note: '晴朗的清晨慢走热身。',
        activityType: 'walk',
        weight: 60,
      }
    ),
    buildRoute(
      now - 24 * 60 * 60 * 1000,
      [
        [30.2748, 120.1552],
        [30.2752, 120.1561],
        [30.2746, 120.1568],
        [30.2739, 120.1559],
        [30.2743, 120.1552],
      ],
      {
        title: 'Library Coffee Ride',
        startLabel: '图书馆西门',
        endLabel: '校园咖啡角',
        privacyLevel: 'public',
        note: '骑车去图书馆喝一杯咖啡。',
        activityType: 'ride',
        weight: 65,
      }
    ),
    buildRoute(
      now - 60 * 60 * 1000,
      [
        [30.2725, 120.1532],
        [30.2731, 120.154],
        [30.2738, 120.1549],
        [30.2745, 120.1557],
        [30.2751, 120.1565],
      ],
      {
        title: 'Dorm to Lab Walk',
        startLabel: '东二宿舍',
        endLabel: '机器人实验室',
        privacyLevel: 'private',
        note: '和队友一起去实验室准备比赛。',
        activityType: 'walk',
        weight: 58,
      }
    ),
  ];
}

function ensureSeedRoutes() {
  const existing = getRoutes();
  if (existing.length) {
    return;
  }
  const startLocation = (label) => (label ? { name: label, displayName: label, address: null, raw: null } : null);
  const samples = generateSampleRoutes();
  samples.forEach((sample) => {
    const payload = createRoutePayload({
      points: sample.points,
      title: sample.title,
      startTime: sample.startTime,
      endTime: sample.endTime,
      privacyLevel: sample.privacyLevel,
      note: sample.note,
      activityType: sample.activityType,
      weight: sample.weight,
      startLabel: sample.startLabel,
      endLabel: sample.endLabel,
      startLocation: startLocation(sample.startLabel),
      endLocation: startLocation(sample.endLabel),
    });
    storeRoute(payload);
  });
}

module.exports = {
  ensureSeedRoutes,
};
