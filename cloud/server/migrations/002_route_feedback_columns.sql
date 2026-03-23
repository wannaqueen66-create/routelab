-- 002_route_feedback_columns.sql
-- Add structured route feedback columns for analytics while keeping raw JSONB in meta.routeFeedback

ALTER TABLE routes
  ADD COLUMN IF NOT EXISTS feedback_choice TEXT,
  ADD COLUMN IF NOT EXISTS feedback_satisfaction_score INTEGER,
  ADD COLUMN IF NOT EXISTS feedback_preference_label TEXT,
  ADD COLUMN IF NOT EXISTS feedback_reason_text TEXT,
  ADD COLUMN IF NOT EXISTS feedback_source TEXT,
  ADD COLUMN IF NOT EXISTS feedback_submitted_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_routes_feedback_choice ON routes(feedback_choice);
CREATE INDEX IF NOT EXISTS idx_routes_feedback_satisfaction_score ON routes(feedback_satisfaction_score);
CREATE INDEX IF NOT EXISTS idx_routes_feedback_source ON routes(feedback_source);
CREATE INDEX IF NOT EXISTS idx_routes_feedback_submitted_at ON routes(feedback_submitted_at DESC);

UPDATE routes
SET
  feedback_choice = COALESCE(feedback_choice, NULLIF(meta->'routeFeedback'->>'preferenceChoice', '')),
  feedback_satisfaction_score = COALESCE(
    feedback_satisfaction_score,
    CASE
      WHEN (meta->'routeFeedback'->>'satisfactionScore') ~ '^[0-9]+$'
      THEN (meta->'routeFeedback'->>'satisfactionScore')::INTEGER
      ELSE NULL
    END
  ),
  feedback_preference_label = COALESCE(feedback_preference_label, NULLIF(meta->'routeFeedback'->>'preferenceLabel', '')),
  feedback_reason_text = COALESCE(feedback_reason_text, NULLIF(meta->'routeFeedback'->>'preferenceReason', '')),
  feedback_source = COALESCE(feedback_source, NULLIF(meta->'routeFeedback'->>'recommendationSource', '')),
  feedback_submitted_at = COALESCE(feedback_submitted_at, updated_at)
WHERE meta ? 'routeFeedback';
