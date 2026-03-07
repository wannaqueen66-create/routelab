-- 002_announcements_feedback.sql
-- Add announcements + feedback tables for web/admin + miniprogram

-- System announcements for in-app notices
CREATE TABLE IF NOT EXISTS announcements (
  id SERIAL PRIMARY KEY,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  publish_at TIMESTAMPTZ,
  delivery_mode TEXT NOT NULL DEFAULT 'single',
  force_read BOOLEAN NOT NULL DEFAULT FALSE,
  link_url TEXT,
  target_audience TEXT NOT NULL DEFAULT 'all',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_announcements_status CHECK (status IN ('draft', 'published'))
);

CREATE INDEX IF NOT EXISTS idx_announcements_status_publish_at
  ON announcements(status, publish_at DESC);

-- User feedback tickets
CREATE TABLE IF NOT EXISTS feedback_tickets (
  id BIGSERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  category TEXT,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  contact TEXT,
  status TEXT NOT NULL DEFAULT 'open',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ,
  admin_reply TEXT
);

CREATE INDEX IF NOT EXISTS idx_feedback_tickets_status_created_at
  ON feedback_tickets(status, created_at DESC);
