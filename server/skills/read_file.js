/* ==========================================================================
   F.R.I.D.A.Y. // SKILL — READ FILE
   ========================================================================== */

import fs from 'fs';
import path from 'path';
import { RISK, CONFIRMATION, PERMISSION } from '../security/risk.js';
import { resolveParent } from './helpers.js';

const MAX_READ_CHARS = 20000;

export default {
  name: 'read_file',
  description: 'Reads a text file from Desktop or Documents.',
  parameters: {
    type: 'object',
    properties: {
      fileName: { type: 'string' },
      parent: { type: 'string', enum: ['desktop', 'documents'] }
    },
    required: ['fileName', 'parent']
  },
  risk: RISK.MEDIUM,
  permissions: [PERMISSION.READ_FILES],
  confirmation: CONFIRMATION.NONE,

  policyHints(args) {
    const dir = resolveParent(args.parent);
    return dir ? { __readDirs: [dir] } : {};
  },

  execute(args, ctx, hints) {
    const dir = (hints.__readDirs || [])[0];
    const full = path.join(dir, String(args.fileName || ''));
    const stat = fs.statSync(full);
    if (stat.size > 2_000_000) return 'Error: file is too large to read (over 2 MB).';
    const content = fs.readFileSync(full, 'utf8');
    return content.length > MAX_READ_CHARS
      ? content.slice(0, MAX_READ_CHARS) + '\n…[truncated]'
      : content;
  }
};
