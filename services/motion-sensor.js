/**
 * Motion Sensor Module
 * Handles accelerometer and gyroscope data collection and feature extraction
 * for the WeChat Mini Program fitness tracker.
 */

const logger = require('../utils/logger');

// === Constants ===
const SENSOR_WINDOW_MS = 3000;
const SENSOR_MAX_SAMPLES = 200;
const SENSOR_ZERO_CROSSING_GAP_MS = 80;

// === State ===
let accelerometerSamples = [];
let gyroscopeSamples = [];
let accelerometerHandler = null;
let gyroscopeHandler = null;
let accelerometerActive = false;
let gyroscopeActive = false;

// === Sample Management ===

/**
 * Trims old samples from a buffer based on time window and max count
 * @param {Array} buffer - Sample buffer
 * @param {number} windowMs - Time window in milliseconds
 */
function trimSensorSamples(buffer, windowMs = SENSOR_WINDOW_MS) {
    if (!Array.isArray(buffer) || !buffer.length) {
        return;
    }
    const cutoff = Date.now() - windowMs;
    while (buffer.length && buffer[0].ts < cutoff) {
        buffer.shift();
    }
    if (buffer.length > SENSOR_MAX_SAMPLES) {
        buffer.splice(0, buffer.length - SENSOR_MAX_SAMPLES);
    }
}

/**
 * Clears all sensor sample buffers
 */
function clearMotionBuffers() {
    accelerometerSamples = [];
    gyroscopeSamples = [];
}

// === Sensor Handlers ===

/**
 * Handles a single accelerometer reading
 * @param {Object} reading - { x, y, z } acceleration values
 */
function handleAccelerometerReading({ x = 0, y = 0, z = 0 } = {}) {
    const ts = Date.now();
    const magnitude = Math.sqrt(x * x + y * y + z * z);
    accelerometerSamples.push({ ts, magnitude });
    trimSensorSamples(accelerometerSamples);
}

/**
 * Handles a single gyroscope reading
 * @param {Object} reading - { x, y, z } rotation values
 */
function handleGyroscopeReading({ x = 0, y = 0, z = 0 } = {}) {
    const ts = Date.now();
    const magnitude = Math.sqrt(x * x + y * y + z * z);
    gyroscopeSamples.push({ ts, magnitude });
    trimSensorSamples(gyroscopeSamples);
}

// === Listener Management ===

/**
 * Attaches WeChat sensor listeners
 */
function attachMotionListeners() {
    if (typeof wx.onAccelerometerChange === 'function' && !accelerometerHandler) {
        accelerometerHandler = (reading) => handleAccelerometerReading(reading || {});
        wx.onAccelerometerChange(accelerometerHandler);
    }
    if (typeof wx.onGyroscopeChange === 'function' && !gyroscopeHandler) {
        gyroscopeHandler = (reading) => handleGyroscopeReading(reading || {});
        wx.onGyroscopeChange(gyroscopeHandler);
    }
}

/**
 * Detaches WeChat sensor listeners
 */
function detachMotionListeners() {
    if (accelerometerHandler && typeof wx.offAccelerometerChange === 'function') {
        wx.offAccelerometerChange(accelerometerHandler);
    }
    if (gyroscopeHandler && typeof wx.offGyroscopeChange === 'function') {
        wx.offGyroscopeChange(gyroscopeHandler);
    }
    accelerometerHandler = null;
    gyroscopeHandler = null;
}

// === Sensor Start/Stop ===

/**
 * Starts motion sensors (accelerometer and gyroscope)
 * @returns {Promise<boolean>} Whether at least one sensor started successfully
 */
function startMotionSensors() {
    attachMotionListeners();
    const tasks = [];

    if (typeof wx.startAccelerometer === 'function' && !accelerometerActive) {
        tasks.push(
            new Promise((resolve) => {
                wx.startAccelerometer({
                    interval: 'game',
                    success: () => {
                        accelerometerActive = true;
                        resolve(true);
                    },
                    fail: (err) => {
                        accelerometerActive = false;
                        logger.warn('startAccelerometer failed', err?.errMsg || err?.message || err);
                        resolve(false);
                    },
                });
            })
        );
    }

    if (typeof wx.startGyroscope === 'function' && !gyroscopeActive) {
        tasks.push(
            new Promise((resolve) => {
                wx.startGyroscope({
                    interval: 'game',
                    success: () => {
                        gyroscopeActive = true;
                        resolve(true);
                    },
                    fail: (err) => {
                        gyroscopeActive = false;
                        logger.warn('startGyroscope failed', err?.errMsg || err?.message || err);
                        resolve(false);
                    },
                });
            })
        );
    }

    if (!tasks.length) {
        return Promise.resolve(false);
    }

    return Promise.all(tasks)
        .then((results) => results.some(Boolean))
        .catch(() => false);
}

