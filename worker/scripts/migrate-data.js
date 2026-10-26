#!/usr/bin/env node
// Migrates a JSON-file-backed fitness instance to Cloudflare D1 + R2.
// Reads DATA_DIR (defaults to ./data) and pushes to CF REST APIs.
// Requires no wrangler CLI — only Node.js + fetch (built-in since Node 18).
//
// Usage:
//   CF_ACCOUNT_ID=... CF_D1_DB_ID=... CF_API_TOKEN=... node scripts/migrate-data.js
//   node scripts/migrate-data.js --dry-run     # read files, print counts, no HTTP calls

import fs   from 'fs';
import path from 'path';

// ── configuration ─────────────────────────────────────────────────────────────

const DRY_RUN       = process.argv.includes('--dry-run');
const CF_ACCOUNT_ID = process.env.CF_ACCOUNT_ID || '';
const CF_D1_DB_ID   = process.env.CF_D1_DB_ID   || '';
const CF_API_TOKEN  = process.env.CF_API_TOKEN   || '';
const CF_R2_BUCKET  = process.env.CF_R2_BUCKET   || 'fitness-media';
const DATA_DIR      = process.env.DATA_DIR        || './data';

if (!DRY_RUN) {
  if (!CF_ACCOUNT_ID) { console.error('CF_ACCOUNT_ID is required'); process.exit(1); }
  if (!CF_D1_DB_ID)   { console.error('CF_D1_DB_ID is required');   process.exit(1); }
  if (!CF_API_TOKEN)  { console.error('CF_API_TOKEN is required');   process.exit(1); }
}

// ── CF REST API helpers ───────────────────────────────────────────────────────

/**
 * Execute a single D1 SQL statement.
 * In --dry-run the HTTP call is skipped; returns a dummy result object.
 */
async function d1Query(sql, params = []) {
  if (DRY_RUN) return { results: [], success: true, meta: {} };
  const url = `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/d1/database/${CF_D1_DB_ID}/query`;
  const res  = await fetch(url, {
    method:  'POST',
    headers: {
      'Authorization': `Bearer ${CF_API_TOKEN}`,
      'Content-Type':  'application/json',
    },
    body: JSON.stringify({ sql, params }),
  });
  const data = await res.json();
  if (!data.success) throw new Error(`D1 query error: ${JSON.stringify(data.errors)}`);
  return data.result?.[0] ?? { results: [], success: true };
}

/**
 * Execute multiple D1 statements in a single HTTP request (batch endpoint).
 * `statements` is an array of { sql, params } objects.
 * In --dry-run the HTTP call is skipped.
 */
async function d1Batch(statements) {
  if (DRY_RUN || !statements.length) return;
  const url = `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/d1/database/${CF_D1_DB_ID}/batch`;
  const res  = await fetch(url, {
    method:  'POST',
    headers: {
      'Authorization': `Bearer ${CF_API_TOKEN}`,
      'Content-Type':  'application/json',
    },
    body: JSON.stringify({ statements }),
  });
  const data = await res.json();
  if (!data.success) throw new Error(`D1 batch error: ${JSON.stringify(data.errors)}`);
}

/**
 * Upload an object to R2 via the CF REST API.
 * In --dry-run the HTTP call is skipped.
 */
async function r2Put(key, body, ct) {
  if (DRY_RUN) return;
  const url = `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/r2/buckets/${CF_R2_BUCKET}/objects/${encodeURIComponent(key)}`;
  const res  = await fetch(url, {
    method:  'PUT',
    headers: {
      'Authorization': `Bearer ${CF_API_TOKEN}`,
      'Content-Type':  ct,
    },
    body,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`R2 put failed for "${key}": ${res.status} ${text}`);
  }
}

// ── MIME lookup (mirrors worker/src/routes/media.js) ──────────────────────────

const EXT_MIME = {
  jpg:  'image/jpeg',
  png:  'image/png',
  webp: 'image/webp',
  gif:  'image/gif',
  mp4:  'video/mp4',
  mov:  'video/quicktime',
  webm: 'video/webm',
};
const FILE_RE = /^([0-9a-f]{64})\.(jpg|png|webp|gif|mp4|mov|webm)$/;

// ── migration steps ───────────────────────────────────────────────────────────

