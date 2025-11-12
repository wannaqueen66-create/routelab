module.exports = {
  apiBaseUrl: 'https://routelab.qzz.io/api',
  api: {
    baseUrl: 'https://routelab.qzz.io/api',
    timeout: 15000,
    retries: 1,
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
