const baseConfig = {
  apiBaseUrl: 'https://routelab.qzz.io/api',
  api: {
    baseUrl: 'https://routelab.qzz.io/api',
    // 适当放宽超时时间，提升弱网环境下的稳定性
    timeout: 20000,
    // 云端请求失败时的额外重试次数（总尝试次数 = retries + 1）
    retries: 2,
    token: '',
    // 最终上传路径会被拼接为 `${api.baseUrl}/upload`，即 `/api/upload`
    uploadEndpoint: '/upload',
    staticBase: 'https://routelab.qzz.io/static/uploads',
  },
  env: 'prod',
  logs: {
    directory: 'miniprogramLogs',
    file: 'rlab.log',
    maxSizeKB: 512,
  },
  map: {
    // 不在仓库中提交真实 key，请在 config/saaa-config.local.js 中覆盖
    amapWebKey: '',
    // Custom UA for Nominatim (required by usage policy)
    nominatimUserAgent: 'RouteLab-MP/1.0 (+https://routelab.qzz.io)',
  },
  survey: {
    enabled: true,
    title: '开始记录前问卷',
    url: 'https://www.powercx.com/r/kjzqe',
    version: 'powercx-kjzqe-v1',
  },
};

function isPlainObject(value) {
  return Object.prototype.toString.call(value) === '[object Object]';
}

function deepMerge(target, source) {
  const output = { ...target };
  if (!isPlainObject(source)) {
    return output;
  }
  Object.keys(source).forEach((key) => {
    const sourceValue = source[key];
    const targetValue = output[key];
    if (isPlainObject(targetValue) && isPlainObject(sourceValue)) {
      output[key] = deepMerge(targetValue, sourceValue);
      return;
    }
    output[key] = sourceValue;
  });
  return output;
}

let localOverride = {};
try {
  // 本地私有覆盖配置（不提交到仓库）
  // eslint-disable-next-line global-require, import/no-unresolved
  localOverride = require('./saaa-config.local');
} catch (_) {
  localOverride = {};
}

module.exports = deepMerge(baseConfig, localOverride);
