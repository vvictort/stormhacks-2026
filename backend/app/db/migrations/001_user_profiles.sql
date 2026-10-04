CREATE TABLE user_profiles (
  id uuid PRIMARY KEY,
  firebase_uid text NOT NULL UNIQUE,
  email text NOT NULL,
  email_verified boolean NOT NULL DEFAULT false,
  name text CHECK (name IS NULL OR length(trim(name)) BETWEEN 1 AND 100),
  phone text CHECK (phone IS NULL OR phone ~ '^\+[1-9][0-9]{7,14}$'),
  profession text,
  interests text[] NOT NULL DEFAULT '{}',
  onboarding_completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (onboarding_completed_at IS NULL OR (name IS NOT NULL AND phone IS NOT NULL))
);
