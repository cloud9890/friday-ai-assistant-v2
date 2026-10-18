/* ==========================================================================
   F.R.I.D.A.Y. // SKILL — CANCEL TASK
   Cancels a pending reminder. Cancelling your own reminder is reversible
   bookkeeping, so it needs no confirmation — but it never guesses which one:
   with neither an id nor matching text it only proceeds when exactly one job
   is pending, otherwise it reports the list and asks.
   ========================================================================== */

import { RISK, CONFIRMATION, PERMISSION } from '../security/risk.js';
import { cancelJob, cancelJobsByText, pendingJobs } from '../lib/scheduler.js';

function humanTime(iso) {
  return new Date(iso).toLocaleString(undefined, {
    weekday: 'short', hour: '2-digit', minute: '2-digit'
  });
}

export default {
  name: 'cancel_task',
  description: 'Cancels a pending reminder or scheduled task. Pass the id from list_tasks, or a short piece of the reminder text to match. With neither, it cancels only when a single reminder is pending.',
  parameters: {
    type: 'object',
    properties: {
      id: { type: 'string' },
      text: { type: 'string' }
    },
    required: []
  },
  risk: RISK.LOW,
  permissions: [PERMISSION.SCHEDULE_WRITE],
  confirmation: CONFIRMATION.NONE,

  execute(args) {
    const id = typeof args.id === 'string' ? args.id.trim() : '';
    const text = typeof args.text === 'string' ? args.text.trim() : '';

    if (id) {
      const job = cancelJob(id);
      return job
        ? `Cancelled "${job.text}".`
        : `I found no pending task with id ${id}.`;
    }

    if (text) {
      const hits = cancelJobsByText(text);
      if (hits.length === 0) return `No pending task matches "${text}".`;
      return `Cancelled ${hits.length} reminder${hits.length === 1 ? '' : 's'}: `
        + hits.map(j => `"${j.text}"`).join(', ') + '.';
    }

    const jobs = pendingJobs();
    if (jobs.length === 0) return 'There is nothing pending to cancel.';
    if (jobs.length === 1) {
      const job = cancelJob(jobs[0].id);
      return `Cancelled "${job.text}".`;
    }
    return `Which one, Boss?\n`
      + jobs.map(j => `- [${j.id}] ${humanTime(j.at)} — ${j.text}`).join('\n');
  }
};
