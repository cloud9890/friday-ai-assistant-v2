/* ==========================================================================
   F.R.I.D.A.Y. // SKILL — SEARCH LOCAL FILES
   ========================================================================== */

import fs from 'fs';
import path from 'path';
import { RISK, CONFIRMATION, PERMISSION } from '../security/risk.js';
import { desktopDir, documentsDir, homeDir } from '../lib/paths.js';

function searchLocalFiles(query, dirs) {
  const matches = [];
  const cleanQ = query.toLowerCase();
  for (const dir of dirs) {
    try {
      if (!fs.existsSync(dir)) continue;
      for (const f of fs.readdirSync(dir)) {
        if (f.toLowerCase().includes(cleanQ)) {
          const fullPath = path.join(dir, f);
          const stat = fs.statSync(fullPath);
          matches.push({ name: f, path: fullPath, isDir: stat.isDirectory() });
          if (matches.length >= 15) return matches;
        }
      }
    } catch (e) { /* unreadable dir: skip */ }
  }
  return matches;
}

export default {
  name: 'search_local_files',
  description: 'Searches Desktop and Documents for files matching a query.',
  parameters: {
    type: 'object',
    properties: { query: { type: 'string' } },
    required: ['query']
  },
  risk: RISK.MEDIUM,
  permissions: [PERMISSION.READ_FILES],
  confirmation: CONFIRMATION.NONE,
  schedulable: true,

  policyHints() {
    // Kernel validates every read dir before this skill runs.
    return { __readDirs: [desktopDir, documentsDir, homeDir] };
  },

  execute(args, ctx, hints) {
    const matches = searchLocalFiles(args.query, hints.__readDirs);
    if (matches.length === 0) return `No files matching "${args.query}" were found on the system.`;
    return `Found ${matches.length} matching entries: ${matches.map(m => `${m.name}${m.isDir ? '/' : ''}`).join(', ')}.`;
  }
};
