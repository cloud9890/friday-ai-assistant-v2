/* ==========================================================================
   F.R.I.D.A.Y. // SKILL — INDEX FOLDER (Phase B: KNOWLEDGEABLE)
   Adds a folder's documents to the local knowledge base so the user can later
   ask "what did I write about X?" and get `path:line` citations.

   The kernel certifies the folder (INDEX_READ) before this runs, and the
   crawler re-checks every path it touches, so a traversal or a denied segment
   (data/, .git, node_modules) can never be ingested.
   ========================================================================== */

import { RISK, CONFIRMATION, PERMISSION } from '../security/risk.js';
import { resolveIndexTarget, indexFolder } from '../lib/knowledge.js';

export default {
  name: 'index_folder',
  description: 'Indexes a folder of documents into the local knowledge base so it can be searched or asked questions about ("index my documents", "index my files"). Re-running is incremental: only new or changed files are re-read. Accepts "documents", "desktop", "home", or a folder path; defaults to Documents.',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string' }
    },
    required: []
  },
  risk: RISK.MEDIUM,
  permissions: [PERMISSION.INDEX_READ],
  confirmation: CONFIRMATION.NONE,

  policyHints(args) {
    // The kernel must see the resolved folder, never the raw model string —
    // an unresolved name is passed through so it can only fail closed.
    const target = resolveIndexTarget(args.path || 'documents');
    if (!target) return { __readDirs: [String(args.path || '')] };
    return { __targetPath: target, __readDirs: [target] };
  },

  async execute(args, ctx, hints) {
    const root = hints.__targetPath;
    if (!root) return 'Error: no indexable folder was resolved.';
    const summary = await indexFolder({ root });
    if (!summary.ok) return `I could not index that folder: ${summary.error}.`;
    const capped = summary.capped ? ' I stopped at 2000 files — ask me to index a narrower folder if you need more.' : '';
    return `Knowledge index updated for ${summary.root} using ${summary.embedder}: ${summary.indexed} indexed, ${summary.unchanged} unchanged, ${summary.removed} removed (${summary.scanned} files scanned).${capped}`;
  },

  describe(args) {
    return `Index the folder ${args.path || 'documents'} into the knowledge base.`;
  }
};
