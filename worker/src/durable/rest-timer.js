// RestTimerDO — Durable Object stub for rest-timer push notifications.
// Full implementation comes in a later FEAT.

export class RestTimerDO {
  constructor(state, env) {
    this.state = state;
    this.env = env;
  }

  async fetch(req) {
    return Response.json({ ok: true });
  }

  async alarm() {}
}
