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
import { installOriginGuard } from './server/middleware/origin-guard.js';
import { installApiAuth } from './server/middleware/api-auth.js';
import { allFacts, recentFacts, lastEpisodes } from './server/memory/store.js';
import { startScheduler, pendingJobs } from './server/lib/scheduler.js';
import { runScheduledTask } from './server/lib/scheduled-task.js';
import { notify, listNotifications, latestNotificationId } from './server/lib/notify.js';
import { knowledgeStats } from './server/lib/knowledge.js';
import { authorize } from './server/security/kernel.js';
import { policyHints, executeSkill } from './server/skills/registry.js';

const MAX_MESSAGES = 40;
const MAX_CONTENT_CHARS = 8000;

function sendJson(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(payload));
}

/** Query params of a connect request, whatever the mount stripped. */
function queryOf(req) {
  const raw = String(req.originalUrl || req.url || '');
  const q = raw.indexOf('?');
  return new URLSearchParams(q === -1 ? '' : raw.slice(q + 1));
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

/** A due job becomes a native toast + HUD notification + spoken line. */
function deliverReminder(job) {
  if (job.action && typeof job.action.skill === 'string') return runScheduledTask(job);
  return notify({ title: 'F.R.I.D.A.Y. REMINDER', body: job.text, speak: true });
}

/**
 * Runs a knowledge capability through the SAME kernel the agent uses — the
 * endpoint never executes a skill the policy has not authorised. Returns a
 * JSON reply; the HUD shows it as an action note.
 */
async function runAuthorisedSkill(name, args, res) {
  const hints = policyHints(name, args);
  const decision = authorize({ tool: name, args, actor: 'ui', ...hints });
  if (decision.decision !== 'allow') {
    return sendJson(res, 403, { error: decision.reason || 'denied by policy' });
  }
  try {
    const reply = await executeSkill(name, args, hints, {});
    return sendJson(res, 200, { reply: String(reply ?? '') });
  } catch (e) {
    return sendJson(res, 500, { error: e.message });
  }
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

    // A client-side stop ("Friday, stop") aborts the fetch; mirror it here so
    // the loop halts server-side instead of running to completion (C5).
    const controller = new AbortController();
    const onClose = () => controller.abort();
    req.on('close', onClose);
    res.on('close', onClose);

    const params = {
      chat,
      messages,
      signal: controller.signal,
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
    installOriginGuard(server);
    installApiAuth(server); // local session cookie in front of every /api/* route
    primeStartAppsCache(); // resolve installed/Store app names for the launch policy
    startScheduler({ onFire: deliverReminder }); // proactive jobs (catch-up on boot)
    server.middlewares.use('/api/agent', handleAgent);

    // Read-only memory snapshot for the HUD's MEMORY CORE card.
    server.middlewares.use('/api/memory', (req, res) => {
      const facts = recentFacts(6); // newest first — same rule the agent context uses (M2)
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({
        factsCount: allFacts().length,
        facts: facts.map(f => ({ key: f.key, value: f.value, updatedAt: f.updatedAt })),
        episodes: lastEpisodes(3).reverse()
      }));
    });

    // Pending reminders for the HUD's TASKS card.
    server.middlewares.use('/api/tasks', (req, res) => {
      const pending = pendingJobs();
      sendJson(res, 200, {
        count: pending.length,
        tasks: pending.map(j => ({ id: j.id, text: j.text, at: j.at, kind: j.kind }))
      });
    });

    // KNOWLEDGE base: read-only stats for the HUD card.
    server.middlewares.use('/api/knowledge/stats', (req, res) => {
      try { sendJson(res, 200, knowledgeStats()); }
      catch (e) { sendJson(res, 500, { error: e.message }); }
    });

    // KNOWLEDGE indexing + search. Both run through the policy kernel.
    server.middlewares.use('/api/knowledge/index', async (req, res) => {
      if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed' });
      let body;
      try { body = await readJsonBody(req); } catch (e) { return sendJson(res, 400, { error: e.message }); }
      return runAuthorisedSkill('index_folder', { path: body.path || 'documents' }, res);
    });

    server.middlewares.use('/api/knowledge/search', async (req, res) => {
      if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed' });
      let body;
      try { body = await readJsonBody(req); } catch (e) { return sendJson(res, 400, { error: e.message }); }
      return runAuthorisedSkill('search_knowledge', { query: body.query, topK: body.topK }, res);
    });

    // Proactive delivery. With no `since` the HUD is seeding (or a fresh
    // browser) and gets only the current high-water mark, so opening the app
    // never replays a backlog of old toasts.
    server.middlewares.use('/api/notifications', (req, res) => {
      const params = queryOf(req);
      const since = params.get('since');
      if (since === null) return sendJson(res, 200, { latestId: latestNotificationId(), notifications: [] });
      return sendJson(res, 200, {
        latestId: latestNotificationId(),
        notifications: listNotifications({ sinceId: Number(since) })
      });
    });
  }

  return {
    name: 'friday-agent',
    configureServer(server) { attach(server); },
    configurePreviewServer(server) { attach(server); }
  };
}
