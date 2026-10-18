/* ==========================================================================
   F.R.I.D.A.Y. // SERVER LIB — VECTOR STORE
   The local knowledge base: per-source JSONL of `{path,line,text,vector}` plus
   a manifest (`path, mtimeMs, size, hash, chunks`) that makes re-indexing
   incremental — an unchanged file is never re-read or re-embedded.

   Same rule as the scheduler: the file IS the state. There is no in-process
   cache, so a restart can never serve a stale or half-written index, and
   "editing one file re-embeds only that file" is provable across processes.

   Vectors are stored L2-normalised, so cosine similarity is a plain dot
   product. Brute force is deliberate: under ~100k chunks it beats a new
   dependency, and it keeps the index a plain file you can inspect and delete.
   ========================================================================== */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { chunkText, CHUNK_DEFAULTS } from './chunker.js';
import { normalizeVector } from './embeddings.js';

const INDEX_DIR = path.join(process.cwd(), 'data', 'index');
const SOURCES_DIR = path.join(INDEX_DIR, 'sources');
const MANIFEST_FILE = path.join(INDEX_DIR, 'manifest.json');
const MANIFEST_VERSION = 1;
const MAX_VECTOR_DIM = 8192;

export function indexDir() { return INDEX_DIR; }
export function sourcesDir() { return SOURCES_DIR; }
export function manifestPath() { return MANIFEST_FILE; }

/** Stable per-source filename — no user text ever becomes a path. */
export function sourceFilePath(absPath) {
  const key = crypto.createHash('sha1').update(String(absPath)).digest('hex').slice(0, 20);
  return path.join(SOURCES_DIR, `${key}.jsonl`);
}

export function hashText(text) {
  return crypto.createHash('sha256').update(String(text ?? ''), 'utf8').digest('hex').slice(0, 24);
}

function emptyManifest() {
  return { version: MANIFEST_VERSION, embedder: null, sources: {}, updatedAt: null };
}

export function loadManifest() {
  try {
    const parsed = JSON.parse(fs.readFileSync(MANIFEST_FILE, 'utf8'));
    return {
      version: parsed.version || MANIFEST_VERSION,
      embedder: parsed.embedder || null,
      sources: (parsed.sources && typeof parsed.sources === 'object') ? parsed.sources : {},
      updatedAt: parsed.updatedAt || null
    };
  } catch {
    return emptyManifest();
  }
}

function writeAtomic(file, contents) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, contents, 'utf8');
  fs.renameSync(tmp, file);
}

function saveManifest(manifest) {
  manifest.updatedAt = new Date().toISOString();
  writeAtomic(MANIFEST_FILE, JSON.stringify(manifest, null, 2));
}

/** Same stat and same content hash means the index is already current. */
function statMatches(entry, { mtimeMs, size }) {
  return Boolean(entry)
    && entry.size === size
    && Math.round(entry.mtimeMs) === Math.round(mtimeMs);
}

function writeSource(absPath, chunks, vectors) {
  const lines = [];
  for (let i = 0; i < chunks.length; i++) {
    const c = chunks[i];
    lines.push(JSON.stringify({
      path: absPath,
      line: c.line,
      start: c.start,
      end: c.end,
      text: c.text,
      vector: vectors[i]
    }));
  }
  writeAtomic(sourceFilePath(absPath), lines.length ? `${lines.join('\n')}\n` : '');
}

/**
 * Indexes one source's text: chunk -> embed -> persist. The manifest records
 * the text hash (the incremental key) and the embedder id (so two embedders
 * are never compared).
 *
 * @returns {Promise<{path: string, chunks: number}>}
 */
export async function indexSource({ path: absPath, text, embedder, mtimeMs = 0, size = 0, maxChars, overlapChars }) {
  const chunks = chunkText(text, {
    maxChars: maxChars ?? CHUNK_DEFAULTS.maxChars,
    overlapChars: overlapChars ?? CHUNK_DEFAULTS.overlapChars
  });
  const raw = chunks.length ? await embedder.embed(chunks.map(c => c.text)) : [];
  const vectors = raw.map(v => normalizeVector(v));
  const dim = vectors[0]?.length || 0;
  if (dim > MAX_VECTOR_DIM) throw new Error('embedding dimension out of range');
  if (vectors.some(v => v.length !== dim)) throw new Error('embedding provider returned ragged vectors');

  writeSource(absPath, chunks, vectors);

  const manifest = loadManifest();
  manifest.sources[absPath] = {
    path: absPath,
    mtimeMs: Number(mtimeMs) || 0,
    size: Number(size) || 0,
    hash: hashText(text),
    chunks: chunks.length,
    dim,
    indexedAt: new Date().toISOString()
  };
  manifest.embedder = { id: embedder.id, dim: dim || (manifest.embedder?.dim ?? null) };
  saveManifest(manifest);
  return { path: absPath, chunks: chunks.length };
}

/** Drops one source's chunks and its manifest entry. */
export function removeSource(absPath) {
  const manifest = loadManifest();
  const had = Object.prototype.hasOwnProperty.call(manifest.sources, absPath);
  delete manifest.sources[absPath];
  try { fs.rmSync(sourceFilePath(absPath), { force: true }); } catch { /* already gone */ }
  if (had) saveManifest(manifest);
  return had;
}

