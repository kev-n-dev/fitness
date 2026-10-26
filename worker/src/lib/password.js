/* Password hashing and policy — Web Crypto only, no Node.js.
 *
 * hashPassword uses PBKDF2-SHA-256 at 310 000 iterations, 32-byte key.
 * PHC-style format: pbkdf2:sha256:310000:<salt_hex>:<hash_hex>
 *
 * verifyPassword detects a '$scrypt$' prefix from migrated data and returns
 * { ok: false, needsReset: true } — directing the user to the admin reset-code flow.
 *
 * All other exports (passwordProblem, passwordLength, normalizeEmail, maskEmail,
 * nameKey, MIN_LENGTH, MAX_LENGTH, EMAIL_MAX, EMAIL_RE, makeResetCode,
 * hashResetCode, resetCodeMatches, RESET_TTL_MS) are copied verbatim from
 * api/password.js with Node crypto calls replaced by Web Crypto. */

export const MIN_LENGTH = 10;
export const MAX_LENGTH = 256;

const ITERATIONS = 310000;
const KEYLEN = 32;
const SALT_BYTES = 16;

// ── helpers ───────────────────────────────────────────────────────────────────

const enc = new TextEncoder();

function hexEncode(buf) {
  return Array.from(new Uint8Array(buf), b => b.toString(16).padStart(2, '0')).join('');
}

function hexDecode(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return bytes;
}

function getRandomBytes(n) {
  const buf = new Uint8Array(n);
  globalThis.crypto.getRandomValues(buf);
  return buf;
}

// ── PBKDF2 ────────────────────────────────────────────────────────────────────

const normalize = pw => String(pw).normalize('NFKC');
export const passwordLength = pw => [...normalize(pw)].length;

async function pbkdf2(password, salt, iterations, keylen) {
  const keyMaterial = await globalThis.crypto.subtle.importKey(
    'raw', enc.encode(normalize(password)), 'PBKDF2', false, ['deriveBits']
  );
  const bits = await globalThis.crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
    keyMaterial,
    keylen * 8
  );
  return new Uint8Array(bits);
}

function formatHash(salt, key) {
  return `pbkdf2:sha256:${ITERATIONS}:${hexEncode(salt)}:${hexEncode(key)}`;
}

function parseHash(stored) {
  const m = /^pbkdf2:sha256:(\d+):([0-9a-f]+):([0-9a-f]+)$/.exec(String(stored || ''));
  if (!m) return null;
  const iterations = Number(m[1]);
  if (iterations < 1 || iterations > 1000000) return null;
  const salt = hexDecode(m[2]);
  const key = hexDecode(m[3]);
  if (salt.length < 8 || key.length < 16) return null;
  return { iterations, salt, key };
}

/** Hash a password with PBKDF2-SHA-256. Returns PHC-style string. */
export async function hashPassword(pw) {
  const salt = getRandomBytes(SALT_BYTES);
  const key = await pbkdf2(pw, salt, ITERATIONS, KEYLEN);
  return formatHash(salt, key);
}

/** Verify a password against a stored hash.
 *  Returns { ok: true } on match, { ok: false } on mismatch,
 *  { ok: false, needsReset: true } for migrated scrypt hashes. */
export async function verifyPassword(pw, stored) {
  if (typeof stored === 'string' && stored.startsWith('$scrypt$')) {
    return { ok: false, needsReset: true };
  }
  const h = parseHash(stored);
  if (!h) return { ok: false };
  const candidate = await pbkdf2(pw, h.salt, h.iterations, h.key.length);
  // Constant-time compare via manual XOR
  if (candidate.length !== h.key.length) return { ok: false };
  let diff = 0;
  for (let i = 0; i < candidate.length; i++) diff |= candidate[i] ^ h.key[i];
  return { ok: diff === 0 };
}

/** No-op: warmUp exists only for API compatibility with the original password.js. */
export const warmUp = async () => {};

// ── name / email helpers (verbatim from api/password.js) ─────────────────────

export const nameKey = name => String(name || '').normalize('NFKC').trim().toLowerCase();

export const EMAIL_MAX = 254;
export const EMAIL_RE = /^[^\s@<>()[\]\\,;:"]{1,64}@(?=.{1,253}$)[^\s@<>()[\]\\,;:"._-][^\s@<>()[\]\\,;:"]*\.[^\s@<>()[\]\\,;:".]{2,}$/u;

export function normalizeEmail(raw) {
  if (typeof raw !== 'string') return null;
  const e = nameKey(raw);
  if (!e || [...e].length > EMAIL_MAX || !EMAIL_RE.test(e) || e.includes('..')) return null;
  return e;
}

