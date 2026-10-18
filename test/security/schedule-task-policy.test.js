/* schedule_task stores a capability to run UNATTENDED. The kernel only accepts
   a read-only, allow-listed tool that needs no approval — approved once at
   creation time — and re-authorises it at fire time, skipping rather than
   running anything that would need the user. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { authorize } from '../../server/security/kernel.js';
import { capabilityTable, policyHints } from '../../server/skills/registry.js';
import { RISK, CONFIRMATION, PERMISSION } from '../../server/security/risk.js';

const iso = (ms) => new Date(Date.now() + ms).toISOString();

/** Authorises schedule_task the way the loop does: hints carry the proposal. */
function schedule(args) {
  const hints = policyHints('schedule_task', args);
  return { decision: authorize({ tool: 'schedule_task', args, actor: 'agent', ...hints }), hints };
}

test('schedule_task is registered, asks first, and proposes via a policy hint', () => {
  const meta = capabilityTable().schedule_task;
  assert.ok(meta, 'schedule_task must be registered');
  assert.equal(meta.risk, RISK.HIGH);
  assert.equal(meta.confirmation, CONFIRMATION.ALWAYS, 'Boss approves the task when it is created');
  assert.deepEqual(meta.permissions, [PERMISSION.SCHEDULE_WRITE]);

  const { hints } = schedule({ skill: 'index_folder', args: { path: 'documents' }, delay_minutes: 30 });
  assert.deepEqual(hints.__schedule, { skill: 'index_folder', args: { path: 'documents' } });
});

test('a read-only allow-listed tool can be scheduled and keeps asking at creation', () => {
  const { decision } = schedule({ skill: 'index_folder', args: { path: 'documents' }, delay_minutes: 30 });
  assert.equal(decision.decision, 'allow');
  assert.equal(decision.confirmation, 'always', 'the creation step always prompts');
});

test('only tools that opted in as schedulable may be scheduled', () => {
  for (const skill of ['run_command', 'delete_path', 'write_file', 'organize_files', 'convert_image', 'schedule_task']) {
    const { decision } = schedule({ skill, delay_minutes: 10 });
    assert.equal(decision.decision, 'deny', `${skill} must not be schedulable`);
    assert.match(decision.reason, /cannot be run on a schedule|unknown capability/);
  }
});

test('a tool that needs approval when it runs is refused at creation', () => {
  // run_command is on no allow-list at all, but even an allow-listed tool is
  // refused if its own policy would surface a confirmation / denial.
  const { decision } = schedule({ skill: 'read_file', args: { fileName: '../../../.env', parent: 'desktop' }, delay_minutes: 10 });
  assert.equal(decision.decision, 'deny');
  assert.match(decision.reason, /not allowed/);
});

test('scheduling needs a time and a known tool', () => {
  assert.match(schedule({ skill: 'index_folder' }).decision.reason, /when.*or.*delay_minutes/i);
  assert.match(schedule({ delay_minutes: 10 }).decision.reason, /needs a "skill"/);
  assert.match(schedule({ skill: 'not_a_tool', delay_minutes: 10 }).decision.reason, /unknown capability/);
  assert.match(schedule({ skill: 'index_folder', delay_minutes: 0 }).decision.reason, /delay_minutes/);
  assert.match(schedule({ skill: 'index_folder', when: 'soon' }).decision.reason, /ISO 8601/);
});

test('a future clock time is accepted, a past one is not', () => {
  assert.equal(schedule({ skill: 'list_dir', args: { parent: 'desktop' }, when: iso(3600_000) }).decision.decision, 'allow');
  assert.match(schedule({ skill: 'list_dir', when: iso(-3600_000) }).decision.reason, /past/);
});

test('schedulable tools are a deliberate, read-only subset', () => {
  const table = capabilityTable();
  const schedulable = Object.entries(table).filter(([, m]) => m.schedulable).map(([n]) => n).sort();
  assert.deepEqual(schedulable, [
    'ask_my_document', 'fetch_battery_status', 'fetch_system_status', 'get_current_time',
    'index_folder', 'list_dir', 'list_tasks', 'read_file', 'recall_facts', 'search_knowledge',
    'search_local_files'
  ]);
  for (const name of schedulable) {
    assert.ok(
      table[name].risk === RISK.SAFE || table[name].risk === RISK.LOW || table[name].risk === RISK.MEDIUM,
      `${name} must be read-only-ish to run unattended`
    );
    assert.equal(table[name].confirmation, CONFIRMATION.NONE, `${name} must not need approval`);
  }
});
