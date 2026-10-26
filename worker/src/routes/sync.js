// GET /api/data        — pull full state
// GET /api/data/rev    — cheap revision poll (KV-first)
// PUT /api/data        — push state delta
//
// Ported from api/server.js GET/PUT /api/data sections.
// referencedHashes() copied from api/media.js.
import { Hono } from 'hono';
import { getSession } from './auth.js';
import { getUserState, updateUser } from '../db/queries.js';
import { stampPut } from '../lib/sync-stamps.js';

// ── constants ──────────────────────────────────────────────────────────────────

// How many earlier write ids a document keeps (`_wids`).
const WID_KEEP = 50;
// GET /api/data updates user.last_pull at most once per this interval.
const PULL_NOTE_MS = 600_000; // 10 minutes
// Media hash pattern — 64 hex chars.
const HASH_RE = /^[0-9a-f]{64}$/;

// ── helpers ────────────────────────────────────────────────────────────────────

// A stored document as a client gets it: strips server-private _unstamped and _prior.
// Copied from api/server.js forClient().
function forClient(S) {
  if (!S || typeof S !== 'object' || !('_unstamped' in S || '_prior' in S)) return S;
  const { _unstamped, _prior, ...rest } = S;
  return rest;
}

// Filters a list down to plain-object entries (non-null, non-array objects).
// Copied from api/server.js records().
const record = x => !!x && typeof x === 'object' && !Array.isArray(x);
const records = v => (Array.isArray(v) ? v.filter(record) : []);

// Every blob hash a state references: customEx[].media(.poster) and workouts[].media[].
// Copied verbatim from api/media.js referencedHashes().
function referencedHashes(state) {
  const out = new Set();
  if (!state || typeof state !== 'object') return out;
  const isObj = v => !!v && typeof v === 'object' && !Array.isArray(v);
  const add = r => {
    if (r && typeof r === 'object' && typeof r.hash === 'string' && HASH_RE.test(r.hash))
      out.add(r.hash);
  };
  const ref = m => { add(m); add(m.poster); };
  for (const c of Array.isArray(state.customEx) ? state.customEx : []) {
    if (isObj(c) && isObj(c.media)) ref(c.media);
  }
  for (const w of Array.isArray(state.workouts) ? state.workouts : []) {
    if (!isObj(w) || !Array.isArray(w.media)) continue;
    for (const m of w.media) if (isObj(m)) ref(m);
  }
  return out;
}

// Update KV GC marks after a PUT. Best-effort; never turns a success into an error.
// Referenced hashes: delete the GC key (cancel pending collection).
// Hashes that were referenced in the old state but absent from the new one: set the GC key
// to now (begin the grace period). Corresponds to media.js noteState + reconcile().
async function noteState(env, uid, curState, newState) {
  try {
    const newRefs = referencedHashes(newState);
    const oldRefs = curState ? referencedHashes(curState) : new Set();
    const ops = [];
    for (const h of newRefs) {
      ops.push(env.RATE_LIMITS.delete('gc:' + uid + ':' + h));
    }
    for (const h of oldRefs) {
      if (!newRefs.has(h)) {
        ops.push(
          env.RATE_LIMITS.put(
            'gc:' + uid + ':' + h,
            String(Date.now()),
            { expirationTtl: 86_400 * 30 }, // 30-day safety TTL
          ),
        );
      }
    }
    if (ops.length) await Promise.all(ops);
  } catch (e) {
    console.error('noteState failed', uid, e?.message);
  }
}

// ── routes ─────────────────────────────────────────────────────────────────────

const app = new Hono();

// ── GET /api/data ──────────────────────────────────────────────────────────────
// Returns the full synced document for the signed-in user.
app.get('/api/data', async (c) => {
  const session = await getSession(c);
  if (!session) return c.json({ error: 'not signed in' }, 401);
  const { user } = session;
  const env = c.env;

  const row = await getUserState(env.DB, user.id);
  if (!row) return c.json({ state: null, rev: 0 });

  let state;
  try {
    state = JSON.parse(row.state);
  } catch {
    console.error('state unreadable for', user.id);
    return c.json({ error: 'state unreadable' }, 503);
  }

  // Record the pull timestamp at most once per PULL_NOTE_MS — non-blocking.
  const now = Date.now();
  if (now - (user.last_pull || 0) >= PULL_NOTE_MS) {
    const ctx = c.executionCtx ?? { waitUntil: () => {} };
    ctx.waitUntil(
      updateUser(env.DB, user.id, { last_pull: now })
        .catch(e => console.error('notePull failed', e?.message)),
    );
  }

  return c.json({ state: forClient(state), rev: row.rev });
});

// ── GET /api/data/rev ──────────────────────────────────────────────────────────
// Returns just the revision (and write id) — the client polls this every 30 s.
// KV is the cheap path; D1 is the fallback on a cache miss.
app.get('/api/data/rev', async (c) => {
  const session = await getSession(c);
  if (!session) return c.json({ error: 'not signed in' }, 401);
  const { user } = session;
  const env = c.env;

  // KV fast path — written on every successful PUT /api/data.
  const kvRaw = await env.SESSIONS.get('data:rev:' + user.id);
  if (kvRaw) {
    try {
      const cached = JSON.parse(kvRaw);
      return c.json({ rev: cached.rev, ...(cached.wid ? { wid: cached.wid } : {}) });
    } catch { /* fall through to D1 */ }
  }

  // D1 fallback — parse state to extract _rev and _wid.
  const row = await getUserState(env.DB, user.id);
  if (!row) return c.json({ rev: 0 });

  let rev = row.rev || 0;
  let wid;
  try {
    const state = JSON.parse(row.state);
    rev = state?._rev || row.rev || 0;
    wid = state?._wid;
  } catch { /* use row.rev, no wid */ }

  return c.json({ rev, ...(wid ? { wid } : {}) });
});

