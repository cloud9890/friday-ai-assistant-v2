/* H1: a redirect must never land on a destination the policy never approved. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { safeFetch, MAX_REDIRECTS } from '../../server/lib/safe-fetch.js';

const redirectTo = (status, location) => async () => ({
  status,
  headers: new Headers({ location }),
  text: async () => ''
});

const ok = (body = 'ok') => async () => ({
  status: 200,
  headers: new Headers(),
  text: async () => body
});

test('a public URL is fetched directly and its body is returned', async () => {
  const res = await safeFetch('https://example.com/page', { fetchImpl: ok('hello') });
  assert.equal(res.status, 200);
  assert.equal(await res.text(), 'hello');
});

test('an unsafe first hop is refused without ever being fetched', async () => {
  let called = false;
  const fetchImpl = async () => { called = true; return { status: 200, headers: new Headers() }; };

  await assert.rejects(
    () => safeFetch('http://127.0.0.1/admin', { fetchImpl }),
    (e) => e.code === 'UNSAFE_URL' && /local\/private/.test(e.message)
  );
  assert.equal(called, false, 'the request must never leave the process');
});

test('a redirect to a private destination is blocked (the H1 bypass)', async () => {
  const seen = [];
  const fetchImpl = async (url) => {
    seen.push(url);
    return { status: 302, headers: new Headers({ location: 'http://169.254.169.254/latest/meta-data/' }), text: async () => '' };
  };

  await assert.rejects(
    () => safeFetch('https://example.com/r', { fetchImpl }),
    (e) => e.code === 'UNSAFE_URL'
  );
  assert.equal(seen.length, 1, 'the private hop must not be requested');
});

test('a public redirect chain is followed and re-validated each hop', async () => {
  const seen = [];
  let n = 0;
  const fetchImpl = async (url) => {
    seen.push(url);
    n += 1;
    if (n === 1) return { status: 301, headers: new Headers({ location: '/step-2' }), text: async () => '' };
    if (n === 2) return { status: 302, headers: new Headers({ location: 'https://other.example.org/final' }), text: async () => '' };
    return { status: 200, headers: new Headers(), text: async () => 'done' };
  };

  const res = await safeFetch('https://example.com/start', { fetchImpl });
  assert.equal(await res.text(), 'done');
  assert.deepEqual(seen, [
    'https://example.com/start',
    'https://example.com/step-2',
    'https://other.example.org/final'
  ]);
});

test('the policy is consulted for every hop, not just the first', async () => {
  const checked = [];
  const check = (url) => { checked.push(url); return { ok: true, url: new URL(url) }; };
  let n = 0;
  const fetchImpl = async () => {
    n += 1;
    return n === 1
      ? { status: 302, headers: new Headers({ location: 'https://b.example.com/x' }), text: async () => '' }
      : { status: 200, headers: new Headers(), text: async () => '' };
  };

  await safeFetch('https://a.example.com/x', { fetchImpl, check });
  assert.equal(checked.length, 2);
  assert.deepEqual(checked, ['https://a.example.com/x', 'https://b.example.com/x']);
});

test('an endless redirect loop fails closed instead of hanging', async () => {
  let n = 0;
  const fetchImpl = async () => {
    n += 1;
    return { status: 302, headers: new Headers({ location: `https://example.com/${n}` }), text: async () => '' };
  };

  await assert.rejects(
    () => safeFetch('https://example.com/0', { fetchImpl }),
    (e) => e.code === 'TOO_MANY_REDIRECTS'
  );
  assert.equal(n, MAX_REDIRECTS + 1);
});
