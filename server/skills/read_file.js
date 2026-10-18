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
    // The kernel must see the resolved FILE, not just the folder: a bare
    // __readDirs check lets "..\\..\\.env" escape the read root (C1).
    const dir = resolveParent(args.parent);
    if (!dir) return { __readDirs: [String(args.parent || '')] }; // unknown parent never maps to a read root
    const fileName = String(args.fileName || '');
    return {
      __fileName: fileName,
      __readDirs: [dir],
      __targetPath: path.join(dir, fileName)
    };
  },

  execute(args, ctx, hints) {
    const full = hints.__targetPath;
    if (!full) return 'Error: no readable target.';
    const stat = fs.statSync(full);
    if (stat.size > 2_000_000) return 'Error: file is too large to read (over 2 MB).';
    const content = fs.readFileSync(full, 'utf8');
    return content.length > MAX_READ_CHARS
      ? content.slice(0, MAX_READ_CHARS) + '\n…[truncated]'
      : content;
  }
};
