// Friend system: requests, friendships, invites, and user search.
import { Hono } from 'hono';
import { getSession } from './auth.js';
import { createLogger } from '../lib/logger.js';
import {
  getUserById,
  getFriendship, createFriendship, deleteFriendship, getFriendsByUser,
  createFriendRequest, getFriendRequestById, getPendingFriendRequests,
  updateFriendRequest, getExistingFriendRequest,
  createFriendInviteCode, getFriendInviteCode, useFriendInviteCode,
  searchUsersByName,
  createNotification, isNotificationTypeEnabled,
} from '../db/queries.js';

const log = createLogger('friends');

// Generate a random id (base64url)
function genId(n = 12) {
  const b = new Uint8Array(n);
  crypto.getRandomValues(b);
  let bin = '';
  for (const byte of b) bin += String.fromCharCode(byte);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

const app = new Hono();

// ── GET /api/friends — list all friends ───────────────────────────────────────

app.get('/api/friends', async (c) => {
  const session = await getSession(c);
  if (!session) return c.json({ error: 'not signed in' }, 401);

  const friends = await getFriendsByUser(c.env.DB, session.user.id);
  return c.json({ friends });
});

// ── DELETE /api/friends/:friendId — remove a friend ───────────────────────────

app.delete('/api/friends/:friendId', async (c) => {
  const session = await getSession(c);
  if (!session) return c.json({ error: 'not signed in' }, 401);

  const friendId = c.req.param('friendId');
  const friendship = await getFriendship(c.env.DB, session.user.id, friendId);
  if (!friendship) {
    return c.json({ error: 'friendship not found' }, 404);
  }

  await deleteFriendship(c.env.DB, session.user.id, friendId);
  log.info(c.env, 'friend removed', { userId: session.user.id, friendId });
  return c.json({ ok: true });
});

// ── GET /api/friends/requests — list pending friend requests ──────────────────

app.get('/api/friends/requests', async (c) => {
  const session = await getSession(c);
  if (!session) return c.json({ error: 'not signed in' }, 401);

  const requests = await getPendingFriendRequests(c.env.DB, session.user.id);
  
  // Separate into incoming and outgoing
  const incoming = requests
    .filter(r => r.to_user_id === session.user.id)
    .map(r => ({
      id: r.id,
      from: { id: r.sender_id, name: r.sender_name },
      created: r.created,
    }));
  
  const outgoing = requests
    .filter(r => r.from_user_id === session.user.id)
    .map(r => ({
      id: r.id,
      to: { id: r.receiver_id, name: r.receiver_name },
      created: r.created,
    }));

  return c.json({ incoming, outgoing });
});

// ── POST /api/friends/request — send a friend request ─────────────────────────

app.post('/api/friends/request', async (c) => {
  const session = await getSession(c);
  if (!session) return c.json({ error: 'not signed in' }, 401);

  const body = await c.req.json().catch(() => ({}));
  const toUserId = body.toUserId;

  if (!toUserId) {
    return c.json({ error: 'toUserId required' }, 400);
  }

  if (toUserId === session.user.id) {
    return c.json({ error: 'cannot send friend request to yourself' }, 400);
  }

  // Check if target user exists
  const targetUser = await getUserById(c.env.DB, toUserId);
  if (!targetUser) {
    return c.json({ error: 'user not found' }, 404);
  }

  // Check if already friends
  const existingFriendship = await getFriendship(c.env.DB, session.user.id, toUserId);
  if (existingFriendship) {
    return c.json({ error: 'already friends' }, 409);
  }

  // Check if there's already a pending request
  const existingRequest = await getExistingFriendRequest(c.env.DB, session.user.id, toUserId);
  if (existingRequest) {
    return c.json({ error: 'friend request already exists' }, 409);
  }

  const now = new Date().toISOString();
  const request = {
    id: genId(),
    from_user_id: session.user.id,
    to_user_id: toUserId,
    status: 'pending',
    created: now,
    updated: now,
  };

  await createFriendRequest(c.env.DB, request);
  log.info(c.env, 'friend request sent', { from: session.user.id, to: toUserId });

  // Create notification for the recipient
  const enabled = await isNotificationTypeEnabled(c.env.DB, toUserId, 'friend_request');
  if (enabled) {
    await createNotification(c.env.DB, {
      user_id: toUserId,
      type: 'friend_request',
      title: 'Friend Request',
      body: `${session.user.name} sent you a friend request`,
      data: JSON.stringify({ requestId: request.id, fromUserId: session.user.id, fromUserName: session.user.name }),
      created: now,
    });
  }

  return c.json({ 
    id: request.id,
    to: { id: targetUser.id, name: targetUser.name },
    created: now,
  });
});

// ── POST /api/friends/request/:id/accept — accept a friend request ────────────

app.post('/api/friends/request/:id/accept', async (c) => {
  const session = await getSession(c);
  if (!session) return c.json({ error: 'not signed in' }, 401);

  const requestId = c.req.param('id');
  const request = await getFriendRequestById(c.env.DB, requestId);

  if (!request) {
    return c.json({ error: 'request not found' }, 404);
  }

  if (request.to_user_id !== session.user.id) {
    return c.json({ error: 'not authorized to accept this request' }, 403);
  }

  if (request.status !== 'pending') {
    return c.json({ error: 'request is no longer pending' }, 400);
  }

  const now = new Date().toISOString();

  // Update request status
  await updateFriendRequest(c.env.DB, requestId, { status: 'accepted', updated: now });

  // Create the friendship
  await createFriendship(c.env.DB, session.user.id, request.from_user_id, now);

  log.info(c.env, 'friend request accepted', { userId: session.user.id, from: request.from_user_id });

  // Notify the requester that their request was accepted
  const enabled = await isNotificationTypeEnabled(c.env.DB, request.from_user_id, 'friend_accepted');
  if (enabled) {
    await createNotification(c.env.DB, {
      user_id: request.from_user_id,
      type: 'friend_accepted',
      title: 'Friend Request Accepted',
      body: `${session.user.name} accepted your friend request`,
      data: JSON.stringify({ userId: session.user.id, userName: session.user.name }),
      created: now,
    });
  }

  return c.json({ ok: true });
});

// ── POST /api/friends/request/:id/decline — decline a friend request ──────────

app.post('/api/friends/request/:id/decline', async (c) => {
  const session = await getSession(c);
  if (!session) return c.json({ error: 'not signed in' }, 401);

  const requestId = c.req.param('id');
  const request = await getFriendRequestById(c.env.DB, requestId);

  if (!request) {
    return c.json({ error: 'request not found' }, 404);
  }

  if (request.to_user_id !== session.user.id) {
    return c.json({ error: 'not authorized to decline this request' }, 403);
  }

  if (request.status !== 'pending') {
    return c.json({ error: 'request is no longer pending' }, 400);
  }

  const now = new Date().toISOString();
  await updateFriendRequest(c.env.DB, requestId, { status: 'declined', updated: now });

  log.info(c.env, 'friend request declined', { userId: session.user.id, from: request.from_user_id });

  return c.json({ ok: true });
});

// ── DELETE /api/friends/request/:id — cancel an outgoing request ──────────────

app.delete('/api/friends/request/:id', async (c) => {
  const session = await getSession(c);
  if (!session) return c.json({ error: 'not signed in' }, 401);

  const requestId = c.req.param('id');
  const request = await getFriendRequestById(c.env.DB, requestId);

  if (!request) {
    return c.json({ error: 'request not found' }, 404);
  }

  if (request.from_user_id !== session.user.id) {
    return c.json({ error: 'not authorized to cancel this request' }, 403);
  }

  if (request.status !== 'pending') {
    return c.json({ error: 'request is no longer pending' }, 400);
  }

  const now = new Date().toISOString();
  await updateFriendRequest(c.env.DB, requestId, { status: 'cancelled', updated: now });

  log.info(c.env, 'friend request cancelled', { userId: session.user.id, to: request.to_user_id });

  return c.json({ ok: true });
});

// ── GET /api/users/search — search users by name ──────────────────────────────

app.get('/api/users/search', async (c) => {
  const session = await getSession(c);
  if (!session) return c.json({ error: 'not signed in' }, 401);

  const query = c.req.query('q') || '';
  if (query.length < 2) {
    return c.json({ error: 'query must be at least 2 characters' }, 400);
  }

  const users = await searchUsersByName(c.env.DB, query, 20);
  
  // Filter out the current user from results
  const filtered = users
    .filter(u => u.id !== session.user.id)
    .map(u => ({ id: u.id, name: u.name }));

  return c.json({ users: filtered });
});

// ── POST /api/friends/invite — generate an invite code ────────────────────────

app.post('/api/friends/invite', async (c) => {
  const session = await getSession(c);
  if (!session) return c.json({ error: 'not signed in' }, 401);

  const now = new Date();
  const expires = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000); // 7 days

  const invite = {
    code: genId(16),
    user_id: session.user.id,
    created: now.toISOString(),
    expires: expires.toISOString(),
  };

  await createFriendInviteCode(c.env.DB, invite);
  log.info(c.env, 'friend invite created', { userId: session.user.id, code: invite.code.slice(0, 8) + '...' });

  return c.json({ 
    code: invite.code,
    expires: invite.expires,
  });
});

