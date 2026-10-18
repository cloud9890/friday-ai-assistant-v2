/* ==========================================================================
   F.R.I.D.A.Y. // SKILL — SEARCH KNOWLEDGE (Phase B: KNOWLEDGEABLE)
   Answers "what did I write about X?" from the local index, always with a
   `path:line` citation and a short excerpt so the user can verify the claim.

   Retrieved file text is UNTRUSTED: the agent loop wraps this result in the
   <<<UNTRUSTED_TOOL_OUTPUT>>> markers, exactly like DOM text (C4).
   ========================================================================== */

import { RISK, CONFIRMATION, PERMISSION } from '../security/risk.js';
import { searchKnowledge, formatHit, knowledgeStats } from '../lib/knowledge.js';

export default {
  name: 'search_knowledge',
  description: 'Searches the locally indexed documents and notes for a topic and returns the best matching passages with file and line citations. Use it for questions about the user\'s own files ("what did I write about the budget?"). If nothing is found, the folder has probably not been indexed yet — offer to run index_folder.',
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string' },
      topK: { type: 'number' }
    },
    required: ['query']
  },
  risk: RISK.MEDIUM,
  permissions: [PERMISSION.INDEX_READ],
  confirmation: CONFIRMATION.NONE,
  schedulable: true,

  async execute(args) {
    const query = String(args.query || '').trim();
    if (!query) return 'Error: no query was given.';

    const index = knowledgeStats();
    if (index.sources === 0) {
      return 'The knowledge index is empty. Ask me to index a folder first (for example "index my documents").';
    }

    const topK = Number.isFinite(args.topK) ? Math.max(1, Math.min(12, Math.round(args.topK))) : 6;
    const { hits, embedder, stale } = await searchKnowledge({ query, topK });

    if (stale) {
      return `The index was built with a different embedding model (${index.embedder}) than the one now configured (${embedder}), so I cannot compare them. Re-run index_folder to rebuild it.`;
    }
    if (!hits.length) return `Nothing in the ${index.sources} indexed file(s) matches "${query}".`;

    const lines = hits.map((h, i) => `${i + 1}. ${formatHit(h)}`);
    return `${hits.length} matching passage(s) for "${query}" (from ${index.chunks} indexed chunks):\n${lines.join('\n')}`;
  },

  describe(args) {
    return `Search the indexed knowledge for "${args.query}".`;
  }
};
