function hasOwn(object, key) {
    return Object.prototype.hasOwnProperty.call(object || {}, key);
}

function isPlainObject(value) {
    if (!value || typeof value !== 'object') {
        return false;
    }
    return Object.getPrototypeOf(value) === Object.prototype;
}

function ensurePlainObject(value) {
    // Simple version found in deriveRouteAnalytics dependencies
    if (value && typeof value === 'object' && !Array.isArray(value)) {
        return value;
    }
    return {};
}

module.exports = {
    hasOwn,
    isPlainObject,
    ensurePlainObject
}
