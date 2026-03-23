-- 003_confirmed_end_columns.sql
-- Store user-confirmed route end separately from raw tracked end for easier querying and QA

ALTER TABLE routes
  ADD COLUMN IF NOT EXISTS raw_end_latitude DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS raw_end_longitude DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS confirmed_end_latitude DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS confirmed_end_longitude DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS confirmed_end_distance_meters DOUBLE PRECISION;

CREATE INDEX IF NOT EXISTS idx_routes_confirmed_end_latitude ON routes(confirmed_end_latitude);
CREATE INDEX IF NOT EXISTS idx_routes_confirmed_end_longitude ON routes(confirmed_end_longitude);

UPDATE routes
SET
  raw_end_latitude = COALESCE(raw_end_latitude, (meta->'endPoint'->>'latitude')::DOUBLE PRECISION),
  raw_end_longitude = COALESCE(raw_end_longitude, (meta->'endPoint'->>'longitude')::DOUBLE PRECISION),
  confirmed_end_latitude = COALESCE(confirmed_end_latitude, (meta->'routeFeedback'->'confirmedEnd'->>'latitude')::DOUBLE PRECISION),
  confirmed_end_longitude = COALESCE(confirmed_end_longitude, (meta->'routeFeedback'->'confirmedEnd'->>'longitude')::DOUBLE PRECISION)
WHERE meta ? 'endPoint' OR meta ? 'routeFeedback';
