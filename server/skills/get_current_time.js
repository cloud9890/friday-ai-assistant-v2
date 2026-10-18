/* ==========================================================================
   F.R.I.D.A.Y. // SKILL — CURRENT TIME
   ========================================================================== */

import { RISK, CONFIRMATION, PERMISSION } from '../security/risk.js';

export default {
  name: 'get_current_time',
  description: 'Gets the current local date and time on the computer.',
  parameters: { type: 'object', properties: {}, required: [] },
  risk: RISK.SAFE,
  permissions: [PERMISSION.READ_SYSTEM],
  confirmation: CONFIRMATION.NONE,
  schedulable: true,

  execute() {
    const now = new Date();
    return `Local date and time: ${now.toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}, ${now.toLocaleTimeString()}.`;
  }
};
