CREATE TABLE users (
  id uuid PRIMARY KEY,
  auth_identity text UNIQUE NOT NULL CHECK (length(auth_identity) > 0),
  name text NOT NULL CHECK (length(trim(name)) > 0),
  profession text,
  interests text[] NOT NULL DEFAULT '{}',
  enabled_channels text[] NOT NULL CHECK (cardinality(enabled_channels) BETWEEN 1 AND 3 AND enabled_channels <@ ARRAY['text','email','call']::text[]),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE game_sessions (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id),
  status text NOT NULL CHECK (status IN ('active','paused','ended')),
  active_attempt_id uuid,
  next_arrival_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, user_id),
  CHECK (status = 'active' OR next_arrival_at IS NULL),
  CHECK (active_attempt_id IS NULL OR next_arrival_at IS NULL)
);
CREATE UNIQUE INDEX one_open_session_per_user ON game_sessions(user_id) WHERE status <> 'ended';

CREATE TABLE scam_patterns (
  id uuid PRIMARY KEY,
  kind text NOT NULL CHECK (kind IN ('scam','legitimate')),
  channel text NOT NULL CHECK (channel IN ('text','email','call')),
  category text NOT NULL,
  tactics text[] NOT NULL CHECK (tactics <@ ARRAY['urgency','authority','suspicious_links','otp_requests','information_sharing']::text[]),
  context_tags text[] NOT NULL DEFAULT '{}',
  example text NOT NULL,
  warning_signs text[] NOT NULL DEFAULT '{}',
  provenance jsonb NOT NULL,
  CHECK ((kind = 'scam' AND cardinality(tactics) > 0) OR (kind = 'legitimate' AND cardinality(tactics) = 0)),
  CHECK (provenance->>'synthetic' = 'true' OR NULLIF(provenance->>'sourceUrl','') IS NOT NULL)
);

CREATE TABLE attempts (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id),
  session_id uuid NOT NULL,
  pattern_id uuid NOT NULL REFERENCES scam_patterns(id),
  channel text NOT NULL CHECK (channel IN ('text','email','call')),
  difficulty text NOT NULL CHECK (difficulty IN ('beginner','intermediate','advanced')),
  status text NOT NULL CHECK (status IN ('reserved','ready','active','awaiting_feedback','completed','abandoned','generation_failed')),
  recommendation jsonb NOT NULL,
  scenario jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  ready_at timestamptz,
  started_at timestamptz,
  finished_at timestamptz,
  UNIQUE (id, user_id),
  UNIQUE (id, user_id, session_id),
  FOREIGN KEY (session_id, user_id) REFERENCES game_sessions(id, user_id),
  CHECK (status NOT IN ('ready','active','awaiting_feedback','completed') OR scenario IS NOT NULL)
);
CREATE UNIQUE INDEX one_active_attempt_per_session ON attempts(session_id)
  WHERE status IN ('reserved','ready','active','awaiting_feedback');
ALTER TABLE game_sessions ADD CONSTRAINT active_attempt_ownership
  FOREIGN KEY (active_attempt_id, user_id, id) REFERENCES attempts(id, user_id, session_id)
  DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE messages (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL,
  attempt_id uuid NOT NULL,
  role text NOT NULL CHECK (role IN ('user','simulation')),
  content text NOT NULL,
  occurred_at timestamptz NOT NULL,
  FOREIGN KEY (attempt_id, user_id) REFERENCES attempts(id, user_id)
);
CREATE TABLE behavioral_events (
  event_id uuid PRIMARY KEY,
  user_id uuid NOT NULL,
  attempt_id uuid NOT NULL,
  action text NOT NULL CHECK (action IN ('opened','replied','clicked_link','shared_otp','shared_information','reported','accepted','call_answered','call_ended')),
  occurred_at timestamptz NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}',
  FOREIGN KEY (attempt_id, user_id) REFERENCES attempts(id, user_id)
);
CREATE INDEX events_by_attempt_time ON behavioral_events(attempt_id, occurred_at);
CREATE TABLE assessments (
  attempt_id uuid PRIMARY KEY,
  user_id uuid NOT NULL,
  rubric_version text NOT NULL,
  score double precision NOT NULL CHECK (score BETWEEN 0 AND 100),
  classification text NOT NULL CHECK (classification IN ('correct','incorrect','unknown')),
  findings jsonb NOT NULL CHECK (jsonb_typeof(findings) = 'array'),
  feedback text NOT NULL,
  assessed_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (attempt_id, user_id) REFERENCES attempts(id, user_id)
);
CREATE INDEX assessments_by_user_time ON assessments(user_id, assessed_at);
