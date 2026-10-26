// Audit logging helpers for Cloudflare Workers.
// Uses ctx.waitUntil so audit writes never block the response.

import { insertAuditEvent, getAuditEvents } from '../db/queries.js';

/**
 * Extract the client IP from a Request, honouring the AUDIT_IP env var.
 * @param {Request} req
 * @param {string} auditIpMode - 'off' | 'net' | 'full'
 * @returns {string|null}
 */
export function clientIp(req, auditIpMode) {
  if (!auditIpMode || auditIpMode === 'off') return null;
  const ip =
    req.headers.get('CF-Connecting-IP') ||
    (req.headers.get('X-Forwarded-For') || '').split(',')[0].trim() ||
    req.headers.get('X-Real-IP') ||
    null;
  if (!ip) return null;
  if (auditIpMode === 'net') {
    // Return the /24 (IPv4) or /48 (IPv6) network prefix only
    if (ip.includes(':')) {
      // IPv6: keep first 3 groups
      const parts = ip.split(':');
      return parts.slice(0, 3).join(':') + '::/48';
    }
    const parts = ip.split('.');
    return parts.slice(0, 3).join('.') + '.0/24';
  }
  return ip;
}

/**
 * Write one audit event; uses ctx.waitUntil to avoid blocking the response.
 * @param {object} env - Worker env bindings
 * @param {ExecutionContext} ctx
 * @param {Request} req
 * @param {string} ev - event name e.g. 'auth.login.ok'
 * @param {object} fields - { ok?, uid?, name?, tgt?, tname?, msg?, act? }
 */
export function audit(env, ctx, req, ev, fields = {}) {
  if (!env.AUDIT_LOG || env.AUDIT_LOG === 'false') return;
  const row = {
    ts: Date.now(),
    ev,
    ok: fields.ok !== false ? 1 : 0,
    uid: fields.uid ?? null,
    name: fields.name ? String(fields.name).slice(0, 40) : null,
    tgt: fields.tgt ?? null,
    tname: fields.tname ? String(fields.tname).slice(0, 40) : null,
    msg: fields.msg ? String(fields.msg).slice(0, 120) : null,
    act: fields.act ?? null,
    ip: clientIp(req, env.AUDIT_IP),
  };
  ctx.waitUntil(insertAuditEvent(env.DB, row).catch(() => {}));
}

/**
 * Compact audit_events: delete rows beyond count cap or age cap.
 * @param {D1Database} db
 * @param {number} maxRows
 * @param {number} maxDays
 */
export async function auditKeep(db, maxRows, maxDays) {
  const cutoffTs = Date.now() - maxDays * 86400 * 1000;
  // Delete old events
  await db.prepare('DELETE FROM audit_events WHERE ts < ?').bind(cutoffTs).run();
  // Delete excess rows (keep newest maxRows)
  await db.prepare(
    `DELETE FROM audit_events WHERE id NOT IN (
       SELECT id FROM audit_events ORDER BY id DESC LIMIT ?
     )`
  ).bind(maxRows).run();
}
