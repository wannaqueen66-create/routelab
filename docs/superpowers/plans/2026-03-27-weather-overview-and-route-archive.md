# Weather Overview And Route Archive Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a richer homepage weather card with 4 tappable metrics and a 24-hour trend view while keeping route detail weather as a stored overview-grade archive.

**Architecture:** Keep the existing route weather snapshot flow intact, add a dedicated authenticated `/api/weather/hourly` endpoint for homepage trend data, and normalize that data in shared frontend weather helpers. Render the homepage detail chart inline with a lightweight canvas helper instead of introducing a new chart dependency or a separate weather page.

**Tech Stack:** WeChat Mini Program (WXML/WXSS/JS), Express, node:test, supertest, wx canvas API

---

## File Map

### Backend

- Modify: `cloud/server/src/services/weatherService.js`
  - Add hourly weather + air-quality timeline fetchers and normalized timeline output.
- Modify: `cloud/server/src/routes/proxy.js`
  - Add `GET /api/weather/hourly` and keep the current `/api/weather` snapshot route unchanged.
- Modify: `cloud/server/test/api-smoke.test.js`
  - Stub the weather service before route registration and add coverage for the new hourly route.

### Frontend weather data + chart helpers

- Modify: `services/api.js`
  - Add `getWeatherHourly({ latitude, longitude })`.
- Modify: `services/weather-local.js`
  - Add homepage metric-card builders, homepage detail-model builders, active-metric toggle logic, and route archive weather formatting.
- Create: `services/weather-local.test.js`
  - Add node:test coverage for weather UI formatters.
- Create: `services/weather-chart.js`
  - Convert metric-series data into canvas-friendly line coordinates and tick labels.
- Create: `services/weather-chart.test.js`
  - Add node:test coverage for chart model generation.

### Homepage UI

- Modify: `pages/index/index.js`
  - Fetch hourly data, manage active weather metric state, build detail models, and draw the inline chart.
- Modify: `pages/index/index.wxml`
  - Replace the static 3-item metric row with 4 tappable metric cards and a conditional detail block.
- Modify: `pages/index/index.wxss`
  - Add selected-state styles, detail container styles, and chart-area styling.

### Route detail archive UI

- Modify: `pages/route-detail/route-detail.js`
  - Format stored route weather snapshots into overview-grade display fields.
- Modify: `pages/route-detail/route-detail.wxml`
  - Show wind direction and air-quality summary alongside the existing stored weather values.
- Modify: `pages/route-detail/route-detail.wxss`
  - Allow the archive weather card to wrap the extra overview fields cleanly.

---

### Task 1: Add the hourly weather API

**Files:**
- Modify: `cloud/server/test/api-smoke.test.js`
- Modify: `cloud/server/src/services/weatherService.js`
- Modify: `cloud/server/src/routes/proxy.js`

- [ ] **Step 1: Write the failing API test**

Add these mocks near the top of `cloud/server/test/api-smoke.test.js`, before `require('../src/server')`:

```js
const weatherService = require('../src/services/weatherService');

let mockWeatherSnapshot = null;
let mockAirSnapshot = null;
let mockWeatherHourlyTimeline = [];

weatherService.fetchWeatherSnapshot = async () => mockWeatherSnapshot;
weatherService.fetchAirQualitySnapshot = async () => mockAirSnapshot;
weatherService.fetchWeatherHourlyTimeline = async () => mockWeatherHourlyTimeline;
```

Append this test to `cloud/server/test/api-smoke.test.js`:

```js
test('GET /api/weather/hourly returns current snapshot and hourly timeline', async () => {
  const now = Date.now();
  mockWeatherSnapshot = {
    temperature: 18.6,
    apparentTemperature: 17.9,
    weatherCode: 3,
    weatherText: '多云',
    humidity: 62,
    windSpeed: 3.4,
    windDirection: 45,
    windDirectionText: '东北风',
    fetchedAt: now,
    source: 'qweather',
  };
  mockAirSnapshot = {
    aqi: 58,
    level: 'Moderate',
    category: 'moderate',
    pm25: 18,
    pm10: 29,
    o3: 71,
    so2: null,
    no2: null,
    co: null,
    fetchedAt: now,
  };
  mockWeatherHourlyTimeline = [
    {
      time: now - 60 * 60 * 1000,
      temperature: 17.1,
      apparentTemperature: 16.5,
      humidity: 68,
      windSpeed: 2.6,
      windDirection: 30,
      windDirectionText: '东北风',
      aqi: 54,
      pm25: 16,
      pm10: 26,
      o3: 63,
      so2: null,
      no2: null,
      co: null,
    },
    {
      time: now,
      temperature: 18.6,
      apparentTemperature: 17.9,
      humidity: 62,
      windSpeed: 3.4,
      windDirection: 45,
      windDirectionText: '东北风',
      aqi: 58,
      pm25: 18,
      pm10: 29,
      o3: 71,
      so2: null,
      no2: null,
      co: null,
    },
    {
      time: now + 60 * 60 * 1000,
      temperature: 20.2,
      apparentTemperature: 19.7,
      humidity: 58,
      windSpeed: 3.8,
      windDirection: 80,
      windDirectionText: '东风',
      aqi: 61,
      pm25: 21,
      pm10: 33,
      o3: 75,
      so2: null,
      no2: null,
      co: null,
    },
  ];

  const response = await request
    .get('/api/weather/hourly?lat=30.27415&lon=120.15515')
    .set('Authorization', `Bearer ${signUserToken('weather-user')}`);

  assert.equal(response.status, 200);
  assert.equal(response.body.current.windDirectionText, '东北风');
  assert.equal(response.body.current.airLevel, 'Moderate');
  assert.equal(response.body.current.aqi, 58);
  assert.ok(Array.isArray(response.body.hourly));
  assert.equal(response.body.hourly.length, 3);
  assert.equal(response.body.hourly[0].aqi, 54);
  assert.equal(response.body.hourly[2].windDirectionText, '东风');
});
```

- [ ] **Step 2: Run the targeted API test and confirm it fails**

Run:

```bash
node --test --test-name-pattern="GET /api/weather/hourly returns current snapshot and hourly timeline" cloud/server/test/api-smoke.test.js
```

Expected: FAIL with `404 !== 200` because `/api/weather/hourly` does not exist yet.

- [ ] **Step 3: Add the hourly timeline fetcher to `cloud/server/src/services/weatherService.js`**

Append these helpers near the Open-Meteo functions and export them:

