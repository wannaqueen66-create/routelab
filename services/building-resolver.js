/**
 * Building Resolver Module
 * 处理地理位置反编码、校园关键建筑识别和路线端点解析逻辑
 */

const logger = require('../utils/logger');
const geocodeLocal = require('./geocode-local');
const { calculateSegmentDistance } = require('../utils/geo');

// === 常量定义 ===

const REPRESENTATIVE_SAMPLE_COUNT = 12;
const REPRESENTATIVE_MIN_SAMPLES = 8;
const REPRESENTATIVE_ACCURACY_THRESHOLD = 25;
const MAP_MATCHING_SEGMENT_METERS = 80;
const BUILDING_DISTANCE_TOLERANCE_METERS = 35;

// 建筑物名称白名单，用于识别校园内的关键建筑
const BUILDING_NAME_WHITELIST = [
    /教学楼/i,
    /实验楼/i,
    /综合楼/i,
    /学院/i,
    /体育/i,
    /公寓/i,
    /学生公寓/i,
    /医院/i,
    /图书馆/i,
    /图书馆信息楼/i,
    /信息中心/i,
    /食堂/i,
    /餐厅/i,
    /餐饮/i,
    /宿舍/i,
    /宿舍楼/i,
    /办公楼/i,
    /行政/i,
    /行政楼/i,
    /运动场馆/i,
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
const AMAP_CAMPUS_PLACE_TYPES = '141200|141201|141202|141203|141204|050100|050300|120201|120202|120203|120302';
const AMAP_CAMPUS_PLACE_KEYWORDS = '教学楼|餐厅|图书馆|信息中心|食堂|宿舍|宿舍楼|实验楼|学院|体育馆|运动|办公楼';

// === 辅助函数 ===

function isFiniteNumber(value) {
    return typeof value === 'number' && Number.isFinite(value);
}

function matchesBuildingWhitelistText(text = '') {
    if (!text) return false;
    return BUILDING_NAME_WHITELIST.some((pattern) => pattern.test(text));
}

function extractRoadName(regeo) {
    if (!regeo) {
        return '';
    }
    if (Array.isArray(regeo.roads) && regeo.roads.length) {
        return regeo.roads[0]?.name || '';
    }
    const rawRoads = regeo?.raw?.regeocode?.roads;
    if (Array.isArray(rawRoads) && rawRoads.length) {
        return rawRoads[0]?.name || '';
    }
    const street = regeo?.raw?.regeocode?.addressComponent?.streetNumber?.street;
    return street || '';
}

function extractDistrictName(regeo) {
    if (!regeo) {
        return '';
    }
    const component = regeo?.raw?.regeocode?.addressComponent || {};
    return regeo.district || component.district || component.township || regeo.name || '';
}

function extractCityName(regeo) {
    if (!regeo) {
        return '';
    }
    const component = regeo?.raw?.regeocode?.addressComponent || {};
    const cityField = component.city ?? regeo.city;
    if (typeof cityField === 'string' && cityField) {
        return cityField;
    }
    if (Array.isArray(cityField) && cityField.length) {
        return cityField[0];
    }
    return component.province || regeo.province || '';
}

function precisionWeight(accuracy) {
    if (!isFiniteNumber(accuracy) || accuracy <= 0) {
        return 1;
    }
    return 1 / Math.max(accuracy, 1);
}

function weightedMedian(items = []) {
    if (!Array.isArray(items) || !items.length) {
        return null;
    }
    const filtered = items
        .filter(
            (item) =>
                item &&
                isFiniteNumber(item.value) &&
                isFiniteNumber(item.weight) &&
                item.weight > 0
        )
        .sort((a, b) => a.value - b.value);
    if (!filtered.length) {
        return null;
    }
    const totalWeight = filtered.reduce((sum, item) => sum + item.weight, 0);
    let cumulative = 0;
    for (let idx = 0; idx < filtered.length; idx += 1) {
        cumulative += filtered[idx].weight;
        if (cumulative >= totalWeight / 2) {
            return filtered[idx].value;
        }
    }
    return filtered[filtered.length - 1].value;
}

function collectSegmentWindow(points = [], { fromStart = true, maxDistance = MAP_MATCHING_SEGMENT_METERS } = {}) {
    const startPoint = fromStart ? points[0] : points[points.length - 1];
    if (!startPoint) {
        return [];
    }
    const window = [startPoint];
    let accumulatedDistance = 0;
    const iterate = fromStart
        ? (cb) => {
            for (let i = 1; i < points.length; i++) cb(points[i], points[i - 1]);
        }
        : (cb) => {
            for (let i = points.length - 2; i >= 0; i--) cb(points[i], points[i + 1]);
        };

    iterate((current, prev) => {
        if (accumulatedDistance >= maxDistance) return;
        const step = calculateSegmentDistance(prev, current);
        accumulatedDistance += step;
        if (accumulatedDistance <= maxDistance) {
            window.push(current);
        }
    });

    return window;
}

function collectEndpointSamples(points, { fromStart = true, maxSamples = REPRESENTATIVE_SAMPLE_COUNT } = {}) {
    const count = points.length;
    if (count <= maxSamples) {
        const subset = points.slice();
        if (!fromStart) subset.reverse();
        return subset;
    }
    // 如果点数足够多，选取靠近端点的一定数量样本
    // 这里简化逻辑，只取最近的点，因为已经有 weighted median
    const subset = fromStart ? points.slice(0, maxSamples * 2) : points.slice(-maxSamples * 2).reverse();

    // 按照距离筛选（简单模拟源码逻辑，源码使用了 based on timestamp/index strict/relaxed threshold）
    // 为保持稳健性，我们直接返回这些点，但在计算中会使用权重
    return subset.slice(0, maxSamples);
}


function computePrecisionWeightedMedianPoint(samples = []) {
    if (!Array.isArray(samples) || !samples.length) {
        return null;
    }
    const latMedian = weightedMedian(
        samples.map((sample) => ({
            value: sample.latitude,
            weight: precisionWeight(sample.accuracy),
        }))
    );
    const lonMedian = weightedMedian(
        samples.map((sample) => ({
            value: sample.longitude,
            weight: precisionWeight(sample.accuracy),
        }))
    );
    if (!isFiniteNumber(latMedian) || !isFiniteNumber(lonMedian)) {
        return null;
    }
    const accuracyMedian = weightedMedian(
        samples.map((sample) => ({
            value: isFiniteNumber(sample.accuracy) ? sample.accuracy : REPRESENTATIVE_ACCURACY_THRESHOLD,
            weight: precisionWeight(sample.accuracy),
        }))
    );
    const timestampMedian = weightedMedian(
        samples.map((sample) => ({
            value: Number.isFinite(sample.timestamp) ? Number(sample.timestamp) : 0,
            weight: precisionWeight(sample.accuracy),
        }))
    );
    return {
        latitude: latMedian,
        longitude: lonMedian,
        accuracy: isFiniteNumber(accuracyMedian) ? accuracyMedian : REPRESENTATIVE_ACCURACY_THRESHOLD,
        timestamp: Number.isFinite(timestampMedian) ? timestampMedian : Date.now(),
    };
}

function refineRepresentativePoint(points = [], basePoint = null, { fromStart = true } = {}) {
    if (!basePoint) {
        return null;
    }
    const segmentPoints = collectSegmentWindow(points, { fromStart, maxDistance: MAP_MATCHING_SEGMENT_METERS });
    if (!segmentPoints.length) {
        return basePoint;
    }
    const sortedByAccuracy = segmentPoints
        .filter((item) => item && isFiniteNumber(item.accuracy))
        .sort((a, b) => a.accuracy - b.accuracy);
    const bestCandidate = sortedByAccuracy[0] || segmentPoints[segmentPoints.length - 1];
    if (!bestCandidate) {
        return basePoint;
    }
    const baseWeight = precisionWeight(basePoint.accuracy);
    const candidateWeight = precisionWeight(bestCandidate.accuracy);
    const totalWeight = baseWeight + candidateWeight || 1;
    const latitude =
        (basePoint.latitude * baseWeight + bestCandidate.latitude * candidateWeight) / totalWeight;
    const longitude =
        (basePoint.longitude * baseWeight + bestCandidate.longitude * candidateWeight) / totalWeight;
    const refinedAccuracy = Math.min(
        isFiniteNumber(basePoint.accuracy) ? basePoint.accuracy : REPRESENTATIVE_ACCURACY_THRESHOLD,
        isFiniteNumber(bestCandidate.accuracy) ? bestCandidate.accuracy : REPRESENTATIVE_ACCURACY_THRESHOLD
    );
    const segmentTimestamp = fromStart
        ? segmentPoints[0]?.timestamp
        : segmentPoints[segmentPoints.length - 1]?.timestamp;
    return {
        latitude,
        longitude,
        accuracy: refinedAccuracy,
        timestamp: Number.isFinite(segmentTimestamp) ? segmentTimestamp : basePoint.timestamp,
    };
}

function evaluateCandidate(candidate, basePoint) {
    if (!candidate) {
        return null;
    }
    const latitude = Number(candidate.latitude);
    const longitude = Number(candidate.longitude);
    if (!isFiniteNumber(latitude) || !isFiniteNumber(longitude)) {
        return null;
    }
    let distance = Number(candidate.distance);
    if (!isFiniteNumber(distance) || distance < 0) {
        distance =
            basePoint && isFiniteNumber(basePoint.latitude) && isFiniteNumber(basePoint.longitude)
                ? calculateSegmentDistance(basePoint, { latitude, longitude })
                : null;
    }
    return {
        name: candidate.name || '',
        type: candidate.type || '',
        typecode: candidate.typecode || '',
        latitude,
        longitude,
        distance,
        address: candidate.address || '',
        raw: candidate.raw || candidate,
        whitelist:
            matchesBuildingWhitelistText(candidate.name || '') ||
            matchesBuildingWhitelistText(candidate.type || ''),
        source: candidate.source || (candidate.raw && candidate.raw.source) || '',
    };
}

function pickBestCandidate(candidates = [], basePoint, { requireWhitelist = false, radius = 80, source = '' } = {}) {
    if (!Array.isArray(candidates) || !candidates.length) {
        return null;
    }
    let best = null;
    candidates.forEach((candidate) => {
        const normalized = evaluateCandidate(candidate, basePoint);
        if (!normalized) {
            return;
        }
        if (requireWhitelist && !normalized.whitelist) {
            return;
        }
        if (Number.isFinite(radius) && normalized.distance !== null && normalized.distance > radius) {
            return;
        }
        const distanceScore = normalized.distance !== null ? normalized.distance : 100000;
        const whitelistScore = normalized.whitelist ? 0 : 10000;
        const score = whitelistScore + distanceScore;
        if (!best || score < best.score) {
            best = {
                ...normalized,
                score,
                source: source || normalized.source || 'amap',
            };
        }
    });
    return best;
}

// === 核心解析函数 ===

function resolveBuildingLocation(basePoint, { direction = 'start' } = {}) {
    if (!basePoint || !isFiniteNumber(basePoint.latitude) || !isFiniteNumber(basePoint.longitude)) {
        return Promise.resolve(null);
    }
    let detailed = null;
    let buildingCandidate = null;
    let fallbackPoiCandidate = null;

    const radius = direction === 'start' ? 60 : 65;

    return geocodeLocal
        .reverseGeocodeDetailed({
            latitude: basePoint.latitude,
            longitude: basePoint.longitude,
            radius,
        })
        .then((response) => {
            detailed = response || null;
            if (detailed) {
                const combinedCandidates = [
                    ...(Array.isArray(detailed.aois) ? detailed.aois : []),
                    ...(Array.isArray(detailed.pois) ? detailed.pois : []),
                ];
                buildingCandidate =
                    pickBestCandidate(combinedCandidates, basePoint, {
                        requireWhitelist: true,
                        radius,
                        source: 'amap-regeo',
                    }) || null;
                if (!buildingCandidate) {
                    fallbackPoiCandidate =
                        pickBestCandidate(detailed.pois || [], basePoint, {
                            requireWhitelist: false,
                            radius: Math.max(radius, 70),
                            source: 'amap-regeo',
                        }) || null;
                }
            }
            return null;
        })
        .catch((error) => {
            logger.warn('Detailed reverse geocode failed', {
                endpoint: direction,
                message: error?.errMsg || error?.message || error,
            });
            detailed = null;
        })
        .then(() =>
            geocodeLocal
                .searchAmapPlaceAround({
                    latitude: basePoint.latitude,
                    longitude: basePoint.longitude,
                    radius: 80,
                    types: AMAP_CAMPUS_PLACE_TYPES,
                    keywords: AMAP_CAMPUS_PLACE_KEYWORDS,
                })
                .then((pois) => {
                    const normalizedPois = Array.isArray(pois) ? pois : [];
                    if (!buildingCandidate) {
                        buildingCandidate =
                            pickBestCandidate(normalizedPois, basePoint, {
                                requireWhitelist: true,
                                radius: 80,
                                source: 'amap-place',
                            }) || null;
                    }
                    if (!fallbackPoiCandidate) {
                        fallbackPoiCandidate =
                            pickBestCandidate(normalizedPois, basePoint, {
                                requireWhitelist: false,
                                radius: 80,
                                source: 'amap-place',
                            }) || null;
                    }
                    return null;
                })
                .catch((error) => {
                    logger.warn('Nearby place search failed', {
                        endpoint: direction,
                        message: error?.errMsg || error?.message || error,
                    });
                })
        )
        .then(() => {
            const withinTolerance =
                buildingCandidate &&
                (buildingCandidate.distance === null || buildingCandidate.distance <= BUILDING_DISTANCE_TOLERANCE_METERS);

            const hierarchy = {
                building: withinTolerance ? buildingCandidate?.name || '' : '',
                poi: '',
                road: extractRoadName(detailed),
                district: extractDistrictName(detailed),
                city: extractCityName(detailed),
            };

            if (!withinTolerance && (buildingCandidate?.name || fallbackPoiCandidate?.name)) {
                hierarchy.poi = buildingCandidate?.name || fallbackPoiCandidate?.name || '';
            } else if (fallbackPoiCandidate?.name) {
                hierarchy.poi = fallbackPoiCandidate.name;
            }

            const level = hierarchy.building
                ? 'building'
                : hierarchy.poi
                    ? 'poi'
                    : hierarchy.road
                        ? 'road'
                        : hierarchy.district
                            ? 'district'
                            : hierarchy.city
                                ? 'city'
                                : 'unknown';

            const preferredName =
                hierarchy[level] ||
                buildingCandidate?.name ||
                fallbackPoiCandidate?.name ||
                detailed?.displayName ||
                detailed?.name ||
                '';

            return {
                name: preferredName,
                displayName: preferredName || detailed?.displayName || '',
                address: detailed?.address || null,
                raw: {
                    regeo: detailed?.raw || null,
                    candidate: buildingCandidate?.raw || buildingCandidate || null,
                    fallbackPoi: fallbackPoiCandidate?.raw || fallbackPoiCandidate || null,
                },
                source: hierarchy.building
                    ? buildingCandidate?.source || 'amap-regeo'
                    : hierarchy.poi
                        ? (buildingCandidate?.source || fallbackPoiCandidate?.source || 'amap-place')
                        : detailed
                            ? 'amap-regeo'
                            : 'amap-place',
                level,
                distance: hierarchy.building
                    ? buildingCandidate?.distance ?? null
                    : fallbackPoiCandidate?.distance ?? buildingCandidate?.distance ?? null,
                coordinate: {
                    latitude: basePoint.latitude,
                    longitude: basePoint.longitude,
                },
                hierarchy,
                accuracy: basePoint.accuracy,
            };
        });
}

function resolveLocationLabel(location) {
    if (!location) {
        return '';
    }
    const hierarchy = location.hierarchy || {};
    for (let idx = 0; idx < FALLBACK_BUILDING_NAME_PRIORITY.length; idx += 1) {
        const key = FALLBACK_BUILDING_NAME_PRIORITY[idx];
        if (hierarchy[key]) {
            return hierarchy[key];
        }
    }
    return location.name || location.displayName || '';
}

function logEndpointResolution(direction, representative, location, signalQuality) {
    logger.info('Tracker endpoint resolved', {
        endpoint: direction,
        representative: representative
            ? {
                latitude: isFiniteNumber(representative.latitude)
                    ? Number(representative.latitude.toFixed(6))
                    : null,
                longitude: isFiniteNumber(representative.longitude)
                    ? Number(representative.longitude.toFixed(6))
                    : null,
                accuracy: representative.accuracy,
            }
            : null,
        location: location
            ? {
                name: location.name,
                level: location.level,
                source: location.source,
                distance: location.distance,
            }
            : null,
        signalQuality: signalQuality,
    });
}

function resolveEndpoint(points = [], { fromStart = true, signalQuality = 'unknown' } = {}) {
    if (!Array.isArray(points) || !points.length) {
        return Promise.resolve({ point: null, location: null });
    }
    const samples = collectEndpointSamples(points, { fromStart });
    let representative = computePrecisionWeightedMedianPoint(samples);
    if (!representative) {
        const fallback = fromStart ? points[0] : points[points.length - 1];
        if (fallback) {
            representative = {
                latitude: fallback.latitude,
                longitude: fallback.longitude,
                accuracy: fallback.accuracy,
                timestamp: fallback.timestamp,
            };
        }
    }
    if (!representative) {
        return Promise.resolve({ point: null, location: null });
    }
    const refined = refineRepresentativePoint(points, representative, { fromStart }) || representative;
    return resolveBuildingLocation(refined, { direction: fromStart ? 'start' : 'end' })
        .then((location) => {
            logEndpointResolution(fromStart ? 'start' : 'end', refined, location, signalQuality);
            return { point: refined, location };
        })
        .catch((error) => {
            logger.warn('Resolve endpoint failed', {
                endpoint: fromStart ? 'start' : 'end',
                message: error?.errMsg || error?.message || error,
            });
            return { point: refined, location: null };
        });
}

module.exports = {
    resolveEndpoint,
    resolveBuildingLocation,
    resolveLocationLabel,
    // 导出辅助函数方便单元测试
    matchesBuildingWhitelistText,
    evaluateCandidate,
    pickBestCandidate,
};
