/**
 * Public Config Routes
 * Handles /api/public/* endpoints
 */

const express = require('express');
const { STORAGE_BASE_URL } = require('../config/index');

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

module.exports = router;
