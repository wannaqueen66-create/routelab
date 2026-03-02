const { EARTH_RADIUS } = require('../config/constants');

function toRadians(value) {
    return (value * Math.PI) / 180;
}

function calculateSegmentDistanceMeters(startPoint, endPoint) {
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

function calculateTotalDistanceMeters(points = []) {
    if (!Array.isArray(points) || points.length < 2) {
        return 0;
    }
    let total = 0;
    for (let index = 1; index < points.length; index += 1) {
        total += calculateSegmentDistanceMeters(points[index - 1], points[index]);
    }
    return total;
}

module.exports = {
    toRadians,
    calculateSegmentDistanceMeters,
    calculateTotalDistanceMeters
};
