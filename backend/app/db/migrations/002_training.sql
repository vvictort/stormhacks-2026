-- The id is the comms attempt id, so re-posting the same attempt is a no-op.
CREATE TABLE training_attempts (
  id text PRIMARY KEY,
  firebase_uid text NOT NULL,
  channel text NOT NULL CHECK (channel IN ('sms', 'email', 'call')),
  scenario_id text NOT NULL,
  scenario_title text NOT NULL,
  difficulty text NOT NULL CHECK (difficulty IN ('easy', 'medium', 'hard')),
  outcome text NOT NULL CHECK (
    outcome IN ('resisted', 'compromised', 'declined', 'missed', 'error')
  ),
  success boolean,
  tactics text[] NOT NULL DEFAULT '{}',
  signals text[] NOT NULL DEFAULT '{}',
  started_at timestamptz,
  completed_at timestamptz NOT NULL,
  duration_secs integer CHECK (duration_secs IS NULL OR duration_secs >= 0),
  -- Redacted summary and transcript only.
  metadata jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX training_attempts_uid_completed_idx
  ON training_attempts (firebase_uid, completed_at DESC);

CREATE TABLE generated_call_scenarios (
  id text PRIMARY KEY CHECK (id LIKE 'gen-%'),
  firebase_uid text NOT NULL,
  scenario jsonb NOT NULL,
  source text NOT NULL CHECK (source IN ('gemini', 'fallback')),
  created_at timestamptz NOT NULL DEFAULT now()
);
