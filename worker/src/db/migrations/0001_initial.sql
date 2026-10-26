-- ── users (db.users, plus password/email/reset fields inlined) ──────────────
CREATE TABLE IF NOT EXISTS users (
  id             TEXT    PRIMARY KEY,             -- base64url 12 random bytes
  name           TEXT    NOT NULL,
  created        TEXT    NOT NULL,                -- ISO-8601
  disabled       INTEGER NOT NULL DEFAULT 0,
  admin          INTEGER NOT NULL DEFAULT 0,      -- explicit flag; ADMIN_UIDS is wrangler var
  invited_by     TEXT,                            -- invite code used at signup
  sv             INTEGER NOT NULL DEFAULT 0,      -- session version; bumped on logout-all
  last_reminder  TEXT,                            -- YYYY-MM-DD; day last reminder was sent
  last_nudge     TEXT,                            -- YYYY-MM-DD; day last nudge was sent
  last_pull      INTEGER,                         -- Unix ms; last GET /api/data
  -- password (optional; null = passkey-only)
  pw_hash        TEXT,                            -- PBKDF2 PHC string (see lib/password.js)
  pw_set         TEXT,                            -- ISO-8601 when hash was written
  -- password-reset token (admin-issued, one-time)
  pw_reset_hash  TEXT,                            -- SHA-256 hex of reset code
  pw_reset_exp   INTEGER,                         -- Unix ms expiry
  pw_reset_by    TEXT,                            -- admin user id that issued it
  -- optional e-mail sign-in alias
  email          TEXT UNIQUE                      -- normalized (trimmed, lower-cased)
);

-- ── passkeys (db.creds) ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS passkeys (
  id          TEXT    PRIMARY KEY,                -- WebAuthn credential id (base64url)
  user_id     TEXT    NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  public_key  TEXT    NOT NULL,                   -- base64url COSE key
  counter     INTEGER NOT NULL DEFAULT 0,
  transports  TEXT    NOT NULL DEFAULT '[]',      -- JSON array of transport strings
  name        TEXT,                               -- user-assigned label (≤40 chars)
  created     TEXT    NOT NULL,                   -- ISO-8601
  last_used   TEXT                                -- ISO-8601
);
CREATE INDEX IF NOT EXISTS passkeys_user_id ON passkeys(user_id);

-- ── push subscriptions (db.subs) ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS push_subscriptions (
  endpoint   TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  p256dh     TEXT NOT NULL,
  auth       TEXT NOT NULL,
  device_id  TEXT,                                -- optional; narrows rest-timer sends
  created    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS push_subscriptions_user_id ON push_subscriptions(user_id);

-- ── invites (db.invites) ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS invites (
  code        TEXT    PRIMARY KEY,                -- 16 hex chars uppercase
  note        TEXT    NOT NULL DEFAULT '',
  created_by  TEXT    NOT NULL,                   -- user id of admin who issued it
  created     TEXT    NOT NULL,
  used_by     TEXT,                               -- user id, null if unused
  used_at     TEXT,
  revoked     INTEGER NOT NULL DEFAULT 0
);

-- ── device links (db.deviceLinks) ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS device_links (
  h        TEXT    PRIMARY KEY,                   -- SHA-256 hex of one-time code
  user_id  TEXT    NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  exp      INTEGER NOT NULL,                      -- Unix ms expiry
  created  INTEGER NOT NULL                       -- Unix ms creation time
);
CREATE INDEX IF NOT EXISTS device_links_user_id ON device_links(user_id);

-- ── user state (state-{uid}.json; DO NOT normalize — sync requires atomic replace) ──
CREATE TABLE IF NOT EXISTS user_state (
  user_id  TEXT    PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  state    TEXT    NOT NULL,                      -- full JSON blob
  rev      INTEGER NOT NULL DEFAULT 0             -- monotonic write counter
);

-- ── audit events (audit.log) ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS audit_events (
  id    INTEGER PRIMARY KEY AUTOINCREMENT,
  ts    INTEGER NOT NULL,                         -- Unix ms
  ev    TEXT    NOT NULL,                         -- e.g. 'auth.login.ok'
  ok    INTEGER NOT NULL DEFAULT 1,
  uid   TEXT,                                     -- acting user id
  name  TEXT,                                     -- acting user display name (≤40 chars)
  tgt   TEXT,                                     -- target user id (admin actions)
  tname TEXT,                                     -- target user display name
  msg   TEXT,                                     -- short detail string (≤120 chars)
  act   TEXT,                                     -- what was being confirmed (proveOwner)
  ip    TEXT                                      -- net/full depending on AUDIT_IP setting
);
CREATE INDEX IF NOT EXISTS audit_events_ts ON audit_events(ts DESC);

-- ── VAPID key pair (data/vapid.json; single row, id always = 1) ──────────────
CREATE TABLE IF NOT EXISTS vapid_keys (
  id           INTEGER PRIMARY KEY DEFAULT 1 CHECK(id = 1),
  public_key   TEXT NOT NULL,                     -- base64url uncompressed P-256 public key
  private_key  TEXT NOT NULL                      -- base64url raw P-256 private key
);

-- ── sessions (KV-primary; this table is a revocation ledger only) ────────────
-- Active sessions are stored in KV SESSIONS namespace (token → user JSON, TTL = SESSION_DAYS).
-- The session version field users.sv handles logout-all without this table.
-- This table exists for future per-token revocation; leave empty for now.
CREATE TABLE IF NOT EXISTS sessions (
  token_hash  TEXT PRIMARY KEY,                   -- SHA-256 of bearer token
  user_id     TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  revoked_at  INTEGER
);
