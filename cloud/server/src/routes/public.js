/**
 * Public Config Routes
 * Handles /api/public/* endpoints
 */

const express = require('express');
const { STORAGE_BASE_URL } = require('../config/index');
const { pool } = require('../db/index');
const {
  getPowercxSurveyConfig,
  verifySurveyStateToken,
  getSurveyStateFromRequest,
  buildSurveyStateCookie,
  buildSurveyStateCookieClear,
  buildPowercxSurveyEntryUrl,
  normalizePowercxCallback,
  renderSurveyCompletionHtml,
} = require('../services/surveyService');

const router = express.Router();

// GET /api/public/config
router.get('/config', async (req, res) => {
  res.json({
    apiBaseUrl: '/api',
    uploadEndpoint: '/upload',
    staticBaseUrl: STORAGE_BASE_URL || 'https://routelab.qzz.io/static/uploads',
    features: {
      announcements: true,
      weatherProxy: true,
      geocodeProxy: true,
    },
  });
});

// GET /api/public/surveys/powercx/start
router.get('/surveys/powercx/start', async (req, res) => {
  const survey = getPowercxSurveyConfig();
  if (!survey.enabled || !survey.valid) {
    res
      .status(409)
      .type('html')
      .send(
        renderSurveyCompletionHtml({
          success: false,
          title: '问卷暂不可用',
          message: '问卷配置尚未完成，暂时无法继续打开，请稍后再试。',
        })
      );
    return;
  }

  const state = typeof req.query.state === 'string' ? req.query.state.trim() : '';
  if (!state) {
    res
      .status(400)
      .type('html')
      .send(
        renderSurveyCompletionHtml({
          success: false,
          title: '问卷入口无效',
          message: '缺少问卷会话信息，请返回小程序重新打开问卷。',
        })
      );
    return;
  }

  try {
    const payload = verifySurveyStateToken(state);
    const entryUrl = buildPowercxSurveyEntryUrl({
      userId: payload.userId,
      source: payload.source,
      state,
    });
    res.setHeader('Set-Cookie', buildSurveyStateCookie(state));
    res.redirect(302, entryUrl);
  } catch (error) {
    res
      .status(400)
      .type('html')
      .send(
        renderSurveyCompletionHtml({
          success: false,
          title: '问卷会话已失效',
          message: '本次问卷会话已经过期，请返回小程序重新开始。',
        })
      );
  }
});

// GET /api/public/surveys/powercx/complete
router.get('/surveys/powercx/complete', async (req, res) => {
  let statePayload;
  try {
    statePayload = getSurveyStateFromRequest(req);
  } catch (error) {
    res
      .status(400)
      .type('html')
      .send(
        renderSurveyCompletionHtml({
          success: false,
          title: '未找到问卷绑定信息',
          message: '当前无法确认是哪个 RouteLab 用户提交了问卷，请返回小程序重新进入问卷。',
          details: '请确认问卷结束页已跳转到 RouteLab 后端回调地址。',
        })
      );
    return;
  }

  const callback = normalizePowercxCallback(req.query || {});
  const completedAt = new Date();

  try {
    await pool.query(
      `INSERT INTO survey_completions (
         user_id,
         survey_key,
         survey_version,
         respondent_id,
         response_status,
         completed_at,
         raw_payload,
         updated_at
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $6)
       ON CONFLICT (user_id, survey_key) DO UPDATE
         SET survey_version = EXCLUDED.survey_version,
             respondent_id = COALESCE(EXCLUDED.respondent_id, survey_completions.respondent_id),
             response_status = COALESCE(EXCLUDED.response_status, survey_completions.response_status),
             completed_at = EXCLUDED.completed_at,
             raw_payload = EXCLUDED.raw_payload,
             updated_at = EXCLUDED.updated_at`,
      [
        Number(statePayload.userId),
        statePayload.surveyKey || 'powercx',
        statePayload.surveyVersion || getPowercxSurveyConfig().version,
        callback.respondentId || null,
        callback.responseStatus || 'submitted',
        completedAt,
        callback.rawPayload || {},
      ]
    );

    res.setHeader('Set-Cookie', buildSurveyStateCookieClear());
    res
      .status(200)
      .type('html')
      .send(
        renderSurveyCompletionHtml({
          success: true,
          title: '问卷结果已同步',
          message: 'RouteLab 已记录本次问卷完成状态。请返回小程序，再点击“我已完成，继续记录”。',
          details: callback.respondentId
            ? `PowerCX respondentId: ${callback.respondentId}`
            : '如需记录 respondentId / 作答状态，请在 PowerCX 结束设置中开启“传递参数”。',
        })
      );
  } catch (error) {
    console.error('GET /api/public/surveys/powercx/complete failed', {
      userId: statePayload.userId,
      message: error?.message,
      stack: error?.stack,
    });
    res
      .status(500)
      .type('html')
      .send(
        renderSurveyCompletionHtml({
          success: false,
          title: '问卷结果同步失败',
          message: '问卷已经提交，但 RouteLab 暂时未能记录结果。请返回小程序稍后重试。',
        })
      );
  }
});

module.exports = router;
