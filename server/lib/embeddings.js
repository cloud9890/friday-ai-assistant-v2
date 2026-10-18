/* ==========================================================================
   F.R.I.D.A.Y. // SERVER LIB — EMBEDDINGS
   Turns text into vectors for the local knowledge base.

   Two backends, one interface: `{ id, dim, embed(texts) }`.
     - ollama: `nomic-embed-text` on the local Ollama daemon (preferred —
       better semantic recall, no cloud, no key).
     - local:  a deterministic hashed bag-of-words embedder. Always available,
       zero deps, works offline, and is honest about being lexical, not
       semantic. Used automatically when Ollama (or the model) is missing.

   The embedder is injectable, exactly like `scheduler.tick(now)`: tests never
   touch the network. `id` is recorded in the index manifest, so vectors from
   two different embedders are never silently compared.
   ========================================================================== */

export const DEFAULT_OLLAMA_URL = 'http://127.0.0.1:11434';
export const DEFAULT_EMBED_MODEL = 'nomic-embed-text';
export const LOCAL_EMBEDDER_ID = 'local-hash-v1';
export const LOCAL_EMBED_DIM = 384;

function fnv1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function tokens(text) {
  return String(text || '').toLowerCase().match(/[a-z0-9_]{2,}/g) || [];
}

function bump(vector, key, weight, dim) {
  const h = fnv1a(key);
  const bucket = h % dim;
  const sign = (h & 0x100) ? -1 : 1; // signed hashing keeps unrelated tokens from cancelling out
  vector[bucket] += sign * weight;
}

/** L2 normalise in place-ish; returns a plain array. */
export function normalizeVector(vector) {
  const v = Array.from(vector, Number);
  let sum = 0;
  for (const x of v) sum += x * x;
  const norm = Math.sqrt(sum);
  if (!norm) return v;
  return v.map(x => x / norm);
}

function hashVector(text, dim) {
  const v = new Float64Array(dim);
  const toks = tokens(text);
  for (let i = 0; i < toks.length; i++) {
    bump(v, toks[i], 1, dim);
    if (i + 1 < toks.length) bump(v, `${toks[i]} ${toks[i + 1]}`, 0.5, dim);
  }
  return normalizeVector(v);
}

/** Deterministic, dependency-free, offline. Lexical overlap only. */
export function createLocalEmbedder({ dim = LOCAL_EMBED_DIM } = {}) {
  return {
    id: LOCAL_EMBEDDER_ID,
    dim,
    async embed(texts) {
      return (Array.isArray(texts) ? texts : [texts]).map(t => hashVector(t, dim));
    }
  };
}

/**
 * Ollama-backed embedder. Batches a whole array in one request.
 * @param {{model?: string, baseUrl?: string, fetchImpl?: Function, timeoutMs?: number}} [options]
 */
export function createOllamaEmbedder({
  model = DEFAULT_EMBED_MODEL,
  baseUrl = DEFAULT_OLLAMA_URL,
  fetchImpl = globalThis.fetch,
  timeoutMs = 30000
} = {}) {
  const base = String(baseUrl || DEFAULT_OLLAMA_URL).replace(/\/+$/, '');
  const embedder = {
    id: `ollama:${model}`,
    dim: null,
    async embed(texts) {
      const input = Array.isArray(texts) ? texts : [texts];
      if (!input.length) return [];
      if (typeof fetchImpl !== 'function') throw new Error('no fetch available for embeddings');
      const res = await fetchImpl(`${base}/api/embed`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, input }),
        signal: timeoutSignal(timeoutMs)
      });
      if (!res.ok) {
        if (res.status === 404) throw new Error(`embedding model "${model}" is not installed (run: ollama pull ${model})`);
        throw new Error(`embedding provider returned HTTP ${res.status}`);
      }
      const data = await res.json().catch(() => ({}));
      const list = Array.isArray(data.embeddings) ? data.embeddings
        : Array.isArray(data.embedding) ? [data.embedding] : [];
      if (list.length !== input.length) throw new Error('embedding provider returned an unexpected payload');
      if (Array.isArray(list[0]) && list[0].length) embedder.dim = list[0].length;
      return list;
    },
    /** True only when the daemon answers AND the configured model is present. */
    async available() {
      if (typeof fetchImpl !== 'function') return false;
      try {
        const res = await fetchImpl(`${base}/api/tags`, { signal: timeoutSignal(1500) });
        if (!res.ok) return false;
        const data = await res.json().catch(() => ({}));
        const models = Array.isArray(data.models) ? data.models : [];
        return models.some(m => m && (m.name === model || m.model === model
          || String(m.name || '').startsWith(`${model}:`)));
      } catch {
        return false;
      }
    }
  };
  return embedder;
}

function timeoutSignal(ms) {
  if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
    return AbortSignal.timeout(ms);
  }
  return undefined;
}

/**
 * Picks the embedder for a session.
 *   FRIDAY_EMBED_PROVIDER=local   -> deterministic local
 *   FRIDAY_EMBED_PROVIDER=ollama  -> Ollama (errors surface if it is down)
 *   unset                         -> Ollama when reachable + model present, else local
 */
export async function resolveEmbedder({ env = process.env, fetchImpl = globalThis.fetch } = {}) {
  const provider = String(env.FRIDAY_EMBED_PROVIDER || '').toLowerCase().trim();
  const model = env.FRIDAY_EMBED_MODEL || DEFAULT_EMBED_MODEL;
  const baseUrl = env.FRIDAY_EMBED_URL || DEFAULT_OLLAMA_URL;

  if (provider === 'local') return createLocalEmbedder();
  const ollama = createOllamaEmbedder({ model, baseUrl, fetchImpl });
  if (provider === 'ollama') return ollama;
  return (await ollama.available()) ? ollama : createLocalEmbedder();
}

let cached = null;

/** Cached resolution (one daemon probe per process). */
export async function getEmbedder(options) {
  if (!cached) cached = await resolveEmbedder(options);
  return cached;
}

/** Test/DI seam — same shape as `scheduler.tick(now)` being injectable. */
export function setEmbedder(embedder) {
  cached = embedder;
}

export function resetEmbedder() {
  cached = null;
}