/** Manifest entries at or below `root`. */
export function sourcesUnder(root) {
  const base = path.resolve(root);
  const prefix = base.endsWith(path.sep) ? base : base + path.sep;
  const lower = base.toLowerCase();
  const slur = prefix.toLowerCase();
  return Object.values(loadManifest().sources).filter((entry) => {
    const p = String(entry.path || '');
    const lp = p.toLowerCase();
    return lp === lower || lp.startsWith(slur);
  });
}

/**
 * Incremental crawl. `files` is [{ path, mtimeMs, size }]; `readText(path)`
 * resolves the extracted text (or null to skip). Only files whose content hash
 * changed are re-embedded; files that vanished under `removeRoot` are dropped.
 *
 * @returns {Promise<{indexed: string[], unchanged: number, removed: number, skipped: string[]}>}
 */
export async function indexFiles({ files, embedder, readText, removeRoot = null, maxChars, overlapChars, maxFiles = 2000 }) {
  const manifest = loadManifest();
  const embedderChanged = !manifest.embedder || manifest.embedder.id !== embedder.id;

  const indexed = [];
  const skipped = [];
  let unchanged = 0;
  const seen = new Set();

  for (const file of files.slice(0, maxFiles)) {
    const absPath = file.path;
    seen.add(absPath);
    const prior = manifest.sources[absPath];

    // Fast path: the stat is identical and the embedder has not changed, so
    // the stored chunks are still current — no read, no hash, no embed.
    if (!embedderChanged && statMatches(prior, file)) {
      unchanged++;
      continue;
    }

    let text = null;
    try {
      text = await readText(absPath);
    } catch (e) {
      skipped.push(`${absPath} (${e.message})`);
      continue;
    }
    if (text === null || text === undefined) {
      skipped.push(absPath);
      continue;
    }

    const hash = hashText(text);
    if (!embedderChanged && prior && prior.hash === hash) {
      // Same content (touched or copied): refresh the stat without re-embedding.
      prior.mtimeMs = Number(file.mtimeMs) || 0;
      prior.size = Number(file.size) || 0;
      saveManifest(manifest);
      unchanged++;
      continue;
    }

    await indexSource({ path: absPath, text, embedder, mtimeMs: file.mtimeMs, size: file.size, maxChars, overlapChars });
    indexed.push(absPath);
  }

  let removed = 0;
  if (removeRoot) {
    for (const entry of sourcesUnder(removeRoot)) {
      if (!seen.has(entry.path)) { removeSource(entry.path); removed++; }
    }
  }

  return { indexed, unchanged, removed, skipped };
}

function readSourceChunks(absPath) {
  try {
    const raw = fs.readFileSync(sourceFilePath(absPath), 'utf8');
    const out = [];
    for (const line of raw.split('\n')) {
      const t = line.trim();
      if (!t) continue;
      try { out.push(JSON.parse(t)); } catch { /* torn line: ignore */ }
    }
    return out;
  } catch {
    return [];
  }
}

/**
 * Brute-force cosine search over every indexed chunk.
 * @returns {Promise<Array<{path, line, start, end, text, score}>>}
 */
export async function search({ query, embedder, topK = 8, minScore = 0 }) {
  const text = String(query || '').trim();
  if (!text) return [];
  const [queryVector] = await embedder.embed([text]);
  const q = normalizeVector(queryVector);
  if (!q.length) return [];

  const manifest = loadManifest();
  const hits = [];
  for (const entry of Object.values(manifest.sources)) {
    for (const chunk of readSourceChunks(entry.path)) {
      const v = chunk.vector;
      if (!Array.isArray(v) || v.length !== q.length) continue; // different embedder: never compare
      let dot = 0;
      for (let i = 0; i < q.length; i++) dot += q[i] * v[i];
      if (dot <= minScore) continue;
      hits.push({ path: chunk.path, line: chunk.line, start: chunk.start, end: chunk.end, text: chunk.text, score: dot });
    }
  }
  hits.sort((a, b) => b.score - a.score || String(a.path).localeCompare(String(b.path)) || a.line - b.line);
  return hits.slice(0, Math.max(1, topK));
}

/** Aggregate view for the HUD card. Read-only; never reads the chunk files. */
export function stats() {
  const manifest = loadManifest();
  const entries = Object.values(manifest.sources);
  return {
    dir: INDEX_DIR,
    embedder: manifest.embedder ? manifest.embedder.id : null,
    sources: entries.length,
    chunks: entries.reduce((n, e) => n + (Number(e.chunks) || 0), 0),
    lastIndexed: entries.reduce((latest, e) => (e.indexedAt > latest ? e.indexedAt : latest), manifest.updatedAt || null),
    updatedAt: manifest.updatedAt || null,
    top: entries
      .slice()
      .sort((a, b) => String(b.indexedAt).localeCompare(String(a.indexedAt)))
      .slice(0, 5)
      .map(e => ({ path: e.path, chunks: e.chunks, indexedAt: e.indexedAt }))
  };
}

/** Wipes the whole index (files + manifest). */
export function clearIndex() {
  try { fs.rmSync(INDEX_DIR, { recursive: true, force: true }); } catch { /* nothing to remove */ }
}
