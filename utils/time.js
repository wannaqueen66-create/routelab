function pad(value) {
  return value < 10 ? `0${value}` : `${value}`;
}

function formatDuration(durationMs) {
  if (!durationMs || durationMs <= 0) {
    return '00:00';
  }
  const totalSeconds = Math.floor(durationMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
  }
  return `${pad(minutes)}:${pad(seconds)}`;
}

function formatClock(timestamp) {
  const date = new Date(timestamp);
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function formatDate(timestamp) {
  const date = new Date(timestamp);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function getWeekday(timestamp) {
  const date = new Date(timestamp);
  const day = date.getDay();
  return ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][day];
}

module.exports = {
  formatDuration,
  formatClock,
  formatDate,
  getWeekday,
};
