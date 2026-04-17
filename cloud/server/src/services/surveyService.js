'use strict';

const jwt = require('jsonwebtoken');
const {
    JWT_SECRET,
    PUBLIC_APP_BASE_URL,
    SURVEY_POWERCX_KEY,
    SURVEY_POWERCX_ENABLED,
    SURVEY_POWERCX_TITLE,
    SURVEY_POWERCX_URL,
    SURVEY_POWERCX_VERSION,
    SURVEY_POWERCX_STATE_EXPIRES_IN,
} = require('../config/index');

const SURVEY_START_PATH = '/api/public/surveys/powercx/start';
const SURVEY_COMPLETE_PATH = '/api/public/surveys/powercx/complete';
const SURVEY_STATE_COOKIE = 'rlab_powercx_state';
const SURVEY_COOKIE_MAX_AGE_SECONDS = 2 * 60 * 60;

function normalizeString(value) {
    return typeof value === 'string' ? value.trim() : '';
}

function firstNonEmpty(values = []) {
    for (const item of values) {
        const normalized = normalizeString(item);
        if (normalized) {
            return normalized;
        }
    }
    return '';
}

function buildQueryString(query = {}) {
    return Object.keys(query)
        .filter((key) => query[key] !== undefined && query[key] !== null && query[key] !== '')
        .map((key) => `${encodeURIComponent(key)}=${encodeURIComponent(query[key])}`)
        .join('&');
}

function appendQuery(url, query = {}) {
    const base = normalizeString(url);
    const queryString = buildQueryString(query);
    if (!base || !queryString) {
        return base;
    }
    const hashIndex = base.indexOf('#');
    const hash = hashIndex >= 0 ? base.slice(hashIndex) : '';
    const beforeHash = hashIndex >= 0 ? base.slice(0, hashIndex) : base;
    const separator = beforeHash.includes('?') ? '&' : '?';
    return `${beforeHash}${separator}${queryString}${hash}`;
}