// ── PUT /api/data ──────────────────────────────────────────────────────────────
// Receives a state push. Validates, stamps, and writes to D1.
app.put('/api/data', async (c) => {
  const session = await getSession(c);
  if (!session) return c.json({ error: 'not signed in' }, 401);
  const { user } = session;
  const env = c.env;

  const body = await c.req.json().catch(() => ({}));

  // ── validate body.state ────────────────────────────────────────────────────
  if (!body.state || typeof body.state !== 'object') {
    return c.json({ error: 'state required' }, 400);
  }
  // Reject a document whose only keys are server-owned bookkeeping (_rev, _ts).
  if (
    !Array.isArray(body.state) &&
    !Object.keys(body.state).some(k => k !== '_rev' && k !== '_ts')
  ) {
    return c.json({ error: 'state required' }, 400);
  }
  const isList = v => v == null || Array.isArray(v);
  if (Array.isArray(body.state) || !isList(body.state.workouts) || !isList(body.state.routines)) {
    return c.json({ error: 'invalid state' }, 400);
  }
  // Drop non-object entries from the two lists the server iterates.
  for (const k of ['workouts', 'routines']) {
    if (Array.isArray(body.state[k])) body.state[k] = records(body.state[k]);
  }

  // ── read current state from D1 ─────────────────────────────────────────────
  const row = await getUserState(env.DB, user.id);
  let cur = null;
  if (row) {
    try {
      cur = JSON.parse(row.state);
    } catch {
      console.error('state unreadable for', user.id);
      return c.json({ error: 'state unreadable' }, 503);
    }
  }
  const curRev = cur?._rev || 0;

  // ── conflict check ─────────────────────────────────────────────────────────
  // A baseRev that does not match the stored rev means another device wrote first.
  // A baseWid mismatch catches the same when rev counters went back in time (restore).
  if (
    (body.baseRev != null && body.baseRev !== curRev) ||
    (body.baseRev != null &&
      typeof body.baseWid === 'string' &&
      cur?._wid &&
      body.baseWid !== cur._wid)
  ) {
    return c.json({ error: 'conflict', rev: curRev, state: forClient(cur) }, 409);
  }

  // ── apply changes ──────────────────────────────────────────────────────────
  // Active workouts stay device-local, never stored.
  delete body.state.active;

  // resetAt only moves forward: keep the stored stamp if it is newer.
  const storedReset = Number(cur?.resetAt) || 0;
  if (storedReset > (Number(body.state.resetAt) || 0)) {
    body.state.resetAt = cur.resetAt;
    if (cur.resetIds && typeof cur.resetIds === 'object') body.state.resetIds = cur.resetIds;
    else delete body.state.resetIds;
  }

  // Run sync-stamps: merges deletion/edit records, restores unknown fields for older writers,
  // stamps changes made without stamps. report.changed is set when the stored document will
  // differ from what the writer sent (server put something back).
  const report = {};
  try {
    stampPut(cur, body.state, {
      overRead: body.baseRev != null && body.baseRev === curRev,
      stamped: body.stamped === true,
      report,
    });
  } catch (e) {
    if (e instanceof RangeError) return c.json({ error: 'invalid state' }, 400);
    throw e;
  }

  // Assign server-owned revision bookkeeping.
  body.state._rev = curRev + 1;
  // Step up an extra revision when the server modified the document so the writer's next
  // half-minute poll sees a change and re-fetches.
  if (report.changed) body.state._rev = curRev + 2;

  body.state._wids = [
    ...(Array.isArray(cur?._wids) ? cur._wids : []),
    ...(cur?._wid ? [cur._wid] : []),
  ].filter(x => typeof x === 'string').slice(-WID_KEEP);

  const widBytes = new Uint8Array(8);
  crypto.getRandomValues(widBytes);
  body.state._wid = Array.from(widBytes, b => b.toString(16).padStart(2, '0')).join('');

  const rev = body.state._rev;
  const wid = body.state._wid;

  // Serialize. JSON.stringify throws RangeError on documents nested thousands of levels deep.
  let text;
  try {
    text = JSON.stringify(body.state);
  } catch (e) {
    if (e instanceof RangeError) return c.json({ error: 'invalid state' }, 400);
    throw e;
  }

  // ── atomic write to D1 ─────────────────────────────────────────────────────
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO user_state (user_id, state, rev) VALUES (?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET state = excluded.state, rev = excluded.rev`,
    ).bind(user.id, text, rev),
  ]);

  // ── post-write KV bookkeeping (non-blocking) ───────────────────────────────
  // Cache the new rev so GET /api/data/rev answers from KV for the next 5 min.
  // Update media GC marks so unreferenced blobs age out correctly.
  const ctx = c.executionCtx ?? { waitUntil: () => {} };
  ctx.waitUntil(
    (async () => {
      await env.SESSIONS.put(
        'data:rev:' + user.id,
        JSON.stringify({ rev, wid }),
        { expirationTtl: 300 },
      );
      await noteState(env, user.id, cur, body.state);
    })().catch(e => console.error('sync post-write KV failed', e?.message)),
  );

  return c.json({ ok: true, ts: body.state._ts || null, rev, wid });
});

export default app;
