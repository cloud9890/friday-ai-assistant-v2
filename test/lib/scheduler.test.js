/* Scheduler: persisted proactive jobs — create, list, cancel, fire.
   The store has no in-process cache, so "survives a restart" is proven by a
   real second process reading the same file. */
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const repoRoot = path.resolve(import.meta.dirname, '..', '..');
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'friday-sched-'));
process.chdir(scratch);

const {
  scheduleJob, pendingJobs, listJobs, cancelJob, cancelJobsByText,
  tick, startScheduler, stopScheduler, jobsFilePath
} = await import('../../server/lib/scheduler.js');

const iso = (ms) => new Date(Date.now() + ms).toISOString();

beforeEach(() => {
  try { fs.rmSync(jobsFilePath(), { force: true }); } catch { /* nothing to clear */ }
});

test('a scheduled reminder is persisted and listed soonest first', () => {
  const later = scheduleJob({ text: 'call Pepper', at: iso(30 * 60000) });
  const sooner = scheduleJob({ text: 'stretch', at: iso(2 * 60000) });

  assert.match(sooner.id, /^job_/);
  assert.equal(sooner.status, 'pending');
  assert.deepEqual(pendingJobs().map(j => j.text), ['stretch', 'call Pepper']);
  assert.equal(listJobs().length, 2);
  assert.equal(later.text, 'call Pepper');
});

test('tick fires only the jobs whose time has arrived', () => {
  scheduleJob({ text: 'now', at: iso(-1000) });
  scheduleJob({ text: 'later', at: iso(60 * 60000) });

  const fired = tick();
  assert.deepEqual(fired.map(j => j.text), ['now']);
  assert.equal(fired[0].status, 'fired');
  assert.ok(fired[0].firedAt);
  assert.deepEqual(pendingJobs().map(j => j.text), ['later']);
});

test('tick is a no-op when nothing is due', () => {
  scheduleJob({ text: 'later', at: iso(60 * 60000) });
  assert.deepEqual(tick(), []);
  assert.equal(pendingJobs().length, 1);
});

test('a cancelled reminder never fires', () => {
  const job = scheduleJob({ text: 'stretch', at: iso(-1000) });
  assert.equal(cancelJob(job.id).status, 'cancelled');
  assert.deepEqual(tick(), []);
  assert.equal(pendingJobs().length, 0);
  assert.equal(cancelJob(job.id), null); // already resolved, not cancellable twice
  assert.equal(cancelJob('job_nope'), null);
});

test('cancelJobsByText cancels every pending job matching a substring', () => {
  scheduleJob({ text: 'stretch your legs', at: iso(10 * 60000) });
  scheduleJob({ text: 'stretch and hydrate', at: iso(20 * 60000) });
  scheduleJob({ text: 'call Pepper', at: iso(30 * 60000) });

  const hits = cancelJobsByText('STRETCH');
  assert.equal(hits.length, 2);
  assert.deepEqual(pendingJobs().map(j => j.text), ['call Pepper']);
  assert.deepEqual(cancelJobsByText('no-such-text'), []);
});

test('the loop catches up jobs that came due while the server was down', () => {
  scheduleJob({ text: 'overdue', at: iso(-5 * 60000) });
  scheduleJob({ text: 'future', at: iso(60 * 60000) });

  const fired = [];
  const stop = startScheduler({ onFire: (job) => fired.push(job.text), intervalMs: 60 * 60000 });
  stop();
  stopScheduler();

  assert.deepEqual(fired, ['overdue']);
  assert.deepEqual(pendingJobs().map(j => j.text), ['future']);
});

test('a pending job survives a restart (a fresh process reads the same file)', () => {
  scheduleJob({ text: 'survives restart', at: iso(120 * 60000) });

  const moduleUrl = pathToFileURL(path.join(repoRoot, 'server/lib/scheduler.js')).href;
  const script = `import(${JSON.stringify(moduleUrl)}).then(m => process.stdout.write(JSON.stringify(m.pendingJobs().map(j => j.text))))`;
  const out = execFileSync(process.execPath, ['-e', script], { cwd: scratch, encoding: 'utf8' });

  assert.deepEqual(JSON.parse(out), ['survives restart']);
});
