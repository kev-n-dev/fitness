-- Google OAuth columns for users table
ALTER TABLE users ADD COLUMN google_id TEXT UNIQUE;
ALTER TABLE users ADD COLUMN google_access_token TEXT;
ALTER TABLE users ADD COLUMN google_refresh_token TEXT;
ALTER TABLE users ADD COLUMN google_token_expires INTEGER;
ALTER TABLE users ADD COLUMN google_fit_enabled INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN google_fit_last_sync TEXT;

-- Index for looking up users by Google ID
CREATE INDEX IF NOT EXISTS users_google_id ON users(google_id);
