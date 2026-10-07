/* ==========================================================================
   F.R.I.D.A.Y. // SKILL — OPEN DESKTOP APP
   ========================================================================== */

import { RISK, CONFIRMATION, PERMISSION } from '../security/risk.js';
import { launchInInteractiveSession } from '../lib/app-launcher.js';

export default {
  name: 'open_desktop_app',
  description: 'Launches a local Windows desktop app or any installed Start Menu app.',
  parameters: {
    type: 'object',
    properties: { appName: { type: 'string' } },
    required: ['appName']
  },
  risk: RISK.HIGH,
  permissions: [PERMISSION.LAUNCH_PROCESS],
  confirmation: CONFIRMATION.NONE,

  execute(args) {
    const target = args.__resolvedApp || args.appName;
    return launchInInteractiveSession(target).then((ok) => ok
      ? `Launched ${args.appName} on the desktop.`
      : `Error: app '${args.appName}' could not be launched. If it is a web app, use search_web_app instead.`);
  }
};
