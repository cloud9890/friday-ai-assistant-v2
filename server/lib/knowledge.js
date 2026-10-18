/* ==========================================================================
   F.R.I.D.A.Y. // SERVER LIB — KNOWLEDGE (crawl + index + retrieve)
   The mechanics behind the KNOWLEDGEABLE phase, kept out of the skills so the
   walker and the retriever have one implementation each:

     indexFolder(root)  - walk, extract, embed incrementally (vector-store)
     searchKnowledge()  - embed the question, rank chunks, cite path:line
     resolveFolderName() - "documents" / "desktop" / "home" -> absolute path

   Every candidate path is re-checked with checkIndexPath, so a symlink, a
   traversal or a rebuilt relative path cannot walk the crawler into `data/`,
   `.git` or `node_modules` even though the kernel already vetted the root.
   ========================================================================== */

import fs from 'fs';
import path from 'path';
import { checkIndexPath } from '../security/path-policy.js';
import { homeDir, desktopDir, documentsDir } from './paths.js';
import { extractText, isExtractable } from './extract.js';
import { indexFiles, search, stats } from './vector-store.js';
import { getEmbedder, normalizeVector } from './embeddings.js';

const MAX_DEPTH = 12;
const MAX_FILES = 2000;

/** Resolves a user-facing folder name to an absolute path, or null. */
export function resolveFolderName(name) {
  const key = String(name || '').toLowerCase().trim().replace(/[\\/]+$/, '');
  if (!key) return null;
  if (key === 'desktop') return desktopDir;
  if (key === 'documents' || key === 'docs') return documentsDir;
  if (key === 'home' || key === '~' || key === 'my files') return homeDir;
  return null;
}

/**
 * Resolves an indexing target. Accepts an absolute path (validated by the
 * kernel) or a friendly root name. Returns null when nothing usable was given.
 */
export function resolveIndexTarget(raw) {
  const value = String(raw || '').trim();
  if (!value) return null;
  const named = resolveFolderName(value);
  if (named) return named;
  return path.resolve(value.replace(/^~(?=[\\/]|$)/, homeDir));
}

/**
 * Walks `root` for indexable files, skipping denied segments/dirs.
 * @returns {{files: Array<{path: string, mtimeMs: number, size: number}>, skippedDirs: number, capped: boolean}}
 */
export function walkIndexable(root) {
  const files = [];
  let skippedDirs = 0;
  let capped = false;

  const visit = (dir, depth) => {
    if (capped || depth > MAX_DEPTH) return;
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return; // unreadable directory: not fatal
    }
    for (const entry of entries) {
      if (capped) return;
      const full = path.join(dir, entry.name);
      if (!checkIndexPath(full).ok) { if (entry.isDirectory()) skippedDirs++; continue; }
      if (entry.isDirectory()) { visit(full, depth + 1); continue; }
      if (!entry.isFile()) continue; // symlinks and devices are never followed
      const ext = path.extname(entry.name).toLowerCase();
      if (!isExtractable(full) || ext === '.env') continue;
      let stat;
      try { stat = fs.statSync(full); } catch { continue; }
      files.push({ path: full, mtimeMs: stat.mtimeMs, size: stat.size });
      if (files.length >= MAX_FILES) { capped = true; return; }
    }
  };

  visit(path.resolve(root), 0);
  return { files, skippedDirs, capped };
}

/**
 * Incrementally indexes a folder. Files that vanished under the root are
 * dropped, so deleting an indexed file removes its chunks.
 *
 * @param {{root: string, embedder?: object, removeMissing?: boolean}} options
 */
export async function indexFolder({ root, embedder = null, removeMissing = true } = {}) {
  const abs = path.resolve(String(root || ''));
  const guard = checkIndexPath(abs);
  if (!guard.ok) return { ok: false, error: guard.reason };

  const stat = (() => { try { return fs.statSync(abs); } catch { return null; } })();
  if (!stat || !stat.isDirectory()) return { ok: false, error: 'not a folder' };

  const embedderInstance = embedder || await getEmbedder();
  const { files, skippedDirs, capped } = walkIndexable(abs);
  const result = await indexFiles({
    files,
    embedder: embedderInstance,
    removeRoot: removeMissing ? abs : null,
    maxFiles: MAX_FILES,
    readText: async (file) => {
      const extracted = await extractText(file);
      return extracted.ok ? extracted.text : null;
    }
  });

  return {
    ok: true,
    root: abs,
    embedder: embedderInstance.id,
    scanned: files.length,
    indexed: result.indexed.length,
    unchanged: result.unchanged,
    removed: result.removed,
    unreadable: result.skipped.length,
    skippedDirs,
    capped
  };
}

/** Ranked retrieval + citation formatting shared by the search/ask skills. */
export async function searchKnowledge({ query, topK = 6, embedder = null, filterPath = null } = {}) {
  const instance = embedder || await getEmbedder();
  const index = stats();
  // Two embedders produce vectors in different spaces: never compare them.
  const stale = Boolean(index.embedder && index.embedder !== instance.id);
  if (stale) return { hits: [], embedder: instance.id, stale: true };

  const hits = await search({ query, embedder: instance, topK: filterPath ? topK * 4 : topK });
  const filtered = filterPath
    ? hits.filter(h => h.path.toLowerCase() === String(filterPath).toLowerCase())
    : hits;
  return { hits: filtered.slice(0, topK), embedder: instance.id, stale: false };
}

/**
 * Ranks an in-memory set of chunks against a query — used by ask_my_document,
 * which answers about a single file without requiring it to be indexed.
 * @returns {Promise<Array<{path, line, start, end, text, score}>>}
 */
export async function rankChunks({ chunks, query, embedder, topK = 3, sourcePath = '' }) {
  const text = String(query || '').trim();
  if (!text || !chunks.length) return [];
  const [queryVector] = await embedder.embed([text]);
  const q = normalizeVector(queryVector);
  const vectors = await embedder.embed(chunks.map(c => c.text));

  return chunks
    .map((chunk, i) => {
      const v = normalizeVector(vectors[i] || []);
      let dot = 0;
      for (let k = 0; k < Math.min(q.length, v.length); k++) dot += q[k] * v[k];
      return { path: sourcePath || chunk.path, line: chunk.line, start: chunk.start, end: chunk.end, text: chunk.text, score: dot };
    })
    .sort((a, b) => b.score - a.score || a.line - b.line)
    .slice(0, Math.max(1, topK));
}


export function knowledgeStats() {
  return stats();
}

/** `path:line` citation plus a short excerpt — the done-criterion for Phase B. */
export function formatHit(hit, maxChars = 320) {
  const text = String(hit.text || '').replace(/\s+/g, ' ').trim();
  const excerpt = text.length > maxChars ? `${text.slice(0, maxChars)}…` : text;
  return `${hit.path}:${hit.line}  (score ${hit.score.toFixed(3)})\n    ${excerpt}`;
}
