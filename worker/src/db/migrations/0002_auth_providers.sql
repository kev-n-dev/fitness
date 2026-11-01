-- ── auth_providers (linked authentication methods per user) ──────────────────
-- Tracks which authentication methods (password, passkey, google) are linked to
-- each user account. Enables signing in with any linked method, and supports
-- account merging.
CREATE TABLE IF NOT EXISTS auth_providers (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id      TEXT    NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider     TEXT    NOT NULL,                  -- 'password', 'passkey', 'google'
  provider_id  TEXT,                              -- credential ID (passkey), Google user ID, or email (password)
  email        TEXT,                              -- email associated with this provider (nullable)
  created      TEXT    NOT NULL,                  -- ISO-8601
  last_used    TEXT                               -- ISO-8601 (nullable)
);

-- Index for looking up all providers for a user
CREATE INDEX IF NOT EXISTS auth_providers_user_id ON auth_providers(user_id);

-- Unique constraint on provider + provider_id where provider_id is not null
-- This prevents the same credential from being linked to multiple accounts
CREATE UNIQUE INDEX IF NOT EXISTS auth_providers_provider_id
  ON auth_providers(provider, provider_id) WHERE provider_id IS NOT NULL;
