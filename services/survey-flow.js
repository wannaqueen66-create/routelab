'use strict';

const config = require('../config/saaa-config');
const api = require('./api');
const { getUserAccount, getLocalSurveyCompletion, saveLocalSurveyCompletion } = require('../utils/storage');

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
    completionSource: normalizeString(payload.completionSource),
  };
}

function getSurveyContext() {
  const survey = getSurveyConfig();
  const account = getUserAccount();
  return {
    survey,
    surveyKey: 'powercx',
    surveyVersion: survey.version,
    userId: account && account.id !== undefined && account.id !== null ? String(account.id).trim() : '',
  };
}

function buildManualCompletionState({ survey, record = null } = {}) {
  return {
    surveyEnabled: survey.enabled,
    surveyVersion: survey.version,
    surveyTitle: survey.title,
    callbackUrl: '',
    currentVersionCompleted: !!record,
    completedVersion: record?.surveyVersion || '',
    completedAt: Number(record?.completedAt) || 0,
    updatedAt: Number(record?.updatedAt) || 0,
    responseStatus: normalizeString(record?.responseStatus),
    respondentId: normalizeString(record?.respondentId),
    configValid: survey.valid,
    surveyUrlConfigured: survey.urlValid,
    surveyVersionConfigured: survey.versionValid,
    completionSource: record ? 'local_manual' : '',
    errorMessage: survey.errorMessage,
  };
}

function getSurveyCompletionState() {
  const { survey, surveyKey, surveyVersion, userId } = getSurveyContext();
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
      completionSource: '',
      errorMessage: survey.errorMessage,
    });
  }

  const localRecord = getLocalSurveyCompletion({
    surveyKey,
    surveyVersion,
    userId,
  });

  return api
    .getPowercxSurveyStatus()
    .then((payload) => {
      const normalized = normalizeSurveyStatus(payload);
      if (normalized.currentVersionCompleted) {
        return {
          ...normalized,
          completionSource: 'server',
          errorMessage: '',
        };
      }
      if (localRecord) {
        return buildManualCompletionState({ survey, record: localRecord });
      }
      return {
        ...normalized,
        errorMessage: '',
      };
    })
    .catch((error) => {
      if (localRecord) {
        return buildManualCompletionState({ survey, record: localRecord });
      }
      throw error;
    });
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

function markSurveyCompleted({ responseStatus = 'manual_confirmed', source = 'manual_confirmed' } = {}) {
  const { survey, surveyKey, surveyVersion, userId } = getSurveyContext();
  if (!surveyVersion) {
    return Promise.reject(new Error('Survey version is required'));
  }
  const record = saveLocalSurveyCompletion({
    surveyKey,
    surveyVersion,
    userId,
    responseStatus,
    source,
    completedAt: Date.now(),
  });
  return Promise.resolve(buildManualCompletionState({ survey, record }));
}

function buildSurveyWebviewUrl({ source = 'manual', next = DEFAULT_NEXT_URL } = {}) {
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
      encodeURIComponent(survey.title || DEFAULT_SURVEY_TITLE) +
      '&next=' +
      encodeURIComponent(resolveNextUrl(next))
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
