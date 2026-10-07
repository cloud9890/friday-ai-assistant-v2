/* ==========================================================================
   F.R.I.D.A.Y. // SKILL — FORGET FACT (long-term memory delete)
   ========================================================================== */

import { RISK, CONFIRMATION, PERMISSION } from '../security/risk.js';
import { deleteFact } from '../memory/store.js';

export default {
  name: 'forget_fact',
  description: 'Deletes one saved fact from long-term memory.',
  parameters: {
    type: 'object',
    properties: { key: { type: 'string' } },
    required: ['key']
  },
  risk: RISK.LOW,
  permissions: [PERMISSION.MEMORY_WRITE],
  confirmation: CONFIRMATION.NONE,

  execute(args) {
    const removed = deleteFact(args.key);
    return removed
      ? `Erased "${args.key}" from my memory.`
      : `I have no memory under "${args.key}" — use recall_facts to see what is stored.`;
  }
};
