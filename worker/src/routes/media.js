// Routes: PUT /api/media/:hash, GET /api/media/:hash, POST /api/media/missing,
//         POST /api/media/sweep
//
// R2 key format : {uid}/{sha256}.{ext}
// R2 meta key   : {uid}/.meta/{sha256}  (value = ext string)
//
// All routes return 403 when MEDIA_UPLOADS env var is 'false', '0', or 'off'.
// Sniffing logic copied verbatim from api/media.js; Buffer replaced with Uint8Array
// so the file uses only Web APIs (no Node.js built-ins).

import { Hono } from 'hono';
import { getSession } from './auth.js';
import { checkWindow } from '../lib/rate-limit.js';
import { getUserState } from '../db/queries.js';

// ── constants (verbatim from api/media.js) ────────────────────────────────────

export const HASH_RE = /^[0-9a-f]{64}$/;
const MB = 1024 * 1024;       // every *_MB setting means MiB; the client uses the same unit
const HEAD_BYTES = 64;         // enough for every magic number below, the WebM DocType included
const DAY = 86_400_000;

/* The seven types that are ever stored. `category` is what the client may not lie about: a
   JPEG declared as a GIF is still a still image and is stored as the JPEG it is, but a video
   declared as an image would slip past the image cap, so that mismatch is refused. */
export const MEDIA_TYPES = {
  'image/jpeg':      { kind: 'image', category: 'still', ext: 'jpg'  },
  'image/png':       { kind: 'image', category: 'still', ext: 'png'  },
  'image/webp':      { kind: 'image', category: 'still', ext: 'webp' },
  'image/gif':       { kind: 'gif',   category: 'still', ext: 'gif'  },
  'video/mp4':       { kind: 'video', category: 'video', ext: 'mp4'  },
  'video/quicktime': { kind: 'video', category: 'video', ext: 'mov'  },
  'video/webm':      { kind: 'video', category: 'video', ext: 'webm' },
};
export const EXT_MIME = Object.fromEntries(
  Object.entries(MEDIA_TYPES).map(([mime, t]) => [t.ext, mime]),
);
export const FILE_RE = /^([0-9a-f]{64})\.(jpg|png|webp|gif|mp4|mov|webm)$/;

const OFF = /^(0|false|no|off)$/i;

const MESSAGES = {
  'bad-request':     'bad request',
  'media-type':      'that file type is not accepted',
  'media-too-large': 'that file is too large',
  'media-quota':     'your space for photos and videos is full',
  'media-invalid':   'that video could not be read',
  'media-too-long':  'that video is too long',
  'media-missing':   'no such file',
  'hash-mismatch':   'the file does not match its name',
  'storage-full':    'the server is running out of disk space',
  busy:              'too many uploads at once, try again in a moment',
  locked:            'too many uploads, try again later',
  timeout:           'the upload stalled',
};

/** A refusal the client caused or can act on (verbatim from api/media.js). */
export class MediaError extends Error {
  constructor(status, code, extra = {}, headers = undefined) {
    super(MESSAGES[code] || code);
    this.status = status;
    this.code = code;
    this.extra = extra;
    this.headers = headers;
  }
}

/** The instance's media settings, read from the environment (verbatim from api/media.js). */
export function mediaLimits(env = {}) {
  const num = (key, def, min) => {
    const raw = env[key];
    if (raw == null || String(raw).trim() === '') return def;
    const n = Number(raw);
    return Number.isFinite(n) && n >= min ? n : def;
  };
  return {
    enabled:         !OFF.test(String(env.MEDIA_UPLOADS || '').trim()),
    quotaMB:          num('MEDIA_QUOTA_MB',          200, 0),
    imageMB:          num('MEDIA_IMAGE_MAX_MB',         2, 0.001),
    gifMB:            num('MEDIA_GIF_MAX_MB',            8, 0.001),
    videoMB:          num('MEDIA_VIDEO_MAX_MB',         40, 0.001),
    videoSec:         num('MEDIA_VIDEO_MAX_SEC',        60, 1),
    gcGraceDays:      num('MEDIA_GC_GRACE_DAYS',        14, 0),
    uploadsPerHour:   Math.floor(num('MEDIA_UPLOADS_PER_HOUR', 600, 1)),
    minFreeMB:        num('MEDIA_MIN_FREE_MB',         512, 0),
  };
}

