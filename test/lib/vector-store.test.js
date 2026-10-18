/* Vector store: per-source JSONL + manifest, incremental re-indexing.
   The done-criterion for Phase B is proven here without a network: touching
   one file re-embeds only that file, and deleting an indexed file drops its
   chunks. Each test file runs in its own process, so the chdir below pins the
   index under a scratch directory (same trick as the scheduler test). */
import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createLocalEmbedder } from '../../server/lib/embeddings.js';

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'friday-index-'));
process.chdir(scratch);

const {
  indexSource, indexFiles, search, removeSource, sourcesUnder, stats,
  loadManifest, manifestPath, sourceFilePath, indexDir, sourcesDir, clearIndex
} = await import('../../server/lib/vector-store.js');

const embedder = createLocalEmbedder({ dim: 64 });

/** Counts what was actually embedded — the proof of incremental work. */
function countingEmbedder() {
  const seen = [];
  return {
    id: embedder.id, // transparent: same embedder, just observed
    dim: embedder.dim,
    seen,
    async embed(texts) {
      seen.push(...texts);
      return embedder.embed(texts);
    }
  };
}

function writeFile(name, contents) {
  const full = path.join(scratch, name);
  fs.writeFileSync(full, contents, 'utf8');
  return { path: full, mtimeMs: fs.statSync(full).mtimeMs, size: fs.statSync(full).size };
}

const readText = async (file) => fs.readFileSync(file, 'utf8');

beforeEach(() => {
  clearIndex();
});

after(() => {
  process.chdir(os.tmpdir());
  fs.rmSync(scratch, { recursive: true, force: true });
});

test('indexSource writes chunks to JSONL and records the manifest', async () => {
  const file = writeFile('a.md', '# Notes\n\nThe budget is five percent higher.');
  await indexSource({ path: file.path, text: fs.readFileSync(file.path, 'utf8'), embedder, mtimeMs: file.mtimeMs, size: file.size });

  const lines = fs.readFileSync(sourceFilePath(file.path), 'utf8').trim().split('\n');
  assert.ok(lines.length >= 1);
  const record = JSON.parse(lines[0]);
  assert.equal(record.path, file.path);
  assert.equal(record.line, 1);
  assert.equal(record.vector.length, 64);

  const manifest = loadManifest();
  assert.equal(manifest.embedder.id, 'local-hash-v1');
  assert.equal(manifest.sources[file.path].chunks, lines.length);
  assert.ok(fs.existsSync(manifestPath()));
  assert.ok(sourceFilePath(file.path).startsWith(sourcesDir()), 'chunks live under data/index/sources');
  assert.ok(manifestPath().startsWith(indexDir()), 'the manifest lives under data/index');
});

test('search ranks the passage that shares the topic', async () => {
  const a = writeFile('travel.md', 'Flights to Tokyo were booked for the quarterly travel budget.');
  const b = writeFile('rust.md', 'Compile the rust crate then run the cargo test suite.');
  await indexSource({ path: a.path, text: fs.readFileSync(a.path, 'utf8'), embedder, mtimeMs: a.mtimeMs, size: a.size });
  await indexSource({ path: b.path, text: fs.readFileSync(b.path, 'utf8'), embedder, mtimeMs: b.mtimeMs, size: b.size });

  const hits = await search({ query: 'travel budget and flights', embedder, topK: 5 });
  assert.ok(hits.length >= 1);
  assert.equal(hits[0].path, a.path);
  assert.equal(typeof hits[0].line, 'number');
  assert.ok(hits[0].score > 0);
});

test('search never compares vectors from a different embedder', async () => {
  const a = writeFile('a.md', 'the budget for travel');
  await indexSource({ path: a.path, text: fs.readFileSync(a.path, 'utf8'), embedder, mtimeMs: a.mtimeMs, size: a.size });
  const other = createLocalEmbedder({ dim: 32 }); // same id space, different dim
  const hits = await search({ query: 'budget', embedder: other, topK: 5 });
  assert.deepEqual(hits, []);
});

