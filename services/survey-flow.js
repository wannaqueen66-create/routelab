'use strict';

const config = require('../config/saaa-config');
const api = require('./api');

const DEFAULT_SURVEY_TITLE = '开始记录前问卷';
const DEFAULT_NEXT_URL = '/pages/record/record';
const SURVEY_GATE_ROUTE = '/pages/survey-gate/survey-gate';
const SURVEY_WEBVIEW_ROUTE = '/pages/survey-webview/survey-webview';

function normalizeString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function safeDecodeURIComponent(value = '') {
  const input = typeof value === 'string' ? value : '';
  if (!input) {
    return '';
  }
  try {
    return decodeURIComponent(input);
  } catch (_) {
    return input;
  }
}

function buildConfigErrorMessage({ urlValid, versionValid }) {
  if (!urlValid && !versionValid) {
    return '请在 survey.url 和 survey.version 中补全问卷链接与版本号';
  }
  if (!urlValid) {
    return '请在 survey.url 中配置有效的问卷链接';
  }
  if (!versionValid) {
    return '请在 survey.version 中配置当前问卷版本号';
  }
  return '';
}

function getSurveyConfig() {
  const raw = config && config.survey && typeof config.survey === 'object' ? config.survey : {};
  const enabled = raw.enabled === true;
  const title = normalizeString(raw.title) || DEFAULT_SURVEY_TITLE;
  const url = normalizeString(raw.url);
  const version = normalizeString(raw.version);
  const urlValid = /^https?:\/\/\S+$/i.test(url);
  const versionValid = Boolean(version);
  const valid = !enabled || (urlValid && versionValid);

  return {
    enabled,
    title,
    url,
    version,
    urlValid,
    versionValid,
    valid,
    errorMessage: enabled && !valid ? buildConfigErrorMessage({ urlValid, versionValid }) : '',
  };
}

function resolveNextUrl(nextUrl = '') {
  const raw = normalizeString(nextUrl);
  const decoded = safeDecodeURIComponent(raw);
  if (!decoded) {
    return DEFAULT_NEXT_URL;
  }
  const candidate = decoded.split('#')[0];
  const path = candidate.split('?')[0];
  if (!path.startsWith('/pages/')) {
    return DEFAULT_NEXT_URL;
  }
  return candidate;
}

function buildSurveyGateUrl({ next = DEFAULT_NEXT_URL, source = 'manual' } = {}) {
  return (
    SURVEY_GATE_ROUTE +
    '?next=' +
    encodeURIComponent(resolveNextUrl(next)) +
    '&source=' +
    encodeURIComponent(normalizeString(source) || 'manual')
  );
}

function normalizeSurveyStatus(payload = {}) {
  return {
    surveyEnabled: payload.surveyEnabled === true,
    surveyVersion: normalizeString(payload.surveyVersion),
    surveyTitle: normalizeString(payload.surveyTitle),
    callbackUrl: normalizeString(payload.callbackUrl),
    currentVersionCompleted: payload.currentVersionCompleted === true,
    completedVersion: normalizeString(payload.completedVersion),
    completedAt: Number(payload.completedAt) || 0,
    updatedAt: Number(payload.updatedAt) || 0,
    responseStatus: normalizeString(payload.responseStatus),
    respondentId: normalizeString(payload.respondentId),
    configValid: payload.configValid !== false,
    surveyUrlConfigured: payload.surveyUrlConfigured !== false,
    surveyVersionConfigured: payload.surveyVersionConfigured !== false,
  };
}

function getSurveyCompletionState() {
  const survey = getSurveyConfig();
  if (!survey.enabled || !survey.valid) {
    return Promise.resolve({
      surveyEnabled: survey.enabled,
      surveyVersion: survey.version,
      surveyTitle: survey.title,
      callbackUrl: '',
      currentVersionCompleted: false,
      completedVersion: '',
      completedAt: 0,
      updatedAt: 0,
      responseStatus: '',
      respondentId: '',
      configValid: survey.valid,
      surveyUrlConfigured: survey.urlValid,
      surveyVersionConfigured: survey.versionValid,
      errorMessage: survey.errorMessage,
    });
  }

  return api.getPowercxSurveyStatus().then((payload) => ({
    ...normalizeSurveyStatus(payload),
    errorMessage: '',
  }));
}

function isSurveyRequired({ source } = {}) {
  if (source && typeof source === 'string') {
    // reserved for future source-specific gating rules
  }
  const survey = getSurveyConfig();
  if (!survey.enabled) {
    return Promise.resolve(false);
  }
  if (!survey.valid) {
    return Promise.resolve(true);
  }
  return getSurveyCompletionState().then((state) => !state.currentVersionCompleted);
}

function markSurveyCompleted() {
  return getSurveyCompletionState();
}

function buildSurveyWebviewUrl({ source = 'manual' } = {}) {
  const survey = getSurveyConfig();
  if (!survey.enabled) {
    return Promise.reject(new Error('Survey is disabled'));
  }
  if (!survey.valid) {
    return Promise.reject(new Error(survey.errorMessage || 'Survey config is invalid'));
  }

  return api.createPowercxSurveySession({ source }).then((payload) => {
    const startUrl = normalizeString(payload && payload.startUrl);
    if (!/^https?:\/\/\S+$/i.test(startUrl)) {
      throw new Error('Survey session startUrl is invalid');
    }
    return (
      SURVEY_WEBVIEW_ROUTE +
      '?url=' +
      encodeURIComponent(startUrl) +
      '&title=' +
      encodeURIComponent(survey.title || DEFAULT_SURVEY_TITLE)
    );
  });
}

module.exports = {
  getSurveyConfig,
  isSurveyRequired,
  getSurveyCompletionState,
  markSurveyCompleted,
  buildSurveyGateUrl,
  buildSurveyWebviewUrl,
  resolveNextUrl,
};
