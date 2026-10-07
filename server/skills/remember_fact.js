/* ==========================================================================
   F.R.I.D.A.Y. // SKILL — REMEMBER FACT (long-term memory write)
   ========================================================================== */

import { RISK, CONFIRMATION, PERMISSION } from '../security/risk.js';
import { saveFact } from '../memory/store.js';

export default {
  name: 'remember_fact',
  description: 'Saves a durable fact or preference to long-term memory.',
  parameters: {
    type: 'object',
    properties: {
      key: { type: 'string' },
      value: { type: 'string' }
    },
    required: ['key', 'value']
  },
  risk: RISK.LOW,
  permissions: [PERMISSION.MEMORY_WRITE],
  confirmation: CONFIRMATION.NONE,

  execute(args) {
    const ok = saveFact(args.key, args.value);
    return ok
      ? `Committed "${args.key}" to long-term memory.`
      : 'Error: both key and value are required to remember something.';
  }
};
