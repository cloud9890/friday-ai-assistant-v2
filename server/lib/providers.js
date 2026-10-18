/* ==========================================================================
   F.R.I.D.A.Y. // SERVER LIB — MODEL PROVIDERS (cloud / Ollama)
   Shared completion engine used by /api/chat and the agent loop. The cloud
   provider is any OpenAI-compatible endpoint (default: OpenRouter); API keys
   never leave this module. The preferred provider is tried first; on any
   failure the alternate is attempted so an outage never breaks the flow.
   Pass onDelta(text) to stream tokens as they arrive; omit it for a
   buffered completion. Both paths normalise to one OpenAI-style message.
   ========================================================================== */

// Any OpenAI-compatible chat-completions endpoint works here. OpenRouter is the
// default cloud link; point OPENROUTER_BASE_URL elsewhere (Groq, Together, …) to
// switch, as long as the endpoint speaks the OpenAI chat-completions schema.
const DEFAULT_CLOUD_BASE = 'https://openrouter.ai/api/v1';
const DEFAULT_CLOUD_MODEL = 'nvidia/nemotron-3-ultra-550b-a55b:free';

export function createProviders(env = {}) {
  // Local-first only when explicitly requested; otherwise cloud-first.
  const wantsLocalFirst = String(env.AI_PROVIDER || '').toLowerCase() === 'ollama';

  const cloudBase = String(env.OPENROUTER_BASE_URL || env.CLOUD_BASE_URL || DEFAULT_CLOUD_BASE).replace(/\/+$/, '');
  const cloudKey = String(env.OPENROUTER_API_KEY || env.CLOUD_API_KEY || '').trim();
  const cloudModel = env.OPENROUTER_MODEL || env.CLOUD_MODEL || DEFAULT_CLOUD_MODEL;
  const cloudLabel = String(env.CLOUD_PROVIDER || 'openrouter').toLowerCase();

  const ollamaBase = (env.OLLAMA_BASE_URL || 'http://localhost:11434').replace(/\/+$/, '');
  const ollamaModel = env.OLLAMA_MODEL || 'llama3.1';

  const PROVIDERS = {
    [cloudLabel]: {
      label: cloudLabel,
      model: cloudModel,
      available: Boolean(cloudKey),
      run
    },
    ollama: {
      label: 'ollama',
      model: ollamaModel,
      available: true,
      run
    }
  };

  async function run({ messages, tools, max_tokens, temperature, onDelta }) {
    const isCloud = this.label === cloudLabel;
    const endpoint = isCloud ? `${cloudBase}/chat/completions` : `${ollamaBase}/api/chat`;
    const headers = {
      'Content-Type': 'application/json',
      // OpenRouter attribution header; harmless on other OpenAI-compatible hosts.
      ...(isCloud ? { Authorization: `Bearer ${cloudKey}`, 'X-Title': 'F.R.I.D.A.Y.' } : {})
    };
    const body = {
      model: isCloud ? cloudModel : ollamaModel,
      messages,
      max_tokens,
      temperature
    };
    if (tools && tools.length > 0) { body.tools = tools; if (isCloud) body.tool_choice = 'auto'; }

    if (!onDelta) {
      body.stream = false;
      const upstream = await fetch(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(90000)
      });
      const data = await upstream.json().catch(() => ({}));
      if (!upstream.ok) throw new Error(data?.error?.message || data?.error || `HTTP ${upstream.status}`);
      const message = isCloud ? data?.choices?.[0]?.message : data?.message;
      if (!message) throw new Error(`${this.label} returned an empty completion`);
      return normalizeMessage(message, this.label);
    }

    // ---- Streaming path ------------------------------------------------
    body.stream = true;
    const upstream = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(isCloud ? 180000 : 150000)
    });
    if (!upstream.ok) {
      const errText = await upstream.text().catch(() => '');
      let msg = errText;
      try { const j = JSON.parse(errText); msg = j?.error?.message || j?.error || errText; } catch { /* raw */ }
      throw new Error(msg || `HTTP ${upstream.status}`);
    }

    const message = { role: 'assistant', content: '', tool_calls: [] };
    const toolAcc = new Map();

    const reader = upstream.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      if (isCloud) {
        // SSE: lines of "data: {...}", terminated by "data: [DONE]". Reasoning
        // models (e.g. OpenRouter reasoning models) also emit delta.reasoning,
        // which is deliberately ignored — it is not part of the reply.
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith('data:')) continue;
          const payload = trimmed.slice(5).trim();
          if (payload === '[DONE]') continue;
          let chunk;
          try { chunk = JSON.parse(payload); } catch { continue; }
          const delta = chunk?.choices?.[0]?.delta || {};
          if (delta.content) {
            message.content += delta.content;
            onDelta(delta.content);
          }
          for (const tc of delta.tool_calls || []) {
            const acc = toolAcc.get(tc.index ?? 0) || { id: tc.id || `call_${tc.index ?? 0}`, type: 'function', function: { name: '', arguments: '' } };
            if (tc.id) acc.id = tc.id;
            if (tc.function?.name) acc.function.name += tc.function.name;
            if (tc.function?.arguments) acc.function.arguments += tc.function.arguments;
            toolAcc.set(tc.index ?? 0, acc);
          }
        }
      } else {
        // Ollama: newline-delimited JSON objects.
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
          if (!line.trim()) continue;
          let chunk;
          try { chunk = JSON.parse(line); } catch { continue; }
          if (chunk.message?.content) {
            message.content += chunk.message.content;
            onDelta(chunk.message.content);
          }
          if (Array.isArray(chunk.message?.tool_calls)) {
            for (const tc of chunk.message.tool_calls) {
              const idx = toolAcc.size;
              toolAcc.set(idx, {
                id: tc.id || `call_${idx}`,
                type: 'function',
                function: {
                  name: tc.function?.name || '',
                  arguments: typeof tc.function?.arguments === 'string'
                    ? tc.function.arguments
                    : JSON.stringify(tc.function?.arguments || {})
                }
              });
            }
          }
        }
      }
    }

    message.tool_calls = [...toolAcc.values()].filter(tc => tc.function.name);
    if (!message.content && message.tool_calls.length === 0) {
      throw new Error(`${this.label} returned an empty completion`);
    }
    return message;
  }

  // Cloud-first unless the operator explicitly prefers the local model.
  const providerOrder = wantsLocalFirst ? ['ollama', cloudLabel] : [cloudLabel, 'ollama'];

  return {
    PROVIDERS,
    providerOrder,
    primaryProvider: providerOrder[0],
    fallbackProvider: providerOrder[1],
    cloudLabel
  };
}

