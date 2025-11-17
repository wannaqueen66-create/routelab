export function formatDistance(distance) {
  const value = Number(distance);
  if (!Number.isFinite(value) || value <= 0) return '0 km';
  if (value >= 1000) {
    return `${(value / 1000).toFixed(2)} km`;
  }
  return `${value.toFixed(0)} m`;
}

export function formatDuration(duration) {
  const value = Number(duration);
  if (!Number.isFinite(value) || value <= 0) return '0s';
  const seconds = Math.round(value);
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

export function formatDateTime(timestamp) {
  if (!timestamp) return '-';
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleString();
}
