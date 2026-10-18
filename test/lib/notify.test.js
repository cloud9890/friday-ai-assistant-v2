/* Notification bus: monotonic ids, high-water polling, and no native toast
   during tests (FRIDAY_NO_TOAST). */
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

process.env.FRIDAY_NO_TOAST = '1'; // never spawn PowerShell from the suite

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'friday-notify-'));
process.chdir(scratch);

const {
  notify, listNotifications, latestNotificationId, notificationsFilePath
} = await import('../../server/lib/notify.js');

beforeEach(() => {
  try { fs.rmSync(notificationsFilePath(), { force: true }); } catch { /* nothing to clear */ }
});

test('notifications get increasing ids and a timestamp', () => {
  const first = notify({ body: 'take a break' });
  const second = notify({ body: 'call Pepper' });

  assert.equal(first.id, 1);
  assert.equal(second.id, 2);
  assert.equal(latestNotificationId(), 2);
  assert.ok(Date.parse(first.ts) > 0);
  assert.equal(first.title, 'F.R.I.D.A.Y.'); // default title
  assert.equal(first.speak, true);
});

test('listNotifications returns only ids newer than the watermark, oldest first', () => {
  notify({ body: 'one' });
  const two = notify({ body: 'two' });
  notify({ body: 'three' });

  assert.deepEqual(listNotifications().map(n => n.body), ['one', 'two', 'three']);
  assert.deepEqual(listNotifications({ sinceId: two.id }).map(n => n.body), ['three']);
  assert.deepEqual(listNotifications({ sinceId: 99 }), []);
});

test('a fresh reader can seed from latestNotificationId without replaying history', () => {
  notify({ body: 'yesterday' });
  const high = latestNotificationId();
  notify({ body: 'just now' });

  assert.deepEqual(listNotifications({ sinceId: high }).map(n => n.body), ['just now']);
});

test('text is normalised and the native channel can be silenced', () => {
  const item = notify({ title: '  Test  ', body: 'hello\n\n   world  ' });
  assert.equal(item.title, 'Test');
  assert.equal(item.body, 'hello world');
});

test('the queue is capped so it cannot grow without bound', () => {
  for (let i = 0; i < 105; i++) notify({ body: `ping ${i}` });
  assert.equal(listNotifications({ limit: 1000 }).length, 100);
  assert.equal(latestNotificationId(), 105);
});