function normalizeMessage(message, label) {
  const out = { role: 'assistant', content: typeof message.content === 'string' ? message.content : '' };
  if (Array.isArray(message.tool_calls) && message.tool_calls.length > 0) {
    out.tool_calls = message.tool_calls.map((call, i) => ({
      id: call.id || `call_${i}`,
      type: 'function',
      function: {
        name: call.function?.name,
        arguments: typeof call.function?.arguments === 'string'
          ? call.function.arguments
          : JSON.stringify(call.function?.arguments || {})
      }
    }));
  }
  return out;
}

/** Returns how long to wait before a rate-limited call may be retried, in ms. */
function rateLimitWaitMs(message) {
  const m = /rate limit.*?try again in ([\d.]+)\s*s/i.exec(String(message));
  if (m) return Math.min(parseFloat(m[1]) * 1000 + 500, 10000);
  if (/rate limit|quota|too many requests/i.test(String(message))) return 8000;
  return 0;
}

const CONNECTION_FAILURE = /fetch failed|ECONNREFUSED|ENOTFOUND|ETIMEDOUT|EAI_AGAIN|socket|network/i;

/**
 * Creates a completion function with automatic provider fallback.
 * Rate-limited calls are retried once (≤10s) so a brief quota pause does not
 * surface to the conversation; a provider that is unreachable (e.g. Ollama
 * down) trips a 60s circuit breaker instead of being retried every turn.
 * @returns {(opts: {messages, tools?, max_tokens?, temperature?, onDelta?}) =>
 *   Promise<{ok: boolean, raw?: object, reply?: string, provider: string,
 *            model: string, fallback: boolean, error?: string}>}
 */
export function createChat(env = {}) {
  const { PROVIDERS, providerOrder } = createProviders(env);
  const deadUntil = new Map(); // provider label -> timestamp

  return async function chat({ messages, tools = null, max_tokens = 800, temperature = 0.6, onDelta = null }) {
    const attempted = [];
    for (let i = 0; i < providerOrder.length; i++) {
      const p = PROVIDERS[providerOrder[i]];
      if (!p.available) { attempted.push(`${p.label}: not configured`); continue; }
      if ((deadUntil.get(p.label) || 0) > Date.now()) {
        attempted.push(`${p.label}: circuit open`);
        continue;
      }

      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const raw = await p.run({ messages, tools, max_tokens, temperature, onDelta });
          deadUntil.delete(p.label);
          return {
            ok: true,
            raw,
            reply: typeof raw.content === 'string' ? raw.content.trim() : '',
            provider: p.label,
            model: p.model,
            fallback: i > 0
          };
        } catch (e) {
          const waitMs = attempt === 0 ? rateLimitWaitMs(e.message) : 0;
          if (waitMs > 0) {
            await new Promise(r => setTimeout(r, waitMs));
            continue;
          }
          if (CONNECTION_FAILURE.test(String(e.message))) {
            deadUntil.set(p.label, Date.now() + 60000);
          }
          attempted.push(`${p.label}: ${e.message}`);
          break;
        }
      }
    }
    return { ok: false, error: `All providers failed. ${attempted.join(' | ')}`, attempted };
  };
}
