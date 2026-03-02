const BUILDING_NAME_WHITELIST = [
    /教学楼/i,
    /实验楼/i,
    /综合楼/i,
    /学院/i,
    /图书馆/i,
    /信息中心/i,
    /学生公寓/i,
    /宿舍/i,
    /办公楼/i,
    /行政楼/i,
    /体育馆/i,
    /运动中心/i,
    /礼堂/i,
    /食堂/i,
    /餐厅/i,
    /auditorium/i,
    /library/i,
    /dining/i,
    /canteen/i,
    /administration/i,
    /office/i,
    /laboratory/i,
    /lab/i,
    /dormitory/i,
];

const FALLBACK_BUILDING_NAME_PRIORITY = ['building', 'poi', 'road', 'district', 'city'];

const ALLOWED_INTERP_METHODS = new Set(['linear', 'snap_road', 'spline', 'gap_fill']);

const TEXTUAL_MIME_PREFIXES = ['text/'];
const TEXTUAL_MIME_TYPES = new Set([
    'application/json',
    'application/ld+json',
    'application/manifest+json',
    'application/vnd.api+json',
    'application/graphql+json',
    'application/javascript',
    'text/javascript',
    'application/xml',
    'text/xml',
    'application/rss+xml',
    'application/atom+xml',
    'image/svg+xml',
    'application/x-www-form-urlencoded',
    'text/csv',
    'application/csv',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
]);

const ROUTE_POINT_INSERT_COLUMNS = [
    'route_id',
    'latitude',
    'longitude',
    'altitude',
    'speed',
    'heading',
    'accuracy',
    'recorded_at',
    'source',
    'source_detail',
    'interp_method',
];

const ROUTE_ID_PATTERN = /^[\w\-:.]{6,128}$/;
const EARTH_RADIUS = 6371000; // meters

module.exports = {
    BUILDING_NAME_WHITELIST,
    FALLBACK_BUILDING_NAME_PRIORITY,
    ALLOWED_INTERP_METHODS,
    TEXTUAL_MIME_PREFIXES,
    TEXTUAL_MIME_TYPES,
    ROUTE_POINT_INSERT_COLUMNS,
    ROUTE_ID_PATTERN,
    EARTH_RADIUS
};