```js
async function fetchOpenMeteoHourlyTimeline(latitude, longitude) {
  const weatherUrl = new URL(OPEN_METEO_WEATHER_BASE);
  weatherUrl.searchParams.set('latitude', latitude);
  weatherUrl.searchParams.set('longitude', longitude);
  weatherUrl.searchParams.set(
    'hourly',
    'temperature_2m,apparent_temperature,relative_humidity_2m,wind_speed_10m,wind_direction_10m'
  );
  weatherUrl.searchParams.set('past_hours', '12');
  weatherUrl.searchParams.set('forecast_hours', '12');
  weatherUrl.searchParams.set('timezone', 'auto');

  const airUrl = new URL(OPEN_METEO_AIR_BASE);
  airUrl.searchParams.set('latitude', latitude);
  airUrl.searchParams.set('longitude', longitude);
  airUrl.searchParams.set(
    'hourly',
    'us_aqi,pm2_5,pm10,ozone,sulphur_dioxide,nitrogen_dioxide,carbon_monoxide'
  );
  airUrl.searchParams.set('past_hours', '12');
  airUrl.searchParams.set('forecast_hours', '12');
  airUrl.searchParams.set('timezone', 'auto');

  const [weatherResponse, airResponse] = await Promise.all([
    fetch(weatherUrl.toString(), { headers: { 'User-Agent': WEATHER_USER_AGENT } }),
    fetch(airUrl.toString(), { headers: { 'User-Agent': WEATHER_USER_AGENT } }),
  ]);

  if (!weatherResponse.ok) {
    const error = new Error('Hourly weather request failed');
    error.statusCode = weatherResponse.status;
    throw error;
  }
  if (!airResponse.ok) {
    const error = new Error('Hourly air-quality request failed');
    error.statusCode = airResponse.status;
    throw error;
  }

  const weatherPayload = await weatherResponse.json();
  const airPayload = await airResponse.json();
  const weatherTimes = Array.isArray(weatherPayload.hourly?.time) ? weatherPayload.hourly.time : [];
  const airTimes = Array.isArray(airPayload.hourly?.time) ? airPayload.hourly.time : [];
  const airIndexByTime = new Map(airTimes.map((time, index) => [time, index]));

  return weatherTimes
    .map((time, index) => {
      const airIndex = airIndexByTime.has(time) ? airIndexByTime.get(time) : -1;
      const timestamp = new Date(time).getTime();
      return {
        time: Number.isFinite(timestamp) ? timestamp : null,
        temperature: normalizeNumberValue(weatherPayload.hourly?.temperature_2m?.[index]),
        apparentTemperature: normalizeNumberValue(weatherPayload.hourly?.apparent_temperature?.[index]),
        humidity: normalizeNumberValue(weatherPayload.hourly?.relative_humidity_2m?.[index]),
        windSpeed: normalizeNumberValue(weatherPayload.hourly?.wind_speed_10m?.[index]),
        windDirection: normalizeNumberValue(weatherPayload.hourly?.wind_direction_10m?.[index]),
        windDirectionText: null,
        aqi: airIndex >= 0 ? normalizeNumberValue(airPayload.hourly?.us_aqi?.[airIndex]) : null,
        pm25: airIndex >= 0 ? normalizeNumberValue(airPayload.hourly?.pm2_5?.[airIndex]) : null,
        pm10: airIndex >= 0 ? normalizeNumberValue(airPayload.hourly?.pm10?.[airIndex]) : null,
        o3: airIndex >= 0 ? normalizeNumberValue(airPayload.hourly?.ozone?.[airIndex]) : null,
        so2: airIndex >= 0 ? normalizeNumberValue(airPayload.hourly?.sulphur_dioxide?.[airIndex]) : null,
        no2: airIndex >= 0 ? normalizeNumberValue(airPayload.hourly?.nitrogen_dioxide?.[airIndex]) : null,
        co: airIndex >= 0 ? normalizeNumberValue(airPayload.hourly?.carbon_monoxide?.[airIndex]) : null,
      };
    })
    .filter((item) => Number.isFinite(item.time));
}

async function fetchWeatherHourlyTimeline(latitude, longitude) {
  return fetchOpenMeteoHourlyTimeline(latitude, longitude);
}
```

Update the export list at the bottom of `cloud/server/src/services/weatherService.js`:

```js
module.exports = {
  // Individual providers
  fetchQWeatherWeatherSnapshot,
  fetchQWeatherAirSnapshot,
  fetchAmapWeatherSnapshot,
  fetchOpenMeteoWeatherSnapshot,
  fetchOpenMeteoAirQualitySnapshot,
  fetchOpenMeteoHourlyTimeline,
  fetchAqicnAirSnapshot,
  // Unified (with fallback)
  fetchWeatherSnapshot,
  fetchAirQualitySnapshot,
  fetchWeatherHourlyTimeline,
  // Utilities
  describeAqi,
  buildExerciseSuggestion,
  normalizeNumberValue,
};
```

- [ ] **Step 4: Add the authenticated route to `cloud/server/src/routes/proxy.js`**

Update the weather-service import:

```js
const {
  fetchWeatherSnapshot,
  fetchAirQualitySnapshot,
  fetchWeatherHourlyTimeline,
  describeAqi,
  buildExerciseSuggestion,
  normalizeNumberValue
} = require('../services/weatherService');
```

Add the new route above `router.get('/geocode/reverse', ...)`:

```js
router.get('/weather/hourly', ensureAuth, async (req, res) => {
  const latitude = normalizeCoordinate(req.query.lat, { min: -90, max: 90 });
  const longitude = normalizeCoordinate(req.query.lon, { min: -180, max: 180 });
  if (latitude === null || longitude === null) {
    return res.status(400).json({ error: 'Invalid coordinates' });
  }

  try {
    const [weather, air, hourly] = await Promise.all([
      fetchWeatherSnapshot(latitude, longitude),
      fetchAirQualitySnapshot(latitude, longitude).catch(() => null),
      fetchWeatherHourlyTimeline(latitude, longitude),
    ]);

    const aqiValue = normalizeNumberValue(air?.aqi);
    const { level: airLevel, category: airCategory } = describeAqi(aqiValue);
    const current = {
      temperature: normalizeNumberValue(weather?.temperature),
      apparentTemperature: normalizeNumberValue(weather?.apparentTemperature),
      weatherText: weather?.weatherText || null,
      humidity: normalizeNumberValue(weather?.humidity),
      windSpeed: normalizeNumberValue(weather?.windSpeed),
      windDirection: weather?.windDirection ?? null,
      windDirectionText: weather?.windDirectionText || null,
      aqi: aqiValue,
      airLevel,
      airCategory,
      suggestion: buildExerciseSuggestion({
        temperature: normalizeNumberValue(weather?.temperature),
        aqi: aqiValue,
        weatherCode: weather?.weatherCode ?? null,
        windSpeed: normalizeNumberValue(weather?.windSpeed),
        humidity: normalizeNumberValue(weather?.humidity),
      }),
      source: weather?.source || 'unknown',
      fetchedAt: weather?.fetchedAt || Date.now(),
    };

    res.json({
      current,
      hourly,
      fetchedAt: Math.max(
        current.fetchedAt || 0,
        ...hourly.map((item) => Number(item.time) || 0)
      ),
    });
  } catch (error) {
    console.error('GET /api/weather/hourly failed', error);
    res.status(error.statusCode || 502).json({ error: 'Failed to fetch hourly weather data' });
  }
});
```