// ── POST /api/friends/invite/redeem — use an invite code ──────────────────────

app.post('/api/friends/invite/redeem', async (c) => {
  const session = await getSession(c);
  if (!session) return c.json({ error: 'not signed in' }, 401);

  const body = await c.req.json().catch(() => ({}));
  const code = body.code;

  if (!code) {
    return c.json({ error: 'code required' }, 400);
  }

  const invite = await getFriendInviteCode(c.env.DB, code);

  if (!invite) {
    return c.json({ error: 'invite code not found' }, 404);
  }

  if (invite.used_by) {
    return c.json({ error: 'invite code already used' }, 400);
  }

  if (new Date(invite.expires) < new Date()) {
    return c.json({ error: 'invite code expired' }, 400);
  }

  if (invite.user_id === session.user.id) {
    return c.json({ error: 'cannot use your own invite code' }, 400);
  }

  // Check if already friends
  const existingFriendship = await getFriendship(c.env.DB, session.user.id, invite.user_id);
  if (existingFriendship) {
    return c.json({ error: 'already friends with this user' }, 409);
  }

  const now = new Date().toISOString();

  // Mark invite as used
  await useFriendInviteCode(c.env.DB, code, session.user.id, now);

  // Create the friendship directly (no request needed for invite codes)
  await createFriendship(c.env.DB, session.user.id, invite.user_id, now);

  // Get the friend's info
  const friend = await getUserById(c.env.DB, invite.user_id);

  log.info(c.env, 'friend invite redeemed', { userId: session.user.id, invitedBy: invite.user_id });

  return c.json({ 
    ok: true,
    friend: { id: friend.id, name: friend.name },
  });
});

export default app;
