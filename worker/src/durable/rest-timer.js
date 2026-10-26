// RestTimerDO — Durable Object for rest-timer push notifications.
// Stores alarm + push data in Durable Object storage so a Worker restart
// between "start" and "fire" does not lose the pending alert.
import { sendPush } from '../lib/push.js';

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
      await this.state.storage.setAlarm(Date.now() + sec * 1000);
      return Response.json({ ok: true });
    }

    if (pathname === '/cancel') {
      await this.state.storage.deleteAlarm();
      return Response.json({ ok: true });
    }

    return new Response('not found', { status: 404 });
  }

  async alarm() {
    // Read stored data first, then wipe — even if sending fails the storage is clean.
    const payloadStr    = await this.state.storage.get('payload');
    const vapidKeysJson = await this.state.storage.get('vapidKeysJson');
    const subJson       = await this.state.storage.get('subJson');
    await this.state.storage.deleteAll();

    if (!payloadStr || !vapidKeysJson || !subJson) return;

    let payload, vapidKeys, subs;
    try {
      payload   = JSON.parse(payloadStr);
      vapidKeys = JSON.parse(vapidKeysJson);
      subs      = JSON.parse(subJson);
    } catch {
      return; // malformed storage — nothing to send
    }

    if (!Array.isArray(subs) || !subs.length) return;

    const subject = this.env.VAPID_SUBJECT || 'mailto:admin@localhost';
    for (const sub of subs) {
      try {
        await sendPush(sub, payload, vapidKeys, subject);
      } catch (e) {
        // Dead subs (VapidError) will be pruned by the next sendPushToUser call
        // from a route — the DO has no D1 access to clean them here.
        console.error('rest-timer alarm push failed', e.message);
      }
    }
  }
}
