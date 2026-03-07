-- 001_init.sql
-- Canonical schema for RouteLab (fresh install)

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
  last_login_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS routes (
  id TEXT PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  client_id TEXT,
  name TEXT,
  privacy_level TEXT NOT NULL DEFAULT 'private',
  activity_type TEXT NOT NULL DEFAULT 'walk',
  purpose_code TEXT,
  start_time TIMESTAMPTZ,
  end_time TIMESTAMPTZ,
  stats JSONB NOT NULL DEFAULT '{}'::jsonb,
  meta JSONB NOT NULL DEFAULT '{}'::jsonb,
  photos JSONB NOT NULL DEFAULT '[]'::jsonb,
  weather JSONB,
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_routes_user_id ON routes(user_id);
CREATE INDEX IF NOT EXISTS idx_routes_created_at ON routes(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_routes_updated_at ON routes(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_routes_start_time ON routes(start_time DESC);
CREATE INDEX IF NOT EXISTS idx_routes_purpose_code ON routes(purpose_code);

CREATE TABLE IF NOT EXISTS route_points (
  id BIGSERIAL PRIMARY KEY,
  route_id TEXT REFERENCES routes(id) ON DELETE CASCADE,
  seq INTEGER NOT NULL,
  latitude DOUBLE PRECISION NOT NULL,
  longitude DOUBLE PRECISION NOT NULL,
  altitude DOUBLE PRECISION,
  timestamp TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uniq_route_points UNIQUE (route_id, seq)
);

CREATE INDEX IF NOT EXISTS idx_route_points_route_id ON route_points(route_id);

CREATE TABLE IF NOT EXISTS route_likes (
  id BIGSERIAL PRIMARY KEY,
  route_id TEXT REFERENCES routes(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uniq_route_likes UNIQUE (route_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_route_likes_route_id ON route_likes(route_id);
CREATE INDEX IF NOT EXISTS idx_route_likes_user_id ON route_likes(user_id);

CREATE TABLE IF NOT EXISTS route_comments (
  id BIGSERIAL PRIMARY KEY,
  route_id TEXT REFERENCES routes(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  parent_id BIGINT REFERENCES route_comments(id) ON DELETE CASCADE,
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_route_comments_route_id ON route_comments(route_id);
CREATE INDEX IF NOT EXISTS idx_route_comments_user_id ON route_comments(user_id);
CREATE INDEX IF NOT EXISTS idx_route_comments_parent_id ON route_comments(parent_id);

CREATE TABLE IF NOT EXISTS user_achievements (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  payload JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_achievements_updated_at ON user_achievements(updated_at DESC);

CREATE TABLE IF NOT EXISTS user_settings (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  default_privacy_level TEXT,
  default_weight_kg NUMERIC,
  auto_sync BOOLEAN,
  keep_screen_preferred BOOLEAN,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_settings_updated_at ON user_settings(updated_at DESC);
