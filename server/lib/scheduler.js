/* ==========================================================================
   F.R.I.D.A.Y. // SERVER LIB — SCHEDULER (proactive jobs)
   Persisted reminders/tasks in data/jobs.json plus a single tick loop. The
   file IS the state (no in-process cache), so pending work survives a server
   restart; overdue jobs are caught up the moment the loop starts.

   Authority stays in the kernel: this module only stores and fires. Whether a
   job may be created is decided by the SCHEDULE_WRITE policy before the skill
   ever reaches the executor.
   ========================================================================== */

import fs from 'fs';
import path from 'path';

const JOBS_FILE = path.join(process.cwd(), 'data', 'jobs.json');
const MAX_JOBS = 200;
const MAX_TEXT_CHARS = 300;
const DONE_TTL_MS = 14 * 24 * 60 * 60 * 1000; // keep finished jobs two weeks
const DEFAULT_TICK_MS = 15000;

function load() {
  try {
    const parsed = JSON.parse(fs.readFileSync(JOBS_FILE, 'utf8'));
    return { jobs: Array.isArray(parsed.jobs) ? parsed.jobs : [] };
  } catch {
    return { jobs: [] };
  }
}

function persist(store) {
  try {
    fs.mkdirSync(path.dirname(JOBS_FILE), { recursive: true });
    const tmp = JOBS_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(store, null, 2), 'utf8');
    fs.renameSync(tmp, JOBS_FILE);
    return true;
  } catch (e) {
    console.warn('Scheduler persist failed:', e.message);
    return false;
  }
}

function clean(text) {
  return String(text ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT_CHARS);
}

function makeId() {
  return `job_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

/** Drops long-finished jobs, then trims the oldest entries to the cap. */
function prune(jobs, now = Date.now()) {
  const kept = jobs.filter(j => j.status === 'pending'
    || now - Date.parse(j.firedAt || j.at || j.createdAt) < DONE_TTL_MS);
  if (kept.length <= MAX_JOBS) return kept;
  const pending = kept.filter(j => j.status === 'pending');
  const done = kept.filter(j => j.status !== 'pending');
  return [...pending, ...done].slice(-MAX_JOBS);
}

/**
 * Creates a pending job. `at` is an ISO 8601 timestamp.
 * @param {{text: string, at: string, kind?: string}} spec
 */
export function scheduleJob({ text, at, kind = 'reminder' } = {}) {
  const store = load();
  const job = {
    id: makeId(),
    kind: String(kind || 'reminder'),
    text: clean(text),
    at: new Date(at).toISOString(),
    createdAt: new Date().toISOString(),
    status: 'pending',
    firedAt: null
  };
  store.jobs = prune([...store.jobs, job]);
  persist(store);
  return job;
}

/** Pending jobs, soonest first. */
export function pendingJobs() {
  return load().jobs
    .filter(j => j.status === 'pending')
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
}

/** Every job, newest activity first (includes fired/cancelled for the HUD). */
export function listJobs() {
  return load().jobs.slice().sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
}

export function getJob(id) {
  const wanted = String(id || '');
  return load().jobs.find(j => j.id === wanted) || null;
}

/** Cancels one pending job. Returns the job, or null if it was not pending. */
export function cancelJob(id) {
  const store = load();
  const job = store.jobs.find(j => j.id === String(id || '') && j.status === 'pending');
  if (!job) return null;
  job.status = 'cancelled';
  job.cancelledAt = new Date().toISOString();
  persist(store);
  return job;
}

/** Cancels every pending job whose text matches (case-insensitive substring). */
export function cancelJobsByText(text) {
  const needle = clean(text).toLowerCase();
  if (!needle) return [];
  const store = load();
  const hits = store.jobs.filter(j => j.status === 'pending' && j.text.toLowerCase().includes(needle));
  for (const job of hits) {
    job.status = 'cancelled';
    job.cancelledAt = new Date().toISOString();
  }
  if (hits.length) persist(store);
  return hits;
}

/**
 * Marks every pending job whose time has arrived as fired.
 * Pure and injectable-now so it is deterministic under test.
 * @returns {Array<object>} the jobs that fired, soonest first
 */
export function tick(now = Date.now()) {
  const store = load();
  const due = [];
  for (const job of store.jobs) {
    if (job.status !== 'pending') continue;
    if (Date.parse(job.at) <= now) {
      job.status = 'fired';
      job.firedAt = new Date(now).toISOString();
      due.push(job);
    }
  }
  if (due.length) {
    store.jobs = prune(store.jobs, now);
    persist(store);
  }
  return due.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
}

let timer = null;

/**
 * Starts the tick loop. Runs one tick immediately (catch-up for jobs that came
 * due while the server was down) then every `intervalMs`. The timer is
 * unref'd so it never keeps the process alive on its own.
 *
 * @param {{onFire?: (job: object) => any, intervalMs?: number}} options
 * @returns {() => void} stop function
 */
export function startScheduler({ onFire = null, intervalMs = DEFAULT_TICK_MS } = {}) {
  stopScheduler();

  const run = () => {
    let fired = [];
    try {
      fired = tick();
    } catch (e) {
      console.warn('Scheduler tick failed:', e.message);
      return;
    }
    for (const job of fired) {
      try {
        const result = onFire ? onFire(job) : null;
        if (result && typeof result.catch === 'function') {
          result.catch(e => console.warn('Scheduler handler failed:', e.message));
        }
      } catch (e) {
        console.warn('Scheduler handler failed:', e.message);
      }
    }
  };

  run();
  timer = setInterval(run, intervalMs);
  timer.unref?.();
  return stopScheduler;
}

export function stopScheduler() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

export function jobsFilePath() {
  return JOBS_FILE;
}