/** The block GET /api/config hands out (verbatim from api/media.js). */
export const mediaConfig = l => ({
  imageMB:  l.imageMB,
  gifMB:    l.gifMB,
  videoMB:  l.videoMB,
  videoSec: l.videoSec,
  quotaMB:  l.quotaMB,
  workouts: true,
});

// ── EBML / sniff helpers (verbatim logic; Buffer → Uint8Array for Workers) ────

const MP4_BRANDS = new Set([
  'isom', 'iso2', 'iso3', 'iso4', 'iso5', 'iso6', 'mp41', 'mp42', 'avc1', 'M4V ', 'M4VP',
  'dash', 'mmp4', 'MSNV', '3gp4', '3gp5', '3gp6', '3g2a',
]);

// An EBML variable-length integer at b[i]. IDs keep their length marker, sizes drop it.
function vint(b, i, keepMarker) {
  if (i >= b.length || b[i] === 0) return null;
  const first = b[i];
  let len = 1;
  while (!(first & (0x80 >> (len - 1)))) len++;
  if (i + len > b.length) return null;
  let v = keepMarker ? first : first & (0xff >> len);
  for (let k = 1; k < len; k++) v = v * 256 + b[i + k];
  return { value: v, len };
}

// The DocType of an EBML header ('webm', 'matroska'), read off the header's children.
function ebmlDocType(b) {
  const hs = vint(b, 4, false);
  if (!hs) return null;
  let i = 4 + hs.len;
  const end = Math.min(b.length, i + hs.value);
  while (i < end) {
    const id = vint(b, i, true);
    const sz = id && vint(b, i + id.len, false);
    if (!sz) return null;
    const body = i + id.len + sz.len;
    if (id.value === 0x4282) {
      if (body + sz.value > b.length) return null;
      // Decode latin-1 without Buffer.toString() — Workers-compatible
      let s = '';
      const tail = body + sz.value;
      for (let k = body; k < tail && k < b.length; k++) s += String.fromCharCode(b[k]);
      return s.replace(/\0+$/, '');
    }
    i = body + sz.value;
  }
  return null;
}

/**
 * What a file is, from its first bytes alone — never from its name or a declared type.
 * Returns { mime, kind, category, ext } or null.
 * Verbatim logic from api/media.js; Buffer replaced with Uint8Array.
 */
