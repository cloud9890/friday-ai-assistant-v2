/* ==========================================================================
   F.R.I.D.A.Y. // TESTS — LOCAL API AUTH WIRING (C3)
   Drives the real installed middleware (server/middleware/api-auth.js), not a
   re-implementation: the SPA load issues the cookie, /api/auth/session is the
   explicit bootstrap, /api/health stays public, and every other /api/* route
   is refused without a valid session cookie.
   ========================================================================== */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { installApiAuth, handleSession, SESSION_PATH, SESSION_COOKIE, auth } from '../../server/middleware/api-auth.js';

const HOST = 'localhost:5173';
const SAME_ORIGIN = 'http://localhost:5173';

function makeRes() {
  return {
    statusCode: 200,
    headers: {},
    body: '',
    ended: false,
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
    end(b) { this.body = b || ''; this.ended = true; }
  };
}

/** Collects the connect handlers installApiAuth installs, in order. */
function makeServer() {
  const stack = [];
  return { middlewares: { use: (fn) => stack.push(fn) }, stack };
}

/** Runs a request through the stack until a handler ends the response. */
async function drive(stack, req) {
  const res = makeRes();
  for (const fn of stack) {
    let advanced = false;
    await fn(req, res, () => { advanced = true; });
    if (res.ended || !advanced) return res;
  }
  return res;
}

const reqFor = (url, extra = {}) => ({
  url, method: 'GET', headers: { host: HOST, origin: SAME_ORIGIN, ...extra }
});

function cookieFrom(res) {
  const raw = res.headers['set-cookie'] || '';
  return raw.split(';')[0];
}

test('handleSession rejects a cross-origin bootstrap', () => {
  const res = makeRes();
  handleSession(reqFor(SESSION_PATH, { origin: 'http://evil.example' }), res);
  assert.equal(res.statusCode, 403);
  assert.equal(JSON.parse(res.body).code, 'CROSS_ORIGIN_BLOCKED');
  assert.equal(res.headers['set-cookie'], undefined);
});

test('installApiAuth: the same-origin app load issues an HttpOnly session cookie', async () => {
  const server = makeServer();
  installApiAuth(server);
  const res = await drive(server.stack, reqFor('/'));
  assert.ok(res.headers['set-cookie'], 'SPA load must set a cookie');
  assert.match(res.headers['set-cookie'], new RegExp(`^${SESSION_COOKIE}=[0-9a-f]{64};`));
  assert.match(res.headers['set-cookie'], /HttpOnly/);
  assert.match(res.headers['set-cookie'], /SameSite=Strict/);
});

test('installApiAuth: /api/health is public, other /api/* needs a session', async () => {
  const server = makeServer();
  installApiAuth(server);

  const health = await drive(server.stack, reqFor('/api/health'));
  assert.equal(health.ended, false, '/api/health must fall through (public)');

  const guarded = await drive(server.stack, reqFor('/api/agent', { method: 'POST' }));
  assert.equal(guarded.statusCode, 401);
  assert.equal(JSON.parse(guarded.body).code, 'UNAUTHORIZED');
});

test('installApiAuth: a valid session cookie passes the gate', async () => {
  const server = makeServer();
  installApiAuth(server);

  // Bootstrap like the browser does (same-origin app load), then reuse it.
  const boot = await drive(server.stack, reqFor('/'));
  const cookie = cookieFrom(boot);
  assert.ok(cookie);

  const ok = await drive(server.stack, reqFor('/api/agent', { method: 'POST', cookie }));
  assert.equal(ok.ended, false, 'a valid session must reach the route');

  // A wrong cookie is still refused.
  const bad = await drive(server.stack, reqFor('/api/agent', { method: 'POST', cookie: `${SESSION_COOKIE}=deadbeef` }));
  assert.equal(bad.statusCode, 401);
});

test('installApiAuth is idempotent across both plugins', () => {
  const server = makeServer();
  installApiAuth(server);
  const afterFirst = server.stack.length;
  installApiAuth(server);
  assert.equal(server.stack.length, afterFirst, 'second install must be a no-op');
});

test('the shared authority exposes the documented bootstrap path', () => {
  assert.equal(SESSION_PATH, '/api/auth/session');
  assert.equal(auth.isSameOriginBrowser(reqFor('/api/agent')), true);
});
