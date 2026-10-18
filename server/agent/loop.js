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

// 16 lets a full browser chain breathe: navigate -> read -> click -> read ->
// type -> read -> verify still leaves room for retries with fresh reads.
const MAX_ITERATIONS = 16;
const PENDING_TTL_MS = 10 * 60 * 1000;
const MAX_TOOL_RESULT_CHARS = 60000;

// Tool/observation text may carry fetched or observed content, so it is framed
// as data for the model and never presented as instructions (C4).
const UNTRUSTED_OPEN = '<<<UNTRUSTED_TOOL_OUTPUT>>>';
const UNTRUSTED_CLOSE = '<<<END_UNTRUSTED_TOOL_OUTPUT>>>';
function frameUntrusted(text) {
  return `${UNTRUSTED_OPEN}\n${text}\n${UNTRUSTED_CLOSE}`;
}

/** token -> { messages, batch, batchIndex, createdAt } */
const pendingConfirmations = new Map();

function gcPending() {
  const now = Date.now();
  for (const [token, entry] of pendingConfirmations) {
    if (now - entry.createdAt > PENDING_TTL_MS || entry.signal?.aborted) pendingConfirmations.delete(token);
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
async function processBatch(chat, messages, batch, batchIndex, actions, onEvent, screenFrame, signal) {
  for (let i = batchIndex; i < batch.length; i++) {
    // A stop must halt the server, not just the client fetch (C5).
    if (signal?.aborted) return { actions, pending: null, aborted: true };
    const call = batch[i];
    const name = call.function.name;
    const args = parseArgs(call.function.arguments);

    const hints = policyHints(name, args);
    const decision = authorize({ tool: name, args, actor: 'agent', ...hints });

    if (decision.decision !== 'allow') {
      actions.push({ tool: name, args, risk: decision.risk, decision: 'denied', summary: decision.reason });
      messages.push({ role: 'tool', tool_call_id: call.id, name, content: `Policy denied this action: ${decision.reason}. Explain this to the user and choose another approach.` });
      continue;
    }

    // The kernel's app resolution lands on the decision; apply it to args so
    // the skill executes the vetted target, never the raw model string.
    if (decision.resolvedApp) args.__resolvedApp = decision.resolvedApp;

    // Destructive capabilities pause the loop for explicit user approval. The
    // kernel may have downgraded the skill's default (a read-only command does
    // not need approval), so the effective mode on the decision is what counts.
    if (decision.confirmation === 'always') {
      const token = `confirm_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      pendingConfirmations.set(token, { messages, batch, batchIndex: i, createdAt: Date.now(), signal });
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
      result = await executeSkill(name, args, hints, { chat, screenFrame });
      onEvent?.({ type: 'toolDone', name, summary: trimToolResult(result, 200) || 'done' });
    } catch (e) {
      result = `Error executing tool: ${e.message}`;
    }
    actions.push({ tool: name, args, risk: decision.risk, decision: 'allowed', summary: trimToolResult(result, 200) || 'done' });
    messages.push({ role: 'tool', tool_call_id: call.id, name, content: frameUntrusted(trimToolResult(result)) });
  }
  return { actions, pending: null };
}

/**
 * Deterministic nudge for unambiguous memory/reminder intents small models
 * tend to answer from text instead of calling the tool. Patterns are
 * deliberately strict — "remember to open notepad" or "recall the file" must
 * NOT trigger a memory tool. Injected as a system message just for that turn.
 */
function intentBooster(userText) {
  const t = String(userText || '').toLowerCase();

  // --- Reminders / scheduled tasks (checked before memory: "forget my
  // reminder" is a task cancel, not a memory erase) ---
  const isReminderWrite = /\bremind me (to|in|at|about|when)\b/.test(t)
    || /^\s*(please\s+)?(set|create) (a |an )?(reminder|alarm)\b/.test(t)
    || /\b(wake me|notify me) (up )?(at|in)\b/.test(t);
  const isReminderErase = /\b(cancel|delete|remove|drop|forget)\b[^.]*\b(reminder|alarm|task)s?\b/.test(t);
  const isReminderRead = /\b(list|show|check|read)\b[^.]*\b(reminders?|alarms?|tasks?)\b/.test(t)
    || /\bwhat('s| is) (scheduled|pending|on my (list|schedule))\b/.test(t)
    || /\bwhat (reminders|tasks|alarms)\b/.test(t);

  if (isReminderWrite) {
    return { role: 'system', content: 'Directive: the user wants a REMINDER. Call set_reminder now with a short "text" and a time: use delay_minutes for a relative time ("in 10 minutes"), or call get_current_time first and then pass `when` as an ISO 8601 date-time for a clock time. Then confirm briefly. Do not say a reminder is set without calling the tool.' };
  }
  if (isReminderErase) {
    return { role: 'system', content: 'Directive: the user wants a scheduled REMINDER cancelled. Call cancel_task (pass the id if you know it, otherwise a piece of its text). If it is ambiguous, call list_tasks and ask which one. Do not answer from text alone.' };
  }
  if (isReminderRead) {
    return { role: 'system', content: 'Directive: the user asks what is SCHEDULED. Call list_tasks and report the pending items in natural speech. Do not answer from text alone.' };
  }

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

  // --- Knowledge base (the user's own documents, indexed locally) ---
  const isIndex = /\b(index|re-?index)\b[^.]*\b(documents?|files?|notes?|folder|knowledge)\b/.test(t);
  const isKnowledgeAsk = /\b(what did i (write|say|note)|search (my|the) (notes|documents|files)|look (in|through) my (notes|documents)|find .* in my (notes|documents)|ask my (document|notes?|files?))\b/.test(t);

  if (isIndex) {
    return { role: 'system', content: 'Directive: the user wants their files indexed into the local knowledge base. Call index_folder with a "path" ("documents", "desktop" or "home") and then confirm how many files were indexed. Do not answer from text alone.' };
  }
  if (isKnowledgeAsk) {
    return { role: 'system', content: 'Directive: the user is asking about their own indexed documents. Call search_knowledge with the topic, then answer using the returned passages and cite the file and line. If the index is empty or nothing matches, say so and offer to index the folder. Do not invent content.' };
  }
  // --- Run a command on this PC ---
  const isRunCommand = /\b(run|execute)\s+(the\s+)?(command|cmd|terminal|shell)\b/.test(t)
    || /\b(run|check|show)\s+(git\s+status|git\s+log|ipconfig|tasklist|systeminfo|npm\s+ls)\b/.test(t);
  if (isRunCommand) {
    return { role: 'system', content: 'Directive: the user wants a command run on this PC. Call run_command with "command" (a bare program name such as "git") and "args" as an array (e.g. ["status", "--short"]). Read-only commands run immediately; anything else asks Boss to approve first. Report the real output — never invent it.' };
  }

  // --- File automation: organise / zip / convert (Phase C tail) ---
  const isOrganize = /\b(organi[sz]e|tidy|clean up|sort)\b[^.]*\b(folder|files|desktop|documents|downloads)\b/.test(t);
  const isZip = /\b(zip|compress|archive)\b[^.]*\b(folder|files|desktop|documents)\b/.test(t)
    || /\b(make|create|build)\b[^.]*\bzip\b/.test(t);
  const isConvert = /\b(convert|change)\b[^.]*\b(image|picture|photo|png|jpe?g|bmp)\b/.test(t);

  if (isOrganize) {
    return { role: 'system', content: 'Directive: the user wants a folder TIDIED. Call organize_files with a "parent" ("desktop" or "documents") and, if they named a subfolder, a "folder". Boss approves the plan before anything moves. Do not answer from text alone.' };
  }
  if (isZip) {
    return { role: 'system', content: 'Directive: the user wants a folder COMPRESSED. Call zip_folder with "name" (the folder name) and "parent" ("desktop" or "documents"). It creates a .zip beside the folder. Do not answer from text alone.' };
  }
  if (isConvert) {
    return { role: 'system', content: 'Directive: the user wants an IMAGE converted. Call convert_image with "name" (the image file name with its extension), "parent" ("desktop" or "documents") and "format" (png, jpg or bmp). Do not answer from text alone.' };
  }
  return null;
}

/**
 * Runs one agent turn.
 * @param {{chat: Function, messages: Array, confirmToken?: string, cancelToken?: string, screenFrame?: string}} params
 *   messages: prior user/assistant turns (the system prompt is prepended here).
 * @returns {{reply, provider, model, actions} | {pending, provider, actions}}
 */
export async function runAgentTurn({ chat, messages, confirmToken = null, cancelToken = null, screenFrame = null, onEvent = null, signal = null }) {
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
    } else if (signal?.aborted) {
      entry.messages.push({ role: 'tool', tool_call_id: call.id, name, content: 'The user stopped the task. Do not perform it.' });
      actions.push({ tool: name, args, risk: 'high', decision: 'cancelled', summary: 'Stopped by user' });
    } else {
      const hints = policyHints(name, args);
      let result;
      try {
        result = await executeSkill(name, args, hints, { chat, screenFrame });
      } catch (e) {
        result = `Error executing tool: ${e.message}`;
      }
      actions.push({ tool: name, args, risk: 'high', decision: 'confirmed', summary: trimToolResult(result, 200) || 'done' });
      entry.messages.push({ role: 'tool', tool_call_id: call.id, name, content: frameUntrusted(trimToolResult(result)) });
    }

    // Continue with the rest of the batch, then the loop.
    messages = entry.messages;
    const batch = entry.batch;
    const rest = await processBatch(chat, messages, batch, entry.batchIndex + 1, actions, onEvent, screenFrame, signal);
    if (rest.aborted) return { reply: 'Stopped, Boss.', provider: 'system', model: '', actions, aborted: true };
    if (rest.pending) return { pending: rest.pending, provider: 'pending', actions: rest.actions };

    // Fall through to the reasoning loop below with the resumed messages.
    return await reasonLoop(chat, messages, actions, onEvent, screenFrame, signal);
  }

  // ---- Fresh turn --------------------------------------------------------
  const lastUser = [...messages].reverse().find(m => m.role === 'user');
  const full = [{ role: 'system', content: SYSTEM_PROMPT + memoryContextBlock() }];
  const booster = lastUser && intentBooster(lastUser.content);
  if (booster) full.push(booster);
  full.push(...messages);
  const result = await reasonLoop(chat, full, actions, onEvent, screenFrame, signal);

  // Log the exchange to episodic memory so future turns remember it.
  if (result.reply && lastUser && !result.aborted) appendEpisode({ user: lastUser.content, reply: result.reply });
  return result;
}

async function reasonLoop(chat, messages, actions, onEvent, screenFrame, signal) {
  const toolHistory = [];

  for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
    if (signal?.aborted) return { reply: 'Stopped, Boss.', provider: 'system', model: '', actions, aborted: true };
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

    // A repeated call is answered with a nudge and NOT executed: running it
    // again would emit two tool messages sharing one tool_call_id (H5).
    const toRun = [];
    for (const call of calls) {
      const signature = `${call.function.name}:${call.function.arguments}`;
      if (toolHistory.includes(signature)) {
        messages.push({
          role: 'tool', tool_call_id: call.id, name: call.function.name,
          content: 'System: you already tried this exact tool call and it did not help. Do not repeat it; respond with text instead.'
        });
      } else {
        toolHistory.push(signature);
        toRun.push(call);
      }
    }

    const { pending, aborted } = await processBatch(chat, messages, toRun, 0, actions, onEvent, screenFrame, signal);
    if (aborted) return { reply: 'Stopped, Boss.', provider: 'system', model: '', actions, aborted: true };
    if (pending) return { pending, provider: result.provider, actions };
  }

  return { reply: 'I hit my iteration limit on that task, Boss, so I stopped there.', provider: 'system', model: '', actions };
}