function escapeHtml(value = '') {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function getPowercxSurveyConfig() {
    const title = normalizeString(SURVEY_POWERCX_TITLE) || '开始记录前问卷';
    const url = normalizeString(SURVEY_POWERCX_URL);
    const version = normalizeString(SURVEY_POWERCX_VERSION);
    const callbackUrl = `${PUBLIC_APP_BASE_URL}${SURVEY_COMPLETE_PATH}`;
    const urlValid = /^https?:\/\/\S+$/i.test(url);
    const versionValid = Boolean(version);
    return {
        key: SURVEY_POWERCX_KEY,
        enabled: SURVEY_POWERCX_ENABLED === true,
        title,
        url,
        version,
        callbackUrl,
        startUrlBase: `${PUBLIC_APP_BASE_URL}${SURVEY_START_PATH}`,
        urlValid,
        versionValid,
        valid: SURVEY_POWERCX_ENABLED !== true || (urlValid && versionValid),
    };
}

function createSurveyStateToken({ userId, source = 'manual' } = {}) {
    if (!JWT_SECRET) {
        throw new Error('JWT secret is required');
    }
    const config = getPowercxSurveyConfig();
    const normalizedUserId = Number(userId);
    if (!Number.isFinite(normalizedUserId) || normalizedUserId <= 0) {
        throw new Error('Valid userId is required');
    }
    return jwt.sign(
        {
            purpose: 'survey_state',
            surveyKey: config.key,
            surveyVersion: config.version,
            userId: Math.floor(normalizedUserId),
            source: normalizeString(source) || 'manual',
        },
        JWT_SECRET,
        { expiresIn: SURVEY_POWERCX_STATE_EXPIRES_IN }
    );
}

function verifySurveyStateToken(token = '') {
    if (!JWT_SECRET) {
        throw new Error('JWT secret is required');
    }
    const payload = jwt.verify(normalizeString(token), JWT_SECRET);
    if (!payload || payload.purpose !== 'survey_state') {
        throw new Error('Invalid survey state token');
    }
    return payload;
}

function parseCookies(cookieHeader = '') {
    return String(cookieHeader || '')
        .split(';')
        .map((segment) => segment.trim())
        .filter(Boolean)
        .reduce((acc, segment) => {
            const index = segment.indexOf('=');
            if (index <= 0) {
                return acc;
            }
            const key = segment.slice(0, index).trim();
            const value = segment.slice(index + 1).trim();
            acc[key] = decodeURIComponent(value);
            return acc;
        }, {});
}

function getSurveyStateFromRequest(req) {
    const queryState = normalizeString(req?.query?.state);
    if (queryState) {
        return verifySurveyStateToken(queryState);
    }
    const cookies = parseCookies(req?.headers?.cookie || '');
    const cookieState = normalizeString(cookies[SURVEY_STATE_COOKIE]);
    if (!cookieState) {
        throw new Error('Survey state cookie missing');
    }
    return verifySurveyStateToken(cookieState);
}

function buildSurveyStateCookie(token) {
    return [
        `${SURVEY_STATE_COOKIE}=${encodeURIComponent(token)}`,
        `Max-Age=${SURVEY_COOKIE_MAX_AGE_SECONDS}`,
        'Path=/api/public/surveys/powercx',
        'HttpOnly',
        'Secure',
        'SameSite=Lax',
    ].join('; ');
}

function buildSurveyStateCookieClear() {
    return [
        `${SURVEY_STATE_COOKIE}=`,
        'Max-Age=0',
        'Path=/api/public/surveys/powercx',
        'HttpOnly',
        'Secure',
        'SameSite=Lax',
    ].join('; ');
}

function buildPowercxSurveyEntryUrl({ userId, source = 'manual', state = '' } = {}) {
    const config = getPowercxSurveyConfig();
    const userIdText =
        userId === undefined || userId === null ? '' : String(userId).trim();
    return appendQuery(config.url, {
        userId: userIdText,
        source: normalizeString(source) || 'manual',
        from: 'wechat_miniprogram',
        surveyVersion: config.version,
        state: normalizeString(state),
    });
}

function normalizePowercxCallback(query = {}) {
    return {
        respondentId: firstNonEmpty([
            query.respondentId,
            query.respondent_id,
            query.responseId,
            query.response_id,
            query.rid,
        ]),
        responseStatus: firstNonEmpty([
            query.responseStatus,
            query.response_status,
            query.answerStatus,
            query.answer_status,
            query.status,
            query.result,
        ]),
        rawPayload: query && typeof query === 'object' ? { ...query } : {},
    };
}

function toTimestamp(value) {
    if (value instanceof Date) {
        return value.getTime();
    }
    const candidate = Number(value);
    return Number.isFinite(candidate) ? candidate : null;
}

function buildSurveyStatusPayload(row) {
    const config = getPowercxSurveyConfig();
    const normalizedRow = row || {};
    const completedVersion = normalizeString(normalizedRow.survey_version);
    const responseStatus = normalizeString(normalizedRow.response_status);
    const respondentId = normalizeString(normalizedRow.respondent_id);
    const completedAt = toTimestamp(normalizedRow.completed_at);
    const updatedAt = toTimestamp(normalizedRow.updated_at);
    return {
        surveyKey: config.key,
        surveyEnabled: config.enabled,
        surveyVersion: config.version,
        surveyTitle: config.title,
        callbackUrl: config.callbackUrl,
        currentVersionCompleted:
            Boolean(completedAt) &&
            completedVersion === config.version,
        completedVersion,
        completedAt,
        updatedAt,
        responseStatus,
        respondentId,
    };
}

function renderSurveyCompletionHtml({ success, title, message, details = '' } = {}) {
    const pageTitle = escapeHtml(title || (success ? '问卷提交成功' : '问卷提交未完成'));
    const pageMessage = escapeHtml(message || '');
    const pageDetails = details ? `<p class="details">${escapeHtml(details)}</p>` : '';
    const toneClass = success ? 'success' : 'warning';

    return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1" />
  <title>${pageTitle}</title>
  <style>
    :root { color-scheme: light; }
    body {
      margin: 0;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background: #f8fafc;
      color: #0f172a;
    }
    .wrap {
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 24px;
      box-sizing: border-box;
    }
    .card {
      width: 100%;
      max-width: 520px;
      background: #ffffff;
      border-radius: 24px;
      box-shadow: 0 16px 48px rgba(15, 23, 42, 0.12);
      padding: 28px 24px;
      box-sizing: border-box;
    }
    .badge {
      display: inline-block;
      border-radius: 999px;
      padding: 6px 12px;
      font-size: 13px;
      font-weight: 600;
      margin-bottom: 16px;
    }
    .badge.success { background: #dcfce7; color: #166534; }
    .badge.warning { background: #fee2e2; color: #b91c1c; }
    h1 {
      margin: 0 0 12px;
      font-size: 24px;
      line-height: 1.4;
    }
    p {
      margin: 0;
      font-size: 15px;
      line-height: 1.8;
      color: #334155;
    }
    .details {
      margin-top: 14px;
      color: #64748b;
      font-size: 13px;
    }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="card">
      <div class="badge ${toneClass}">${success ? '已同步到 RouteLab' : '未能同步到 RouteLab'}</div>
      <h1>${pageTitle}</h1>
      <p>${pageMessage}</p>
      ${pageDetails}
    </div>
  </div>
</body>
</html>`;
}

module.exports = {
    SURVEY_START_PATH,
    SURVEY_COMPLETE_PATH,
    SURVEY_STATE_COOKIE,
    getPowercxSurveyConfig,
    createSurveyStateToken,
    verifySurveyStateToken,
    getSurveyStateFromRequest,
    buildSurveyStateCookie,
    buildSurveyStateCookieClear,
    buildPowercxSurveyEntryUrl,
    normalizePowercxCallback,
    buildSurveyStatusPayload,
    renderSurveyCompletionHtml,
};
