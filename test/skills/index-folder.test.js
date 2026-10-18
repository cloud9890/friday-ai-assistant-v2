/* Index folder + search knowledge end to end, with an injected embedder so no
   test touches the network. Proves the Phase B done-criterion: a question about
   the user's own files comes back with `path:line` citations, and the crawler
   neither follows nor ingests denied segments. */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { homeDir } from '../../server/lib/paths.js';
import { createLocalEmbedder, setEmbedder, resetEmbedder } from '../../server/lib/embeddings.js';

const storeScratch = fs.mkdtempSync(path.join(os.tmpdir(), 'friday-kb-store-'));
process.chdir(storeScratch);

const { policyHints, executeSkill } = await import('../../server/skills/registry.js');
const { walkIndexable, rankChunks } = await import('../../server/lib/knowledge.js');
const { stats, clearIndex } = await import('../../server/lib/vector-store.js');

// A folder the policy will accept, created outside the repo's own data/.
const root = fs.mkdtempSync(path.join(homeDir, '.friday-kb-test-'));
const sub = path.join(root, 'projects');
const denied = path.join(root, 'node_modules');
fs.mkdirSync(sub);
fs.mkdirSync(denied);

fs.writeFileSync(path.join(root, 'notes.md'), '# Budget\n\nThe quarterly travel budget was approved with a five percent increase.\n');
fs.writeFileSync(path.join(sub, 'plan.md'), '# Plan\n\nFlights to Tokyo were booked for March, then the hotel.\n');
fs.writeFileSync(path.join(root, 'image.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00]));
fs.writeFileSync(path.join(denied, 'secret.md'), 'dependency source must never be indexed');
fs.writeFileSync(path.join(root, '.env'), 'OPENROUTER_API_KEY=sk-should-never-be-indexed');

setEmbedder(createLocalEmbedder({ dim: 64 }));

after(() => {
  resetEmbedder();
  fs.rmSync(root, { recursive: true, force: true });
  process.chdir(os.tmpdir());
  fs.rmSync(storeScratch, { recursive: true, force: true });
});

async function run(name, args) {
  const hints = policyHints(name, args);
  return executeSkill(name, args, hints, {});
}

test('the crawler skips denied segments, images and .env', () => {
  const { files } = walkIndexable(root);
  const names = files.map(f => path.basename(f.path)).sort();
  assert.deepEqual(names, ['notes.md', 'plan.md']);
});

test('index_folder indexes the folder and reports a summary', async () => {
  const reply = await run('index_folder', { path: root });
  assert.match(reply, /Knowledge index updated/);
  assert.match(reply, /2 indexed/);

  const s = stats();
  assert.equal(s.sources, 2);
  assert.ok(s.chunks >= 2);
});

test('search_knowledge answers with path:line citations', async () => {
  const reply = await run('search_knowledge', { query: 'travel budget increase' });
  assert.match(reply, /notes\.md:\d+/);
  assert.match(reply, /budget/i);
});

test('re-indexing is incremental (nothing re-embedded when nothing changed)', async () => {
  const reply = await run('index_folder', { path: root });
  assert.match(reply, /0 indexed, 2 unchanged/);
});

test('rankChunks cites a single document without requiring an index', async () => {
  const chunks = [
    { index: 0, start: 0, end: 30, line: 1, text: '# Budget\n\nQuarterly travel budget' },
    { index: 1, start: 30, end: 60, line: 3, text: 'Rust crate compile steps' }
  ];
  const hits = await rankChunks({ chunks, query: 'travel budget', embedder: createLocalEmbedder({ dim: 64 }), topK: 1, sourcePath: 'Z:\\doc.md' });
  assert.equal(hits.length, 1);
  assert.equal(hits[0].path, 'Z:\\doc.md');
  assert.equal(hits[0].line, 1);
});

test('searching before anything is indexed is honest about it', async () => {
  clearIndex();
  const reply = await run('search_knowledge', { query: 'anything at all' });
  assert.match(reply, /index is empty/i);
});
