/* The unattended half of schedule_task: a stored action is re-authorised at
   fire time and only runs when it is still allowed without approval. */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { documentsDir } from '../../server/lib/paths.js';
import { runScheduledTask } from '../../server/lib/scheduled-task.js';
import { policyHints, executeSkill } from '../../server/skills/registry.js';
import { authorize } from '../../server/security/kernel.js';

fs.mkdirSync(documentsDir, { recursive: true });
const scratch = fs.mkdtempSync(path.join(documentsDir, '.friday-sched-'));
const scratchName = path.basename(scratch);
fs.writeFileSync(path.join(scratch, 'budget.md'), '# Budget\n\nQuarterly travel budget approved.\n');

after(() => fs.rmSync(scratch, { recursive: true, force: true }));

function collector() {
  const sent = [];
  return { sent, deliver: (payload) => { sent.push(payload); } };
}

/** Runs an action through the same kernel path the loop uses, then fires it. */
async function createAndFire(args) {
  const hints = policyHints('schedule_task', args);
  const decision = authorize({ tool: 'schedule_task', args, actor: 'agent', ...hints });
  assert.equal(decision.decision, 'allow', `creation must be allowed: ${decision.reason}`);
  const action = hints.__schedule;
  const { sent, deliver } = collector();
  const outcome = await runScheduledTask({ text: 'scheduled', action }, { deliver });
  return { action, outcome, sent };
}

test('a scheduled read-only tool really runs at fire time and reports back', async () => {
  const { outcome, sent } = await createAndFire({
    skill: 'list_dir',
    args: { parent: 'documents' },
    delay_minutes: 30
  });

  assert.equal(outcome.status, 'done');
  assert.equal(sent.length, 1);
  assert.match(sent[0].title, /TASK/);
  assert.equal(sent[0].speak, true);
  assert.ok(sent[0].body.length > 0);
});

test('an action the policy would now refuse is skipped, never run', async () => {
  // A stored action whose args reach a protected location must be denied at
  // fire time and reported, rather than executed unattended.
  const { sent, deliver } = collector();
  const outcome = await runScheduledTask(
    { action: { skill: 'index_folder', args: { path: 'C:\\Windows\\System32' } } },
    { deliver }
  );
  assert.equal(outcome.status, 'skipped');
  assert.match(sent[0].title, /SKIPPED/);
});

test('an unknown or non-schedulable skill is skipped, not executed', async () => {
  for (const skill of ['run_command', 'delete_path', 'made_up_tool']) {
    const { sent, deliver } = collector();
    const outcome = await runScheduledTask({ action: { skill, args: {} } }, { deliver });
    assert.equal(outcome.status, 'skipped', `${skill} must be skipped`);
    assert.match(sent[0].title, /SKIPPED/);
  }
});

test('a job with no action is skipped rather than throwing', async () => {
  const { sent, deliver } = collector();
  const outcome = await runScheduledTask({ text: 'plain reminder' }, { deliver });
  assert.equal(outcome.status, 'skipped');
  assert.match(sent[0].body, /no action/i);
});

test('an allowed action still runs through the ordinary executor', async () => {
  // Proves the fire path uses the real skill, on real files.
  const hints = policyHints('search_knowledge', { query: 'travel budget' });
  const decision = authorize({ tool: 'search_knowledge', args: { query: 'travel budget' }, actor: 'scheduler', ...hints });
  assert.equal(decision.decision, 'allow');
  const result = await executeSkill('search_knowledge', { query: 'travel budget' }, hints, {});
  assert.equal(typeof result, 'string');

  fs.writeFileSync(path.join(scratch, 'note.md'), 'The travel budget for the Tokyo trip was approved.');
  const withFile = await createAndFire({
    skill: 'search_knowledge',
    args: { query: 'travel budget' },
    text: 'search my notes',
    delay_minutes: 15
  });
  assert.equal(withFile.outcome.status, 'done');
});
