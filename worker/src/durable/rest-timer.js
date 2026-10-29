// RestTimerDO — Durable Object for rest-timer push notifications.
// Stores alarm + push data in Durable Object storage so a Worker restart
// between "start" and "fire" does not lose the pending alert.
import { sendPush } from '../lib/push.js';

// Simple DO logger (no access to env in constructor context for LOG_LEVEL)
const doLog = {
  debug: (msg, data = {}) => console.log(JSON.stringify({ ts: new Date().toISOString(), level: 'debug', module: 'rest-timer-do', msg, ...data })),
  info: (msg, data = {}) => console.log(JSON.stringify({ ts: new Date().toISOString(), level: 'info', module: 'rest-timer-do', msg, ...data })),
  warn: (msg, data = {}) => console.warn(JSON.stringify({ ts: new Date().toISOString(), level: 'warn', module: 'rest-timer-do', msg, ...data })),
  error: (msg, data = {}) => console.error(JSON.stringify({ ts: new Date().toISOString(), level: 'error', module: 'rest-timer-do', msg, ...data })),
};

export class RestTimerDO {
  constructor(state, env) {
    this.state = state;
    this.env = env;
  }

  async fetch(request) {
    const { pathname } = new URL(request.url);

    if (pathname === '/schedule') {
      const body = await request.json();
      const { sec, payload, vapidKeysJson, subJson } = body;
      // Persist everything the alarm needs before setting it.
      await this.state.storage.put('payload', JSON.stringify(payload));
      await this.state.storage.put('vapidKeysJson', vapidKeysJson);
      await this.state.storage.put('subJson', subJson);
      // (Re-)schedule the alarm; any existing alarm is replaced.
      const alarmTime = Date.now() + sec * 1000;
      await this.state.storage.setAlarm(alarmTime);
      doLog.debug('alarm scheduled', { sec, alarmTime: new Date(alarmTime).toISOString() });
      return Response.json({ ok: true });
    }

    if (pathname === '/cancel') {
      await this.state.storage.deleteAlarm();
      doLog.debug('alarm cancelled');
      return Response.json({ ok: true });
    }

    return new Response('not found', { status: 404 });
  }

  async alarm() {
    doLog.debug('alarm fired');
    
    // Read stored data first, then wipe — even if sending fails the storage is clean.
    const payloadStr    = await this.state.storage.get('payload');
    const vapidKeysJson = await this.state.storage.get('vapidKeysJson');
    const subJson       = await this.state.storage.get('subJson');
    await this.state.storage.deleteAll();

    if (!payloadStr || !vapidKeysJson || !subJson) {
      doLog.warn('alarm fired but missing data');
      return;
    }

    let payload, vapidKeys, subs;
    try {
      payload   = JSON.parse(payloadStr);
      vapidKeys = JSON.parse(vapidKeysJson);
      subs      = JSON.parse(subJson);
    } catch {
      doLog.error('alarm fired but malformed storage');
      return; // malformed storage — nothing to send
    }

    if (!Array.isArray(subs) || !subs.length) {
      doLog.debug('alarm fired but no subscriptions');
      return;
    }

    const subject = this.env.VAPID_SUBJECT || 'mailto:admin@localhost';
    let sent = 0;
    let failed = 0;
    
    for (const sub of subs) {
      try {
        await sendPush(sub, payload, vapidKeys, subject);
        sent++;
      } catch (e) {
        // Dead subs (VapidError) will be pruned by the next sendPushToUser call
        // from a route — the DO has no D1 access to clean them here.
        doLog.warn('alarm push failed', { error: e.message, endpoint: sub.endpoint?.slice(0, 50) });
        failed++;
      }
    }
    
    doLog.info('alarm completed', { sent, failed, total: subs.length });
  }
}
