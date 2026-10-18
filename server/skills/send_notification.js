/* ==========================================================================
   F.R.I.D.A.Y. // SKILL — SEND NOTIFICATION
   A one-off alert (native Windows toast + HUD + spoken line) for the moments
   that are not worth a scheduled job, e.g. a long task finishing.
   ========================================================================== */

import { RISK, CONFIRMATION, PERMISSION } from '../security/risk.js';
import { notify } from '../lib/notify.js';

export default {
  name: 'send_notification',
  description: 'Sends the user an immediate notification (a Windows toast plus a spoken line). Use it to surface something important that cannot wait for the reply, not for ordinary answers.',
  parameters: {
    type: 'object',
    properties: {
      message: { type: 'string' },
      title: { type: 'string' }
    },
    required: ['message']
  },
  risk: RISK.LOW,
  permissions: [PERMISSION.NOTIFY],
  confirmation: CONFIRMATION.NONE,

  execute(args) {
    const item = notify({ title: args.title || 'F.R.I.D.A.Y.', body: args.message });
    return `Notification sent: ${item.body}`;
  }
};
