-- In-progress and finished simulations, one JSON document per thread or call
-- (the TextThread / CallRecord shape). The columns beside `doc` are copies kept
-- for lookups and the sweepers; the store writes both in one statement.
CREATE TABLE sim_text_threads (
  id text PRIMARY KEY,
  user_id text NOT NULL,
  status text NOT NULL CHECK (status IN ('active', 'ended')),
  link_token text UNIQUE,
  doc jsonb NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- One active thread per user, across processes. Also serves the sweeper's
-- active-thread scan.
CREATE UNIQUE INDEX sim_text_threads_active_user_idx
  ON sim_text_threads (user_id)
  WHERE status = 'active';

CREATE TABLE sim_calls (
  id text PRIMARY KEY,
  user_id text NOT NULL,
  status text NOT NULL CHECK (
    status IN ('ringing', 'in_call', 'analyzing', 'completed')
  ),
  doc jsonb NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- The sweepers only list calls that aren't completed.
CREATE INDEX sim_calls_open_status_idx
  ON sim_calls (status)
  WHERE status <> 'completed';

-- Every simulation event (app/sim/events.ts envelope); append-only.
CREATE TABLE sim_events (
  id text PRIMARY KEY,
  type text NOT NULL,
  at timestamptz NOT NULL,
  user_id text NOT NULL,
  simulation_id text NOT NULL,
  channel text NOT NULL CHECK (channel IN ('text', 'call')),
  event jsonb NOT NULL
);

CREATE INDEX sim_events_simulation_idx ON sim_events (simulation_id, at);
