/* ==========================================================================
   F.R.I.D.A.Y. // SKILL — WRITE FILE
   ========================================================================== */

import fs from 'fs';
import path from 'path';
import { RISK, CONFIRMATION, PERMISSION } from '../security/risk.js';
import { resolveParent } from './helpers.js';

const MAX_WRITE_CHARS = 200000;

export default {
  name: 'write_file',
  description: 'Writes a .txt/.md file on the Desktop or in Documents.',
  parameters: {
    type: 'object',
    properties: {
      fileName: { type: 'string' },
      content: { type: 'string' },
      parent: { type: 'string', enum: ['desktop', 'documents'] }
    },
    required: ['fileName', 'content', 'parent']
  },
  risk: RISK.HIGH,
  permissions: [PERMISSION.WRITE_FILES],
  confirmation: CONFIRMATION.NONE,

  policyHints(args) {
    const dir = resolveParent(args.parent);
    return dir ? { __fileName: args.fileName, __targetPath: path.join(dir, String(args.fileName || '')) } : {};
  },

  describe(args) {
    return `Write file "${args.fileName}" to ${String(args.parent || 'desktop').toUpperCase()}.`;
  },

  execute(args, ctx, hints) {
    let full = hints.__targetPath;
    if (!/\.(txt|md)$/i.test(full)) full += '.txt';
    fs.writeFileSync(full, String(args.content || '').slice(0, MAX_WRITE_CHARS), 'utf8');
    return `Saved ${full}.`;
  }
};
