/* ==========================================================================
   F.R.I.D.A.Y. // SKILL — LIST TASKS
   Read-only view of the scheduler: everything still pending, with the id the
   user (or the model) needs to cancel one.
   ========================================================================== */

import { RISK, CONFIRMATION, PERMISSION } from '../security/risk.js';
import { pendingJobs } from '../lib/scheduler.js';

function humanTime(iso) {
  return new Date(iso).toLocaleString(undefined, {
    weekday: 'short', hour: '2-digit', minute: '2-digit'
  });
}

export default {
  name: 'list_tasks',
  description: 'Lists the reminders and scheduled tasks still pending. Use it before cancelling something, or when the user asks what is scheduled or what you are going to remind them about.',
  parameters: { type: 'object', properties: {}, required: [] },
  risk: RISK.SAFE,
  permissions: [PERMISSION.SCHEDULE_READ],
  confirmation: CONFIRMATION.NONE,
  schedulable: true,

  execute() {
    const jobs = pendingJobs();
    if (jobs.length === 0) return 'Nothing is scheduled right now.';
    return `Pending (${jobs.length}):\n`
      + jobs.map(j => `- [${j.id}] ${humanTime(j.at)} — ${j.text}`).join('\n');
  }
};
