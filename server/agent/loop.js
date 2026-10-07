/* ==========================================================================
   F.R.I.D.A.Y. // AGENT — ReAct LOOP
   Runs the model/tool loop server-side. Every tool call is authorised by the
   policy kernel before execution; destructive actions (confirmation: always)
   pause the loop and return a pending token the UI must approve or cancel.
   ========================================================================== */

import { authorize, RISK } from '../security/kernel.js';
import { TOOLS, SYSTEM_PROMPT } from './tools.js';
import { policyHints, describe, executeSkill } from '../skills/registry.js';
import { memoryContextBlock } from '../memory/context.js';
import { appendEpisode } from '../memory/store.js';

const MAX_ITERATIONS = 10;
const PENDING_TTL_MS = 10 * 60 * 1000;
const MAX_TOOL_RESULT_CHARS = 60000;

/** token -> { messages, batch, batchIndex, createdAt } */
const pendingConfirmations = new Map();

function gcPending() {
  const now = Date.now();
  for (const [token, entry] of pendingConfirmations) {
    if (now - entry.createdAt > PENDING_TTL_MS) pendingConfirmations.delete(token);
  }
}

function trimToolResult(text, max = MAX_TOOL_RESULT_CHARS) {
  const s = String(text ?? '');
  return s.length > max ? s.slice(0, max) + '\n…[truncated]' : s;
}

/** Normalises provider tool_calls to OpenAI string-argument shape. */
function normalizeToolCalls(raw) {
  if (!Array.isArray(raw.tool_calls) || raw.tool_calls.length === 0) return null;
  return raw.tool_calls
    .filter(c => c?.function?.name)
    .map((c, i) => ({
      id: c.id || `call_${i}`,
      type: 'function',
      function: { name: c.function.name, arguments: c.function.arguments || '{}' }
    }));
}

function parseArgs(rawArgs) {
  try {
    const parsed = JSON.parse(rawArgs || '{}');
    return (parsed && typeof parsed === 'object') ? parsed : {};
  } catch {
    return {};
  }
}

/**
 * Processes one batch of tool calls starting at batchIndex.
 * Returns { actions, pending } — pending is set when a confirmation-required
 * call pauses the loop (the remaining state is stashed for later resume).
 */
