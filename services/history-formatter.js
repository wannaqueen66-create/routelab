/**
 * History Formatter Module
 * 处理历史记录展示相关的格式化逻辑
 */

const { formatDuration, formatDate, formatClock, getWeekday } = require('../utils/time');
const { formatDistance, formatCalories } = require('../utils/format');
const { PRIVACY_LEVEL_MAP } = require('../constants/privacy');
const { ACTIVITY_TYPE_MAP, DEFAULT_ACTIVITY_TYPE } = require('../constants/activity');

// === 历史记录筛选器常量 ===
const HISTORY_FILTERS = [
    { key: 'all', label: '全部' },
    { key: 'recent', label: '最近一周' },
    { key: 'walk', label: '步行' },
    { key: 'ride', label: '骑行' },
    { key: 'public', label: '公开' },
    { key: 'private', label: '仅自己' },
];

const HISTORY_RECENT_DAYS = 7;

/**
 * 格式化单条历史路线为展示格式
 * @param {Object} route - 原始路线数据
 * @returns {Object|null} 格式化后的路线数据
 */
function formatHistoryRoute(route) {
    if (!route || typeof route !== 'object') {
        return null;
    }
    const activityType = route.meta?.activityType || route.activityType || DEFAULT_ACTIVITY_TYPE;
    const activityMeta = ACTIVITY_TYPE_MAP[activityType] || ACTIVITY_TYPE_MAP[DEFAULT_ACTIVITY_TYPE];
    const synced = route.synced === true;
    return {
        id: route.id,
        title: route.title || '未命名路线',
        distanceText: formatDistance(route.stats?.distance),
        durationText: formatDuration(route.stats?.duration),
        caloriesText: formatCalories(route.stats?.calories),
        privacyLevel: route.privacyLevel,
        privacyLabel: PRIVACY_LEVEL_MAP[route.privacyLevel]?.label || '未知',
        startDate: formatDate(route.startTime),
        weekLabel: getWeekday(route.startTime),
        startLabel: route.meta?.startLabel || route.campusZone || '起点待识别',
        endLabel: route.meta?.endLabel || '终点待识别',
        activityLabel: activityMeta.label,
        activityType,
        timeRange: `${formatClock(route.startTime)} - ${formatClock(route.endTime)}`,
        photosCount: Array.isArray(route.photos) ? route.photos.length : 0,
        synced,
        syncPending: !synced,
        syncStatusLabel: synced ? '已同步' : '待同步',
    };
}

/**
 * 按条件筛选历史路线
 * @param {Array} routes - 路线列表
 * @param {string} filterKey - 筛选条件
 * @returns {Array} 筛选后的路线列表
 */
function filterHistoryRoutes(routes = [], filterKey = 'all') {
    const list = Array.isArray(routes) ? routes.filter(Boolean) : [];
    if (filterKey === 'recent') {
        const threshold = Date.now() - HISTORY_RECENT_DAYS * 24 * 60 * 60 * 1000;
        return list.filter((route) => route.startTime >= threshold);
    }
    if (filterKey === 'walk') {
        return list.filter(
            (route) => (route.meta?.activityType || route.activityType || DEFAULT_ACTIVITY_TYPE) === 'walk'
        );
    }
    if (filterKey === 'ride') {
        return list.filter(
            (route) => (route.meta?.activityType || route.activityType || DEFAULT_ACTIVITY_TYPE) === 'ride'
        );
    }
    if (filterKey === 'public') {
        return list.filter((route) => route.privacyLevel === 'public');
    }
    if (filterKey === 'private') {
        return list.filter((route) => route.privacyLevel === 'private');
    }
    return list;
}

/**
 * 格式化同步状态信息
 * @param {Object} status - 同步状态
 * @returns {Object} 格式化后的同步信息
 */
function formatSyncInfo(status = {}) {
    const timestamp = Number(status.lastSyncAt);
    const hasTimestamp = Number.isFinite(timestamp) && timestamp > 0;
    const lastError = status.lastError && typeof status.lastError === 'object' ? status.lastError : null;
    return {
        pending: status.pending || 0,
        synced: status.synced || 0,
        deleted: status.deleted || 0,
        total: status.total || 0,
        lastSyncText: hasTimestamp ? `${formatDate(timestamp)} ${formatClock(timestamp)}` : '尚未同步',
        lastErrorMessage: lastError?.message || '',
        lastErrorAt: Number(lastError?.at) || 0,
    };
}

/**
 * 判断地名是否需要修复
 * @param {string} name - 地名
 * @returns {boolean} 是否需要修复
 */
function shouldFixPlaceName(name = '') {
    if (!name || typeof name !== 'string') {
        return true;
    }
    const value = name.trim();
    if (!value) {
        return true;
    }
    if (/^\d+(\.\d+)?\s*,\s*\d+(\.\d+)?$/.test(value)) {
        return true;
    }
    return value.includes('待') || value.includes('未') || value.includes('坐标');
}

module.exports = {
    // 常量导出
    HISTORY_FILTERS,
    HISTORY_RECENT_DAYS,
    // 函数导出
    formatHistoryRoute,
    filterHistoryRoutes,
    formatSyncInfo,
    shouldFixPlaceName,
};