// Helper: split an array into chunks of at most `n`
function chunks(arr, n) {
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

// Helper: read a JSON file; returns null when it does not exist or fails to parse
function readJson(p) {
  try   { return JSON.parse(fs.readFileSync(p, 'utf8')); }
  catch { return null; }
}

// ── Step 1: load db.json ──────────────────────────────────────────────────────
function loadDb() {
  const p  = path.join(DATA_DIR, 'db.json');
  const db = readJson(p);
  if (!db) throw new Error(`Cannot read ${p}. Set DATA_DIR or run from the project root.`);
  db.users       = Array.isArray(db.users)       ? db.users       : [];
  db.creds       = Array.isArray(db.creds)       ? db.creds       : [];
  db.subs        = Array.isArray(db.subs)        ? db.subs        : [];
  db.invites     = Array.isArray(db.invites)     ? db.invites     : [];
  db.deviceLinks = Array.isArray(db.deviceLinks) ? db.deviceLinks : [];
  return db;
}

// ── Step 2: users ──────────────────────────────────────────────────────────────
// pw_hash keeps its $scrypt$ prefix so the original verify path keeps working
// until users log in and upgrade to PBKDF2.
async function migrateUsers(users) {
  const SQL = `INSERT OR IGNORE INTO users
    (id,name,created,disabled,admin,invited_by,sv,
     last_reminder,last_nudge,last_pull,
     pw_hash,pw_set,pw_reset_hash,pw_reset_exp,pw_reset_by,email)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`;

  let count = 0;
  for (const batch of chunks(users, 100)) {
    await d1Batch(batch.map(u => ({
      sql:    SQL,
      params: [
        u.id,
        u.name,
        u.created ?? new Date().toISOString(),
        u.disabled ? 1 : 0,
        u.admin    ? 1 : 0,
        u.invitedBy    ?? null,
        u.sv           ?? 0,
        u.last_reminder ?? null,
        u.last_nudge    ?? null,
        u.last_pull     ?? null,
        u.pw?.h        ?? null,   // keep $scrypt$ prefix as-is
        u.pw?.set      ?? null,
        u.pwReset?.h   ?? null,
        u.pwReset?.exp ?? null,
        u.pwReset?.by  ?? null,
        u.email        ?? null,
      ],
    })));
    count += batch.length;
  }
  return count;
}

// ── Step 3: passkeys ──────────────────────────────────────────────────────────
async function migratePasskeys(creds) {
  const SQL = `INSERT OR IGNORE INTO passkeys
    (id,user_id,public_key,counter,transports,name,created,last_used)
    VALUES (?,?,?,?,?,?,?,?)`;

  let count = 0;
  for (const batch of chunks(creds, 100)) {
    await d1Batch(batch.map(c => ({
      sql:    SQL,
      params: [
        c.id,
        c.userId,
        c.publicKey,
        c.counter  ?? 0,
        JSON.stringify(c.transports || []),
        c.name     ?? null,
        c.created,
        c.lastUsed ?? null,
      ],
    })));
    count += batch.length;
  }
  return count;
}

// ── Step 4: push subscriptions ────────────────────────────────────────────────
// p256dh and auth come from the nested keys object in db.json
async function migrateSubs(subs) {
  const SQL = `INSERT OR IGNORE INTO push_subscriptions
    (endpoint,user_id,p256dh,auth,device_id,created)
    VALUES (?,?,?,?,?,?)`;

  let count = 0;
  for (const batch of chunks(subs, 100)) {
    await d1Batch(batch.map(s => ({
      sql:    SQL,
      params: [
        s.endpoint,
        s.userId,
        s.keys?.p256dh ?? s.p256dh ?? '',
        s.keys?.auth   ?? s.auth   ?? '',
        s.deviceId     ?? null,
        s.created,
      ],
    })));
    count += batch.length;
  }
  return count;
}

// ── Step 5: invites ───────────────────────────────────────────────────────────
async function migrateInvites(invites) {
  const SQL = `INSERT OR IGNORE INTO invites
    (code,note,created_by,created,used_by,used_at,revoked)
    VALUES (?,?,?,?,?,?,?)`;

  let count = 0;
  for (const batch of chunks(invites, 100)) {
    await d1Batch(batch.map(i => ({
      sql:    SQL,
      params: [
        i.code,
        i.note        ?? '',
        i.createdBy,
        i.created,
        i.usedBy      ?? null,
        i.usedAt      ?? null,
        i.revoked     ? 1 : 0,
      ],
    })));
    count += batch.length;
  }
  return count;
}

// ── Step 6: device links ──────────────────────────────────────────────────────
// Only rows whose expiry is still in the future are migrated.
async function migrateDeviceLinks(links) {
  const SQL = `INSERT OR IGNORE INTO device_links
    (h,user_id,exp,created)
    VALUES (?,?,?,?)`;

  const now    = Date.now();
  const active = links.filter(l => l && typeof l.h === 'string' && l.exp > now);
  let count    = 0;

  for (const batch of chunks(active, 100)) {
    await d1Batch(batch.map(l => ({
      sql:    SQL,
      params: [l.h, l.userId, l.exp, l.created],
    })));
    count += batch.length;
  }
  return count;
}

// ── Step 7: VAPID keys ────────────────────────────────────────────────────────
async function migrateVapid() {
  const p    = path.join(DATA_DIR, 'vapid.json');
  const vapid = readJson(p);
  if (!vapid?.publicKey || !vapid?.privateKey) {
    console.log('  vapid.json missing or incomplete — skipped');
    return 0;
  }
  await d1Query(
    `INSERT OR IGNORE INTO vapid_keys (id,public_key,private_key) VALUES (1,?,?)`,
    [vapid.publicKey, vapid.privateKey],
  );
  return 1;
}

// ── Step 8: user states ───────────────────────────────────────────────────────
async function migrateStates(users) {
  const SQL = `INSERT OR REPLACE INTO user_state (user_id,state,rev) VALUES (?,?,?)`;
  let count = 0;

  for (const u of users) {
    const p     = path.join(DATA_DIR, `state-${u.id}.json`);
    const state = readJson(p);
    if (!state) continue;
    const rev   = state._rev ?? 0;
    await d1Query(SQL, [u.id, JSON.stringify(state), rev]);
    count++;
  }
  return count;
}

// ── Step 9: audit log ─────────────────────────────────────────────────────────
async function migrateAudit() {
  const p = path.join(DATA_DIR, 'audit.log');
  if (!fs.existsSync(p)) { console.log('  audit.log not found — skipped'); return 0; }

  const lines = fs.readFileSync(p, 'utf8').split('\n').filter(l => l.trim());
  const rows  = [];
  for (const line of lines) {
    try {
      const r = JSON.parse(line);
      if (r && typeof r.ts === 'number' && typeof r.ev === 'string') rows.push(r);
    } catch { /* skip malformed lines */ }
  }

  const SQL = `INSERT INTO audit_events
    (ts,ev,ok,uid,name,tgt,tname,msg,act,ip)
    VALUES (?,?,?,?,?,?,?,?,?,?)`;

  let count = 0;
  for (const batch of chunks(rows, 200)) {
    await d1Batch(batch.map(r => ({
      sql:    SQL,
      params: [
        r.ts,
        r.ev,
        r.ok !== false ? 1 : 0,
        r.uid   ?? null,
        r.name  ?? null,
        r.tgt   ?? null,
        r.tname ?? null,
        r.msg   ?? null,
        r.act   ?? null,
        r.ip    ?? null,
      ],
    })));
    count += batch.length;
  }
  return count;
}

// ── Step 10: media uploads ────────────────────────────────────────────────────
// Walks DATA_DIR/uploads/{uid}/{sha256}.{ext} and uploads to R2.
// Also writes a .meta/{sha256} key so the worker GET route can find the extension.
async function migrateMedia() {
  const uploadsDir = path.join(DATA_DIR, 'uploads');
  if (!fs.existsSync(uploadsDir)) {
    console.log('  uploads/ directory not found — skipped');
    return 0;
  }

  let count = 0;
  const uids = fs.readdirSync(uploadsDir, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name);

  for (const uid of uids) {
    const uidDir = path.join(uploadsDir, uid);
    let files;
    try { files = fs.readdirSync(uidDir, { withFileTypes: true }); }
    catch { continue; }

    for (const f of files) {
      if (!f.isFile()) continue;
      const m = FILE_RE.exec(f.name);
      if (!m) continue;
      const [, sha256, ext] = m;
      const mime = EXT_MIME[ext];
      if (!mime) continue;

      const filePath = path.join(uidDir, f.name);
      let buf;
      try { buf = fs.readFileSync(filePath); }
      catch (e) { console.error(`  Could not read ${filePath}: ${e.message}`); continue; }

      const r2Key  = `${uid}/${sha256}.${ext}`;
      const metaKey = `${uid}/.meta/${sha256}`;

      try {
        await r2Put(r2Key,  buf, mime);
        await r2Put(metaKey, ext, 'text/plain');
        count++;
      } catch (e) {
        console.error(`  R2 upload failed for ${r2Key}: ${e.message}`);
      }
    }
  }
  return count;
}

// ── main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\nFitness → Cloudflare migration  ${DRY_RUN ? '[DRY RUN]' : ''}`);
  console.log(`DATA_DIR: ${path.resolve(DATA_DIR)}\n`);

  // Step 1 — load source data
  let db;
  try   { db = loadDb(); }
  catch (e) {
    if (DRY_RUN) {
      // In dry-run, missing data files are fine — just report zeros.
      console.log('  db.json not found — reporting zero counts (dry-run mode)\n');
      db = { users: [], creds: [], subs: [], invites: [], deviceLinks: [] };
    } else {
      console.error(e.message); process.exit(1);
    }
  }

  console.log('Step 1  db.json loaded:',
    db.users.length, 'users,',
    db.creds.length, 'passkeys,',
    db.subs.length, 'subscriptions,',
    db.invites.length, 'invites,',
    db.deviceLinks.length, 'device links');

  // Step 2 — users
  process.stdout.write('Step 2  Migrating users ... ');
  const nUsers = await migrateUsers(db.users);
  console.log(`${nUsers} rows`);

  // Step 3 — passkeys
  process.stdout.write('Step 3  Migrating passkeys ... ');
  const nPasskeys = await migratePasskeys(db.creds);
  console.log(`${nPasskeys} rows`);

  // Step 4 — push subscriptions
  process.stdout.write('Step 4  Migrating push subscriptions ... ');
  const nSubs = await migrateSubs(db.subs);
  console.log(`${nSubs} rows`);

  // Step 5 — invites
  process.stdout.write('Step 5  Migrating invites ... ');
  const nInvites = await migrateInvites(db.invites);
  console.log(`${nInvites} rows`);

  // Step 6 — device links (active only)
  process.stdout.write('Step 6  Migrating device links (active only) ... ');
  const nLinks = await migrateDeviceLinks(db.deviceLinks);
  console.log(`${nLinks} rows`);

  // Step 7 — VAPID
  process.stdout.write('Step 7  Migrating VAPID keys ... ');
  const nVapid = await migrateVapid();
  console.log(`${nVapid} row(s)`);

  // Step 8 — user states
  process.stdout.write('Step 8  Migrating user states ... ');
  const nStates = await migrateStates(db.users);
  console.log(`${nStates} files`);

  // Step 9 — audit log
  process.stdout.write('Step 9  Migrating audit events ... ');
  const nAudit = await migrateAudit();
  console.log(`${nAudit} events`);

  // Step 10 — media uploads
  process.stdout.write('Step 10 Migrating media uploads ... ');
  const nMedia = await migrateMedia();
  console.log(`${nMedia} files`);

  // Summary table
  console.log('\n┌──────────────────────┬──────────┐');
  console.log('│ Table / resource     │   Count  │');
  console.log('├──────────────────────┼──────────┤');
  console.log(`│ users                │ ${String(nUsers).padStart(8)} │`);
  console.log(`│ passkeys             │ ${String(nPasskeys).padStart(8)} │`);
  console.log(`│ push_subscriptions   │ ${String(nSubs).padStart(8)} │`);
  console.log(`│ invites              │ ${String(nInvites).padStart(8)} │`);
  console.log(`│ device_links (live)  │ ${String(nLinks).padStart(8)} │`);
  console.log(`│ vapid_keys           │ ${String(nVapid).padStart(8)} │`);
  console.log(`│ user_state           │ ${String(nStates).padStart(8)} │`);
  console.log(`│ audit_events         │ ${String(nAudit).padStart(8)} │`);
  console.log(`│ R2 media files       │ ${String(nMedia).padStart(8)} │`);
  console.log('└──────────────────────┴──────────┘');
  console.log(DRY_RUN ? '\nDry run complete — no data was written.\n' : '\nMigration complete.\n');
}

main().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
