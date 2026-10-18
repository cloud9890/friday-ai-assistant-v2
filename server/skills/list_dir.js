/* ==========================================================================
   F.R.I.D.A.Y. // SKILL — LIST DIRECTORY
   ========================================================================== */

import fs from 'fs';
import { RISK, CONFIRMATION, PERMISSION } from '../security/risk.js';
import { resolveParent } from './helpers.js';

export default {
  name: 'list_dir',
  description: 'Lists an allowed folder (desktop or documents) to discover exact names.',
  parameters: {
    type: 'object',
    properties: { parent: { type: 'string', enum: ['desktop', 'documents'] } },
    required: ['parent']
  },
  risk: RISK.MEDIUM,
  permissions: [PERMISSION.READ_FILES],
  confirmation: CONFIRMATION.NONE,
  schedulable: true,

  policyHints(args) {
    const dir = resolveParent(args.parent);
    return dir ? { __readDirs: [dir] } : {};
  },

  execute(args, ctx, hints) {
    const dir = (hints.__readDirs || [])[0];
    const entries = fs.readdirSync(dir, { withFileTypes: true })
      .map(e => `${e.name}${e.isDirectory() ? '/' : ''}`);
    return entries.length === 0 ? 'The folder is empty.' : `Entries:\n${entries.join('\n')}`;
  }
};
