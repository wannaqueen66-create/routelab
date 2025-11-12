function toBeaufort(mps) {
  const v = Number(mps);
  if (!Number.isFinite(v) || v < 0) {
    return { scale: null, name: '', label: '' };
  }
  // Beaufort thresholds in m/s
  const thresholds = [
    0.2, // 0
    1.5, // 1
    3.3, // 2
    5.4, // 3
    7.9, // 4
    10.7, // 5
    13.8, // 6
    17.1, // 7
    20.7, // 8
    24.4, // 9
    28.4, // 10
    32.6, // 11
    Infinity, // 12+
  ];
  const names = [
    '无风', // 0
    '软风', // 1
    '轻风', // 2
    '微风', // 3
    '和风', // 4
    '清劲风', // 5
    '强风', // 6
    '疾风', // 7
    '大风', // 8
    '烈风', // 9
    '狂风', // 10
    '暴风', // 11
    '飓风', // 12
  ];
  let scale = 0;
  for (let i = 0; i < thresholds.length; i += 1) {
    if (v <= thresholds[i]) {
      scale = i;
      break;
    }
  }
  const name = names[scale] || '';
  const label = `${scale} 级${name}`;
  return { scale, name, label };
}

function formatWind(mps) {
  const v = Number(mps);
  if (!Number.isFinite(v) || v < 0) {
    return '--';
  }
  const { label } = toBeaufort(v);
  return `${v.toFixed(1)} m/s（${label}）`;
}

module.exports = {
  toBeaufort,
  formatWind,
};

