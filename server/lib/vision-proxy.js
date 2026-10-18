/* ==========================================================================
   F.R.I.D.A.Y. // SERVER LIB — MULTIMODAL VISION PROXY
   Shared by the screen-analysis skill and the web/desktop agents. The primary
   provider is any OpenAI-compatible multimodal endpoint (default: OpenRouter,
   with a free vision model); if it fails or is unconfigured the request is
   retried against a fallback provider (default: Groq). This means vision works
   with an OpenRouter key alone, and Groq stays a pure fallback (it is also the
   only source of speech-to-text). Keys never leave this module.
   ========================================================================== */

import { readEnv } from './env.js';

// Per-provider defaults. Any OpenAI-compatible endpoint that accepts the
// OpenAI `image_url` content part can be used via VISION_BASE_URL.
const PROVIDER_DEFAULTS = {
  openrouter: {
    base: 'https://openrouter.ai/api/v1',
    model: 'nvidia/nemotron-3.5-super-vl:free',
    keyEnv: 'OPENROUTER_API_KEY'
  },
  groq: {
    base: 'https://api.groq.com/openai/v1',
    model: 'qwen/qwen3.8-27b',
    keyEnv: 'GROQ_API_KEY'
  }
};

const DEFAULT_PRIMARY = 'openrouter';
const DEFAULT_FALLBACK = 'groq';
const DEFAULT_TIMEOUT_MS = 20000;
// Groq and OpenRouter both cap an inline base64 image at ~20 MB.
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;

/**
 * Resolves one provider's config from the environment. Everything is read at
 * call time (not import time) so values in .env are honoured. `primary`
 * selects the VISION_* / VISION_FALLBACK_* variable family.
 */
function resolveProvider(kind, primary) {
  const defaults = PROVIDER_DEFAULTS[kind];
  if (!defaults) return null;
  const prefix = primary ? 'VISION_' : 'VISION_FALLBACK_';
  return {
    kind,
    label: kind,
    base: String(readEnv(`${prefix}BASE_URL`) || defaults.base).replace(/\/+$/, ''),
    model: readEnv(`${prefix}MODEL`) || defaults.model,
    // A provider-specific key wins; otherwise the provider's own key env var.
    key: String(readEnv(`${prefix}API_KEY`) || readEnv(defaults.keyEnv) || '').trim()
  };
}

/**
 * Builds the ordered list of providers to try. Exported for tests.
 * VISION_PROVIDER picks the primary (default openrouter); VISION_FALLBACK_PROVIDER
 * overrides or disables the fallback. Both are resolved per call.
 */
export function resolveVisionChain() {
  const primaryKind = String(readEnv('VISION_PROVIDER') || DEFAULT_PRIMARY).toLowerCase();
  const explicitFallback = readEnv('VISION_FALLBACK_PROVIDER');
  const fallbackKind = explicitFallback === null
    ? (primaryKind === DEFAULT_PRIMARY ? DEFAULT_FALLBACK : null)
    : explicitFallback.toLowerCase();

  const chain = [];
  const primary = resolveProvider(primaryKind, true);
  if (primary) chain.push(primary);
  const fallback = fallbackKind && fallbackKind !== 'none'
    ? resolveProvider(fallbackKind, false)
    : null;
  if (fallback) chain.push(fallback);
  return chain;
}

function resolveTimeoutMs() {
  const raw = Number(readEnv('VISION_TIMEOUT_MS'));
  if (Number.isFinite(raw) && raw >= 1000 && raw <= 120000) return raw;
  return DEFAULT_TIMEOUT_MS;
}

/** Rough decoded byte size of a base64 data URL (0 for anything else). */
function estimateDataUrlBytes(imageUrl) {
  if (typeof imageUrl !== 'string' || !imageUrl.startsWith('data:')) return 0;
  const comma = imageUrl.indexOf(',');
  if (comma < 0) return 0;
  const b64 = imageUrl.slice(comma + 1);
  const padding = b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0;
  return Math.max(0, Math.floor((b64.length * 3) / 4) - padding);
}

/**
 * Runs one vision call against a resolved provider config. Returns the raw
 * OpenAI-compatible JSON ({ choices: [{ message: { content } }] }).
 */
async function callVision(cfg, { image_url, text, system_prompt, timeoutMs }) {
  const response = await fetch(`${cfg.base}/chat/completions`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${cfg.key}`,
      'Content-Type': 'application/json',
      // OpenRouter attribution header; ignored by other OpenAI-compatible hosts.
      'X-Title': 'F.R.I.D.A.Y.'
    },
    body: JSON.stringify({
      model: cfg.model,
      messages: [
        { role: 'system', content: system_prompt || 'You are a helpful AI assistant.' },
        {
          role: 'user',
          content: [
            { type: 'text', text: text || 'Analyze this screenshot.' },
            { type: 'image_url', image_url: { url: image_url } }
          ]
        }
      ],
      temperature: 0.3,
      max_tokens: 2048
    }),
    signal: AbortSignal.timeout(timeoutMs)
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => '');
    let msg = errText;
    try { const j = JSON.parse(errText); msg = j?.error?.message || j?.error || errText; } catch { /* raw body */ }
    throw new Error(`HTTP ${response.status}: ${typeof msg === 'string' ? msg : JSON.stringify(msg)}`);
  }
  const data = await response.json().catch(() => ({}));
  // Some OpenAI-compatible gateways answer HTTP 200 with an embedded error
  // object and no `choices` (seen on OpenRouter upstream failures). Fail loudly
  // rather than handing back a payload the caller cannot read.
  if (!Array.isArray(data?.choices) || data.choices.length === 0) {
    const detail = data?.error?.message || data?.error || 'no choices in response';
    throw new Error(`no result: ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`);
  }
  return data;
}

/**
 * Analyses an image data URL with the configured vision provider chain.
 * Returns the raw OpenAI-compatible JSON response (same shape /api/vision
 * returned before): { choices: [{ message: { content } }] }.
 * Throws when no provider is configured or every provider in the chain fails.
 */
export async function runVisionAnalysis({ image_url, text, system_prompt }) {
  const bytes = estimateDataUrlBytes(image_url);
  if (bytes > MAX_IMAGE_BYTES) {
    throw new Error(`Vision image too large (${(bytes / 1048576).toFixed(1)} MB; limit 20 MB)`);
  }

  const timeoutMs = resolveTimeoutMs();
  const chain = resolveVisionChain();
  const failures = [];

  for (const cfg of chain) {
    if (!cfg.key) { failures.push(`${cfg.label}: not configured`); continue; }
    try {
      return await callVision(cfg, { image_url, text, system_prompt, timeoutMs });
    } catch (e) {
      failures.push(`${cfg.label}: ${e.message}`);
    }
  }

  if (failures.length === 0) throw new Error('Vision analysis failed: no vision provider configured');
  throw new Error(`Vision analysis failed. ${failures.join(' | ')}`);
}
