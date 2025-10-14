const EARTH_RADIUS = 6371000; // meters

function toRadians(value) {
  return (value * Math.PI) / 180;
}

function calculateSegmentDistance(startPoint, endPoint) {
  if (!(startPoint && endPoint)) {
    return 0;
  }
  const startLat = toRadians(startPoint.latitude);
  const endLat = toRadians(endPoint.latitude);
  const deltaLat = toRadians(endPoint.latitude - startPoint.latitude);
  const deltaLng = toRadians(endPoint.longitude - startPoint.longitude);

  const a =
    Math.sin(deltaLat / 2) * Math.sin(deltaLat / 2) +
    Math.cos(startLat) * Math.cos(endLat) * Math.sin(deltaLng / 2) * Math.sin(deltaLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return Number((EARTH_RADIUS * c).toFixed(2));
}

function calculateTotalDistance(points = []) {
  if (!Array.isArray(points) || points.length < 2) {
    return 0;
  }
  return points.reduce((total, point, index) => {
    if (index === 0) {
      return total;
    }
    return total + calculateSegmentDistance(points[index - 1], point);
  }, 0);
}

function calculateBoundingBox(points = []) {
  if (!points.length) {
    return null;
  }
  let minLat = points[0].latitude;
  let maxLat = points[0].latitude;
  let minLng = points[0].longitude;
  let maxLng = points[0].longitude;
  points.forEach((point) => {
    minLat = Math.min(minLat, point.latitude);
    maxLat = Math.max(maxLat, point.latitude);
    minLng = Math.min(minLng, point.longitude);
    maxLng = Math.max(maxLng, point.longitude);
  });
  return {
    southwest: { latitude: minLat, longitude: minLng },
    northeast: { latitude: maxLat, longitude: maxLng },
  };
}

function estimateCalories(distanceInMeters, weightKg = 60, activityType = 'walk') {
  // Rough estimation based on average energy cost per km.
  const distanceKm = distanceInMeters / 1000;
  let factorPerKm = 0.75; // brisk walk / jog baseline
  if (activityType === 'ride') {
    factorPerKm = 0.45; // moderate cycling ~4.5 MET
  }
  const kcal = distanceKm * weightKg * factorPerKm;
  return Math.round(kcal);
}

module.exports = {
  calculateSegmentDistance,
  calculateTotalDistance,
  calculateBoundingBox,
  estimateCalories,
};