export function sniffMedia(head) {
  const b = head instanceof Uint8Array
    ? head
    : (head ? new Uint8Array(head) : new Uint8Array(0));
  const as = mime => ({ mime, ...MEDIA_TYPES[mime] });
  const at = (off, ...bytes) => bytes.every((x, i) => b[off + i] === x);
  const ascii = (off, len) => {
    if (b.length < off + len) return '';
    let s = '';
    for (let i = 0; i < len; i++) s += String.fromCharCode(b[off + i]);
    return s;
  };
  if (at(0, 0xff, 0xd8, 0xff)) return as('image/jpeg');
  if (at(0, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return as('image/png');
  if (ascii(0, 6) === 'GIF87a' || ascii(0, 6) === 'GIF89a') return as('image/gif');
  if (ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WEBP') return as('image/webp');
  if (ascii(4, 4) === 'ftyp') {
    const brand = ascii(8, 4);
    if (brand === 'qt  ') return as('video/quicktime');
    if (MP4_BRANDS.has(brand)) return as('video/mp4');
    return null; // HEIC/AVIF stills, M4A audio, unrecognised brand
  }
  if (at(0, 0x1a, 0x45, 0xdf, 0xa3)) return ebmlDocType(b) === 'webm' ? as('video/webm') : null;
  return null;
}

/**
 * mp4Info reads an open file descriptor with positioned fs.readSync calls (Node.js only).
 * That API is unavailable in Cloudflare Workers, so this stub returns null.
 * MP4/MOV duration validation is therefore skipped; sniffMedia still validates the type.
 */
export function mp4Info(_fd, _size) { return null; }

/**
 * Every blob a state refers to — verbatim from api/media.js.
 */
export function referencedHashes(state) {
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

// ── private helpers ───────────────────────────────────────────────────────────

const OFF_EXACT = /^(false|0|off)$/i;

function uploadsEnabled(env) {
  return !OFF_EXACT.test(String(env.MEDIA_UPLOADS || '').trim());
}

// Sanitise a uid to the same character set used by server.js stateFile().
function safe(uid) {
  const s = String(uid ?? '').replace(/[^a-zA-Z0-9_-]/g, '');
  if (!s) throw new Error('media: a profile id is required');
  return s;
}

// ArrayBuffer / BufferSource → lowercase hex string.
function hexFrom(buf) {
  return Array.from(new Uint8Array(buf), b => b.toString(16).padStart(2, '0')).join('');
}

// ── routes ────────────────────────────────────────────────────────────────────

const app = new Hono();

// ── PUT /api/media/:hash ───────────────────────────────────────────────────────
// Accepts a media file whose SHA-256 hex equals :hash.
// On success returns { ok, hash, mime, size, existed }.
app.put('/api/media/:hash', async (c) => {
  if (!uploadsEnabled(c.env))
    return c.json({ error: 'media uploads disabled', code: 'disabled' }, 403);

  const session = await getSession(c);
  if (!session) return c.json({ error: 'not signed in', code: 'auth' }, 401);
  const uid = safe(session.user.id);

  const hash = c.req.param('hash');
  if (!HASH_RE.test(hash))
    return c.json({ error: MESSAGES['bad-request'], code: 'bad-request' }, 400);

  const limits = mediaLimits(c.env);

  // Rate-limit: uploads per hour
  const wait = await checkWindow(c.env.RATE_LIMITS, `upload:${uid}`, {
    max:      limits.uploadsPerHour,
    windowMs: 3_600_000,
  });
  if (wait > 0) {
    c.header('Retry-After', String(wait));
    return c.json({ error: MESSAGES.locked, code: 'locked', retryAfter: wait }, 429);
  }

  // Determine per-kind cap from the declared Content-Type header
  const ctRaw = (c.req.header('content-type') || '').split(';')[0].trim().toLowerCase();
  const declared = MEDIA_TYPES[ctRaw];
  if (!declared) return c.json({ error: MESSAGES['media-type'], code: 'media-type' }, 415);

  const capMB_fn = kind =>
    kind === 'video' ? limits.videoMB : kind === 'gif' ? limits.gifMB : limits.imageMB;
  const capOf   = kind => Math.round(capMB_fn(kind) * MB);
  const cap      = capOf(declared.kind);

  // Content-Length pre-check — reject before reading the body
  const clRaw = c.req.header('content-length');
  const clNum = clRaw != null ? Number(clRaw) : null;
  if (clNum != null && Number.isSafeInteger(clNum) && clNum > cap) {
    return c.json({
      error: MESSAGES['media-too-large'], code: 'media-too-large',
      maxMB: capMB_fn(declared.kind),
    }, 413);
  }

  // HEAD R2 — if we already have the file with a matching size, skip the upload
  const existingMeta = await c.env.FITNESS_MEDIA.get(`${uid}/.meta/${hash}`);
  if (existingMeta) {
    const ext      = (await existingMeta.text()).trim();
    const existing = await c.env.FITNESS_MEDIA.head(`${uid}/${hash}.${ext}`);
    if (existing && (clNum == null || existing.size === clNum)) {
      return c.json({ ok: true, existed: true, hash, mime: EXT_MIME[ext] || ctRaw, size: existing.size });
    }
  }

  // Buffer the body (Workers: no filesystem; max video cap 40 MB < 128 MB worker memory)
  const bodyBuffer = await c.req.arrayBuffer();
  const size       = bodyBuffer.byteLength;

  if (size > cap) {
    return c.json({
      error: MESSAGES['media-too-large'], code: 'media-too-large',
      maxMB: capMB_fn(declared.kind),
    }, 413);
  }

  // Hash verification using Web Crypto
  const hashDigest = await crypto.subtle.digest('SHA-256', bodyBuffer);
  const sha256     = hexFrom(hashDigest);
  if (sha256 !== hash)
    return c.json({ error: MESSAGES['hash-mismatch'], code: 'hash-mismatch' }, 400);

  // Sniff actual MIME from first 64 bytes
  const head = new Uint8Array(bodyBuffer, 0, Math.min(HEAD_BYTES, size));
  const sn   = sniffMedia(head);
  if (!sn || sn.category !== declared.category)
    return c.json({ error: MESSAGES['media-type'], code: 'media-type' }, 415);

  // Size vs sniffed kind cap (e.g. a GIF can be declared as image but has its own cap)
  const kindCap = capOf(sn.kind);
  if (size > kindCap) {
    return c.json({
      error: MESSAGES['media-too-large'], code: 'media-too-large',
      maxMB: capMB_fn(sn.kind),
    }, 413);
  }

  // Quota check — sum sizes of existing media files (excluding .meta/ keys)
  if (limits.quotaMB > 0) {
    const quotaBytes = Math.round(limits.quotaMB * MB);
    const listed     = await c.env.FITNESS_MEDIA.list({ prefix: `${uid}/` });
    const usedBytes  = listed.objects
      .filter(o => !o.key.includes('/.meta/'))
      .reduce((s, o) => s + o.size, 0);
    if (usedBytes + size > quotaBytes) {
      return c.json({
        error: MESSAGES['media-quota'], code: 'media-quota',
        usedMB:  Math.round(usedBytes / MB * 10) / 10,
        quotaMB: limits.quotaMB,
      }, 413);
    }
  }

  // Write media object; R2 verifies the sha256 matches what we computed
  await c.env.FITNESS_MEDIA.put(`${uid}/${hash}.${sn.ext}`, bodyBuffer, {
    httpMetadata: { contentType: sn.mime },
    sha256,
  });
  // Write meta key (ext string) so GET can find the correct extension
  await c.env.FITNESS_MEDIA.put(`${uid}/.meta/${hash}`, sn.ext, {
    httpMetadata: { contentType: 'text/plain' },
  });

  return c.json({ ok: true, hash, mime: sn.mime, size, existed: false });
});

// ── GET /api/media/:hash ───────────────────────────────────────────────────────
// Streams the stored file with security headers. 404 when not found.
app.get('/api/media/:hash', async (c) => {
  if (!uploadsEnabled(c.env))
    return c.json({ error: 'media uploads disabled', code: 'disabled' }, 403);

  const session = await getSession(c);
  if (!session) return c.json({ error: 'not signed in', code: 'auth' }, 401);
  const uid = safe(session.user.id);

  const hash = c.req.param('hash');
  if (!HASH_RE.test(hash))
    return c.json({ error: MESSAGES['bad-request'], code: 'bad-request' }, 400);

  // Look up extension from meta key
  const metaObj = await c.env.FITNESS_MEDIA.get(`${uid}/.meta/${hash}`);
  if (!metaObj) return c.json({ error: MESSAGES['media-missing'], code: 'media-missing' }, 404);
  const ext = (await metaObj.text()).trim();

  // Fetch the actual media object
  const obj = await c.env.FITNESS_MEDIA.get(`${uid}/${hash}.${ext}`);
  if (!obj) return c.json({ error: MESSAGES['media-missing'], code: 'media-missing' }, 404);

  const mime    = EXT_MIME[ext] || 'application/octet-stream';
  const headers = new Headers({
    'Content-Type':                mime,
    'X-Content-Type-Options':      'nosniff',
    'Content-Security-Policy':     'sandbox',
    'Cross-Origin-Resource-Policy': 'same-origin',
    'Cache-Control':               'no-store',
    'Content-Disposition':         'inline',
  });
  if (obj.size) headers.set('Content-Length', String(obj.size));

  return new Response(obj.body, { status: 200, headers });
});

// ── POST /api/media/missing ────────────────────────────────────────────────────
// Body: { hashes: string[] }.  Returns { missing: string[] }.
app.post('/api/media/missing', async (c) => {
  if (!uploadsEnabled(c.env))
    return c.json({ error: 'media uploads disabled', code: 'disabled' }, 403);

  const session = await getSession(c);
  if (!session) return c.json({ error: 'not signed in', code: 'auth' }, 401);
  const uid = safe(session.user.id);

  const body   = await c.req.json().catch(() => ({}));
  const hashes = Array.isArray(body.hashes) ? body.hashes : [];
  const missing = [];

  for (const h of hashes) {
    if (typeof h !== 'string' || !HASH_RE.test(h)) { missing.push(h); continue; }
    const metaObj = await c.env.FITNESS_MEDIA.get(`${uid}/.meta/${h}`);
    if (!metaObj) { missing.push(h); continue; }
    const ext = (await metaObj.text()).trim();
    const obj  = await c.env.FITNESS_MEDIA.head(`${uid}/${h}.${ext}`);
    if (!obj) missing.push(h);
  }

  return c.json({ missing });
});

// ── POST /api/media/sweep ──────────────────────────────────────────────────────
// GC: removes unreferenced blobs past their grace period.
// Rate-limited: 10 sweeps per hour.
// Returns { removed, freedBytes, usage: { bytes, count, quotaBytes } }.
app.post('/api/media/sweep', async (c) => {
  if (!uploadsEnabled(c.env))
    return c.json({ error: 'media uploads disabled', code: 'disabled' }, 403);

  const session = await getSession(c);
  if (!session) return c.json({ error: 'not signed in', code: 'auth' }, 401);
  const uid = safe(session.user.id);

  const wait = await checkWindow(c.env.RATE_LIMITS, `sweep:${uid}`, {
    max:      10,
    windowMs: 3_600_000,
  });
  if (wait > 0) {
    c.header('Retry-After', String(wait));
    return c.json({ error: MESSAGES.locked, code: 'locked', retryAfter: wait }, 429);
  }

  // Read user state from D1 to determine referenced hashes
  const row = await getUserState(c.env.DB, session.user.id);
  let state = null;
  if (row) {
    try { state = JSON.parse(row.state); } catch { state = null; }
  }
  const refs    = referencedHashes(state);
  const limits  = mediaLimits(c.env);
  const graceMs = limits.gcGraceDays * DAY;
  const now     = Date.now();

  // List all R2 objects for this user
  const prefix  = `${uid}/`;
  const listed  = await c.env.FITNESS_MEDIA.list({ prefix });
  const mediaObjects = listed.objects.filter(o => !o.key.includes('/.meta/'));

  let removed    = 0;
  let freedBytes = 0;

  for (const obj of mediaObjects) {
    const keyPart = obj.key.slice(prefix.length);
    const m = FILE_RE.exec(keyPart);
    if (!m) continue;
    const [, objHash] = m;

    if (refs.has(objHash)) continue;

    // Check KV grace mark written by sync.js noteState
    const gcKey  = `gc:${uid}:${objHash}`;
    const graceVal = await c.env.RATE_LIMITS.get(gcKey);
    if (!graceVal) continue; // not yet marked — skip until noteState runs
    const markedAt = Number(graceVal);
    if (!Number.isFinite(markedAt) || now - markedAt < graceMs) continue;

    // Past grace period — delete media + meta + grace mark
    await c.env.FITNESS_MEDIA.delete(obj.key);
    await c.env.FITNESS_MEDIA.delete(`${uid}/.meta/${objHash}`);
    await c.env.RATE_LIMITS.delete(gcKey);
    removed++;
    freedBytes += obj.size;
  }

  // Recalculate usage
  const listedAfter  = await c.env.FITNESS_MEDIA.list({ prefix });
  const mediaAfter   = listedAfter.objects.filter(o => !o.key.includes('/.meta/'));
  const usageBytes   = mediaAfter.reduce((s, o) => s + o.size, 0);
  const quotaBytes   = limits.quotaMB > 0 ? Math.round(limits.quotaMB * MB) : 0;

  return c.json({
    removed,
    freedBytes,
    usage: { bytes: usageBytes, count: mediaAfter.length, quotaBytes },
  });
});

export default app;