/**
 * Stops motion sensors
 * @param {Object} options - { clearBuffers: boolean }
 */
function stopMotionSensors({ clearBuffers = false } = {}) {
    detachMotionListeners();

    if (typeof wx.stopAccelerometer === 'function' && accelerometerActive) {
        try {
            wx.stopAccelerometer({ complete: () => { } });
        } catch (_) {
            // Swallow errors
        }
    }

    if (typeof wx.stopGyroscope === 'function' && gyroscopeActive) {
        try {
            wx.stopGyroscope({ complete: () => { } });
        } catch (_) {
            // Swallow errors
        }
    }

    accelerometerActive = false;
    gyroscopeActive = false;

    if (clearBuffers) {
        clearMotionBuffers();
    }
}

// === Statistical Functions ===

/**
 * Computes variance of a numeric array
 * @param {number[]} values - Array of numbers
 * @returns {number|null} Variance or null if insufficient data
 */
function computeVariance(values = []) {
    if (!Array.isArray(values) || values.length < 2) {
        return null;
    }
    const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
    const variance =
        values.reduce((sum, value) => {
            const delta = value - mean;
            return sum + delta * delta;
        }, 0) / values.length;
    return Number.isFinite(variance) ? variance : null;
}

/**
 * Counts zero crossings in sample data (useful for step detection)
 * @param {Array} samples - Sensor samples with { ts, magnitude }
 * @param {number} mean - Mean value to center around
 * @returns {number} Number of zero crossings
 */
function computeZeroCrossings(samples = [], mean = 0) {
    if (!Array.isArray(samples) || samples.length < 2) {
        return 0;
    }
    let lastSign = null;
    let lastTimestamp = 0;
    let crossings = 0;

    samples.forEach((item) => {
        if (!item) {
            return;
        }
        const centered = item.magnitude - mean;
        const sign = centered >= 0 ? 1 : -1;
        if (lastSign !== null && sign !== lastSign) {
            if (!lastTimestamp || item.ts - lastTimestamp >= SENSOR_ZERO_CROSSING_GAP_MS) {
                crossings += 1;
                lastTimestamp = item.ts;
            }
        }
        lastSign = sign;
    });

    return crossings;
}

// === Feature Extraction ===

/**
 * Gets a snapshot of motion features for activity inference
 * @returns {Object} Motion feature snapshot
 */
function getMotionFeatureSnapshot() {
    trimSensorSamples(accelerometerSamples);
    trimSensorSamples(gyroscopeSamples);

    const now = Date.now();
    const accWindow = accelerometerSamples.filter(
        (item) => item && now - item.ts <= SENSOR_WINDOW_MS
    );
    const gyroWindow = gyroscopeSamples.filter(
        (item) => item && now - item.ts <= SENSOR_WINDOW_MS
    );

    const accValues = accWindow.map((item) => item.magnitude);
    const gyroValues = gyroWindow.map((item) => item.magnitude);

    const accVar = computeVariance(accValues);
    const gyroVar = computeVariance(gyroValues);

    const accMean = accValues.length
        ? accValues.reduce((sum, value) => sum + value, 0) / accValues.length
        : 0;
    const accZeroCrossings = accValues.length ? computeZeroCrossings(accWindow, accMean) : 0;

    const windowStartCandidate = Math.min(
        accWindow.length ? accWindow[0].ts : now,
        gyroWindow.length ? gyroWindow[0].ts : now
    );
    const windowMs = windowStartCandidate ? Math.max(0, now - windowStartCandidate) : 0;

    return {
        accVar: accVar !== null ? accVar : null,
        gyroVar: gyroVar !== null ? gyroVar : null,
        accZeroCrossings,
        accSampleCount: accWindow.length,
        gyroSampleCount: gyroWindow.length,
        windowMs,
    };
}

/**
 * Checks if sensors are currently active
 * @returns {Object} Sensor status
 */
function getSensorStatus() {
    return {
        accelerometerActive,
        gyroscopeActive,
        accelerometerSampleCount: accelerometerSamples.length,
        gyroscopeSampleCount: gyroscopeSamples.length,
    };
}

module.exports = {
    // Sensor control
    startMotionSensors,
    stopMotionSensors,
    clearMotionBuffers,
    // Feature extraction
    getMotionFeatureSnapshot,
    getSensorStatus,
    // Statistics (exported for testing)
    computeVariance,
    computeZeroCrossings,
    // Constants (for reference by other modules)
    SENSOR_WINDOW_MS,
};