async function processBatch(chat, messages, batch, batchIndex, actions, onEvent) {
  for (let i = batchIndex; i < batch.length; i++) {
    const call = batch[i];
    const name = call.function.name;
    const args = parseArgs(call.function.arguments);

    const { hints } = policyHints(name, args);
    const decision = authorize({ tool: name, args, actor: 'agent', ...hints });

    if (decision.decision !== 'allow') {
      actions.push({ tool: name, args, risk: decision.risk, decision: 'denied', summary: decision.reason });
      messages.push({ role: 'tool', tool_call_id: call.id, name, content: `Policy denied this action: ${decision.reason}. Explain this to the user and choose another approach.` });
      continue;
    }

    // The kernel's app resolution lands on the decision; apply it to args so
    // the skill executes the vetted target, never the raw model string.
    if (decision.resolvedApp) args.__resolvedApp = decision.resolvedApp;

    // Destructive capabilities pause the loop for explicit user approval.
    if (decision.meta && decision.meta.confirmation === 'always') {
      const token = `confirm_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      pendingConfirmations.set(token, { messages, batch, batchIndex: i, createdAt: Date.now() });
      return {
        actions,
        pending: {
          token,
          tool: name,
          args,
          risk: decision.risk,
          description: describe(name, args)
        }
      };
    }

    let result;
    try {
      onEvent?.({ type: 'tool', name });
      result = await executeSkill(name, args, hints, { chat });
      onEvent?.({ type: 'toolDone', name, summary: trimToolResult(result, 200) || 'done' });
    } catch (e) {
      result = `Error executing tool: ${e.message}`;
    }
    actions.push({ tool: name, args, risk: decision.risk, decision: 'allowed', summary: trimToolResult(result, 200) || 'done' });
    messages.push({ role: 'tool', tool_call_id: call.id, name, content: trimToolResult(result) });
  }
  return { actions, pending: null };
}

/**
 * Deterministic nudge for unambiguous memory intents small models tend to
 * answer from text instead of calling the tool. Patterns are deliberately
 * strict — "remember to open notepad" or "recall the file" must NOT trigger
 * a memory tool. Injected as a system message just for that turn.
 */
function intentBooster(userText) {
  const t = String(userText || '').toLowerCase();

  // "remember that...", "note down...", "keep in mind..." (memory writes)
  const isWrite = /^\s*(please\s+)?(remember|note down|keep in mind|store this)\b/.test(t)
    || /\bremember (that|this)\b/.test(t);
  // "forget X", "erase it from your memory"
  const isErase = /\bforget\b/.test(t) || /\b(erased?|wiped?|removed?) .*(from (your )?memory)\b/.test(t);
  // "what do you remember about me", "check your memory"
  const isRead = /\b(what do you (remember|know) about me|do you remember|your memor(y|ies))\b/.test(t);

  if (isWrite) {
    return { role: 'system', content: 'Directive: the user is asking you to REMEMBER something. Call the remember_fact tool now with a sensible short key and the exact detail as value, then briefly confirm. Do not answer from text alone.' };
  }
  if (isErase) {
    return { role: 'system', content: 'Directive: the user wants something FORGOTTEN. Use recall_facts to find the matching key if the exact key is unclear, then call forget_fact. Do not answer from text alone.' };
  }
  if (isRead) {
    return { role: 'system', content: 'Directive: the user asks about your stored memory. Call the recall_facts tool with a relevant query and report the results. Do not answer from text alone.' };
  }
  return null;
}

/**
 * Runs one agent turn.
 * @param {{chat: Function, messages: Array, confirmToken?: string, cancelToken?: string}} params
 *   messages: prior user/assistant turns (the system prompt is prepended here).
 * @returns {{reply, provider, model, actions} | {pending, provider, actions}}
 */
export async function runAgentTurn({ chat, messages, confirmToken = null, cancelToken = null, onEvent = null }) {
  gcPending();

  let actions = [];

  // ---- Resume a paused confirmation -------------------------------------
  if (confirmToken || cancelToken) {
    const token = confirmToken || cancelToken;
    const entry = pendingConfirmations.get(token);
    if (!entry) {
      return { reply: 'That confirmation expired before I received it, Boss. Ask me again.', provider: 'system', model: '', actions };
    }
    pendingConfirmations.delete(token);

    const call = entry.batch[entry.batchIndex];
    const name = call.function.name;
    const args = parseArgs(call.function.arguments);

    if (cancelToken) {
      entry.messages.push({ role: 'tool', tool_call_id: call.id, name, content: 'The user DECLINED this action. Do not attempt it again; acknowledge and offer alternatives.' });
      actions.push({ tool: name, args, risk: 'high', decision: 'cancelled', summary: 'Declined by user' });
    } else {
      const { hints } = policyHints(name, args);
      let result;
      try {
        result = await executeSkill(name, args, hints, { chat });
      } catch (e) {
        result = `Error executing tool: ${e.message}`;
      }
      actions.push({ tool: name, args, risk: 'high', decision: 'confirmed', summary: trimToolResult(result, 200) || 'done' });
      entry.messages.push({ role: 'tool', tool_call_id: call.id, name, content: trimToolResult(result) });
    }

    // Continue with the rest of the batch, then the loop.
    messages = entry.messages;
    const batch = entry.batch;
    const rest = await processBatch(chat, messages, batch, entry.batchIndex + 1, actions, onEvent);
    if (rest.pending) return { pending: rest.pending, provider: 'pending', actions: rest.actions };

    // Fall through to the reasoning loop below with the resumed messages.
    return await reasonLoop(chat, messages, actions, onEvent);
  }

  // ---- Fresh turn --------------------------------------------------------
  const lastUser = [...messages].reverse().find(m => m.role === 'user');
  const full = [{ role: 'system', content: SYSTEM_PROMPT + memoryContextBlock() }];
  const booster = lastUser && intentBooster(lastUser.content);
  if (booster) full.push(booster);
  full.push(...messages);
  const result = await reasonLoop(chat, full, actions, onEvent);

  // Log the exchange to episodic memory so future turns remember it.
  if (result.reply && lastUser) appendEpisode({ user: lastUser.content, reply: result.reply });
  return result;
}

async function reasonLoop(chat, messages, actions, onEvent) {
  const toolHistory = [];

  for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
    const result = await chat({
      messages, tools: TOOLS, max_tokens: 1500, temperature: 0.6,
      onDelta: onEvent ? (text) => onEvent({ type: 'delta', text }) : null
    });
    if (!result.ok) throw new Error(result.error);

    const calls = normalizeToolCalls(result.raw);
    if (!calls) {
      const reply = (result.reply || '').trim();
      return { reply: reply || 'Task executed, Boss.', provider: result.provider, model: result.model, actions };
    }

    // The streamed text belonged to a tool-call turn; clear it client-side.
    if (onEvent && result.raw.content) onEvent({ type: 'reset' });
    messages.push({ role: 'assistant', content: result.raw.content || '', tool_calls: calls });

    for (const call of calls) {
      const signature = `${call.function.name}:${call.function.arguments}`;
      if (toolHistory.includes(signature)) {
        messages.push({
          role: 'tool', tool_call_id: call.id, name: call.function.name,
          content: 'System: you already tried this exact tool call and it did not help. Do not repeat it; respond with text instead.'
        });
      } else {
        toolHistory.push(signature);
      }
    }

    const { pending } = await processBatch(chat, messages, calls, 0, actions, onEvent);
    if (pending) return { pending, provider: result.provider, actions };
  }

  return { reply: 'I hit my iteration limit on that task, Boss, so I stopped there.', provider: 'system', model: '', actions };
}
