/* ==========================================================================
   F.R.I.D.A.Y. // DESKTOP AGENT — ENGINE (HTTP-facing orchestrator)
   Computer-use discipline: observe first, act on indices from the latest
   observation, verify the effect from the read-back every action returns.
   The UIA bridge does the work; this layer formats model-facing results,
   remembers each app's last observation for stale-index detection, and runs
   the vision fallback for UIs the accessibility tree cannot see.
   ========================================================================== */

import { runUia, runCapture, DesktopUseError } from './uia.js';
import { runVisionAnalysis } from '../lib/vision-proxy.js';
import { validateProcessTarget } from '../security/app-policy.js';
import { clampInt } from '../web-agent/validate.js';

const VISION_SYSTEM_PROMPT = `You are F.R.I.D.A.Y., Tony Stark's advanced tactical AI. Analyze the provided application window screenshot and answer the query directly in 1-3 concise sentences. Focus on what the user asked about.`;

/** pid -> { treeCount, windowTitle, at } of the last observation. */
const lastObservation = new Map();

function targetArgs(body) {
  return {
    appName: typeof body.appName === 'string' ? body.appName.trim() : '',
    pid: Number(body.pid) > 0 ? Math.trunc(Number(body.pid)) : 0,
    windowTitle: typeof body.windowTitle === 'string' ? body.windowTitle.trim() : ''
  };
}

/* ------------------------- model-facing formatting ------------------------ */

export function formatApps(apps) {
  if (!apps || apps.length === 0) return 'No running apps with visible windows.';
  return apps.map((a) =>
    `- ${a.process} (pid ${a.pid}) "${a.title}"${a.sensitive ? ' [blocked for automation]' : ''}`
  ).join('\n');
}

export function formatElements(elements) {
  if (!elements || elements.length === 0) {
    return 'No elements matched. Re-observe without a query to see the whole tree.';
  }
  return elements.map((e) => {
    const flags = [];
    if (!e.enabled) flags.push('disabled');
    if (e.offscreen) flags.push('offscreen');
    if (e.focused) flags.push('focused');
    const flagStr = flags.length ? ` [${flags.join(',')}]` : '';
    const patterns = Array.isArray(e.patterns) && e.patterns.length ? ` patterns=${e.patterns.join('+')}` : '';
    const value = e.value ? ` value="${String(e.value).slice(0, 60)}"` : '';
    const rect = e.rect ? ` rect=${e.rect.x},${e.rect.y} ${e.rect.w}x${e.rect.h}` : '';
    const name = e.name ? `"${String(e.name).slice(0, 80)}"` : '""';
    return `#${e.index} [${String(e.role).toUpperCase()}] ${name}${value}${flagStr}${patterns}${rect}`;
  }).join('\n');
}

const OBSERVATION_CAP = 40000;

function observationHeader(payload) {
  return `Window: ${payload.process} (pid ${payload.pid}) "${payload.windowTitle}" — ${payload.treeCount} elements in tree, ${payload.listed} listed${payload.treeCount > payload.listed ? ' (use query= or raise maxElements to see more)' : ''}`;
}

export function formatObserve(payload) {
  const lines = [observationHeader(payload), formatElements(payload.elements)];
  const text = lines.join('\n');
  return text.length > OBSERVATION_CAP ? text.slice(0, OBSERVATION_CAP) + '\n…[truncated]' : text;
}

/** Advisory when an index was never seen in this app's last full observation. */
function staleAdvisory(pid, index) {
  const last = lastObservation.get(pid);
  if (!last || !Number.isInteger(index) || index < 0) return '';
  if (index >= last.treeCount) {
    return `Warning: index ${index} is beyond the last observation of this window (${last.treeCount} elements). You are acting on the CURRENT tree — observe again if that was not intended.`;
  }
  return '';
}

/* -------------------------------- dispatcher ------------------------------ */

