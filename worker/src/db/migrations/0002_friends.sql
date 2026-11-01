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
