-- Texts and emails are scored server-side too, and every attempt can carry its scam category.
ALTER TABLE training_attempts DROP CONSTRAINT training_attempts_outcome_check;
ALTER TABLE training_attempts ADD CONSTRAINT training_attempts_outcome_check CHECK (outcome IN (
  'resisted', 'compromised', 'declined', 'missed', 'error',
  'reported_correct', 'reported_incorrect', 'safe_correct', 'safe_incorrect'));
ALTER TABLE training_attempts ADD COLUMN scam_category text CHECK (scam_category IS NULL OR scam_category IN (
  'banking', 'government', 'shipping', 'account_security', 'workplace', 'promotional'));

-- How users behave during training, as a time series (a TimescaleDB hypertable on TigerData). Append-only.
CREATE TABLE behavior_events (
  event_time timestamptz NOT NULL DEFAULT now(),
  firebase_uid text NOT NULL,
  event_type text NOT NULL CHECK (event_type IN (
    'scenario_started', 'message_opened', 'sender_inspected', 'link_clicked', 'attachment_opened',
    'message_reported', 'message_marked_safe',
    'call_received', 'call_answered', 'call_declined', 'call_missed', 'call_ended',
    'scenario_completed', 'debrief_viewed')),
  channel text NOT NULL CHECK (channel IN ('sms', 'email', 'call')),
  scenario_id text NOT NULL,
  -- One run of a scenario: a browser-generated id for texts and emails, the call id for calls.
  attempt_id text NOT NULL,
  scam_category text CHECK (scam_category IS NULL OR scam_category IN (
    'banking', 'government', 'shipping', 'account_security', 'workplace', 'promotional')),
  difficulty text CHECK (difficulty IS NULL OR difficulty IN ('easy', 'medium', 'hard')),
  outcome text CHECK (outcome IS NULL OR outcome IN (
    'resisted', 'compromised', 'declined', 'missed', 'error',
    'reported_correct', 'reported_incorrect', 'safe_correct', 'safe_incorrect')),
  -- Since the scenario started.
  response_time_ms integer CHECK (response_time_ms IS NULL OR response_time_ms >= 0),
  metadata jsonb NOT NULL DEFAULT '{}'
);
CREATE INDEX behavior_events_uid_time_idx ON behavior_events (firebase_uid, event_time DESC);
CREATE INDEX behavior_events_attempt_idx ON behavior_events (attempt_id, event_time);

-- On TigerData the table is a hypertable; plain Postgres (and the test database) keeps a normal table.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'timescaledb') THEN
    PERFORM create_hypertable('behavior_events', by_range('event_time', INTERVAL '7 days'));
  END IF;
END $$;

-- Generated text and email scenarios (frontend-ready JSON), owner-scoped like generated_call_scenarios.
CREATE TABLE generated_message_scenarios (
  id text PRIMARY KEY CHECK (id LIKE 'gen-email-%' OR id LIKE 'gen-sms-%'),
  firebase_uid text NOT NULL,
  channel text NOT NULL CHECK (channel IN ('sms', 'email')),
  scenario jsonb NOT NULL,
  source text NOT NULL CHECK (source IN ('gemini', 'fallback')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX generated_message_scenarios_uid_idx ON generated_message_scenarios (firebase_uid, created_at DESC);