- [ ] **Step 5: Run the targeted API test again**

Run:

```bash
node --test --test-name-pattern="GET /api/weather/hourly returns current snapshot and hourly timeline" cloud/server/test/api-smoke.test.js
```

Expected: PASS with `ok` output for the new test.

- [ ] **Step 6: Run the backend test suite**

Run:

```bash
npm --prefix cloud/server run test
```

Expected: PASS with `# pass` covering `cloud/server/test/api-smoke.test.js`.

- [ ] **Step 7: Commit the backend slice**

Run:

```bash
git add cloud/server/src/services/weatherService.js cloud/server/src/routes/proxy.js cloud/server/test/api-smoke.test.js
git commit -m "feat(api): add hourly weather endpoint"
```

Expected: a new commit containing the API route, provider logic, and test coverage.

---

### Task 2: Add homepage weather formatters and detail models

**Files:**
- Create: `services/weather-local.test.js`
- Modify: `services/weather-local.js`

- [ ] **Step 1: Write the failing formatter tests**

Create `services/weather-local.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  formatWeatherPayload,
  buildWeatherMetricItems,
  buildWeatherMetricDetail,
} = require('./weather-local');

test('buildWeatherMetricItems returns four homepage weather tiles', () => {
  const formatted = formatWeatherPayload({
    temperature: 18.6,
    apparentTemperature: 17.9,
    weatherText: '多云',
    humidity: 62,
    windSpeed: 3.4,
    windDirectionText: '东北风',
    airQuality: { aqi: 58, value: 58, level: 'Moderate', category: 'moderate' },
    suggestion: '天气不错，可以按计划进行户外运动。',
    fetchedAt: 1774540000000,
  });

  const items = buildWeatherMetricItems(formatted);

  assert.deepEqual(items.map((item) => item.key), ['temperature', 'humidity', 'wind', 'air']);
  assert.equal(items[0].value, '18.6℃');
  assert.equal(items[0].subvalue, '体感 17.9℃');
  assert.equal(items[2].subvalue, '东北风');
  assert.match(items[3].value, /58/);
});

test('buildWeatherMetricDetail hides the detail block when no metric is active', () => {
  const detail = buildWeatherMetricDetail({ activeMetric: '', hourly: [] });
  assert.equal(detail.visible, false);
  assert.equal(detail.empty, false);
});

test('buildWeatherMetricDetail uses only AQI as the air trend series', () => {
  const detail = buildWeatherMetricDetail({
    activeMetric: 'air',
    hourly: [
      { time: 1774536400000, aqi: 54, pm25: 16, pm10: 26, o3: 63 },
      { time: 1774540000000, aqi: 58, pm25: 18, pm10: 29, o3: 71 },
      { time: 1774543600000, aqi: 61, pm25: 21, pm10: 33, o3: 75 },
    ],
  });

  assert.equal(detail.visible, true);
  assert.equal(detail.empty, false);
  assert.equal(detail.chart.series.length, 1);
  assert.equal(detail.chart.series[0].key, 'aqi');
  assert.equal(detail.summary[0].label, '当前 AQI');
});
```

- [ ] **Step 2: Run the new frontend formatter test file and confirm it fails**

Run:

```bash
node --test services/weather-local.test.js
```

Expected: FAIL with `buildWeatherMetricItems is not a function` and `buildWeatherMetricDetail is not a function`.

- [ ] **Step 3: Add metric-card builders and detail-model builders to `services/weather-local.js`**

Add these helpers below `formatWeatherPayload` and export them:

```js
function formatHourLabel(timestamp) {
  const value = Number(timestamp);
  if (!Number.isFinite(value)) {
    return '--';
  }
  return new Date(value).toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

function buildWeatherMetricItems(weather = {}) {
  const airLabel = weather.airQualityLevel || '空气质量';
  return [
    {
      key: 'temperature',
      label: '温度 / 体感',
      value: weather.temperature || '--',
      subvalue: weather.apparentTemperature ? `体感 ${weather.apparentTemperature}` : '体感 --',
    },
    {
      key: 'humidity',
      label: '湿度',
      value: weather.humidityText || '--',
      subvalue: '相对湿度',
    },
    {
      key: 'wind',
      label: '风力 / 风向',
      value: weather.windText || '--',
      subvalue: weather.windDirectionText || '风向未知',
    },
    {
      key: 'air',
      label: '空气 / 污染',
      value: weather.airQualityText || '--',
      subvalue: airLabel || '空气质量',
    },
  ];
}

function buildWeatherMetricDetail({ activeMetric = '', hourly = [] } = {}) {
  if (!activeMetric) {
    return { visible: false, empty: false, title: '', subtitle: '', summary: [], chart: { series: [] } };
  }

  const rows = Array.isArray(hourly) ? hourly.filter((item) => Number.isFinite(Number(item.time))) : [];
  if (!rows.length) {
    return {
      visible: true,
      empty: true,
      title: '24 小时天气变化',
      subtitle: '前 12 小时 + 未来 12 小时',
      summary: [],
      chart: { series: [] },
      emptyText: '暂无 24 小时天气变化数据',
    };
  }

  const labelRows = rows.map((item) => ({ ...item, label: formatHourLabel(item.time) }));
  if (activeMetric === 'temperature') {
    const temperatures = labelRows.map((item) => item.temperature).filter(Number.isFinite);
    return {
      visible: true,
      empty: false,
      title: '温度 / 体感 · 24 小时变化',
      subtitle: '前 12 小时 + 未来 12 小时',
      summary: [
        { label: '最低', value: `${Math.min(...temperatures).toFixed(1)}℃` },
        { label: '当前', value: `${Number(labelRows[12]?.temperature ?? labelRows.at(-1)?.temperature).toFixed(1)}℃` },
        { label: '最高', value: `${Math.max(...temperatures).toFixed(1)}℃` },
      ],
      chart: {
        unit: '℃',
        series: [
          {
            key: 'temperature',
            label: '温度',
            color: '#2563eb',
            points: labelRows.map((item) => ({ label: item.label, value: item.temperature })),
          },
          {
            key: 'apparentTemperature',
            label: '体感',
            color: '#7c3aed',
            points: labelRows.map((item) => ({ label: item.label, value: item.apparentTemperature })),
          },
        ],
      },
    };
  }

  if (activeMetric === 'humidity') {
    const humidities = labelRows.map((item) => item.humidity).filter(Number.isFinite);
    return {
      visible: true,
      empty: false,
      title: '湿度 · 24 小时变化',
      subtitle: '前 12 小时 + 未来 12 小时',
      summary: [
        { label: '最低', value: `${Math.min(...humidities).toFixed(0)}%` },
        { label: '当前', value: `${Number(labelRows[12]?.humidity ?? labelRows.at(-1)?.humidity).toFixed(0)}%` },
        { label: '最高', value: `${Math.max(...humidities).toFixed(0)}%` },
      ],
      chart: {
        unit: '%',
        series: [
          {
            key: 'humidity',
            label: '湿度',
            color: '#0f766e',
            points: labelRows.map((item) => ({ label: item.label, value: item.humidity })),
          },
        ],
      },
    };
  }

  if (activeMetric === 'wind') {
    const windSpeeds = labelRows.map((item) => item.windSpeed).filter(Number.isFinite);
    const strongest = labelRows.reduce(
      (current, item) => (!current || (Number(item.windSpeed) || 0) > (Number(current.windSpeed) || 0) ? item : current),
      null
    );
    return {
      visible: true,
      empty: false,
      title: '风力 / 风向 · 24 小时变化',
      subtitle: '前 12 小时 + 未来 12 小时',
      summary: [
        { label: '当前风向', value: labelRows[12]?.windDirectionText || labelRows.at(-1)?.windDirectionText || '风向未知' },
        { label: '主导风速', value: `${Math.max(...windSpeeds).toFixed(1)} m/s` },
        { label: '最大风速时段', value: strongest ? strongest.label : '--' },
      ],
      chart: {
        unit: 'm/s',
        series: [
          {
            key: 'windSpeed',
            label: '风速',
            color: '#ea580c',
            points: labelRows.map((item) => ({ label: item.label, value: item.windSpeed })),
          },
        ],
      },
    };
  }

  return {
    visible: true,
    empty: false,
    title: '空气 / 污染 · 24 小时变化',
    subtitle: '前 12 小时 + 未来 12 小时',
    summary: [
      { label: '当前 AQI', value: `${Number(labelRows[12]?.aqi ?? labelRows.at(-1)?.aqi ?? 0).toFixed(0)}` },
      { label: 'PM2.5', value: `${Number(labelRows[12]?.pm25 ?? labelRows.at(-1)?.pm25 ?? 0).toFixed(0)}` },
      { label: 'PM10', value: `${Number(labelRows[12]?.pm10 ?? labelRows.at(-1)?.pm10 ?? 0).toFixed(0)}` },
    ],
    chart: {
      unit: 'AQI',
      series: [
        {
          key: 'aqi',
          label: 'AQI',
          color: '#dc2626',
          points: labelRows.map((item) => ({ label: item.label, value: item.aqi })),
        },
      ],
    },
  };
}
```

Update `formatWeatherPayload` so the returned object keeps wind direction text and prebuilt metric items:

```js
function formatWeatherPayload(payload = {}) {
  const normalizedAirQuality = payload.airQuality && typeof payload.airQuality === 'object'
    ? payload.airQuality
    : {
        aqi: payload.aqi ?? null,
        value: payload.aqi ?? null,
        level: payload.airLevel || payload.airCategory || '',
        category: payload.airCategory || payload.airLevel || '',
      };
  const normalizedPayload = {
    ...payload,
    airQuality: normalizedAirQuality,
    cityName: payload.cityName || payload.city || payload.district || '',
  };
  const advice = analyzeSportAdvice(normalizedPayload);
  const weatherText = ensureChineseText(normalizedPayload.weatherText, advice.label);
  const suggestion = ensureChineseText(normalizedPayload.suggestion, advice.label, WEATHER_SUGGESTION_MAP);
  const apparent = Number(normalizedPayload.apparentTemperature);
  const humidity = Number(normalizedPayload.humidity);
  const windSpeed = Number(normalizedPayload.windSpeed);
  const base = {
    loading: false,
    ready: true,
    temperature: Number.isFinite(normalizedPayload.temperature)
      ? `${Number(normalizedPayload.temperature).toFixed(1)}℃`
      : '--',
    apparentTemperature: Number.isFinite(apparent) ? `${apparent.toFixed(1)}℃` : null,
    weatherText,
    humidityText: Number.isFinite(humidity) ? `${Math.round(humidity)}%` : '--',
    windText: formatWindSpeed(windSpeed),
    windDirectionText: ensureChineseText(normalizedPayload.windDirectionText, ''),
    airQualityText: formatAirQuality(normalizedAirQuality),
    airQualityLevel: normalizedAirQuality.level || normalizedAirQuality.category || '',
    suggestion,
    fetchedAt: normalizedPayload.fetchedAt || Date.now(),
    error: '',
    cityText: normalizedPayload.cityName || '',
    sportAdviceLevel: advice.label,
    sportAdviceLabel: suggestion,
    sportAdviceColor: advice.color,
  };
  return {
    ...base,
    metricItems: buildWeatherMetricItems(base),
  };
}
```

Update the export list:

```js
module.exports = {
  getLocalWeatherSnapshot,
  WEATHER_CODE_TEXT,
  createWeatherState,
  formatAirQuality,
  analyzeSportAdvice,
  formatWeatherPayload,
  buildWeatherMetricItems,
  buildWeatherMetricDetail,
  WEATHER_TEXT_MAP,
  WEATHER_SUGGESTION_MAP,
};
```

- [ ] **Step 4: Run the formatter test file again**

Run:

```bash
node --test services/weather-local.test.js
```

Expected: PASS for all three formatter tests.

- [ ] **Step 5: Commit the formatter slice**

Run:

```bash
git add services/weather-local.js services/weather-local.test.js
git commit -m "feat(weather): add homepage weather detail models"
```

Expected: a new commit with homepage weather formatter logic and tests.

---

### Task 3: Add the inline chart model helper

**Files:**
- Create: `services/weather-chart.test.js`
- Create: `services/weather-chart.js`

- [ ] **Step 1: Write the failing chart-helper tests**

