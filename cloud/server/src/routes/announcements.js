/**
 * Announcements Routes
 * Handles /api/announcements/* endpoints
 */

const express = require('express');
const { pool } = require('../db/index');

const router = express.Router();

function mapAnnouncementRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    title: row.title,
    body: row.body,
    status: row.status,
    deliveryMode: row.delivery_mode,
    forceRead: row.force_read,
    linkUrl: row.link_url,
    targetAudience: row.target_audience,
    publishAt: row.publish_at ? row.publish_at.getTime() : null,
    createdAt: row.created_at ? row.created_at.getTime() : null,
    updatedAt: row.updated_at ? row.updated_at.getTime() : null,
  };
}

// GET /api/announcements/latest
router.get('/latest', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT *
         FROM announcements
        WHERE status = 'published'
          AND (publish_at IS NULL OR publish_at <= NOW())
        ORDER BY COALESCE(publish_at, created_at) DESC
        LIMIT 1`
    );
    const item = mapAnnouncementRow(result.rows[0]);
    res.json(item || null);
  } catch (error) {
    console.error('GET /api/announcements/latest failed', error);
    res.status(500).json({ error: 'Failed to fetch latest announcement' });
  }
});

// GET /api/announcements/active
router.get('/active', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT *
         FROM announcements
        WHERE status = 'published'
          AND (publish_at IS NULL OR publish_at <= NOW())
        ORDER BY COALESCE(publish_at, created_at) DESC
        LIMIT 20`
    );

    const items = result.rows.map(mapAnnouncementRow).filter(Boolean);
    res.json({ items });
  } catch (error) {
    console.error('GET /api/announcements/active failed', error);
    res.status(500).json({ error: 'Failed to fetch active announcements' });
  }
});

module.exports = router;
