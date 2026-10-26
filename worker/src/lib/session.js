// Web Crypto HMAC-SHA-256 sessions. Uses ONLY globalThis.crypto — no Node.js crypto.
//
// Token format: base64url(uid:exp:sv) + '.' + base64url(hmac)
// The payload is uid:exp:sv where exp is Unix ms expiry and sv is session version.

const enc = new TextEncoder();

function b64uEncode(buf) {
  const bytes = new Uint8Array(buf);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function b64uDecode(str) {
  const s = str.replace(/-/g, '+').replace(/_/g, '/');
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4));
  const bin = atob(s + pad);
  const buf = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  return buf;
}

async function importKey(secret) {
  const raw = typeof secret === 'string' ? enc.encode(secret) : secret;
  return globalThis.crypto.subtle.importKey(
    'raw', raw, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']
  );
}

/**
 * Create a signed session token.
 * @param {string} userId
 * @param {number} sv - session version
 * @param {number} sessionDays
 * @param {string} secret - HMAC signing secret
 * @returns {Promise<string>} token
 */
export async function makeSession(userId, sv, sessionDays, secret) {
  const exp = Date.now() + sessionDays * 86400 * 1000;
  const payload = `${userId}:${exp}:${sv}`;
  const key = await importKey(secret);
  const sig = await globalThis.crypto.subtle.sign('HMAC', key, enc.encode(payload));
  return b64uEncode(enc.encode(payload)) + '.' + b64uEncode(sig);
}

/**
 * Verify a session token.
 * @param {string} token
 * @param {string} secret
 * @returns {Promise<{userId:string, sv:number, exp:number}|null>}
 */
export async function verifySession(token, secret) {
  if (typeof token !== 'string') return null;
  const dot = token.lastIndexOf('.');
  if (dot < 1) return null;
  const payloadB64 = token.slice(0, dot);
  const macB64 = token.slice(dot + 1);
  let payload;
  try {
    payload = new TextDecoder().decode(b64uDecode(payloadB64));
  } catch { return null; }
  const parts = payload.split(':');
  if (parts.length < 3) return null;
  // uid may itself contain colons if someone uses a URL — take first and last two fields
  const sv = Number(parts[parts.length - 1]);
  const exp = Number(parts[parts.length - 2]);
  const userId = parts.slice(0, parts.length - 2).join(':');
  if (!userId || isNaN(exp) || isNaN(sv)) return null;
  if (Date.now() > exp) return null;
  const key = await importKey(secret);
  let mac;
  try { mac = b64uDecode(macB64); } catch { return null; }
  const valid = await globalThis.crypto.subtle.verify('HMAC', key, mac, enc.encode(payload));
  if (!valid) return null;
  return { userId, sv, exp };
}

const COOKIE_NAME = 'gymsid';
const SECURE_COOKIE_NAME = '__Host-gymsid';

/**
 * Returns Set-Cookie header strings for the session token.
 * @param {string} token
 * @param {number} sessionDays
 * @param {boolean} isSecure
 * @returns {string[]}
 */
export function sessionCookieHeader(token, sessionDays, isSecure) {
  const maxAge = sessionDays * 86400;
  const base = `=${token}; Path=/; Max-Age=${maxAge}; HttpOnly; SameSite=Strict`;
  if (isSecure) {
    return [`${SECURE_COOKIE_NAME}${base}; Secure`];
  }
  return [`${COOKIE_NAME}${base}`];
}

/**
 * Returns Set-Cookie headers that expire both cookie variants.
 * @param {boolean} isSecure
 * @returns {string[]}
 */
export function clearCookieHeaders(isSecure) {
  if (isSecure) {
    return [`${SECURE_COOKIE_NAME}=; Path=/; Max-Age=0; HttpOnly; SameSite=Strict; Secure`];
  }
  return [
    `${COOKIE_NAME}=; Path=/; Max-Age=0; HttpOnly; SameSite=Strict`,
    `${SECURE_COOKIE_NAME}=; Path=/; Max-Age=0; HttpOnly; SameSite=Strict; Secure`,
  ];
}
