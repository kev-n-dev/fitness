-- ── friendships (bidirectional, stored once per pair) ─────────────────────────
CREATE TABLE IF NOT EXISTS friendships (
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  friend_id  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created    TEXT NOT NULL,                       -- ISO-8601
  status     TEXT NOT NULL DEFAULT 'accepted',    -- 'accepted' only for now
  PRIMARY KEY (user_id, friend_id)
);
CREATE INDEX IF NOT EXISTS friendships_friend_id ON friendships(friend_id);

-- ── friend_requests ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS friend_requests (
  id            TEXT    PRIMARY KEY,              -- base64url random id
  from_user_id  TEXT    NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  to_user_id    TEXT    NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status        TEXT    NOT NULL DEFAULT 'pending',  -- 'pending', 'accepted', 'declined', 'cancelled'
  created       TEXT    NOT NULL,                 -- ISO-8601
  updated       TEXT    NOT NULL                  -- ISO-8601
);
CREATE INDEX IF NOT EXISTS friend_requests_from ON friend_requests(from_user_id);
CREATE INDEX IF NOT EXISTS friend_requests_to ON friend_requests(to_user_id);
CREATE INDEX IF NOT EXISTS friend_requests_status ON friend_requests(status);

-- ── friend_invite_codes (shareable invite links) ──────────────────────────────
CREATE TABLE IF NOT EXISTS friend_invite_codes (
  code       TEXT    PRIMARY KEY,                 -- random code for URL
  user_id    TEXT    NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created    TEXT    NOT NULL,                    -- ISO-8601
  expires    TEXT    NOT NULL,                    -- ISO-8601 (7 days from creation)
  used_by    TEXT    REFERENCES users(id) ON DELETE SET NULL,
  used_at    TEXT                                 -- ISO-8601, null if unused
);
CREATE INDEX IF NOT EXISTS friend_invite_codes_user_id ON friend_invite_codes(user_id);

-- ── activity_feed_settings (default visibility per user) ──────────────────────
CREATE TABLE IF NOT EXISTS activity_feed_settings (
  user_id             TEXT    PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  default_visibility  TEXT    NOT NULL DEFAULT 'summary',  -- 'summary', 'full', 'hidden'
  created             TEXT    NOT NULL,                    -- ISO-8601
  updated             TEXT    NOT NULL                     -- ISO-8601
);

-- ── workout_visibility (per-workout override) ─────────────────────────────────
CREATE TABLE IF NOT EXISTS workout_visibility (
  workout_id   TEXT    NOT NULL,                  -- workout id from user state
  user_id      TEXT    NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  visibility   TEXT    NOT NULL,                  -- 'summary', 'full', 'hidden'
  created      TEXT    NOT NULL,                  -- ISO-8601
  PRIMARY KEY (workout_id, user_id)
);
CREATE INDEX IF NOT EXISTS workout_visibility_user_id ON workout_visibility(user_id);

-- ── friend_activity (denormalized feed entries) ───────────────────────────────
CREATE TABLE IF NOT EXISTS friend_activity (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id      TEXT    NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  workout_id   TEXT    NOT NULL,                  -- workout id from user state
  workout_name TEXT,                              -- cached for quick display
  completed_at TEXT    NOT NULL,                  -- ISO-8601
  duration_ms  INTEGER,                           -- workout duration
  exercise_count INTEGER,                         -- number of exercises
  set_count    INTEGER,                           -- total sets
  created      TEXT    NOT NULL                   -- ISO-8601
);
CREATE INDEX IF NOT EXISTS friend_activity_user_id ON friend_activity(user_id);
CREATE INDEX IF NOT EXISTS friend_activity_completed_at ON friend_activity(completed_at DESC);
