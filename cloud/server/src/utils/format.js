const { TEXTUAL_MIME_TYPES, TEXTUAL_MIME_PREFIXES, ALLOWED_INTERP_METHODS, ROUTE_ID_PATTERN } = require('../config/constants');

function sanitizeEnumValue(value, allowedValues) {
    if (typeof value !== 'string') {
        return '';
    }
    const normalized = value.trim().toLowerCase();
    if (!normalized) {
        return '';
    }
    return allowedValues.has(normalized) ? normalized : '';
}

function isTextualMimeType(mime) {
    if (!mime) {
        return false;
    }
    if (TEXTUAL_MIME_TYPES.has(mime)) {
        return true;
    }
    if (TEXTUAL_MIME_PREFIXES.some((prefix) => mime.startsWith(prefix))) {
        return true;
    }
    if (mime.endsWith('+json') || mime.endsWith('+xml')) {
        return true;
    }
    return false;
}

function ensureUtf8ContentType(value) {
    if (typeof value !== 'string') {
        return value;
    }
    const segments = value
        .split(';')
        .map((segment) => segment.trim())
        .filter(Boolean);
    if (!segments.length) {
        return value;
    }
    const [type, ...params] = segments;
    const normalizedType = type.toLowerCase();
    if (!isTextualMimeType(normalizedType)) {
        return value;
    }
    const hasCharset = params.some((param) => param.toLowerCase().startsWith('charset='));
    if (hasCharset) {
        return [type, ...params].join('; ');
    }
    return [type, 'charset=utf-8', ...params].join('; ');
}

function normalizePointSource(value) {
    if (typeof value !== 'string') {
        return 'gps';
    }
    const normalized = value.trim().toLowerCase();
    if (!normalized) {
        return 'gps';
    }
    return normalized === 'interp' ? 'interp' : 'gps';
}

function normalizeSourceDetail(value) {
    if (typeof value !== 'string') {
        return null;
    }
    const trimmed = value.trim();
    return trimmed.length ? trimmed : null;
}

function normalizeInterpMethod(value) {
    if (typeof value !== 'string') {
        return null;
    }
    const method = value.trim().toLowerCase();
    if (!method) {
        return null;
    }
    return ALLOWED_INTERP_METHODS.has(method) ? method : null;
}

function normalizeRouteId(value) {
    if (value === null || value === undefined) {
        return null;
    }
    const id = String(value).trim();
    if (!id) {
        return null;
    }
    if (id.length < 6 || id.length > 128) {
        return null;
    }
    if (!ROUTE_ID_PATTERN.test(id)) {
        return null;
    }
    return id;
}

function buildHttpError(statusCode, message, details = undefined) {
    const error = new Error(message);
    error.statusCode = statusCode;
    if (details !== undefined) {
        error.details = details;
    }
    return error;
}

module.exports = {
    sanitizeEnumValue,
    isTextualMimeType,
    ensureUtf8ContentType,
    normalizePointSource,
    normalizeSourceDetail,
    normalizeInterpMethod,
    normalizeRouteId,
    buildHttpError
};
