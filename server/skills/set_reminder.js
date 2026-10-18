/* ==========================================================================
   F.R.I.D.A.Y. // SKILL — SET REMINDER
   Turns Friday from reactive to proactive: a persisted job that fires a
   notification (native toast + HUD + spoken line) at a future time.

   The kernel certifies the time (SCHEDULE_WRITE policy) before this runs, so
   a missing, malformed or past timestamp never reaches the executor.
   ========================================================================== */

import { RISK, CONFIRMATION, PERMISSION } from '../security/risk.js';
import { scheduleJob } from '../lib/scheduler.js';

function resolveAt(args) {
  if (typeof args.delay_minutes === 'number' && Number.isFinite(args.delay_minutes)) {
    return new Date(Date.now() + args.delay_minutes * 60000);
  }
  return new Date(Date.parse(args.when));
}

function humanTime(date) {
  const now = new Date();
  const sameDay = date.toDateString() === now.toDateString();
  return date.toLocaleString(undefined, sameDay
    ? { hour: '2-digit', minute: '2-digit' }
    : { weekday: 'short', hour: '2-digit', minute: '2-digit' });
}

export default {
  name: 'set_reminder',
  description: 'Sets a real reminder that will alert the user at a future time ("remind me in 10 minutes to stretch", "remind me at 17:30 to call Pepper"). Use delay_minutes for a relative time, or when (ISO 8601 date-time) for a clock time — get the current time first with get_current_time.',
  parameters: {
    type: 'object',
    properties: {
      text: { type: 'string' },
      when: { type: 'string' },
      delay_minutes: { type: 'number' }
    },
    required: ['text']
  },
  risk: RISK.LOW,
  permissions: [PERMISSION.SCHEDULE_WRITE],
  confirmation: CONFIRMATION.NONE,

  execute(args) {
    const at = resolveAt(args);
    const job = scheduleJob({ text: args.text, at: at.toISOString() });
    return `Reminder set for ${humanTime(at)}: ${job.text}.`;
  },

  describe(args) {
    return `Set a reminder: "${args.text}".`;
  }
};
