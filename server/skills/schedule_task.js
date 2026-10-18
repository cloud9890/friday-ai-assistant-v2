/* ==========================================================================
   F.R.I.D.A.Y. // SKILL — SCHEDULE TASK (Phase C tail)
   Stores a read-only capability to run later, unattended ("index my documents
   at 8am", "check my battery in an hour").

   The authority is entirely the kernel's: this skill only PROPOSES the action
   (__schedule) and, once the kernel's SCHEDULE_WRITE branch has certified it
   and confirmed it needs no approval, stores exactly that proposal. Boss
   approves the task when it is created. At fire time the kernel re-authorises
   the stored action, so a capability that later starts needing approval is
   skipped and reported rather than run unattended.
   ========================================================================== */

import { RISK, CONFIRMATION, PERMISSION } from '../security/risk.js';
import { scheduleJob } from '../lib/scheduler.js';
import { resolveAt, humanTime } from '../lib/schedule-time.js';

/** A short label for the HUD task list. */
function label(plan, args) {
  const text = String(args.text || '').trim();
  if (text) return text;
  const shape = plan.args && Object.keys(plan.args).length ? ` ${JSON.stringify(plan.args)}` : '';
  return `${plan.skill}${shape}`;
}

export default {
  name: 'schedule_task',
  description: 'Schedules a safe read-only tool to run by itself at a future time and report the result ("every morning check my battery", "at 8am index my documents"). Only read-only tools can be scheduled; Boss approves the task now and it is re-checked when it runs.',
  parameters: {
    type: 'object',
    properties: {
      skill: { type: 'string', description: 'Name of the read-only tool to run later (e.g. index_folder, search_knowledge, fetch_battery_status)' },
      args: { type: 'object', description: 'Arguments to pass that tool (same shape you would pass now)' },
      when: { type: 'string', description: 'ISO 8601 clock time; get it from get_current_time' },
      delay_minutes: { type: 'number', description: 'Relative delay in minutes, instead of "when"' },
      text: { type: 'string', description: 'Optional short label for the task list' }
    },
    required: ['skill']
  },
  risk: RISK.HIGH,
  permissions: [PERMISSION.SCHEDULE_WRITE],
  // Boss approves the creation; the kernel then refuses anything that would
  // still need approval at run time.
  confirmation: CONFIRMATION.ALWAYS,

  policyHints(args) {
    const raw = (args.args && typeof args.args === 'object' && !Array.isArray(args.args)) ? args.args : {};
    return { __schedule: { skill: String(args.skill || '').trim(), args: raw } };
  },

  describe(args) {
    const name = String(args.skill || '').trim() || 'a tool';
    const shape = args.args && Object.keys(args.args).length ? ` with ${JSON.stringify(args.args)}` : '';
    return `Schedule "${name}"${shape} to run unattended. Boss approves the task now; it is skipped rather than run if it would need approval later.`;
  },

  execute(args, ctx, hints) {
    const plan = hints.__schedule;
    if (!plan || !plan.skill) return 'Error: no scheduled action was certified.';

    const at = resolveAt(args);
    if (Number.isNaN(at.getTime())) return 'Error: that time could not be understood.';

    const job = scheduleJob({
      text: label(plan, args),
      at: at.toISOString(),
      kind: 'task',
      action: { skill: plan.skill, args: plan.args }
    });

    const shape = plan.args && Object.keys(plan.args).length ? ` (${JSON.stringify(plan.args)})` : '';
    return `Scheduled ${job.action.skill}${shape} for ${humanTime(at)}.`;
  }
};