Create `services/weather-chart.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');

const { buildCanvasLineModel } = require('./weather-chart');

test('buildCanvasLineModel maps multi-series data into a shared chart domain', () => {
  const model = buildCanvasLineModel({
    width: 640,
    height: 220,
    labels: ['08:00', '09:00', '10:00'],
    series: [
      { key: 'temperature', color: '#2563eb', values: [18, 21, 20] },
      { key: 'apparentTemperature', color: '#7c3aed', values: [17, 20, 19] },
    ],
  });

  assert.equal(model.series.length, 2);
  assert.equal(model.series[0].points.length, 3);
  assert.ok(model.series[0].points[0].x < model.series[0].points[1].x);
  assert.ok(model.series[0].points[1].y < model.series[0].points[0].y);
  assert.equal(model.minValue, 17);
  assert.equal(model.maxValue, 21);
});

test('buildCanvasLineModel pads a flat domain to keep lines drawable', () => {
  const model = buildCanvasLineModel({
    width: 640,
    height: 220,
    labels: ['08:00', '09:00', '10:00'],
    series: [
      { key: 'humidity', color: '#0f766e', values: [62, 62, 62] },
    ],
  });

  assert.equal(model.minValue, 61);
  assert.equal(model.maxValue, 63);
  assert.equal(model.series[0].points.length, 3);
});
```

- [ ] **Step 2: Run the chart-helper test file and confirm it fails**

Run:

```bash
node --test services/weather-chart.test.js
```

Expected: FAIL with `Cannot find module './weather-chart'`.

- [ ] **Step 3: Implement `services/weather-chart.js`**

Create `services/weather-chart.js`:

```js
function clampNumber(value, fallback = null) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function buildCanvasLineModel({ width = 640, height = 220, labels = [], series = [] } = {}) {
  const chartWidth = Math.max(Number(width) || 640, 320);
  const chartHeight = Math.max(Number(height) || 220, 160);
  const padding = { top: 20, right: 18, bottom: 28, left: 30 };
  const validSeries = (Array.isArray(series) ? series : [])
    .map((item) => ({
      key: item.key,
      color: item.color || '#2563eb',
      values: Array.isArray(item.values) ? item.values.map((value) => clampNumber(value)) : [],
    }))
    .filter((item) => item.values.some((value) => value !== null));

  const allValues = validSeries.flatMap((item) => item.values.filter((value) => value !== null));
  let minValue = Math.min(...allValues);
  let maxValue = Math.max(...allValues);
  if (minValue === maxValue) {
    minValue -= 1;
    maxValue += 1;
  }

  const innerWidth = chartWidth - padding.left - padding.right;
  const innerHeight = chartHeight - padding.top - padding.bottom;
  const pointsCount = Math.max(labels.length - 1, 1);
  const scaleX = innerWidth / pointsCount;
  const scaleY = innerHeight / (maxValue - minValue);

  return {
    width: chartWidth,
    height: chartHeight,
    padding,
    minValue,
    maxValue,
    labels,
    xTicks: [labels[0] || '', labels[Math.floor(labels.length / 2)] || '', labels.at(-1) || ''],
    series: validSeries.map((item) => ({
      key: item.key,
      color: item.color,
      points: item.values.map((value, index) => ({
        value,
        x: padding.left + scaleX * index,
        y: value === null ? null : padding.top + (maxValue - value) * scaleY,
      })),
    })),
  };
}

module.exports = {
  buildCanvasLineModel,
};
```

- [ ] **Step 4: Run the chart-helper test file again**

Run:

```bash
node --test services/weather-chart.test.js
```

Expected: PASS for both chart-model tests.

- [ ] **Step 5: Commit the chart-helper slice**

Run:

```bash
git add services/weather-chart.js services/weather-chart.test.js
git commit -m "feat(weather): add inline trend chart helper"
```

Expected: a new commit with the chart model helper and tests.

---

### Task 4: Wire the homepage weather card interactions

**Files:**
- Modify: `services/weather-local.test.js`
- Modify: `services/weather-local.js`
- Modify: `services/api.js`
- Modify: `pages/index/index.js`
- Modify: `pages/index/index.wxml`
- Modify: `pages/index/index.wxss`

- [ ] **Step 1: Add a failing test for the active-metric toggle helper**

Append this test to `services/weather-local.test.js`:

```js
test('toggleWeatherMetric collapses when the active metric is tapped again', () => {
  const { toggleWeatherMetric } = require('./weather-local');
  assert.equal(toggleWeatherMetric('', 'temperature'), 'temperature');
  assert.equal(toggleWeatherMetric('temperature', 'temperature'), '');
  assert.equal(toggleWeatherMetric('temperature', 'wind'), 'wind');
});
```

- [ ] **Step 2: Run the formatter tests and confirm the new toggle test fails**

Run:

```bash
node --test services/weather-local.test.js
```

Expected: FAIL with `toggleWeatherMetric is not a function`.

- [ ] **Step 3: Implement the toggle helper in `services/weather-local.js`**

Add and export this helper:

```js
function toggleWeatherMetric(activeMetric = '', nextMetric = '') {
  if (!nextMetric) {
    return '';
  }
  return activeMetric === nextMetric ? '' : nextMetric;
}
```

Update exports:

```js
module.exports = {
  getLocalWeatherSnapshot,
  WEATHER_CODE_TEXT,
  createWeatherState,
  formatAirQuality,
  analyzeSportAdvice,
  formatWeatherPayload,
  buildWeatherMetricItems,
  buildWeatherMetricDetail,
  toggleWeatherMetric,
  WEATHER_TEXT_MAP,
  WEATHER_SUGGESTION_MAP,
};
```

- [ ] **Step 4: Run the formatter tests again**

Run:

```bash
node --test services/weather-local.test.js
```

Expected: PASS, including the new toggle test.

- [ ] **Step 5: Add the frontend API helper in `services/api.js`**

Append this request helper near the other weather APIs and export it:

```js
function getWeatherHourly({ latitude, longitude } = {}) {
  if (latitude === undefined || longitude === undefined) {
    return Promise.reject(new Error('Latitude and longitude are required'));
  }
  return request({
    path: `/weather/hourly${buildQueryString({ lat: latitude, lon: longitude })}`,
    method: 'GET',
  });
}
```

Update the export list:

