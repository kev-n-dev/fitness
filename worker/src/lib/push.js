/* Manual Web Push / VAPID via Web Crypto only. No npm web-push package.
 *
 * Implements RFC 8291 (Message Encryption for Web Push) and RFC 8292 (VAPID).
 * Uses only globalThis.crypto.subtle — compatible with Cloudflare Workers. */

// ── Base64url helpers ─────────────────────────────────────────────────────────

export function uint8ArrayToBase64url(buf) {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function base64urlToUint8Array(str) {
  const s = str.replace(/-/g, '+').replace(/_/g, '/');
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4));
  const bin = atob(s + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

const enc = new TextEncoder();

function concat(...arrays) {
  const total = arrays.reduce((n, a) => n + a.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const a of arrays) { out.set(a, off); off += a.length; }
  return out;
}

// ── VAPID key generation ──────────────────────────────────────────────────────

/**
 * Generate a VAPID key pair.
 * @returns {Promise<{ publicKey: string, privateKey: string }>} base64url-encoded keys
 */
export async function generateVAPIDKeys() {
  const keyPair = await globalThis.crypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' },
    true,
    ['sign', 'verify']
  );
  // Export public key as uncompressed point (65 bytes, 0x04 prefix)
  const pubRaw = await globalThis.crypto.subtle.exportKey('raw', keyPair.publicKey);
  // Export private key as raw scalar (32 bytes)
  const privJwk = await globalThis.crypto.subtle.exportKey('jwk', keyPair.privateKey);
  const privBytes = base64urlToUint8Array(privJwk.d);
  return {
    publicKey: uint8ArrayToBase64url(new Uint8Array(pubRaw)),
    privateKey: uint8ArrayToBase64url(privBytes),
  };
}

// ── VAPID JWT signing ─────────────────────────────────────────────────────────

async function signVapidJwt(endpoint, vapidKeys, subject) {
  const url = new URL(endpoint);
  const audience = `${url.protocol}//${url.host}`;
  const exp = Math.floor(Date.now() / 1000) + 12 * 3600; // 12 h
  const header = uint8ArrayToBase64url(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const payload = uint8ArrayToBase64url(enc.encode(JSON.stringify({ aud: audience, exp, sub: subject })));
  const sigInput = enc.encode(`${header}.${payload}`);

  // Import private key from raw scalar bytes
  const privBytes = base64urlToUint8Array(vapidKeys.privateKey);
  const pubBytes = base64urlToUint8Array(vapidKeys.publicKey);

  // Build JWK for the private key
  const pubJwk = {
    kty: 'EC', crv: 'P-256',
    x: uint8ArrayToBase64url(pubBytes.slice(1, 33)),
    y: uint8ArrayToBase64url(pubBytes.slice(33, 65)),
    d: uint8ArrayToBase64url(privBytes),
    key_ops: ['sign'],
    ext: true,
  };
  const signingKey = await globalThis.crypto.subtle.importKey(
    'jwk', pubJwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']
  );
  const sigDer = await globalThis.crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' }, signingKey, sigInput
  );
  const sigB64 = uint8ArrayToBase64url(new Uint8Array(sigDer));
  return `${header}.${payload}.${sigB64}`;
}

// ── RFC 8291 payload encryption ───────────────────────────────────────────────

