/* M7: the origin guard must accept IPv6-loopback hosts and install once. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createOriginGuard, installOriginGuard } from '../../server/middleware/origin-guard.js';

function run(headers) {
  const guard = createOriginGuard();
  const req = { headers };
  let nexted = false;
  const res = {
    statusCode: 200,
    headers: {},
    setHeader(k, v) { this.headers[k] = v; },
    end(body) { this.body = body; }
  };
  guard(req, res, () => { nexted = true; });
  return { nexted, status: res.statusCode, body: res.body };
}

test('a bracketed IPv6 loopback Host header is accepted, not 403', () => {
  assert.equal(run({ host: '[::1]:5173' }).nexted, true);
  assert.equal(run({ host: '[::1]' }).nexted, true);
  assert.equal(run({ host: '[0:0:0:0:0:0:0:1]:5173' }).nexted, false, 'a non-::1 v6 host is still refused');
});

test('IPv4 and localhost hosts keep working', () => {
  assert.equal(run({ host: '127.0.0.1:5173' }).nexted, true);
  assert.equal(run({ host: 'localhost:5173' }).nexted, true);
  assert.equal(run({ host: 'evil.example.com' }).nexted, false);
});

test('a cross-site Origin is still rejected', () => {
  const res = run({ host: '127.0.0.1:5173', origin: 'https://evil.example.com' });
  assert.equal(res.nexted, false);
  assert.equal(res.status, 403);
});

test('an IPv6 loopback Origin is accepted', () => {
  assert.equal(run({ host: '[::1]:5173', origin: 'http://[::1]:5173' }).nexted, true);
});

test('the guard installs at most once per server', () => {
  const used = [];
  const server = { middlewares: { use: (fn) => used.push(fn) } };

  installOriginGuard(server);
  installOriginGuard(server);
  installOriginGuard(server);

  assert.equal(used.length, 1, 'both plugins share one middleware stack (M7)');
  assert.equal(typeof used[0], 'function');
});