```js
module.exports = {
  request,
  getBaseUrl: auth.getBaseUrl,
  buildUrl: auth.buildUrl,
  upsertRoute,
  createRoute,
  listRoutes,
  syncRoutes,
  patchRoute,
  removeRoute,
  likeRoute,
  unlikeRoute,
  createRouteComment,
  listRouteComments,
  createRouteCommentReply,
  likeRouteComment,
  unlikeRouteComment,
  deleteRouteComment,
  listPublicRoutes,
  getWeatherSnapshot,
  getWeatherSnapshotSafe,
  getWeatherHourly,
  reverseGeocode,
  geocodeRegeo,
  geocodeAround,
  reverseGeocodeSafe,
  getRouteById,
  getLatestAnnouncement,
  getActiveAnnouncements,
  submitFeedbackTicket,
  updateUserProfile,
  getUserSettings,
  saveUserSettings,
  getUserAchievements,
  saveUserAchievements,
};
```

- [ ] **Step 6: Update homepage state and handlers in `pages/index/index.js`**

Update the weather imports:

```js
const {
  createWeatherState,
  formatWeatherPayload,
  buildWeatherMetricItems,
  buildWeatherMetricDetail,
  toggleWeatherMetric,
} = require('../../services/weather-local');
const { buildCanvasLineModel } = require('../../services/weather-chart');
```

Update the default weather state to include hourly/detail fields:

```js
const DEFAULT_WEATHER = createWeatherState({
  loading: true,
  metricItems: [],
  activeMetric: '',
  detailModel: {
    visible: false,
    empty: false,
    title: '',
    subtitle: '',
    summary: [],
    chart: { series: [] },
  },
  hourly: [],
});
```

Replace `loadWeather({ latitude, longitude })` with this version:

```js
loadWeather({ latitude, longitude }) {
  return Promise.all([
    api.getWeatherSnapshotSafe({ latitude, longitude }),
    api.getWeatherHourly({ latitude, longitude }).catch(() => ({ hourly: [] })),
    typeof geocodeLocal.getCityNameWithFallback === 'function'
      ? geocodeLocal.getCityNameWithFallback({ latitude, longitude }).catch(() => '')
      : Promise.resolve(''),
  ])
    .then(([payload, hourlyPayload, cityText]) => {
      const formatted = formatWeatherPayload(payload);
      const hourly = Array.isArray(hourlyPayload?.hourly) ? hourlyPayload.hourly : [];
      const activeMetric = '';
      const detailModel = buildWeatherMetricDetail({ activeMetric, hourly });
      this.setData({
        weather: {
          ...formatted,
          cityText: cityText || payload.cityName || payload.city || '',
          hourly,
          activeMetric,
          metricItems: buildWeatherMetricItems(formatted),
          detailModel,
        },
      });
    })
    .catch((error) => {
      const message = error?.errMsg || error?.message || '天气数据暂不可用';
      this.setData({
        weather: createWeatherState({
          loading: false,
          error: message,
          suggestion: '稍后再试或刷新页面',
          metricItems: [],
          activeMetric: '',
          detailModel: { visible: false, empty: false, title: '', subtitle: '', summary: [], chart: { series: [] } },
          hourly: [],
        }),
      });
    });
}
```

Add these methods to the page object:

```js
handleWeatherMetricTap(event) {
  const { key } = event.currentTarget.dataset || {};
  if (!key) {
    return;
  }
  const activeMetric = toggleWeatherMetric(this.data.weather?.activeMetric || '', key);
  const detailModel = buildWeatherMetricDetail({
    activeMetric,
    hourly: this.data.weather?.hourly || [],
  });
  this.setData({
    'weather.activeMetric': activeMetric,
    'weather.detailModel': detailModel,
  }, () => {
    if (detailModel.visible && !detailModel.empty) {
      this.drawWeatherDetailChart(detailModel);
    }
  });
}

handleRefreshWeather() {
  return this.ensureWeather(true);
}

drawWeatherDetailChart(detailModel) {
  const labels = detailModel.chart.series[0]?.points?.map((item) => item.label) || [];
  const series = detailModel.chart.series.map((item) => ({
    key: item.key,
    color: item.color,
    values: item.points.map((point) => point.value),
  }));
  const model = buildCanvasLineModel({ width: 640, height: 220, labels, series });
  const ctx = wx.createCanvasContext('weatherTrendChart', this);

  ctx.clearRect(0, 0, model.width, model.height);
  ctx.setStrokeStyle('rgba(148, 163, 184, 0.35)');
  ctx.setLineWidth(1);
  ctx.moveTo(model.padding.left, model.padding.top);
  ctx.lineTo(model.padding.left, model.height - model.padding.bottom);
  ctx.lineTo(model.width - model.padding.right, model.height - model.padding.bottom);
  ctx.stroke();

  model.series.forEach((line) => {
    const drawablePoints = line.points.filter((point) => point.y !== null);
    if (!drawablePoints.length) {
      return;
    }
    ctx.beginPath();
    ctx.setStrokeStyle(line.color);
    ctx.setLineWidth(3);
    drawablePoints.forEach((point, index) => {
      if (index === 0) {
        ctx.moveTo(point.x, point.y);
      } else {
        ctx.lineTo(point.x, point.y);
      }
    });
    ctx.stroke();
  });

  ctx.setFillStyle('#64748b');
  ctx.setFontSize(18);
  model.xTicks.forEach((label, index) => {
    const tickX = index === 0
      ? model.padding.left
      : index === 1
      ? model.width / 2
      : model.width - model.padding.right - 48;
    ctx.fillText(label, tickX, model.height - 4);
  });

  ctx.draw();
}
```

- [ ] **Step 7: Replace the homepage weather markup in `pages/index/index.wxml`**

Replace the static 3-item metric row inside the weather card with this block:

```xml
<view class="weather__metrics-grid">
  <block wx:for="{{weather.metricItems}}" wx:key="key">
    <view
      class="weather__metric-card {{weather.activeMetric === item.key ? 'weather__metric-card--active' : ''}}"
      data-key="{{item.key}}"
      bindtap="handleWeatherMetricTap"
    >
      <text class="weather__metric-card-label">{{item.label}}</text>
      <text class="weather__metric-card-value">{{item.value}}</text>
      <text class="weather__metric-card-subvalue">{{item.subvalue}}</text>
    </view>
  </block>
</view>

<view wx:if="{{weather.detailModel.visible}}" class="weather__detail">
  <view class="weather__detail-head">
    <text class="weather__detail-title">{{weather.detailModel.title}}</text>
    <text class="weather__detail-subtitle">{{weather.detailModel.subtitle}}</text>
  </view>
  <view wx:if="{{weather.detailModel.empty}}" class="weather__detail-empty">
    <text>{{weather.detailModel.emptyText}}</text>
  </view>
  <view wx:else>
    <canvas
      canvas-id="weatherTrendChart"
      class="weather__chart-canvas"
      style="width: 100%; height: 220rpx;"
    ></canvas>
    <view class="weather__detail-summary">
      <block wx:for="{{weather.detailModel.summary}}" wx:key="label">
        <view class="weather__detail-summary-item">
          <text class="weather__detail-summary-label">{{item.label}}</text>
          <text class="weather__detail-summary-value">{{item.value}}</text>
        </view>
      </block>
    </view>
  </view>
</view>
```

