/* ==========================================================================
   F.R.I.D.A.Y. // TESTS — VISION PROXY
   The vision proxy must be provider-aware: OpenRouter (free multimodal model)
   primary, Groq fallback, everything resolved per call from the environment.
   fetch is stubbed so no network is touched.
   ========================================================================== */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { runVisionAnalysis, resolveVisionChain } from '../../server/lib/vision-proxy.js';

const OPENROUTER_VISION_MODEL = 'nvidia/nemotron-3.5-super-vl:free';
const GROQ_VISION_MODEL = 'qwen/qwen3.8-27b';
const IMAGE = 'data:image/jpeg;base64,AAAA';

/** Sets process.env entries for the duration of fn, then restores them. */
async function withEnv(vars, fn) {
  const saved = {};
  for (const [k, v] of Object.entries(vars)) {
    saved[k] = process.env[k];
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
  try { return await fn(); } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  }
}

/** Replaces fetch, recording every call's URL and body. */
function stubFetch(handler) {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, opts) => {
    const body = JSON.parse(opts.body);
    calls.push({ url: String(url), model: body.model, body });
    return handler({ url: String(url), body }, calls.length);
  };
  return { calls, restore: () => { globalThis.fetch = original; } };
}

const okResponse = (content = 'ok') => ({
  ok: true, status: 200,
  json: async () => ({ choices: [{ message: { content } }] })
});
const httpError = (status = 503, text = 'upstream down') => ({
  ok: false, status, text: async () => text, json: async () => ({})
});
const embeddedError = (message = 'Upstream error from CoreWeave') => ({
  ok: true, status: 200,
  json: async () => ({ error: { message } })
});

const CHAIN_ENV = {
  VISION_PROVIDER: undefined, VISION_FALLBACK_PROVIDER: undefined,
  VISION_MODEL: undefined, VISION_BASE_URL: undefined,
  VISION_FALLBACK_MODEL: undefined, VISION_FALLBACK_BASE_URL: undefined
};

test('defaults to an OpenRouter primary with the free vision model, Groq fallback', async () => {
  await withEnv({ ...CHAIN_ENV, OPENROUTER_API_KEY: 'test-or', GROQ_API_KEY: 'test-groq' }, () => {
    const chain = resolveVisionChain();
    assert.equal(chain.length, 2);
    assert.equal(chain[0].label, 'openrouter');
    assert.equal(chain[0].base, 'https://openrouter.ai/api/v1');
    assert.equal(chain[0].model, OPENROUTER_VISION_MODEL);
    assert.equal(chain[1].label, 'groq');
    assert.equal(chain[1].base, 'https://api.groq.com/openai/v1');
    assert.equal(chain[1].model, GROQ_VISION_MODEL);
  });
});

test('honours VISION_MODEL / VISION_BASE_URL for the primary provider', async () => {
  await withEnv({ ...CHAIN_ENV, VISION_MODEL: 'test/vision-x', OPENROUTER_API_KEY: 'test-or' }, async () => {
    const { calls, restore } = stubFetch(() => okResponse('primary answer'));
    try {
      const data = await runVisionAnalysis({ image_url: IMAGE, text: 'hi' });
      assert.equal(data.choices[0].message.content, 'primary answer');
      assert.equal(calls.length, 1);
      assert.equal(calls[0].url, 'https://openrouter.ai/api/v1/chat/completions');
      assert.equal(calls[0].model, 'test/vision-x');
    } finally { restore(); }
  });
});

test('falls back to Groq when the primary provider returns an HTTP error', async () => {
  await withEnv({ ...CHAIN_ENV, OPENROUTER_API_KEY: 'test-or', GROQ_API_KEY: 'test-groq' }, async () => {
    const { calls, restore } = stubFetch(({ url }) =>
      url.includes('openrouter') ? httpError(503) : okResponse('groq answer'));
    try {
      const data = await runVisionAnalysis({ image_url: IMAGE, text: 'hi' });
      assert.equal(data.choices[0].message.content, 'groq answer');
      assert.equal(calls.length, 2);
      assert.equal(calls[1].url, 'https://api.groq.com/openai/v1/chat/completions');
      assert.equal(calls[1].model, GROQ_VISION_MODEL);
    } finally { restore(); }
  });
});

test('treats an HTTP 200 with no choices as a failure and falls back', async () => {
  await withEnv({ ...CHAIN_ENV, OPENROUTER_API_KEY: 'test-or', GROQ_API_KEY: 'test-groq' }, async () => {
    const { calls, restore } = stubFetch(({ url }) =>
      url.includes('openrouter') ? embeddedError() : okResponse('groq answer'));
    try {
      const data = await runVisionAnalysis({ image_url: IMAGE, text: 'hi' });
      assert.equal(data.choices[0].message.content, 'groq answer');
      assert.equal(calls.length, 2);
    } finally { restore(); }
  });
});

test('VISION_PROVIDER=groq uses Groq as the primary (OpenRouter not called)', async () => {
  await withEnv({ ...CHAIN_ENV, VISION_PROVIDER: 'groq', OPENROUTER_API_KEY: 'test-or', GROQ_API_KEY: 'test-groq' }, async () => {
    const { calls, restore } = stubFetch(() => okResponse('groq answer'));
    try {
      const data = await runVisionAnalysis({ image_url: IMAGE, text: 'hi' });
      assert.equal(data.choices[0].message.content, 'groq answer');
      assert.equal(calls.length, 1);
      assert.equal(calls[0].url, 'https://api.groq.com/openai/v1/chat/completions');
      assert.equal(calls[0].model, GROQ_VISION_MODEL);
    } finally { restore(); }
  });
});

test('VISION_FALLBACK_PROVIDER=none disables the fallback', async () => {
  await withEnv({ ...CHAIN_ENV, VISION_FALLBACK_PROVIDER: 'none', OPENROUTER_API_KEY: 'test-or', GROQ_API_KEY: 'test-groq' }, async () => {
    assert.equal(resolveVisionChain().length, 1);
    const { calls, restore } = stubFetch(() => httpError(503));
    try {
      await assert.rejects(
        () => runVisionAnalysis({ image_url: IMAGE, text: 'hi' }),
        /Vision analysis failed\. openrouter:/
      );
      assert.equal(calls.length, 1);
    } finally { restore(); }
  });
});

test('reports every provider failure when the whole chain fails', async () => {
  await withEnv({ ...CHAIN_ENV, OPENROUTER_API_KEY: 'test-or', GROQ_API_KEY: 'test-groq' }, async () => {
    const { restore } = stubFetch(({ url }) => httpError(503, url.includes('groq') ? 'groq boom' : 'or boom'));
    try {
      await assert.rejects(
        () => runVisionAnalysis({ image_url: IMAGE, text: 'hi' }),
        (e) => /openrouter: HTTP 503: or boom/.test(e.message) && /groq: HTTP 503: groq boom/.test(e.message)
      );
    } finally { restore(); }
  });
});

test('rejects an oversized inline image before calling any provider', async () => {
  await withEnv({ ...CHAIN_ENV, OPENROUTER_API_KEY: 'test-or' }, async () => {
    const { calls, restore } = stubFetch(() => okResponse());
    try {
      const huge = 'data:image/jpeg;base64,' + 'A'.repeat(28_000_000); // ~21 MB decoded
      await assert.rejects(
        () => runVisionAnalysis({ image_url: huge, text: 'hi' }),
        /too large.*20 MB/
      );
      assert.equal(calls.length, 0);
    } finally { restore(); }
  });
});
