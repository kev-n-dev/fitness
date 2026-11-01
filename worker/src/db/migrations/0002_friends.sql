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

-- ── challenges (friend competitions) ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS challenges (
  id           TEXT    PRIMARY KEY,               -- base64url random id
  creator_id   TEXT    NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  opponent_id  TEXT    NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type         TEXT    NOT NULL,                  -- 'beat_pr', 'workout_count', 'timed'
  exercise_id  TEXT,                              -- nullable, for beat_pr challenges
  target_value REAL    NOT NULL,                  -- target to beat/reach
  metric       TEXT    NOT NULL DEFAULT 'count',  -- 'weight', 'reps', 'both', 'count'
  start_date   TEXT    NOT NULL,                  -- ISO-8601
  end_date     TEXT,                              -- ISO-8601, nullable for open-ended
  status       TEXT    NOT NULL DEFAULT 'pending', -- 'pending', 'active', 'completed', 'declined'
  winner_id    TEXT    REFERENCES users(id) ON DELETE SET NULL,
  created      TEXT    NOT NULL,                  -- ISO-8601
  updated      TEXT    NOT NULL                   -- ISO-8601
);
CREATE INDEX IF NOT EXISTS challenges_creator_id ON challenges(creator_id);
CREATE INDEX IF NOT EXISTS challenges_opponent_id ON challenges(opponent_id);
CREATE INDEX IF NOT EXISTS challenges_status ON challenges(status);

-- ── challenge_progress (tracks each participant's current progress) ───────────
CREATE TABLE IF NOT EXISTS challenge_progress (
  challenge_id    TEXT    NOT NULL REFERENCES challenges(id) ON DELETE CASCADE,
  user_id         TEXT    NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  current_value   REAL    NOT NULL DEFAULT 0,
  best_attempt_date TEXT,                         -- ISO-8601
  updated         TEXT    NOT NULL,               -- ISO-8601
  PRIMARY KEY (challenge_id, user_id)
);
CREATE INDEX IF NOT EXISTS challenge_progress_user_id ON challenge_progress(user_id);

-- ── notifications (in-app notification system) ────────────────────────────────
CREATE TABLE IF NOT EXISTS notifications (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id      TEXT    NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type         TEXT    NOT NULL,                  -- 'friend_request', 'friend_accepted', 'challenge_received', 'challenge_accepted', 'challenge_declined', 'challenge_won', 'challenge_lost', 'friend_workout'
  title        TEXT    NOT NULL,
  body         TEXT,
  data         TEXT,                              -- JSON with related ids
  read         INTEGER NOT NULL DEFAULT 0,        -- 0 = unread, 1 = read
  created      TEXT    NOT NULL                   -- ISO-8601
);
CREATE INDEX IF NOT EXISTS notifications_user_id ON notifications(user_id);
CREATE INDEX IF NOT EXISTS notifications_user_read ON notifications(user_id, read);
CREATE INDEX IF NOT EXISTS notifications_created ON notifications(created DESC);

-- ── notification_preferences (user settings for notification types) ───────────
CREATE TABLE IF NOT EXISTS notification_preferences (
  user_id            TEXT    PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  friend_requests    INTEGER NOT NULL DEFAULT 1,  -- 1 = enabled, 0 = disabled
  challenge_updates  INTEGER NOT NULL DEFAULT 1,
  friend_activity    INTEGER NOT NULL DEFAULT 1,
  created            TEXT    NOT NULL,            -- ISO-8601
  updated            TEXT    NOT NULL             -- ISO-8601
);