- [ ] **Step 8: Add the homepage styles in `pages/index/index.wxss`**

Replace the old `.weather__metrics` styles with this block and add the detail styles after it:

```css
.weather__metrics-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12rpx;
  margin-top: 18rpx;
}

.weather__metric-card {
  padding: 18rpx;
  border-radius: 22rpx;
  background: var(--color-surface-muted);
  display: flex;
  flex-direction: column;
  gap: 8rpx;
  border: 1px solid transparent;
}

.weather__metric-card--active {
  border-color: rgba(37, 99, 235, 0.28);
  background: rgba(37, 99, 235, 0.08);
  box-shadow: 0 12rpx 28rpx rgba(37, 99, 235, 0.12);
}

.weather__metric-card-label {
  font-size: 22rpx;
  color: var(--color-text-secondary);
}

.weather__metric-card-value {
  font-size: 28rpx;
  font-weight: 600;
}

.weather__metric-card-subvalue {
  font-size: 22rpx;
  color: var(--color-text-tertiary);
}

.weather__detail {
  margin-top: 18rpx;
  padding: 20rpx;
  border-radius: 24rpx;
  background: rgba(239, 246, 255, 0.9);
  border: 1px solid rgba(59, 130, 246, 0.16);
}

.weather__detail-head {
  display: flex;
  flex-direction: column;
  gap: 6rpx;
}

.weather__detail-title {
  font-size: 28rpx;
  font-weight: 600;
}

.weather__detail-subtitle,
.weather__detail-empty {
  font-size: 22rpx;
  color: var(--color-text-secondary);
}

.weather__chart-canvas {
  width: 100%;
  height: 220rpx;
  margin-top: 16rpx;
  border-radius: 18rpx;
  background: #ffffff;
}

.weather__detail-summary {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10rpx;
  margin-top: 16rpx;
}

.weather__detail-summary-item {
  padding: 14rpx 16rpx;
  border-radius: 18rpx;
  background: rgba(255, 255, 255, 0.88);
}

.weather__detail-summary-label {
  display: block;
  font-size: 22rpx;
  color: var(--color-text-secondary);
}

.weather__detail-summary-value {
  display: block;
  margin-top: 6rpx;
  font-size: 26rpx;
  font-weight: 600;
}
```

- [ ] **Step 9: Run lint and the formatter/chart tests**

Run:

```bash
node --test services/weather-local.test.js services/weather-chart.test.js && npm run lint
```

Expected: PASS for both root test files and a clean lint run.

- [ ] **Step 10: Manually verify the homepage weather flow in WeChat DevTools**

Manual checklist:

```text
1. Open the homepage.
2. Confirm the detail block is hidden by default.
3. Tap “温度 / 体感” and confirm the chart appears.
4. Tap “温度 / 体感” again and confirm the detail block collapses.
5. Tap “风力 / 风向” and confirm the detail block switches instead of opening a new section.
6. Tap “空气 / 污染” and confirm only one AQI trend line is rendered.
```

Expected: the homepage weather card behaves exactly as described in the spec.

- [ ] **Step 11: Commit the homepage slice**

Run:

```bash
git add services/api.js services/weather-local.js services/weather-local.test.js services/weather-chart.js services/weather-chart.test.js pages/index/index.js pages/index/index.wxml pages/index/index.wxss
git commit -m "feat(home): add interactive weather detail card"
```

Expected: a new commit containing the homepage weather interactions and inline chart.

---

### Task 5: Align route-detail weather with the stored archive snapshot

**Files:**
- Modify: `services/weather-local.test.js`
- Modify: `services/weather-local.js`
- Modify: `pages/route-detail/route-detail.js`
- Modify: `pages/route-detail/route-detail.wxml`
- Modify: `pages/route-detail/route-detail.wxss`

- [ ] **Step 1: Add a failing archive-formatter test**

Append this test to `services/weather-local.test.js`:

```js
test('formatRouteWeatherArchive keeps route weather at overview granularity', () => {
  const { formatRouteWeatherArchive } = require('./weather-local');
  const archive = formatRouteWeatherArchive({
    temperature: 18.6,
    apparentTemperature: 17.9,
    weatherText: '多云',
    humidity: 62,
    windSpeed: 3.4,
    windDirectionText: '东北风',
    aqi: 58,
    airLevel: 'Moderate',
    suggestion: '天气不错，可以按计划进行户外运动。',
  });

  assert.equal(archive.temperatureText, '18.6°');
  assert.equal(archive.windDirectionText, '东北风');
  assert.match(archive.airQualityText, /58/);
  assert.equal(archive.suggestion, '天气不错，可以按计划进行户外运动。');
});
```

- [ ] **Step 2: Run the formatter tests and confirm the archive test fails**

Run:

```bash
node --test services/weather-local.test.js
```

Expected: FAIL with `formatRouteWeatherArchive is not a function`.

- [ ] **Step 3: Implement `formatRouteWeatherArchive` in `services/weather-local.js`**

Add this helper and export it:

```js
function formatRouteWeatherArchive(weather = null) {
  if (!weather || typeof weather !== 'object') {
    return null;
  }
  const temperature = Number(weather.temperature);
  const apparent = Number(weather.apparentTemperature);
  const humidity = Number(weather.humidity);
  const airQualityText = formatAirQuality({
    aqi: weather.aqi ?? null,
    value: weather.aqi ?? null,
    level: weather.airLevel || weather.airCategory || '',
    category: weather.airCategory || weather.airLevel || '',
  });
  return {
    temperatureText: Number.isFinite(temperature) ? `${temperature.toFixed(1)}°` : '--',
    apparentTemperatureText: Number.isFinite(apparent) ? `${apparent.toFixed(1)}°` : '--',
    weatherText: ensureChineseText(weather.weatherText, '未知'),
    humidityText: Number.isFinite(humidity) ? `${Math.round(humidity)}%` : '--',
    windText: formatWindSpeed(Number(weather.windSpeed)),
    windDirectionText: ensureChineseText(weather.windDirectionText, ''),
    airQualityText,
    suggestion: ensureChineseText(weather.suggestion, '关注实时天气', WEATHER_SUGGESTION_MAP),
  };
}
```

Update exports:

