/* ==========================================================================
   F.R.I.D.A.Y. // SERVER LIB — SCHEDULED TASK RUNNER
   Executes a job that `schedule_task` stored. A scheduled capability runs
   UNATTENDED, so the kernel re-authorises it at fire time, with the stored
   arguments, before anything happens: only an action that is still allowed AND
   still needs no confirmation is run. Anything else is skipped and reported —
   it is never run behind the user's back, and never silently dropped.
   ========================================================================== */

import { authorize } from '../security/kernel.js';
import { policyHints, executeSkill } from '../skills/registry.js';
import { notify } from './notify.js';

export const SUMMARY_CHARS = 300;

/**
 * @param {{text?: string, action?: {skill: string, args?: object}}} job
 * @param {{deliver?: (payload: {title: string, body: string, speak: boolean}) => any}} [options]
 * @returns {Promise<{status: 'done'|'skipped'|'failed', skill: string, summary: string}>}
 */
export async function runScheduledTask(job, { deliver = notify } = {}) {
  const skill = job?.action?.skill;
  const args = (job?.action?.args && typeof job.action.args === 'object') ? job.action.args : {};
  const say = (title, body) => deliver({ title, body, speak: true });

  if (typeof skill !== 'string' || !skill) {
    await say('F.R.I.D.A.Y. TASK SKIPPED', 'A scheduled task had no action to run.');
    return { status: 'skipped', skill: '', summary: 'no action' };
  }

  const hints = policyHints(skill, args);
  const decision = authorize({ tool: skill, args, actor: 'scheduler', ...hints });

  if (decision.decision !== 'allow' || decision.confirmation !== 'none') {
    const why = decision.reason || 'it would need approval';
    await say('F.R.I.D.A.Y. TASK SKIPPED', `I did not run the scheduled ${skill} — ${why}.`);
    return { status: 'skipped', skill, summary: why };
  }

  try {
    const result = await executeSkill(skill, args, hints, {});
    const summary = String(result ?? '').replace(/\s+/g, ' ').trim().slice(0, SUMMARY_CHARS);
    await say(`F.R.I.D.A.Y. TASK — ${skill}`, summary || 'Done.');
    return { status: 'done', skill, summary };
  } catch (e) {
    await say('F.R.I.D.A.Y. TASK FAILED', `${skill}: ${e.message}`);
    return { status: 'failed', skill, summary: String(e.message || '') };
  }
}
