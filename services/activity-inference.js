/**
 * Activity Inference Module
 * Handles activity type detection (idle/walk/run/ride) and state stabilization
 * for the WeChat Mini Program fitness tracker.
 */

const { DEFAULT_ACTIVITY_TYPE, ACTIVITY_TYPE_MAP } = require('../constants/activity');
const { inferActivityType } = require('../utils/activity');

// === Constants ===
const ACTIVITY_UPGRADE_DURATION_MS = 3000;
const ACTIVITY_DOWNGRADE_DURATION_MS = 5000;
const ACTIVITY_RIDE_DOWNGRADE_DURATION_MS = 7000;

// Speed thresholds for activity detection
const STILL_SPEED_THRESHOLD_MPS = 0.5;
const WALK_SPEED_MAX_MPS = 1.8;

// === State ===
let activityStabilizer = {
    current: DEFAULT_ACTIVITY_TYPE,
    candidate: DEFAULT_ACTIVITY_TYPE,
    candidateSince: 0,
    lastChangeAt: 0,
};

// === Priority Functions ===

/**
 * Gets the priority level of an activity type
 * Higher priority activities require longer duration to downgrade
 * @param {string} activityType - Activity type
 * @returns {number} Priority level (1=walk, 2=run, 3=ride)
 */
function getActivityPriority(activityType) {
    if (activityType === 'ride') {
        return 3;
    }
    if (activityType === 'run') {
        return 2;
    }
    return 1;
}

// === Hysteresis Logic ===

/**
 * Applies hysteresis to activity type changes to prevent rapid oscillation
 * @param {string} candidateType - New detected activity type
 * @param {Object} options - { now: timestamp }
 * @returns {string} Stabilized activity type
 */
function applyActivityHysteresis(candidateType, { now = Date.now() } = {}) {
    const normalized = ACTIVITY_TYPE_MAP[candidateType] ? candidateType : DEFAULT_ACTIVITY_TYPE;
    const current = activityStabilizer.current || DEFAULT_ACTIVITY_TYPE;

    if (!ACTIVITY_TYPE_MAP[current]) {
        activityStabilizer.current = DEFAULT_ACTIVITY_TYPE;
    }

    // Track new candidate
    if (activityStabilizer.candidate !== normalized) {
        activityStabilizer.candidate = normalized;
        activityStabilizer.candidateSince = now;
    }

    const currentPriority = getActivityPriority(current);
    const candidatePriority = getActivityPriority(normalized);
    const isUpgrade = candidatePriority > currentPriority;
    const isDowngrade = candidatePriority < currentPriority;

    // Determine required duration for state change
    let requiredDuration = 0;
    if (isUpgrade) {
        requiredDuration = ACTIVITY_UPGRADE_DURATION_MS;
    } else if (current === 'ride' && isDowngrade) {
        requiredDuration = ACTIVITY_RIDE_DOWNGRADE_DURATION_MS;
    } else if (isDowngrade) {
        requiredDuration = ACTIVITY_DOWNGRADE_DURATION_MS;
    }

    const elapsed = now - (activityStabilizer.candidateSince || now);

    if (!requiredDuration || elapsed >= requiredDuration) {
        activityStabilizer.current = normalized;
        activityStabilizer.lastChangeAt = now;
        activityStabilizer.candidateSince = now;
        return normalized;
    }

    return activityStabilizer.current || normalized;
}

// === Main Detection Function ===

/**
 * Updates and returns the detected activity type based on motion and GPS data
 * @param {Object} params - Detection parameters
 * @param {Object} params.trackerState - Current tracker state
 * @param {Object} params.sensorStats - Motion sensor statistics
 * @param {string|null} params.override - Manual activity type override
 * @returns {string} Detected/stabilized activity type
 */
function updateDetectedActivityType({ trackerState, sensorStats, override = null }) {
    const now = Date.now();

    // Check for manual override
    if (override && ACTIVITY_TYPE_MAP[override]) {
        activityStabilizer = {
            current: override,
            candidate: override,
            candidateSince: now,
            lastChangeAt: now,
        };
        return override;
    }

    // Infer activity from data
    const detected = inferActivityType({
        distance: trackerState.stats?.distance || 0,
        duration: trackerState.stats?.duration || 0,
        speed: trackerState.stats?.speed || 0,
        points: trackerState.points || [],
        sensorStats,
    });

    // Apply hysteresis for stability
    const stabilized = applyActivityHysteresis(detected || DEFAULT_ACTIVITY_TYPE, { now });

    return stabilized;
}

// === State Management ===

/**
 * Resets the activity inference state
 */
function resetActivityState() {
    activityStabilizer = {
        current: DEFAULT_ACTIVITY_TYPE,
        candidate: DEFAULT_ACTIVITY_TYPE,
        candidateSince: 0,
        lastChangeAt: 0,
    };
}

/**
 * Gets the current activity stabilizer state
 * @returns {Object} Current stabilizer state
 */
function getActivityState() {
    return { ...activityStabilizer };
}

/**
 * Sets the activity state directly (for recovery/restore scenarios)
 * @param {Object} state - State to restore
 */
function setActivityState(state) {
    if (state && typeof state === 'object') {
        activityStabilizer = {
            current: state.current || DEFAULT_ACTIVITY_TYPE,
            candidate: state.candidate || DEFAULT_ACTIVITY_TYPE,
            candidateSince: state.candidateSince || 0,
            lastChangeAt: state.lastChangeAt || 0,
        };
    }
}

// === Stillness Detection ===

/**
 * Checks if current speed indicates stillness
 * @param {number} speed - Current speed in m/s
 * @returns {boolean} Whether user is still
 */
function isStill(speed) {
    return speed < STILL_SPEED_THRESHOLD_MPS;
}

/**
 * Checks if current speed indicates walking
 * @param {number} speed - Current speed in m/s
 * @returns {boolean} Whether user is walking
 */
function isWalking(speed) {
    return speed >= STILL_SPEED_THRESHOLD_MPS && speed <= WALK_SPEED_MAX_MPS;
}

/**
 * Checks if current speed indicates running
 * @param {number} speed - Current speed in m/s
 * @returns {boolean} Whether user is running
 */
function isRunning(speed) {
    return speed > WALK_SPEED_MAX_MPS;
}

module.exports = {
    // Main functions
    updateDetectedActivityType,
    applyActivityHysteresis,
    getActivityPriority,
    // State management
    resetActivityState,
    getActivityState,
    setActivityState,
    // Speed checks
    isStill,
    isWalking,
    isRunning,
    // Constants export
    STILL_SPEED_THRESHOLD_MPS,
    WALK_SPEED_MAX_MPS,
    ACTIVITY_UPGRADE_DURATION_MS,
    ACTIVITY_DOWNGRADE_DURATION_MS,
};
