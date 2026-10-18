/* Embeddings: the local embedder is deterministic and lexical; the Ollama
   backend is exercised with a fake fetch so no test ever touches the network. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createLocalEmbedder, createOllamaEmbedder, resolveEmbedder,
  normalizeVector, LOCAL_EMBEDDER_ID, LOCAL_EMBED_DIM
} from '../../server/lib/embeddings.js';

function cosine(a, b) {
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  return dot;
}

test('the local embedder is deterministic and normalised', async () => {
  const embedder = createLocalEmbedder();
  assert.equal(embedder.id, LOCAL_EMBEDDER_ID);
  assert.equal(embedder.dim, LOCAL_EMBED_DIM);

  const [a1] = await embedder.embed(['the budget for travel']);
  const [a2] = await embedder.embed(['the budget for travel']);
  assert.deepEqual(a1, a2);
  assert.equal(a1.length, LOCAL_EMBED_DIM);
  assert.ok(Math.abs(cosine(a1, a1) - 1) < 1e-9, 'l2-normalised vectors have unit self-similarity');
});

test('the local embedder ranks a shared-topic text above an unrelated one', async () => {
  const embedder = createLocalEmbedder();
  const [query] = await embedder.embed(['quarterly travel budget']);
  const vectors = await embedder.embed([
    'the quarterly travel budget was approved',
    'flights to tokyo were booked',
    'compile the rust crate and run the tests'
  ]);
  assert.ok(cosine(query, vectors[0]) > cosine(query, vectors[2]));
});

test('normalizeVector handles a zero vector without dividing by zero', () => {
  assert.deepEqual(normalizeVector([0, 0, 0]), [0, 0, 0]);
  const v = normalizeVector([3, 4]);
  assert.ok(Math.abs(v[0] - 0.6) < 1e-9);
  assert.ok(Math.abs(v[1] - 0.8) < 1e-9);
});

test('the Ollama embedder batches and reports its dimension', async () => {
  const calls = [];
  const fetchImpl = async (url, opts) => {
    calls.push({ url: String(url), opts });
    if (String(url).endsWith('/api/tags')) {
      return { ok: true, json: async () => ({ models: [{ name: 'nomic-embed-text:latest' }] }) };
    }
    return { ok: true, json: async () => ({ embeddings: [[1, 0, 0], [0, 1, 0]] }) };
  };

  const embedder = createOllamaEmbedder({ fetchImpl });
  assert.equal(await embedder.available(), true);

  const vectors = await embedder.embed(['alpha', 'beta']);
  assert.equal(vectors.length, 2);
  assert.equal(embedder.dim, 3);
  const embedCall = calls.find(c => c.url.endsWith('/api/embed'));
  assert.deepEqual(JSON.parse(embedCall.opts.body).input, ['alpha', 'beta']);
});

test('the Ollama embedder is unavailable when the model is missing', async () => {
  const fetchImpl = async (url) => {
    if (String(url).endsWith('/api/tags')) {
      return { ok: true, json: async () => ({ models: [{ name: 'llama3:8b' }] }) };
    }
    return { ok: false, status: 404, json: async () => ({}) };
  };
  const embedder = createOllamaEmbedder({ fetchImpl });
  assert.equal(await embedder.available(), false);
  await assert.rejects(() => embedder.embed(['x']), /not installed/);
});

test('resolveEmbedder falls back to local when Ollama is not reachable', async () => {
  const fetchImpl = async () => { throw new Error('ECONNREFUSED'); };
  const embedder = await resolveEmbedder({ env: {}, fetchImpl });
  assert.equal(embedder.id, LOCAL_EMBEDDER_ID);
});

test('resolveEmbedder honours an explicit provider', async () => {
  const fetchImpl = async () => ({ ok: true, json: async () => ({ models: [] }) });
  const local = await resolveEmbedder({ env: { FRIDAY_EMBED_PROVIDER: 'local' }, fetchImpl });
  assert.equal(local.id, LOCAL_EMBEDDER_ID);

  const ollama = await resolveEmbedder({ env: { FRIDAY_EMBED_PROVIDER: 'ollama', FRIDAY_EMBED_MODEL: 'nomic-embed-text' }, fetchImpl });
  assert.equal(ollama.id, 'ollama:nomic-embed-text');
});

test('a bad embed payload is rejected instead of silently misaligned', async () => {
  const fetchImpl = async () => ({ ok: true, json: async () => ({ embeddings: [[1, 2]] }) });
  const embedder = createOllamaEmbedder({ fetchImpl });
  await assert.rejects(() => embedder.embed(['a', 'b']), /unexpected payload/);
});
