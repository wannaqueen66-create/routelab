-- RouteLab database bootstrap script
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  openid TEXT UNIQUE,
  unionid TEXT,
  nickname TEXT,
  avatar TEXT,
  gender TEXT,
  age_range TEXT,
  identity_label TEXT,
  birthday TEXT,
  height_cm INTEGER,
  weight_kg NUMERIC,
  session_key TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS routes (
  id TEXT PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  title TEXT,
  start_time TIMESTAMPTZ,
  end_time TIMESTAMPTZ,
  privacy_level TEXT NOT NULL DEFAULT 'private',
  note TEXT,
  campus_zone TEXT,
  start_campus JSONB,
  end_campus JSONB,
  stats JSONB,
  meta JSONB,
  photos JSONB,
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS route_points (
  id BIGSERIAL PRIMARY KEY,
  route_id TEXT REFERENCES routes(id) ON DELETE CASCADE,
  latitude DOUBLE PRECISION NOT NULL,
  longitude DOUBLE PRECISION NOT NULL,
  altitude DOUBLE PRECISION,
  speed DOUBLE PRECISION,
  heading DOUBLE PRECISION,
  accuracy DOUBLE PRECISION,
  recorded_at TIMESTAMPTZ NOT NULL,
  source TEXT NOT NULL DEFAULT 'gps',
  source_detail TEXT,
  interp_method TEXT
);

CREATE TABLE IF NOT EXISTS photos (
  id BIGSERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  route_id TEXT REFERENCES routes(id) ON DELETE SET NULL,
  url TEXT NOT NULL,
  original_name TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS route_fragments (
  id BIGSERIAL PRIMARY KEY,
  session_id TEXT NOT NULL,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS route_likes (
  id BIGSERIAL PRIMARY KEY,
  route_id TEXT REFERENCES routes(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT uniq_route_likes UNIQUE (route_id, user_id)
);

CREATE TABLE IF NOT EXISTS route_comments (
    id BIGSERIAL PRIMARY KEY,
    route_id TEXT REFERENCES routes(id) ON DELETE CASCADE,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
    deleted_at TIMESTAMPTZ
  );

CREATE TABLE IF NOT EXISTS route_comment_likes (
  id BIGSERIAL PRIMARY KEY,
  comment_id BIGINT REFERENCES route_comments(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT uniq_route_comment_likes UNIQUE (comment_id, user_id)
);

CREATE TABLE IF NOT EXISTS route_comment_replies (
  id BIGSERIAL PRIMARY KEY,
  comment_id BIGINT REFERENCES route_comments(id) ON DELETE CASCADE,
  route_id TEXT REFERENCES routes(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_routes_user ON routes(user_id);
CREATE INDEX IF NOT EXISTS idx_route_points_route ON route_points(route_id);
CREATE INDEX IF NOT EXISTS idx_routes_start_time ON routes(start_time DESC);
CREATE INDEX IF NOT EXISTS idx_routes_updated_at ON routes(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_photos_user ON photos(user_id);
CREATE INDEX IF NOT EXISTS idx_photos_route ON photos(route_id);
CREATE INDEX IF NOT EXISTS idx_route_likes_route ON route_likes(route_id);
CREATE INDEX IF NOT EXISTS idx_route_likes_user ON route_likes(user_id);
CREATE INDEX IF NOT EXISTS idx_route_comments_route ON route_comments(route_id);
CREATE INDEX IF NOT EXISTS idx_route_comments_user ON route_comments(user_id);
CREATE INDEX IF NOT EXISTS idx_route_comment_likes_comment ON route_comment_likes(comment_id);
CREATE INDEX IF NOT EXISTS idx_route_comment_likes_user ON route_comment_likes(user_id);
CREATE INDEX IF NOT EXISTS idx_route_comment_replies_comment ON route_comment_replies(comment_id);
CREATE INDEX IF NOT EXISTS idx_route_comment_replies_route ON route_comment_replies(route_id);
CREATE INDEX IF NOT EXISTS idx_route_comment_replies_user ON route_comment_replies(user_id);

CREATE TABLE IF NOT EXISTS user_achievements (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  payload JSONB NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_achievements_updated_at ON user_achievements(updated_at DESC);

CREATE TABLE IF NOT EXISTS user_settings (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  default_privacy_level TEXT,
  default_weight_kg NUMERIC,
  auto_sync BOOLEAN,
  keep_screen_preferred BOOLEAN,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_settings_updated_at ON user_settings(updated_at DESC);

ALTER TABLE route_comments
  ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE route_comments
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

ALTER TABLE routes
  ALTER COLUMN privacy_level SET DEFAULT 'private';

ALTER TABLE routes
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

UPDATE routes
SET privacy_level = 'private'
WHERE privacy_level IS NULL;

ALTER TABLE route_points
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'gps';
ALTER TABLE route_points
  ADD COLUMN IF NOT EXISTS source_detail TEXT;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS gender TEXT;
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS age_range TEXT;
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS identity_label TEXT;
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS birthday TEXT;
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS height_cm INTEGER;
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS weight_kg NUMERIC;
