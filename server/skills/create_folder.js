/* ==========================================================================
   F.R.I.D.A.Y. // SKILL — CREATE FOLDER
   ========================================================================== */

import fs from 'fs';
import path from 'path';
import { RISK, CONFIRMATION, PERMISSION } from '../security/risk.js';
import { resolveParent } from './helpers.js';

export default {
  name: 'create_folder',
  description: 'Creates a folder on the Desktop or in Documents.',
  parameters: {
    type: 'object',
    properties: {
      name: { type: 'string' },
      parent: { type: 'string', enum: ['desktop', 'documents'] }
    },
    required: ['name', 'parent']
  },
  risk: RISK.HIGH,
  permissions: [PERMISSION.WRITE_FILES],
  confirmation: CONFIRMATION.NONE,

  policyHints(args) {
    const dir = resolveParent(args.parent);
    return dir ? { __targetPath: path.join(dir, String(args.name || '')) } : {};
  },

  describe(args) {
    return `Create folder "${args.name}" in ${String(args.parent || 'desktop').toUpperCase()}.`;
  },

  execute(args, ctx, hints) {
    fs.mkdirSync(hints.__targetPath, { recursive: true });
    return `Created folder ${hints.__targetPath}.`;
  }
};
