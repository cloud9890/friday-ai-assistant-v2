/* Phase 1 (R11/S9): secrets never reach the audit trail. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { redact, hashTarget, auditFilePath } from '../../server/security/audit.js';

test('credential-looking keys are redacted at any depth', () => {
  const out = redact({
    apiKey: 'gsk_livevalue123456789',
    nested: { authorization: 'Bearer abcdefghijklmnop', theme: 'dark' },
    list: [{ password: 'hunter2', keep: 'visible' }]
  });
  assert.equal(out.apiKey, '[REDACTED]');
  assert.equal(out.nested.authorization, '[REDACTED]');
  assert.equal(out.nested.theme, 'dark');
  assert.equal(out.list[0].password, '[REDACTED]');
  assert.equal(out.list[0].keep, 'visible');
});

test('credential-shaped free text is scrubbed', () => {
  assert.match(redact('token is sk-abcdefghijklmnopqrst'), /\[REDACTED\]/);
  assert.match(redact('header sk-abcdefghijklmnopqrst end'), /\[REDACTED\]/);
  assert.doesNotMatch(redact('Authorization: Bearer abcdefghijklmnopqrst'), /abcdefghijklmnopqrst/);
});

test('long strings are truncated and depth is bounded', () => {
  const long = redact('x'.repeat(2000));
  assert.ok(long.length < 2000);
  assert.match(long, /truncated/);

  let deep = { v: 'leaf' };
  for (let i = 0; i < 12; i++) deep = { nested: deep };
  assert.match(JSON.stringify(redact(deep)), /depth-limit/);
});

test('primitives and functions survive redaction without throwing', () => {
  assert.equal(redact(42), 42);
  assert.equal(redact(true), true);
  assert.equal(redact(null), null);
  assert.equal(redact(undefined), undefined);
  assert.equal(redact(() => {}), '[function]');
  assert.equal(redact(Symbol('x')) instanceof Object || typeof redact(Symbol('x')) === 'string', true);
});

test('redaction never throws on hostile shapes (circular references)', () => {
  const circular = { name: 'loop' };
  circular.self = circular;
  assert.doesNotThrow(() => redact(circular));
});

test('the audit file lives under data/ and is gitignored', () => {
  assert.match(auditFilePath().replace(/\\/g, '/'), /\/data\/audit\.jsonl$/);
  const ignore = fs.readFileSync('C:/Users/YASH/friday-ai-assistant/.gitignore', 'utf8');
  assert.match(ignore, /^data\/$/m);
});

/* M10: targets are correlatable without persisting the cleartext on disk. */
test('audit targets are stored as stable hashes, never cleartext (M10)', () => {
  const query = 'my bank statement password is hunter2';
  const hash = hashTarget(query);

  assert.match(hash, /^sha256:[0-9a-f]{16}$/);
  assert.doesNotMatch(hash, /hunter2/);
  assert.doesNotMatch(hash, /bank/);
  assert.equal(hashTarget(query), hash, 'the same target must hash the same way');
  assert.notEqual(hashTarget(`${query} `), hash);

  assert.equal(hashTarget(null), null);
  assert.equal(hashTarget(undefined), null);
  assert.equal(hashTarget(''), null);
  assert.doesNotThrow(() => hashTarget({ nested: { apiKey: 'gsk_livevalue123456789' } }));
});