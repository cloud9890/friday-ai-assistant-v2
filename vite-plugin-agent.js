/* ==========================================================================
   F.R.I.D.A.Y. // AGENT PLUGIN (dev + preview server middleware)
   --------------------------------------------------------------------------
   POST /api/agent
     body: { messages: [{role, content}], confirmToken?, cancelToken? }
     -> { reply, provider, model, actions: [...] }
     -> { pending: { token, tool, args, risk, description }, actions: [...] }

   The browser never talks to OS capabilities directly: the only route here is
   the agent loop, and every tool call inside it is authorised by the policy
   kernel before execution (see server/agent/loop.js).
   ========================================================================== */

import { createChat } from './server/lib/providers.js';
import { runAgentTurn } from './server/agent/loop.js';
import { primeStartAppsCache } from './server/lib/app-launcher.js';
import { createOriginGuard } from './server/middleware/origin-guard.js';
import { allFacts, lastEpisodes } from './server/memory/store.js';

const MAX_MESSAGES = 40;
const MAX_CONTENT_CHARS = 8000;

function sendJson(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(payload));
}

function readJsonBody(req, limitBytes = 4_000_000) {
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

/** Only prior conversation turns travel from the browser, sanitised. */
function sanitizeHistory(messages) {
  if (!Array.isArray(messages)) return [];
  return messages
    .filter(m => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
    .slice(-MAX_MESSAGES)
    .map(m => ({ role: m.role, content: m.content.slice(0, MAX_CONTENT_CHARS) }));
}

export default function fridayAgentPlugin(env = {}) {
  const chat = createChat(env);

  async function handleAgent(req, res) {
    if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed' });

    let body;
    try { body = await readJsonBody(req); } catch (e) { return sendJson(res, 400, { error: e.message }); }

    const messages = sanitizeHistory(body.messages);
    if (messages.length === 0 && !body.confirmToken && !body.cancelToken) {
      return sendJson(res, 400, { error: 'messages array required' });
    }

    const params = {
      chat,
      messages,
      confirmToken: typeof body.confirmToken === 'string' ? body.confirmToken : null,
      cancelToken: typeof body.cancelToken === 'string' ? body.cancelToken : null,
      screenFrame: typeof body.screenFrame === 'string' && body.screenFrame.startsWith('data:image/')
        ? body.screenFrame.slice(0, 4_000_000) : null
    };

    // Streaming mode: token deltas + live tool events over SSE.
    if (body.stream === true) {
      res.statusCode = 200;
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      const send = (evt) => res.write(`data: ${JSON.stringify(evt)}\n\n`);
      try {
        const result = await runAgentTurn({ ...params, onEvent: (evt) => send(evt) });
        send({ type: 'final', ...result });
      } catch (e) {
        send({ type: 'final', error: e.message });
      }
      res.end();
      return;
    }

    try {
      const result = await runAgentTurn(params);
      return sendJson(res, 200, result);
    } catch (e) {
      return sendJson(res, 502, { error: e.message });
    }
  }

  function attach(server) {
    server.middlewares.use(createOriginGuard());
    primeStartAppsCache(); // resolve installed/Store app names for the launch policy
    server.middlewares.use('/api/agent', handleAgent);

    // Read-only memory snapshot for the HUD's MEMORY CORE card.
    server.middlewares.use('/api/memory', (req, res) => {
      const facts = allFacts().slice(-6).reverse();
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({
        factsCount: allFacts().length,
        facts: facts.map(f => ({ key: f.key, value: f.value, updatedAt: f.updatedAt })),
        episodes: lastEpisodes(3).reverse()
      }));
    });
  }

  return {
    name: 'friday-agent',
    configureServer(server) { attach(server); },
    configurePreviewServer(server) { attach(server); }
  };
}