test('re-indexing an unchanged folder reads and embeds nothing', async () => {
  const a = writeFile('a.md', '# A\n\nAlpha content about the budget.');
  const b = writeFile('b.md', '# B\n\nBeta content about travel.');

  const first = countingEmbedder();
  const one = await indexFiles({ files: [a, b], embedder: first, readText });
  assert.deepEqual(one.indexed.slice().sort(), [a.path, b.path].sort());
  assert.ok(first.seen.length >= 2);

  const second = countingEmbedder();
  const two = await indexFiles({ files: [a, b], embedder: second, readText });
  assert.equal(two.indexed.length, 0);
  assert.equal(two.unchanged, 2);
  assert.deepEqual(second.seen, [], 'nothing may be embedded when nothing changed');
});

test('editing one file re-embeds only that file', async () => {
  const a = writeFile('a.md', 'Alpha content about the budget.');
  const b = writeFile('b.md', 'Beta content about travel.');
  await indexFiles({ files: [a, b], embedder, readText });

  const edited = writeFile('a.md', 'Alpha content about the budget, now revised with detail.');
  const counter = countingEmbedder();
  const result = await indexFiles({ files: [edited, b], embedder: counter, readText });

  assert.deepEqual(result.indexed, [a.path]);
  assert.ok(counter.seen.length >= 1);
  assert.ok(counter.seen.every(t => t.includes('revised') || t.includes('Alpha')));
});

test('a touched-but-identical file refreshes its stat without re-embedding', async () => {
  const a = writeFile('a.md', 'Unchanged content, same bytes.');
  await indexFiles({ files: [a], embedder, readText });

  const touched = { ...a, mtimeMs: a.mtimeMs + 5000 };
  const counter = countingEmbedder();
  const result = await indexFiles({ files: [touched], embedder: counter, readText });

  assert.equal(result.indexed.length, 0);
  assert.equal(result.unchanged, 1);
  assert.deepEqual(counter.seen, []);
});

test('deleting an indexed file drops its chunks', async () => {
  const a = writeFile('a.md', 'Alpha about the budget.');
  const b = writeFile('b.md', 'Beta about travel.');
  await indexFiles({ files: [a, b], embedder, readText });
  assert.equal(sourcesUnder(scratch).length, 2);

  fs.rmSync(b.path);
  const result = await indexFiles({ files: [a], embedder, readText, removeRoot: scratch });

  assert.equal(result.removed, 1);
  assert.equal(loadManifest().sources[b.path], undefined);
  assert.equal(fs.existsSync(sourceFilePath(b.path)), false);
  const hits = await search({ query: 'travel', embedder, topK: 5 });
  assert.ok(hits.every(h => h.path !== b.path));
});

test('switching embedder rebuilds every source', async () => {
  const a = writeFile('a.md', 'Alpha about the budget.');
  await indexFiles({ files: [a], embedder, readText });

  const base = createLocalEmbedder({ dim: 32 });
  const seen = [];
  const counter = { id: 'other-embed', dim: 32, async embed(t) { seen.push(...t); return base.embed(t); } };
  const result = await indexFiles({ files: [a], embedder: counter, readText });

  assert.deepEqual(result.indexed, [a.path]);
  assert.equal(seen.length >= 1, true);
  assert.equal(loadManifest().embedder.id, 'other-embed');
});

test('stats and removeSource agree with the manifest; torn lines are ignored', async () => {
  const a = writeFile('a.md', '# A\n\nAlpha about the budget.');
  await indexFiles({ files: [a], embedder, readText });

  const s = stats();
  assert.equal(s.sources, 1);
  assert.equal(s.chunks >= 1, true);
  assert.equal(s.embedder, 'local-hash-v1');

  fs.appendFileSync(sourceFilePath(a.path), '{ this is not json }\n');
  const hits = await search({ query: 'budget', embedder, topK: 5 });
  assert.ok(hits.length >= 1, 'a torn trailing line must not lose earlier chunks');

  assert.equal(removeSource(a.path), true);
  assert.equal(stats().sources, 0);
  assert.equal(removeSource(a.path), false);
});

test('a bad embedder payload is rejected before anything is written', async () => {
  const a = writeFile('a.md', 'Alpha about the budget.');
  const broken = { id: 'broken', dim: 64, embed: async () => [[1, 2], [1, 2, 3]] };
  await assert.rejects(
    () => indexSource({ path: a.path, text: fs.readFileSync(a.path, 'utf8'), embedder: broken, mtimeMs: a.mtimeMs, size: a.size }),
    /ragged/
  );
  assert.equal(fs.existsSync(indexDir()) && fs.existsSync(manifestPath()), false);
});
