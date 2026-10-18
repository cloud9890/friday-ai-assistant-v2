/* ==========================================================================
   F.R.I.D.A.Y. // AI CLIENT (browser side)
   Thin, secret-free wrapper around the same-origin AI proxy routes.
   ========================================================================== */

function combineSignal(signal, timeoutMs) {
  const hasTimeout = typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function';
  const timeoutSignal = hasTimeout ? AbortSignal.timeout(timeoutMs) : null;
  if (signal && timeoutSignal && typeof AbortSignal.any === 'function') {
    return AbortSignal.any([signal, timeoutSignal]);
  }
  return signal || timeoutSignal || undefined;
}

async function postJson(path, payload, { signal, timeoutMs = 30000 } = {}) {
  return fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal: combineSignal(signal, timeoutMs)
  });
}

/**
 * Send a conversation to the AI proxy and resolve with the reply plus the
 * provider that served it. Flow is CLOUD FIRST: the cloud provider (OpenRouter
 * and the proxy automatically falls back to the local Ollama model when the
 * cloud link fails, times out, or is unconfigured.
 * @param {Array<{role: string, content: string}>} messages
 * @returns {Promise<{reply: string, provider: string, model: string, fallback: boolean}>}
 */
export async function askFriday(messages, { signal, maxTokens = 800, temperature = 0.6 } = {}) {
  const res = await postJson('/api/chat', { messages, max_tokens: maxTokens, temperature }, { signal, timeoutMs: 45000 });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `AI proxy HTTP ${res.status}`);
  if (!data.reply) throw new Error('AI proxy returned an empty reply');
  return {
    reply: data.reply,
    provider: data.provider || 'unknown',
    model: data.model || '',
    fallback: Boolean(data.fallback)
  };
}

/**
 * Run one agentic turn with live streaming: text deltas, tool-start events
 * and the final result arrive over server-sent events as they happen.
 * Pass screenFrame (a JPEG data URL) while screen sharing is enabled so the
 * analyze_screen skill can see the display.
 * @returns {Promise<{reply?, provider?, model?, actions?, pending?, error?}>}
 */
export async function runAgent(messages, { signal, confirmToken = null, cancelToken = null, screenFrame = null, onEvent = null } = {}) {
  const res = await postJson('/api/agent', { messages, confirmToken, cancelToken, screenFrame, stream: Boolean(onEvent) }, { signal, timeoutMs: 180000 });
  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error(errData.error || `Agent HTTP ${res.status}`);
  }

  // Non-streaming turn: one JSON payload.
  const contentType = res.headers.get('content-type') || '';
  if (!contentType.includes('text/event-stream')) {
    return await res.json();
  }

  // SSE stream: collect events until the final one.
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let final = null;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split('\n\n');
    buffer = parts.pop() || '';
    for (const part of parts) {
      const line = part.trim();
      if (!line.startsWith('data:')) continue;
      let evt;
      try { evt = JSON.parse(line.slice(5).trim()); } catch { continue; }
      if (evt.type === 'final') final = evt;
      else onEvent(evt);
    }
  }
  if (!final) throw new Error('Agent stream ended without a final result');
  return final;
}

/** Probe the proxy for provider configuration and round-trip latency. */
export async function checkHealth({ signal } = {}) {
  const started = (typeof performance !== 'undefined' ? performance.now() : Date.now());
  try {
    const res = await fetch('/api/health', { signal });
    const latencyMs = Math.round((typeof performance !== 'undefined' ? performance.now() : Date.now()) - started);
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok, latencyMs, ...data };
  } catch (e) {
    const latencyMs = Math.round((typeof performance !== 'undefined' ? performance.now() : Date.now()) - started);
    return { ok: false, latencyMs, error: e.message };
  }
}

/** Request synthesized speech audio; resolves with an audio Blob. */
export async function synthesizeSpeech(text, { signal } = {}) {
  const res = await postJson('/api/tts', { text }, { signal, timeoutMs: 30000 });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `TTS proxy HTTP ${res.status}`);
  }
  return await res.blob();
}