async function encryptPayload(plaintext, p256dh, auth) {
  // Decode subscription keys
  const receiverPublicKeyBytes = base64urlToUint8Array(p256dh);
  const authSecret = base64urlToUint8Array(auth);

  // Generate sender (ephemeral) ECDH key pair
  const senderKeyPair = await globalThis.crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']
  );
  const senderPublicKeyRaw = await globalThis.crypto.subtle.exportKey('raw', senderKeyPair.publicKey);

  // Import receiver public key
  const receiverPublicKey = await globalThis.crypto.subtle.importKey(
    'raw', receiverPublicKeyBytes, { name: 'ECDH', namedCurve: 'P-256' }, false, []
  );

  // ECDH: derive shared secret (32 bytes)
  const sharedSecretBits = await globalThis.crypto.subtle.deriveBits(
    { name: 'ECDH', public: receiverPublicKey }, senderKeyPair.privateKey, 256
  );
  const sharedSecret = new Uint8Array(sharedSecretBits);

  // Generate salt (16 random bytes)
  const salt = new Uint8Array(16);
  globalThis.crypto.getRandomValues(salt);

  const senderPublicKeyBytes = new Uint8Array(senderPublicKeyRaw);

  // HKDF-SHA-256 key derivation (RFC 8291 Section 3.4)
  // PRK = HKDF-Extract(auth_secret, ecdh_secret)
  const hkdfPrkKey = await globalThis.crypto.subtle.importKey(
    'raw', authSecret, 'HKDF', false, ['deriveBits']
  );

  // ikm info: "WebPush: info\x00" || receiver_public || sender_public
  const ikmInfo = concat(
    enc.encode('WebPush: info\x00'),
    receiverPublicKeyBytes,
    senderPublicKeyBytes
  );
  const ikmBits = await globalThis.crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt: sharedSecret, info: ikmInfo },
    hkdfPrkKey, 256
  );
  const ikm = new Uint8Array(ikmBits);

  // Derive CEK and nonce from salt + ikm
  const ikmKey = await globalThis.crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);

  // CEK: 16 bytes
  const cekInfo = enc.encode('Content-Encoding: aes128gcm\x00');
  const cekBits = await globalThis.crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt, info: cekInfo }, ikmKey, 128
  );
  const cek = new Uint8Array(cekBits);

  // Nonce: 12 bytes
  const nonceInfo = enc.encode('Content-Encoding: nonce\x00');
  const nonceBits = await globalThis.crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt, info: nonceInfo }, ikmKey, 96
  );
  const nonce = new Uint8Array(nonceBits);

  // AES-128-GCM encrypt
  // RFC 8291: pad plaintext to record size with \x02 delimiter
  const rs = 4096;
  const plaintextBytes = enc.encode(JSON.stringify(plaintext));
  // padding delimiter + \x00 padding to rs-17 bytes
  const padLen = rs - 16 - 1 - plaintextBytes.length - 5; // 5 = salt(0) + rs(0) + keyid_len(0)
  const paddedLen = plaintextBytes.length + 1 + Math.max(0, padLen);
  const padded = new Uint8Array(paddedLen);
  padded.set(plaintextBytes);
  padded[plaintextBytes.length] = 0x02; // RFC 8291 delimiter

  const aesKey = await globalThis.crypto.subtle.importKey(
    'raw', cek, { name: 'AES-GCM' }, false, ['encrypt']
  );
  const ciphertext = await globalThis.crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: nonce }, aesKey, padded
  );

  // RFC 8291 Section 2: header || ciphertext
  // header: salt(16) || rs(4, big-endian) || keyid_len(1) || keyid(65)
  const header = new Uint8Array(16 + 4 + 1 + senderPublicKeyBytes.length);
  header.set(salt, 0);
  const view = new DataView(header.buffer);
  view.setUint32(16, rs, false);
  header[20] = senderPublicKeyBytes.length;
  header.set(senderPublicKeyBytes, 21);

  const body = concat(header, new Uint8Array(ciphertext));
  return { body, senderPublicKeyBytes };
}

// ── VapidError ────────────────────────────────────────────────────────────────

export class VapidError extends Error {
  constructor(code, message) {
    super(message || code);
    this.code = code;
  }
}

// ── sendPush ──────────────────────────────────────────────────────────────────

/**
 * Send a Web Push notification.
 * @param {{ endpoint: string, p256dh: string, auth: string }} subscription
 * @param {object} payloadObj - JSON-serializable payload
 * @param {{ publicKey: string, privateKey: string }} vapidKeys
 * @param {string} subject - mailto: or https: VAPID contact
 * @throws {VapidError} on dead subscription (404/410/403)
 */
export async function sendPush(subscription, payloadObj, vapidKeys, subject) {
  const { endpoint, p256dh, auth } = subscription;

  const jwt = await signVapidJwt(endpoint, vapidKeys, subject);
  const { body } = await encryptPayload(payloadObj, p256dh, auth);

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Authorization': `vapid t=${jwt},k=${vapidKeys.publicKey}`,
      'Content-Type': 'application/octet-stream',
      'Content-Encoding': 'aes128gcm',
      'TTL': '86400',
    },
    body,
  });

  if (response.status === 404 || response.status === 410 || response.status === 403) {
    throw new VapidError('dead', `Push endpoint responded ${response.status}`);
  }
  if (!response.ok) {
    throw new Error(`Push failed: ${response.status} ${await response.text().catch(() => '')}`);
  }
  return response;
}
