/* One-time device links — adapted from api/device-link.js.
 * Uses Web Crypto only (crypto.subtle.digest + crypto.getRandomValues). No Node.js crypto.
 *
 * The D1 operations (create/delete rows) are done via queries.js in route handlers;
 * this module provides the pure-logic helpers: code generation, hashing, and constant-time
 * comparison. */

export const LINK_TTL_MS = 10 * 60 * 1000;   // 10 minutes
export const LINK_BYTES = 12;                  // = LENGTH chars from alphabet

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const LENGTH = 12;

function hexEncode(buf) {
  return Array.from(new Uint8Array(buf), b => b.toString(16).padStart(2, '0')).join('');
}

/** Generate a random one-time code formatted as XXXX-XXXX-XXXX. */
export function makeLinkCode() {
  const bytes = new Uint8Array(LENGTH);
  globalThis.crypto.getRandomValues(bytes);
  // 256 is a multiple of 32, so the modulo is unbiased.
  const raw = Array.from(bytes, b => ALPHABET[b % ALPHABET.length]).join('');
  return raw.slice(0, 4) + '-' + raw.slice(4, 8) + '-' + raw.slice(8);
}

const clean = code => (typeof code === 'string' ? code : '').toUpperCase().replace(/[^A-Z0-9]/g, '');

/** SHA-256 hex of the canonical code (dashes/case stripped, prefixed). */
export async function hashLinkCode(code) {
  const enc = new TextEncoder();
  const data = enc.encode('opengym-link:' + clean(code));
  const hash = await globalThis.crypto.subtle.digest('SHA-256', data);
  return hexEncode(hash);
}

/**
 * Constant-time compare of two hex strings (manual XOR; Workers lacks timingSafeEqual).
 * Returns true only when both strings are identical.
 */
export function timingSafeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
