module.exports = {
  apiBaseUrl: 'https://routelab.qzz.io/api',
  api: {
    baseUrl: 'https://routelab.qzz.io/api',
    // 适当放宽超时时间，提升弱网环境下的稳定性
    timeout: 20000,
    // 云端请求失败时的额外重试次数（总尝试次数 = retries + 1）
    // 这里设置为 2，可在暂时性网络波动/5xx 时自动多试几次
    retries: 2,
    token: '',
    uploadEndpoint: '/photos',
    staticBase: 'https://routelab.qzz.io/static/uploads',
  },
  env: 'prod',
  logs: {
    directory: 'miniprogramLogs',
    file: 'rlab.log',
    maxSizeKB: 512,
  },
  map: {
    // Set your AMap Web Service key here (GCJ-02 native)
    amapWebKey: '2e02139ccd72b88fa3804a058d1dbaf3',
    // Custom UA for Nominatim (required by usage policy)
    nominatimUserAgent: 'RouteLab-MP/1.0 (+https://routelab.qzz.io)',
  },
};
