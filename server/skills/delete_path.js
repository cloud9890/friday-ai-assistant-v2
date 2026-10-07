/* ==========================================================================
   F.R.I.D.A.Y. // SKILL — DELETE PATH (confirmation required)
   ========================================================================== */

import fs from 'fs';
import path from 'path';
import { RISK, CONFIRMATION, PERMISSION } from '../security/risk.js';
import { resolveParent } from './helpers.js';

export default {
  name: 'delete_path',
  description: 'PERMANENTLY deletes a Desktop/Documents file or folder; confirmation is handled automatically. list_dir first.',
  parameters: {
    type: 'object',
    properties: {
      name: { type: 'string' },
      parent: { type: 'string', enum: ['desktop', 'documents'] }
    },
    required: ['name', 'parent']
  },
  risk: RISK.HIGH,
  permissions: [PERMISSION.DELETE_FILES],
  confirmation: CONFIRMATION.ALWAYS,

  policyHints(args) {
    const dir = resolveParent(args.parent);
    return dir ? { __targetPath: path.join(dir, String(args.name || '')) } : {};
  },

  describe(args) {
    return `Permanently delete "${args.name}" from ${String(args.parent || 'desktop').toUpperCase()} (recursive, cannot be undone).`;
  },

  execute(args, ctx, hints) {
    fs.rmSync(hints.__targetPath, { recursive: true, force: false });
    return `Deleted ${hints.__targetPath}.`;
  }
};
