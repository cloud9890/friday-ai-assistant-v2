/* ==========================================================================
   F.R.I.D.A.Y. // SKILL — ORGANIZE FILES (Phase C tail)
   Sorts the loose files in a Desktop/Documents folder into category
   subfolders (Images, Documents, Audio, ...).

   The plan (every from -> to pair) is computed in policyHints and certified by
   the kernel's MOVE_FILES branch BEFORE anything runs; execute applies exactly
   that plan and never re-derives it, so the model can never move a file the
   policy has not seen. Confirmation is always required — this is a bulk rename
   of the user's own workspace.
   ========================================================================== */

import fs from 'fs';
import path from 'path';
import { RISK, CONFIRMATION, PERMISSION } from '../security/risk.js';
import { checkFileName } from '../security/path-policy.js';
import { resolveParent } from './helpers.js';
import { readEntries, planMoves, summarize } from '../lib/organizer.js';

/** Resolves the folder to organise, or null when the name is not safe. */
function resolveFolder(args) {
  const base = resolveParent(args.parent);
  if (!base) return null;
  const name = String(args.folder || '').trim();
  if (!name) return base;
  if (!checkFileName(name).ok) return null;
  return path.join(base, name);
}

export default {
  name: 'organize_files',
  description: 'Tidies a Desktop or Documents folder by moving its loose files into category subfolders (Images, Documents, Spreadsheets, Presentations, Audio, Video, Archives, Code, Other). Optionally restrict to one subfolder with "folder". Boss is asked to approve the plan first.',
  parameters: {
    type: 'object',
    properties: {
      parent: { type: 'string', enum: ['desktop', 'documents'], description: 'Which top-level folder to tidy' },
      folder: { type: 'string', description: 'Optional subfolder name inside the parent (a bare name, no path)' }
    },
    required: ['parent']
  },
  risk: RISK.HIGH,
  permissions: [PERMISSION.MOVE_FILES],
  confirmation: CONFIRMATION.ALWAYS,

  policyHints(args) {
    const root = resolveFolder(args);
    // An unresolvable or unsafe folder yields no plan: the kernel then denies
    // with "no move plan was provided" rather than the executor guessing.
    if (!root) return {};
    const plan = planMoves({ root, entries: readEntries(root) });
    return { __targetPath: root, __readDirs: [root], __moves: plan.moves, __plan: plan };
  },

  describe(args) {
    const where = String(args.folder || '').trim()
      ? `${String(args.parent || 'desktop').toUpperCase()}\\${String(args.folder).trim()}`
      : String(args.parent || 'desktop').toUpperCase();
    return `Sort the loose files in ${where} into category folders (Images, Documents, Audio, ...).`;
  },

  execute(args, ctx, hints) {
    const plan = hints.__plan;
    if (!plan || !Array.isArray(plan.moves)) return 'Error: no certified plan was supplied.';
    if (plan.moves.length === 0) return 'Nothing to organize there — I found no loose files, Boss.';

    const created = new Set();
    let moved = 0;
    const failures = [];

    for (const move of plan.moves) {
      try {
        const dir = path.dirname(move.to);
        if (!created.has(dir)) { fs.mkdirSync(dir, { recursive: true }); created.add(dir); }
        fs.renameSync(move.from, move.to);
        moved += 1;
      } catch (e) {
        failures.push(`${path.basename(move.from)}: ${e.message}`);
      }
    }

    const parts = [`Organized ${moved} file${moved === 1 ? '' : 's'} in ${plan.root}.`];
    const buckets = summarize(plan).map(([category, n]) => `${n} into ${category}`).join(', ');
    if (buckets) parts.push(buckets + '.');
    if (failures.length) {
      parts.push(`${failures.length} could not be moved (${failures.slice(0, 3).join('; ')}).`);
    }
    return parts.join(' ');
  }
};
