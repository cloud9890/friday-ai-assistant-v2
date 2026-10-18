/* ==========================================================================
   F.R.I.D.A.Y. // SERVER LIB — ORGANIZER (Phase C tail)
   Turns a folder listing into a DETERMINISTIC move plan: every loose file is
   bucketed into a category subfolder (Images, Documents, Audio, ...).

   Why a library and not just the skill: the kernel has to certify the exact
   pairs before anything moves, so the plan is computed once (as a policy hint)
   and the executor applies exactly that plan. The bucketing itself is pure
   given the entries, so it is unit-testable without touching the disk.
   ========================================================================== */

import fs from 'fs';
import path from 'path';

/** Extension -> category. Unknown or missing extensions land in "Other". */
const CATEGORY_BY_EXT = {
  Images: ['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp', '.svg', '.tif', '.tiff', '.heic', '.ico', '.raw'],
  Documents: ['.txt', '.md', '.pdf', '.doc', '.docx', '.rtf', '.odt', '.pages', '.epub', '.tex', '.log'],
  Spreadsheets: ['.csv', '.tsv', '.xls', '.xlsx', '.ods', '.numbers'],
  Presentations: ['.ppt', '.pptx', '.odp', '.key'],
  Audio: ['.mp3', '.wav', '.m4a', '.flac', '.aac', '.ogg', '.wma', '.mid'],
  Video: ['.mp4', '.mov', '.avi', '.mkv', '.wmv', '.webm', '.flv', '.m4v'],
  Archives: ['.zip', '.rar', '.7z', '.tar', '.gz', '.bz2', '.xz', '.iso'],
  Code: [
    '.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx', '.py', '.rb', '.go', '.rs', '.java', '.c', '.h',
    '.cpp', '.cs', '.php', '.sh', '.ps1', '.html', '.css', '.json', '.yml', '.yaml', '.xml', '.sql',
    '.ipynb', '.swift', '.kt'
  ]
};

const OTHER = 'Other';
const EXT_TO_CATEGORY = new Map();
for (const [category, extensions] of Object.entries(CATEGORY_BY_EXT)) {
  for (const ext of extensions) EXT_TO_CATEGORY.set(ext, category);
}

/** The category folder a file name belongs in. */
export function categoryFor(name) {
  const ext = path.extname(String(name || '')).toLowerCase();
  return EXT_TO_CATEGORY.get(ext) || OTHER;
}

/** Every category name this planner can produce (handy for tests + docs). */
export function categories() {
  return [...Object.keys(CATEGORY_BY_EXT), OTHER];
}

/**
 * Lists a folder's immediate entries. Any read error is reported as "no
 * entries" so a missing or unreadable folder simply has nothing to organise.
 * @returns {Array<{name: string, isDir: boolean}>}
 */
export function readEntries(root) {
  try {
    return fs.readdirSync(root, { withFileTypes: true })
      .map(entry => ({ name: entry.name, isDir: entry.isDirectory() }));
  } catch {
    return [];
  }
}

/** A collision-free destination inside `dir`, honouring earlier plan entries. */
function freePath(dir, name, reserved, exists) {
  const ext = path.extname(name);
  const base = ext ? name.slice(0, -ext.length) : name;
  let candidate = path.join(dir, name);
  let n = 2;
  while (reserved.has(candidate.toLowerCase()) || (exists && exists(candidate))) {
    candidate = path.join(dir, `${base} (${n})${ext}`);
    n += 1;
    if (n > 500) break;
  }
  return candidate;
}

/**
 * Builds the move plan for one folder.
 *
 * @param {{
 *   root: string,
 *   entries: Array<{name: string, isDir: boolean}>,
 *   max?: number,
 *   exists?: (candidate: string) => boolean  // injectable for tests
 * }} params
 * @returns {{root: string, moves: Array<{from: string, to: string, category: string}>,
 *            skipped: number, capped: boolean}}
 */
export function planMoves({ root, entries = [], max = 200, exists = fs.existsSync } = {}) {
  const moves = [];
  const reserved = new Set();
  let skipped = 0;
  let capped = false;

  const ordered = [...entries].sort((a, b) => String(a?.name || '').localeCompare(String(b?.name || '')));

  for (const entry of ordered) {
    const name = String(entry?.name || '');
    if (!name || entry?.isDir || name.startsWith('.')) { skipped += 1; continue; }
    if (moves.length >= max) { capped = true; break; }

    const category = categoryFor(name);
    const dir = path.join(root, category);
    const to = freePath(dir, name, reserved, exists);
    reserved.add(to.toLowerCase());
    moves.push({ from: path.join(root, name), to, category });
  }

  return { root, moves, skipped, capped };
}

/** Counts moves per category, biggest bucket first. */
export function summarize(plan) {
  const counts = new Map();
  for (const move of plan?.moves || []) {
    counts.set(move.category, (counts.get(move.category) || 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}
