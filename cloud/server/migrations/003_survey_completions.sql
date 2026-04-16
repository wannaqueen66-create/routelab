-- 003_survey_completions.sql
-- Persist per-user survey completion state from PowerCX callback redirects

CREATE TABLE IF NOT EXISTS survey_completions (
  id BIGSERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  survey_key TEXT NOT NULL,
  survey_version TEXT NOT NULL,
  respondent_id TEXT,
  response_status TEXT,
  completed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  raw_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uniq_survey_completions_user_key UNIQUE (user_id, survey_key)
);

CREATE INDEX IF NOT EXISTS idx_survey_completions_user_id
  ON survey_completions(user_id);

CREATE INDEX IF NOT EXISTS idx_survey_completions_survey_version
  ON survey_completions(survey_key, survey_version);

CREATE INDEX IF NOT EXISTS idx_survey_completions_completed_at
  ON survey_completions(completed_at DESC);
