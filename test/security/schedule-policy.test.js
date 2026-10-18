/* Proactive capabilities must be gated exactly like every other one: the
   kernel certifies the reminder's time and refuses anything malformed. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { authorize } from '../../server/security/kernel.js';
import { capabilityTable } from '../../server/skills/registry.js';
import { RISK, CONFIRMATION, PERMISSION } from '../../server/security/risk.js';

const decisionOf = (req) => authorize(req).decision;
const iso = (ms) => new Date(Date.now() + ms).toISOString();

test('the proactive skills are registered and declare their own authority', () => {
  const table = capabilityTable();
  for (const name of ['set_reminder', 'list_tasks', 'cancel_task', 'send_notification']) {
    assert.ok(table[name], `${name} must be registered`);
  }
  assert.equal(table.set_reminder.risk, RISK.LOW);
  assert.equal(table.set_reminder.confirmation, CONFIRMATION.NONE);
  assert.deepEqual(table.set_reminder.permissions, [PERMISSION.SCHEDULE_WRITE]);
  assert.deepEqual(table.list_tasks.permissions, [PERMISSION.SCHEDULE_READ]);
  assert.equal(table.list_tasks.risk, RISK.SAFE);
  assert.deepEqual(table.cancel_task.permissions, [PERMISSION.SCHEDULE_WRITE]);
  assert.deepEqual(table.send_notification.permissions, [PERMISSION.NOTIFY]);
});

test('a reminder with a relative delay is allowed', () => {
  const res = authorize({ tool: 'set_reminder', args: { text: 'stretch', delay_minutes: 2 } });
  assert.equal(res.decision, 'allow');
  assert.equal(res.confirmation, 'none');
});

test('a reminder with a future ISO timestamp is allowed', () => {
  const res = authorize({ tool: 'set_reminder', args: { text: 'call Pepper', when: iso(3600_000) } });
  assert.equal(res.decision, 'allow');
});

test('a reminder must carry text', () => {
  assert.equal(decisionOf({ tool: 'set_reminder', args: { delay_minutes: 5 } }), 'deny');
  assert.equal(decisionOf({ tool: 'set_reminder', args: { text: '', delay_minutes: 5 } }), 'deny');
});

test('a reminder needs exactly one time: neither or both are denied', () => {
  const neither = authorize({ tool: 'set_reminder', args: { text: 'stretch' } });
  assert.equal(neither.decision, 'deny');
  assert.match(neither.reason, /when.*or.*delay_minutes/i);

  const both = authorize({
    tool: 'set_reminder',
    args: { text: 'stretch', delay_minutes: 5, when: iso(3600_000) }
  });
  assert.equal(both.decision, 'deny');
  assert.match(both.reason, /not both/i);
});

test('an out-of-range or non-numeric delay is denied', () => {
  for (const delay_minutes of [0, -5, 43201, Number.NaN]) {
    assert.equal(
      decisionOf({ tool: 'set_reminder', args: { text: 'stretch', delay_minutes } }),
      'deny',
      `delay_minutes=${delay_minutes} must be denied`
    );
  }
});

test('a malformed or past timestamp is denied', () => {
  const malformed = authorize({ tool: 'set_reminder', args: { text: 'stretch', when: 'in 5 minutes' } });
  assert.equal(malformed.decision, 'deny');
  assert.match(malformed.reason, /ISO 8601/i);

  const past = authorize({ tool: 'set_reminder', args: { text: 'stretch', when: iso(-2 * 3600_000) } });
  assert.equal(past.decision, 'deny');
  assert.match(past.reason, /past/i);

  const farFuture = authorize({ tool: 'set_reminder', args: { text: 'stretch', when: iso(400 * 24 * 3600_000) } });
  assert.equal(farFuture.decision, 'deny');
  assert.match(farFuture.reason, /within the next year/i);
});

test('listing and cancelling tasks need no confirmation', () => {
  assert.equal(decisionOf({ tool: 'list_tasks', args: {} }), 'allow');
  assert.equal(decisionOf({ tool: 'cancel_task', args: {} }), 'allow');
  assert.equal(decisionOf({ tool: 'cancel_task', args: { text: 'stretch' } }), 'allow');
});

test('a notification must carry a real message', () => {
  const ok = authorize({ tool: 'send_notification', args: { message: 'build finished' } });
  assert.equal(ok.decision, 'allow');
  assert.equal(decisionOf({ tool: 'send_notification', args: { message: ' ' } }), 'deny');
  assert.equal(decisionOf({ tool: 'send_notification', args: {} }), 'deny');
  assert.equal(decisionOf({ tool: 'send_notification', args: { message: 'x'.repeat(501) } }), 'deny');
});
