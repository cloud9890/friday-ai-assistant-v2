/* ==========================================================================
   F.R.I.D.A.Y. // SKILL — CONTROL MEDIA (play/pause/skip)
   ========================================================================== */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { RISK, CONFIRMATION, PERMISSION } from '../security/risk.js';
import { runPowerShellScript } from './helpers.js';

export default {
  name: 'control_media',
  description: 'Play/pause or skip media playing on the computer.',
  parameters: {
    type: 'object',
    properties: { action: { type: 'string', enum: ['play', 'pause', 'next', 'prev'] } },
    required: ['action']
  },
  risk: RISK.LOW,
  permissions: [PERMISSION.CONTROL_MEDIA],
  confirmation: CONFIRMATION.NONE,

  execute(args) {
    const action = String(args.action || 'play');
    const vk = action === 'next' ? 176 : action === 'prev' ? 177 : 179;
    const psScript = `
      $code = @"
      using System.Runtime.InteropServices;
      public class Keyboard {
          [DllImport("user32.dll")]
          public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, int dwExtraInfo);
      }
"@
      Add-Type -TypeDefinition $code -ErrorAction SilentlyContinue
      [Keyboard]::keybd_event(${vk}, 0, 0, 0)
      [Keyboard]::keybd_event(${vk}, 0, 2, 0)`;
    const tempScriptPath = path.join(os.tmpdir(), 'friday_media_control.ps1');
    fs.writeFileSync(tempScriptPath, psScript);
    runPowerShellScript(tempScriptPath, '');
    return `Media control executed (${action}).`;
  }
};
