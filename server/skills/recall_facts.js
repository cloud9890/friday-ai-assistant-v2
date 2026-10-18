/* ==========================================================================
   F.R.I.D.A.Y. // SKILL — RECALL FACTS (long-term memory read)
   ========================================================================== */

import { RISK, CONFIRMATION, PERMISSION } from '../security/risk.js';
import { searchFacts } from '../memory/store.js';

export default {
  name: 'recall_facts',
  description: 'Searches long-term memory for saved facts.',
  parameters: {
    type: 'object',
    properties: { query: { type: 'string' } },
    required: []
  },
  risk: RISK.SAFE,
  permissions: [PERMISSION.MEMORY_READ],
  confirmation: CONFIRMATION.NONE,
  schedulable: true,

  execute(args) {
    const facts = searchFacts(args.query).slice(0, 10);
    if (facts.length === 0) return 'I have no matching memories stored.';
    return `From my memory archives:\n${facts.map(f => `- ${f.key}: ${f.value}`).join('\n')}`;
  }
};
