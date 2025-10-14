function generateRouteId() {
  const random = Math.random().toString(16).slice(2, 10);
  return `rt_${Date.now().toString(16)}_${random}`;
}

module.exports = {
  generateRouteId,
};
