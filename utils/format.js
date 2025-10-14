function formatDistance(distance) {
  if (!distance || distance <= 0) {
    return '0 m';
  }
  if (distance >= 1000) {
    return `${(distance / 1000).toFixed(2)} km`;
  }
  return `${Math.round(distance)} m`;
}

function formatSpeed(speed) {
  if (!speed || speed <= 0) {
    return '0 m/s';
  }
  if (speed >= 3) {
    return `${speed.toFixed(2)} m/s`;
  }
  const paceSeconds = speed ? 1000 / speed : 0;
  const minutes = Math.floor(paceSeconds / 60);
  const seconds = Math.round(paceSeconds % 60);
  return `${minutes}'${seconds < 10 ? `0${seconds}` : seconds}"`;
}

function formatCalories(calories) {
  if (!calories || calories <= 0) {
    return '0 kcal';
  }
  return `${calories} kcal`;
}

module.exports = {
  formatDistance,
  formatSpeed,
  formatCalories,
};
