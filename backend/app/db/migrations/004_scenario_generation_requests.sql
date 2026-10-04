-- One row per accepted POST /api/training/call-scenarios, for the per-user rate limit. Rows older than a day are
-- deleted by the next request from the same user.
CREATE TABLE scenario_generation_requests (
  firebase_uid text NOT NULL,
  requested_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX scenario_generation_requests_uid_idx ON scenario_generation_requests (firebase_uid, requested_at);
