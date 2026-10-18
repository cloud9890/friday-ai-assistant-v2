/* ==========================================================================
   F.R.I.D.A.Y. // SKILL — CHANGE SYSTEM VOLUME
   ========================================================================== */

import fs from 'fs';
import path from 'path';
import { RISK, CONFIRMATION, PERMISSION } from '../security/risk.js';
import { runPowerShellScript } from './helpers.js';

export default {
  name: 'change_system_volume',
  description: 'Changes the system audio volume.',
  parameters: {
    type: 'object',
    properties: {
      action: { type: 'string', enum: ['volume-up', 'volume-down', 'volume-set', 'mute'] },
      amount: { type: 'number' }
    },
    required: ['action']
  },
  risk: RISK.LOW,
  permissions: [PERMISSION.CONTROL_VOLUME],
  confirmation: CONFIRMATION.NONE,

  execute(args) {
    const action = String(args.action || 'mute');
    let arg = 'mute';
    if (action === 'volume-up') arg = 'up';
    else if (action === 'volume-down') arg = 'down';
    else if (action === 'volume-set') arg = 'set';
    const scriptPath = path.join(process.cwd(), 'volume.ps1');
    if (!fs.existsSync(scriptPath)) return 'Error: volume control script is missing on the server.';
    runPowerShellScript(scriptPath, [arg, String(Number(args.amount) || 10)]);
    return `System volume adjusted (${action}${args.amount !== undefined ? ` ${args.amount}` : ''}).`;
  }
};