export const maskEmail = e => {
  const [local = '', domain = ''] = String(e || '').split('@');
  return (local[0] || '?') + '…@' + (domain[0] || '?') + '…';
};

// ── password policy (verbatim from api/password.js) ───────────────────────────

const COMMON = new Set([
  '1234567890', '0987654321', '12345678910', '123456789012', '1234567890123', '11111111111',
  '1111111111', '0000000000', '9999999999', '1q2w3e4r5t', '1q2w3e4r5t6y', 'q1w2e3r4t5',
  'qwertyuiop', 'qwertyuiop[]', 'asdfghjkl;', 'asdfghjkl', 'zxcvbnm,./', '1qaz2wsx3edc',
  'qazwsxedc123', 'qwerty123456', 'qwertz123456', 'azerty123456', 'password12', 'password123',
  'password1234', 'password12345', 'passw0rd123', 'iloveyou123', 'abcdefghij', 'abcd123456',
  'abc1234567', 'a1b2c3d4e5', 'aaaaaaaaaa', 'princess123', 'football123', 'baseball123',
  'sunshine123', 'superman123', 'welcome123', 'welcome1234', 'letmein123', 'trustno1234',
  'changeme123', 'administrator', 'opengym123', 'opengym1234', 'qwerty1234567', '123qweasdzxc',
  'zaq12wsxcde3', '1q2w3e4r5t6y7u', 'q1w2e3r4t5y6', '123123123123', '1234512345',
  '123456123456', 'monkey12345', 'dragon12345', 'master12345', 'shadow12345', 'michael123',
  'jennifer123', 'computer123', 'starwars123', 'whatever123', 'freedom1234', 'pokemon1234',
  'liverpool123', 'chelsea1234', 'arsenal1234', 'barcelona123', 'realmadrid123', 'juventus123',
  'hallo12345', 'passwort123', 'passwort1234', 'motdepasse123', 'contrasena123', 'contraseña123',
  'senha123456', 'parola12345', 'haslo123456', 'wachtwoord123', 'salasana123', 'gymgymgym1'
]);
const STEMS = new Set([
  'password', 'passwort', 'passw0rd', 'motdepasse', 'contrasena', 'contraseña', 'senha', 'parola',
  'haslo', 'wachtwoord', 'salasana', 'qwerty', 'qwertz', 'azerty', 'qwertyuiop', 'asdfgh',
  'letmein', 'welcome', 'iloveyou', 'admin', 'administrator', 'changeme', 'opengym', 'gym',
  'workout', 'fitness', 'dragon', 'monkey', 'football', 'baseball', 'sunshine', 'princess',
  'superman', 'batman', 'master', 'shadow', 'trustno', 'abc', 'abcdef', 'secret', 'login'
]);

export function passwordProblem(pw, name) {
  if (typeof pw !== 'string') return 'too-short';
  const len = passwordLength(pw);
  if (len < MIN_LENGTH) return 'too-short';
  if (len > MAX_LENGTH) return 'too-long';
  const low = normalize(pw).toLowerCase();
  if (new Set(low).size <= 2) return 'too-common';
  if (COMMON.has(low)) return 'too-common';
  const stem = low.replace(/^[^\p{L}]+|[^\p{L}]+$/gu, '');
  if (STEMS.has(stem)) return 'too-common';
  const n = nameKey(name);
  if (n.length >= 3 && stem === n) return 'too-common';
  return null;
}

// ── reset codes ───────────────────────────────────────────────────────────────

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const RESET_TTL_MS = 24 * 3600000;

export function makeResetCode() {
  const bytes = getRandomBytes(12);
  const raw = Array.from(bytes, b => ALPHABET[b % ALPHABET.length]).join('');
  return raw.slice(0, 4) + '-' + raw.slice(4, 8) + '-' + raw.slice(8);
}

const cleanCode = code => String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

export async function hashResetCode(code) {
  const data = enc.encode('opengym-reset:' + cleanCode(code));
  const hash = await globalThis.crypto.subtle.digest('SHA-256', data);
  return hexEncode(hash);
}

export async function resetCodeMatches(code, stored) {
  if (!stored || typeof stored.h !== 'string' || !(stored.exp > Date.now())) return false;
  const h = await hashResetCode(code);
  if (h.length !== stored.h.length) return false;
  // Constant-time compare
  let diff = 0;
  for (let i = 0; i < h.length; i++) diff |= h.charCodeAt(i) ^ stored.h.charCodeAt(i);
  return diff === 0;
}