export async function handleDesktopAgent(body = {}) {
  const action = typeof body.action === 'string' ? body.action.trim() : '';
  if (!action) return { success: false, error: 'Missing "action".' };

  const target = targetArgs(body);

  // Engine-side enforcement of the static name policy (kernel already gates
  // agent calls; this covers direct API use too).
  if (target.appName) {
    const check = validateProcessTarget(target.appName);
    if (!check.ok) return { success: false, error: check.reason };
  }

  try {
    switch (action) {
      case 'listApps': {
        const payload = await runUia({ action: 'listApps' });
        return { success: true, action, apps: payload.apps, result: formatApps(payload.apps) };
      }

      case 'observe': {
        const payload = await runUia({
          action: 'observe',
          appName: target.appName,
          pid: target.pid,
          windowTitle: target.windowTitle,
          query: body.query,
          maxElements: clampInt(body.maxElements, 120, 10, 300)
        });
        lastObservation.set(payload.pid, {
          treeCount: payload.treeCount,
          windowTitle: payload.windowTitle,
          at: Date.now()
        });
        return { success: true, action, pid: payload.pid, observation: formatObserve(payload) };
      }

      case 'click':
      case 'focus':
      case 'performAction': {
        if (!Number.isInteger(Number(body.index)) || Number(body.index) < 0) {
          return { success: false, error: `${action} needs an element index from the latest observation.` };
        }
        const payload = await runUia({
          action,
          ...target,
          index: Number(body.index),
          actionName: body.actionName
        });
        const advisory = staleAdvisory(payload.pid, Number(body.index));
        return {
          success: true,
          action,
          result: [
            advisory,
            `${action} on #${body.index} [${payload.target ? String(payload.target.role).toUpperCase() : '?'}] "${payload.target ? payload.target.name : ''}" via ${payload.via || payload.performed || 'pattern'}.`,
            `Window now: "${payload.windowTitle}". Keyboard focus: ${payload.focusedAfter ? `${payload.focusedAfter.role} "${payload.focusedAfter.name}"` : 'undetermined'}.`,
            'If this was meant to change the page, observe again to verify the effect.'
          ].filter(Boolean).join('\n')
        };
      }

      case 'setValue': {
        if (!Number.isInteger(Number(body.index)) || Number(body.index) < 0) {
          return { success: false, error: 'setValue needs an element index from the latest observation.' };
        }
        if (typeof body.text !== 'string') return { success: false, error: 'setValue needs text.' };
        const payload = await runUia({ action: 'setValue', ...target, index: Number(body.index), text: body.text });
        const advisory = staleAdvisory(payload.pid, Number(body.index));
        return {
          success: true,
          action,
          result: [
            advisory,
            `Set value on #${body.index} [${String(payload.target.role).toUpperCase()}] "${payload.target.name}" via ${payload.via}.`,
            payload.landed
              ? `Verified: the element now reads "${payload.readBack}".`
              : `NOT VERIFIED: read-back was "${payload.readBack}" but "${payload.requested}" was requested. Observe and retry (the control may be a rich editor).`,
            `Window now: "${payload.windowTitle}".`
          ].join('\n')
        };
      }

      case 'pressKey': {
        if (!body.key || !String(body.key).trim()) {
          return { success: false, error: 'pressKey needs a key (e.g. Enter, ctrl+a, alt+F4).' };
        }
        const payload = await runUia({ action: 'pressKey', ...target, key: String(body.key) });
        return {
          success: true,
          action,
          result: `Sent ${payload.sent} to "${payload.windowTitle}". Keyboard focus: ${payload.focusedAfter ? `${payload.focusedAfter.role} "${payload.focusedAfter.name}"` : 'undetermined'}. Observe again to verify the effect.`
        };
      }

      case 'scroll': {
        const payload = await runUia({ action: 'scroll', ...target, direction: body.direction });
        return { success: true, action, result: `Scrolled ${payload.direction} in "${payload.windowTitle}". Observe again to see the new content.` };
      }

      case 'screenshot': {
        const payload = await runCapture({ ...target });
        const result = {
          success: true,
          action,
          windowTitle: payload.windowTitle,
          size: payload.size
        };
        if (typeof body.query === 'string' && body.query.trim()) {
          try {
            const vdata = await runVisionAnalysis({
              image_url: payload.screenshot,
              text: body.query,
              system_prompt: VISION_SYSTEM_PROMPT
            });
            result.analysis = vdata.choices?.[0]?.message?.content || '';
          } catch (e) {
            result.analysisError = e.message;
          }
        }
        result.result = [
          result.analysis ? `[Visual Analysis]: ${result.analysis}` : 'Screenshot captured.',
          result.analysisError ? `[Vision analysis error]: ${result.analysisError}` : ''
        ].filter(Boolean).join('\n');
        return result;
      }

      default:
        return { success: false, error: `Unknown desktop agent action: ${action}` };
    }
  } catch (e) {
    if (e instanceof DesktopUseError) {
      return {
        success: false,
        error: `${e.code}: ${e.message}${e.retry ? ` (${e.retry})` : ''}`,
        code: e.code
      };
    }
    return { success: false, error: `Desktop agent error: ${e.message}` };
  }
}

/** Test hook: forget remembered observations. */
export function resetDesktopSession() {
  lastObservation.clear();
}
