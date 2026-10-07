/* ==========================================================================
   F.R.I.D.A.Y. // SKILL — EXECUTE MACRO (chained app/url/delay steps)
   Every step is validated by the kernel (SCRIPT_EXECUTE) before any step
   runs, so a macro can never half-start with an invalid tail.
   ========================================================================== */

import { execSync } from 'child_process';
import { RISK, CONFIRMATION, PERMISSION } from '../security/risk.js';
import { APP_EXECUTABLES, findAppShortcut, launchInInteractiveSession, findStartApp } from '../lib/app-launcher.js';

function launchStep(target) {
  const exe = APP_EXECUTABLES[target.toLowerCase()];
  if (exe) return launchInInteractiveSession(exe);
  const shortcut = findAppShortcut(target);
  if (shortcut) return launchInInteractiveSession(shortcut);
  const startApp = findStartApp(target);
  if (startApp) return launchInInteractiveSession(startApp);
  try {
    execSync(`powershell.exe -WindowStyle Hidden -Command "Start-Process '${target.replace(/'/g, "''")}' -ErrorAction Stop"`, { stdio: 'ignore', timeout: 5000 });
    return Promise.resolve(true);
  } catch (e) {
    return Promise.resolve(false);
  }
}

export default {
  name: 'execute_macro',
  description: 'Runs 1-20 steps in order: launch apps, open URLs, wait delays.',
  parameters: {
    type: 'object',
    properties: {
      steps: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            type: { type: 'string', enum: ['app', 'url', 'delay'] },
            target: { type: 'string' },
            ms: { type: 'number' }
          },
          required: ['type']
        }
      }
    },
    required: ['steps']
  },
  risk: RISK.HIGH,
  permissions: [PERMISSION.SCRIPT_EXECUTE, PERMISSION.LAUNCH_PROCESS],
  confirmation: CONFIRMATION.ALWAYS,

  describe(args) {
    const summary = (args.steps || [])
      .map(s => s.type === 'delay' ? `wait ${s.ms || 1000}ms` : s.target)
      .filter(Boolean)
      .join(' → ');
    return `Run macro: ${summary || 'empty sequence'}.`;
  },

  async execute(args) {
    const results = [];
    for (const step of args.steps) {
      if (step.type === 'app') {
        const ok = await launchStep(step.target);
        results.push(ok ? `Launched ${step.target}` : `Failed to launch ${step.target}`);
      } else if (step.type === 'url') {
        const url = step.target.startsWith('http') ? step.target : `https://${step.target}`;
        await launchInInteractiveSession(url);
        results.push(`Opened ${url}`);
      } else if (step.type === 'delay') {
        await new Promise(r => setTimeout(r, Math.min(Number(step.ms) || 1000, 10000)));
      }
    }
    return `Macro finished (${results.length} steps): ${results.join('; ')}.`;
  }
};
