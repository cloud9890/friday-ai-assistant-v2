/* ==========================================================================
   F.R.I.D.A.Y. // AI PROXY (dev + preview server middleware)
   --------------------------------------------------------------------------
   Every API key stays on the server. The browser only ever talks to these
   same-origin routes, so no secret can leak into the client bundle:
     POST /api/chat    -> { messages, max_tokens, temperature } -> { reply, provider, model }
     POST /api/tts     -> { text }                               -> audio/mpeg
     POST /api/stt     -> raw audio body (webm/opus or wav)      -> { text }
     GET  /api/health  -> { ok, provider, configured, model, tts }
   Completions run through the shared provider engine (server/lib/providers.js),
   which also powers the agent loop with automatic cloud<->local fallback.
   ========================================================================== */

import { createProviders, createChat } from './server/lib/providers.js';
import { installOriginGuard } from './server/middleware/origin-guard.js';
import { installApiAuth } from './server/middleware/api-auth.js';

const ELEVENLABS_URL = 'https://api.elevenlabs.io/v1/text-to-speech';
const GROQ_STT_URL = 'https://api.groq.com/openai/v1/audio/transcriptions';

function sendJson(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(payload));
}

function readJsonBody(req, limitBytes = 2_000_000) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limitBytes) { reject(new Error('Request body too large')); req.destroy(); return; }
      chunks.push(chunk);
    });
    req.on('error', reject);
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return resolve({});
      try { resolve(JSON.parse(raw)); } catch { reject(new Error('Invalid JSON body')); }
    });
  });
}

function readRawBody(req, limitBytes = 12_000_000) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limitBytes) { reject(new Error('Request body too large')); req.destroy(); return; }
      chunks.push(chunk);
    });
    req.on('error', reject);
    req.on('end', () => resolve(Buffer.concat(chunks)));
  });
}

export default function fridayAiPlugin(env = {}) {
  const { PROVIDERS, providerOrder, primaryProvider, fallbackProvider } = createProviders(env);
  const chat = createChat(env);

  const elevenKey = (env.ELEVENLABS_API_KEY || '').trim();
  const elevenVoice = env.ELEVENLABS_VOICE_ID || 'EXAVITQu4vr4xnSDxMaL';
  const elevenModel = env.ELEVENLABS_MODEL || 'eleven_multilingual_v2';

  // Speech-to-text rides on a Groq key, because OpenRouter exposes no audio
  // transcription endpoint. Optional: voice input degrades if it is absent.
  const sttKey = (env.GROQ_API_KEY || '').trim();
  const sttModel = env.STT_MODEL || 'whisper-large-v3-turbo';

  async function handleHealth(req, res) {
    sendJson(res, 200, {
      ok: true,
      provider: primaryProvider,
      fallback: fallbackProvider,
      configured: PROVIDERS[primaryProvider].available,
      fallbackConfigured: PROVIDERS[fallbackProvider].available,
      model: PROVIDERS[primaryProvider].model,
      tts: Boolean(elevenKey),
      stt: Boolean(sttKey)
    });
  }

  async function handleChat(req, res) {
    if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed' });

    let body;
    try { body = await readJsonBody(req); } catch (e) { return sendJson(res, 400, { error: e.message }); }

    const messages = Array.isArray(body.messages) ? body.messages : null;
    if (!messages || messages.length === 0) return sendJson(res, 400, { error: 'messages array required' });

    const max_tokens = Number(body.max_tokens) > 0 ? Math.min(Number(body.max_tokens), 8000) : 800;
    const temperature = Number.isFinite(Number(body.temperature)) ? Number(body.temperature) : 0.6;

    const result = await chat({ messages, max_tokens, temperature });
    if (!result.ok) return sendJson(res, 502, { error: result.error });

    return sendJson(res, 200, {
      reply: result.reply,
      provider: result.provider,
      model: result.model,
      fallback: result.fallback
    });
  }

  async function handleTts(req, res) {
    if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed' });

    let body;
    try { body = await readJsonBody(req); } catch (e) { return sendJson(res, 400, { error: e.message }); }

    const text = String(body.text || '').slice(0, 2000).trim();
    if (!text) return sendJson(res, 400, { error: 'text required' });
    if (!elevenKey) return sendJson(res, 503, { error: 'ELEVENLABS_API_KEY is not configured on the server' });

    try {
      const upstream = await fetch(`${ELEVENLABS_URL}/${encodeURIComponent(elevenVoice)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'xi-api-key': elevenKey, Accept: 'audio/mpeg' },
        body: JSON.stringify({ text, model_id: elevenModel })
      });
      if (!upstream.ok) {
        const detail = await upstream.text().catch(() => '');
        return sendJson(res, upstream.status, { error: `ElevenLabs returned HTTP ${upstream.status} ${detail.slice(0, 200)}` });
      }
      const buffer = Buffer.from(await upstream.arrayBuffer());
      res.statusCode = 200;
      res.setHeader('Content-Type', 'audio/mpeg');
      res.setHeader('Cache-Control', 'no-store');
      res.end(buffer);
    } catch (e) {
      return sendJson(res, 502, { error: `TTS request failed: ${e.message}` });
    }
  }

  async function handleStt(req, res) {
    if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed' });
    if (!sttKey) return sendJson(res, 503, { error: 'GROQ_API_KEY is not configured on the server' });

    let audio;
    try { audio = await readRawBody(req); } catch (e) { return sendJson(res, 400, { error: e.message }); }
    if (!audio.length) return sendJson(res, 400, { error: 'audio body required' });

    const mime = (req.headers['content-type'] || 'audio/webm').split(';')[0].trim();
    try {
      const form = new FormData();
      form.append('file', new Blob([audio], { type: mime }), mime.includes('wav') ? 'speech.wav' : 'speech.webm');
      form.append('model', sttModel);
      form.append('temperature', '0');
      const upstream = await fetch(GROQ_STT_URL, {
        method: 'POST',
        headers: { Authorization: `Bearer ${sttKey}` },
        body: form
      });
      const payload = await upstream.json().catch(() => ({}));
      if (!upstream.ok) {
        const detail = payload.error && payload.error.message ? payload.error.message : '';
        return sendJson(res, upstream.status, { error: detail || `Groq STT returned HTTP ${upstream.status}` });
      }
      return sendJson(res, 200, { text: String(payload.text || '').trim() });
    } catch (e) {
      return sendJson(res, 502, { error: `STT request failed: ${e.message}` });
    }
  }

  function attach(server) {
    installOriginGuard(server);
    installApiAuth(server); // local session cookie in front of every /api/* route
    server.middlewares.use('/api/health', handleHealth);
    server.middlewares.use('/api/chat', handleChat);
    server.middlewares.use('/api/tts', handleTts);
    server.middlewares.use('/api/stt', handleStt);
  }

  return {
    name: 'friday-ai-proxy',
    configureServer(server) { attach(server); },
    configurePreviewServer(server) { attach(server); }
  };
}