```js
module.exports = {
  getLocalWeatherSnapshot,
  WEATHER_CODE_TEXT,
  createWeatherState,
  formatAirQuality,
  analyzeSportAdvice,
  formatWeatherPayload,
  buildWeatherMetricItems,
  buildWeatherMetricDetail,
  toggleWeatherMetric,
  formatRouteWeatherArchive,
  WEATHER_TEXT_MAP,
  WEATHER_SUGGESTION_MAP,
};
```

- [ ] **Step 4: Run the formatter tests again**

Run:

```bash
node --test services/weather-local.test.js
```

Expected: PASS, including the new archive test.

- [ ] **Step 5: Wire the archive formatter into `pages/route-detail/route-detail.js`**

Update the imports:

```js
const { formatRouteWeatherArchive } = require('../../services/weather-local');
```

Inside `applyRouteDetail(route, ownRoute)`, replace the raw weather assignment with:

```js
const formattedWeather = formatRouteWeatherArchive(route.weather);

this.setData({
  routeId: route.id,
  detail: {
    title: route.title,
    campusLabel: `${startLabel} → ${endLabel}`,
    startLabel,
    endLabel,
    startDate: formatDate(route.startTime),
    timeRange: `${formatClock(route.startTime)} - ${formatClock(route.endTime)}`,
    duration,
    paceOrSpeed,
    distance,
    calories,
    steps,
    privacyLabel: PRIVACY_LEVEL_MAP[route.privacyLevel]?.label || '未知',
    note: route.note || '未填写备注',
    activityLabel: activityMeta.label,
    photos,
    activityLevel: activityLevelMeta,
    purposeLabel: purposeMeta ? purposeMeta.label : '未填写',
    purposeDescription: purposeMeta
      ? purposeMeta.description
      : '本次路线未填写出行目的',
    purposeIcon: purposeMeta ? purposeMeta.icon : '？',
    hasPurpose: !!purposeMeta,
    weather: formattedWeather,
    hasWeather: !!formattedWeather,
  },
  polyline: buildPolyline(route.points),
  markers: buildMarkers(route.points, route.meta?.pausePoints),
  centerLatitude: route.points?.[0]?.latitude || 30.27415,
  centerLongitude: route.points?.[0]?.longitude || 120.15515,
  privacyIndex,
  levelStandards: ACTIVITY_LEVEL_LIST,
  ownRoute,
});
```

- [ ] **Step 6: Update the weather card markup in `pages/route-detail/route-detail.wxml`**

Replace the weather snapshot block with this overview-grade archive markup:

```xml
<view class="section weather-section" wx:if="{{detail.hasWeather}}">
  <view class="section__title">出行天气</view>
  <view class="weather-card">
    <view class="weather-card__main">
      <text class="weather-card__temp">{{detail.weather.temperatureText}}</text>
      <text class="weather-card__text">{{detail.weather.weatherText}}</text>
    </view>
    <view class="weather-card__details">
      <view class="weather-card__item">
        <text class="weather-card__label">体感</text>
        <text class="weather-card__value">{{detail.weather.apparentTemperatureText}}</text>
      </view>
      <view class="weather-card__item">
        <text class="weather-card__label">湿度</text>
        <text class="weather-card__value">{{detail.weather.humidityText}}</text>
      </view>
      <view class="weather-card__item">
        <text class="weather-card__label">风力</text>
        <text class="weather-card__value">{{detail.weather.windText}}</text>
      </view>
      <view class="weather-card__item" wx:if="{{detail.weather.windDirectionText}}">
        <text class="weather-card__label">风向</text>
        <text class="weather-card__value">{{detail.weather.windDirectionText}}</text>
      </view>
      <view class="weather-card__item">
        <text class="weather-card__label">空气</text>
        <text class="weather-card__value">{{detail.weather.airQualityText}}</text>
      </view>
    </view>
    <view class="weather-card__suggestion" wx:if="{{detail.weather.suggestion}}">
      <text>{{detail.weather.suggestion}}</text>
    </view>
  </view>
</view>
```

- [ ] **Step 7: Let the archive card wrap the extra field in `pages/route-detail/route-detail.wxss`**

Update the item width so the extra “风向” and “空气” blocks can wrap cleanly:

```css
.weather-card__details {
  display: flex;
  flex-wrap: wrap;
  gap: 16rpx;
}

.weather-card__item {
  flex: 1 1 45%;
  display: flex;
  justify-content: space-between;
  background: rgba(255,255,255,0.6);
  border-radius: 12rpx;
  padding: 12rpx 20rpx;
}
```

- [ ] **Step 8: Run full verification**

Run:

```bash
node --test services/weather-local.test.js services/weather-chart.test.js && npm --prefix cloud/server run test && npm run lint
```

Expected: PASS for root formatter tests, chart tests, backend tests, and repository lint.

- [ ] **Step 9: Manually verify route-detail weather in WeChat DevTools**

Manual checklist:

```text
1. Open a route that already has weather data.
2. Confirm the weather card still shows a single archive snapshot, not a trend chart.
3. Confirm 风向 is shown when windDirectionText exists.
4. Confirm 空气 shows AQI + 等级 in one value.
5. Confirm the card still wraps cleanly in dark mode.
```

Expected: the route detail weather card remains compact and matches the homepage overview vocabulary.

- [ ] **Step 10: Commit the route-detail slice**

Run:

```bash
git add services/weather-local.js services/weather-local.test.js pages/route-detail/route-detail.js pages/route-detail/route-detail.wxml pages/route-detail/route-detail.wxss
git commit -m "feat(route-detail): align archived weather summary"
```

Expected: a final commit for the archive UI and formatting updates.

---

## Self-Review

### Spec coverage

- Homepage weather overview now has 4 tappable metrics: covered by Task 2 + Task 4.
- Detail block defaults to hidden and toggles inline: covered by Task 4.
- AQI-only trend for the air view: covered by Task 2 + Task 4.
- New hourly backend endpoint: covered by Task 1.
- Route detail remains archive-grade and still stored in `routes.weather`: covered by Task 5.
- Route detail shows only overview-level weather information: covered by Task 5.

No spec gaps found.

### Placeholder scan

- No `TODO`, `TBD`, or “similar to above” references remain.
- Every code-changing step includes concrete code blocks.
- Every verification step includes an exact command and expected result.

### Type consistency

- Backend uses `fetchWeatherHourlyTimeline` consistently in both the route and the test.
- Frontend uses `activeMetric` keys consistently: `temperature`, `humidity`, `wind`, `air`.
- Homepage detail builders and chart helper both use the `chart.series[].points[]` shape.
- Route detail formatter and WXML both use the `temperatureText`, `windText`, `windDirectionText`, and `airQualityText` property names.

No naming mismatches found.
