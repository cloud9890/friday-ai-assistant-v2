/* Phase 1 (R8/S6): network policy — SSRF and credential-bearing URLs are refused. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkUrl, checkUrlForAgent, isPrivateHost, BLOCKED_HOSTS } from '../../server/security/network-policy.js';

test('public https destinations are allowed', () => {
  for (const u of ['https://example.com', 'https://en.wikipedia.org/wiki/Puppeteer', 'http://neverssl.com']) {
    assert.equal(checkUrl(u).ok, true, u);
  }
});

test('loopback, private and link-local destinations are refused (SSRF)', () => {
  for (const u of [
    'http://localhost:11434/api/tags',
    'http://127.0.0.1/admin',
    'http://[::1]:5173/',
    'http://10.0.0.5/router',
    'http://192.168.1.1/',
    'http://172.16.9.9/',
    'http://169.254.169.254/latest/meta-data/',
    'http://metadata.google.internal/computeMetadata/v1/'
  ]) {
    const res = checkUrl(u);
    assert.equal(res.ok, false, `${u} should be blocked`);
  }
});

test('single-label hostnames count as local', () => {
  assert.equal(isPrivateHost('intranet'), true);
  assert.equal(isPrivateHost('router'), true);
  assert.equal(isPrivateHost('example.com'), false);
});

test('non-web schemes and credential URLs are refused', () => {
  assert.equal(checkUrl('file:///C:/Windows/System32/drivers/etc/hosts').ok, false);
  assert.equal(checkUrl('javascript:alert(1)').ok, false);
  assert.equal(checkUrl('ftp://example.com/x').ok, false);
  assert.equal(checkUrl('https://user:pass@example.com/').ok, false);
  assert.equal(checkUrl('not a url').ok, false);
  assert.equal(checkUrl('').ok, false);
  assert.equal(checkUrl(null).ok, false);
});

test('allowPrivate is the only way local URLs pass, and is opt-in', () => {
  assert.equal(checkUrl('http://localhost:3000/app').ok, false);
  assert.equal(checkUrl('http://localhost:3000/app', { allowPrivate: true }).ok, true);
  assert.equal(checkUrlForAgent('http://localhost:3000/app').ok, true);
});

test('the browser agent may not be pointed at credential surfaces', () => {
  assert.ok(BLOCKED_HOSTS.includes('accounts.google.com'));
  assert.equal(checkUrlForAgent('https://accounts.google.com/signin').ok, false);
  assert.equal(checkUrlForAgent('https://mail.google.com/').ok, false);
  assert.equal(checkUrlForAgent('https://example.com').ok, true);
});

test('even with allowPrivate, non-http schemes stay refused', () => {
  assert.equal(checkUrlForAgent('file:///C:/Users/Public').ok, false);
  assert.equal(checkUrlForAgent('javascript:alert(1)').ok, false);
});
