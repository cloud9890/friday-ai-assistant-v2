/* Phase 1 (R2/S2): every capability call needs a local session.
   These tests drive the real installed guard, not a re-implementation. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAuth, isSameOriginBrowser, SESSION_COOKIE } from '../../server/middleware/authentication.js';

const ORIGIN = 'http://localhost:5173';
const HOST = 'localhost:5173';

/** Minimal response double that records what the guard wrote. */
function makeRes() {
  return {
    statusCode: 200,
    headers: {},
    body: '',
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
    end(b) { this.body = b || ''; }
  };
}

/** Installs the guard exactly as the plugin does and returns it. */
function guard(ttlMs) {
  const auth = createAuth(ttlMs ? { ttlMs } : {});
  const stack = [];
  auth.install({ use: (fn) => stack.push(fn) });
  return { auth, guard: stack[0] };
}

function call(guardFn, overrides = {}) {
  const req = {
    method: 'POST',
    url: '/api/open-app',
    headers: { host: HOST, origin: ORIGIN, ...(overrides.headers || {}) }
  };
  const res = makeRes();
  let nexted = false;
  guardFn(req, res, () => { nexted = true; });
  return { res, nexted };
}

const tokenFrom = (res) => String(res.headers['set-cookie']).match(/=([^;]+)/)[1];

test('an unauthenticated capability request is refused with 401', () => {
  const { guard: g } = guard();
  const { res, nexted } = call(g);
  assert.equal(nexted, false, 'the route must never be reached without a session');
  assert.equal(res.statusCode, 401);
  assert.match(res.body, /UNAUTHORIZED/);
});

test('a request with no Origin and no cookie is refused', () => {
  const { guard: g } = guard();
  const { res, nexted } = call(g, { headers: { origin: undefined } });
  assert.equal(nexted, false);
  assert.equal(res.statusCode, 401);
});

test('static UI assets and HMR are never gated', () => {
  const { guard: g } = guard();
  for (const url of ['/', '/app.js', '/style.css', '/@vite/client', '/js/tools/tool-handlers.js']) {
    const req = { method: 'GET', url, headers: { host: HOST, origin: ORIGIN } };
    const res = makeRes();
    let nexted = false;
    g(req, res, () => { nexted = true; });
    assert.equal(nexted, true, `${url} must pass through`);
  }
});

test('liveness and bootstrap stay reachable without a session', () => {
  const { auth, guard: g } = guard();
  assert.deepEqual(auth.publicPaths.sort(), ['/api/auth/session', '/api/health']);
  const req = { method: 'GET', url: '/api/health', headers: { host: HOST, origin: ORIGIN } };
  const res = makeRes();
  let nexted = false;
  g(req, res, () => { nexted = true; });
  assert.equal(nexted, true);
});

test('a session cookie is issued HttpOnly, SameSite=Strict and not readable by JS', () => {
  const { auth } = guard();
  const res = makeRes();
  auth.issueCookie(res);
  const cookie = res.headers['set-cookie'];
  assert.match(cookie, new RegExp(`^${SESSION_COOKIE}=`));
  assert.match(cookie, /HttpOnly/i);
  assert.match(cookie, /SameSite=Strict/i);
  assert.match(cookie, /Path=\//);
  assert.equal(res.headers['cache-control'], 'no-store');
  assert.ok(!/document\.cookie/i.test(cookie));
});

test('a forged or unknown token is refused', () => {
  const { guard: g } = guard();
  for (const token of ['deadbeef', '', 'a'.repeat(64), 'null', 'undefined']) {
    const { res, nexted } = call(g, { headers: { cookie: `${SESSION_COOKIE}=${token}` } });
    assert.equal(nexted, false, `token ${token} must be refused`);
    assert.equal(res.statusCode, 401);
  }
});

test('a valid session is accepted, and only from the local origin', () => {
  const { auth, guard: g } = guard();
  const issued = makeRes();
  auth.issueCookie(issued);
  const token = tokenFrom(issued);

  const ok = call(g, { headers: { cookie: `${SESSION_COOKIE}=${token}` } });
  assert.equal(ok.nexted, true, 'a valid same-origin session must reach the route');

  const crossOrigin = call(g, { headers: { cookie: `${SESSION_COOKIE}=${token}`, origin: 'https://evil.example' } });
  assert.equal(crossOrigin.nexted, false);
  assert.equal(crossOrigin.res.statusCode, 403);
  assert.match(crossOrigin.res.body, /CROSS_ORIGIN_BLOCKED/);
});

test('a browser page marked cross-site is refused even without an Origin header', () => {
  const { auth, guard: g } = guard();
  const issued = makeRes();
  auth.issueCookie(issued);
  const token = tokenFrom(issued);
  const { res, nexted } = call(g, {
    headers: { cookie: `${SESSION_COOKIE}=${token}`, origin: undefined, 'sec-fetch-site': 'cross-site' }
  });
  assert.equal(nexted, false);
  assert.equal(res.statusCode, 403);
});

test('an expired session is refused', async () => {
  const { auth, guard: g } = guard(5);
  const issued = makeRes();
  auth.issueCookie(issued);
  const token = tokenFrom(issued);
  await new Promise((r) => setTimeout(r, 20));
  const { res, nexted } = call(g, { headers: { cookie: `${SESSION_COOKIE}=${token}` } });
  assert.equal(nexted, false);
  assert.equal(res.statusCode, 401);
});

test('tokens are unguessable and unique per session', () => {
  const a = createAuth();
  const b = createAuth();
  const r1 = makeRes(); a.issueCookie(r1);
  const r2 = makeRes(); b.issueCookie(r2);
  const t1 = tokenFrom(r1);
  const t2 = tokenFrom(r2);
  assert.notEqual(t1, t2);
  assert.match(t1, /^[0-9a-f]{64}$/);
});

test('isSameOriginBrowser only honours the local UI origin', () => {
  assert.equal(isSameOriginBrowser({ headers: { host: HOST, origin: ORIGIN } }), true);
  assert.equal(isSameOriginBrowser({ headers: { host: HOST, origin: 'http://127.0.0.1:5173' } }), false);
  assert.equal(isSameOriginBrowser({ headers: { host: HOST, origin: 'https://evil.example' } }), false);
  assert.equal(isSameOriginBrowser({ headers: { host: HOST, origin: 'file://' } }), false);
  assert.equal(isSameOriginBrowser({ headers: { host: HOST, origin: 'null' } }), false);
  assert.equal(isSameOriginBrowser({ headers: { host: HOST } }), true);
  assert.equal(isSameOriginBrowser({ headers: { host: HOST, 'sec-fetch-site': 'cross-site' } }), false);
});

test('no wildcard CORS header is ever emitted', () => {
  const { auth, guard: g } = guard();
  const issued = makeRes();
  auth.issueCookie(issued);
  assert.notEqual(issued.headers['access-control-allow-origin'], '*');
  const { res } = call(g);
  assert.notEqual(res.headers['access-control-allow-origin'], '*');
  const { res: res2 } = call(g, { headers: { origin: 'https://evil.example' } });
  assert.notEqual(res2.headers['access-control-allow-origin'], '*');
});
