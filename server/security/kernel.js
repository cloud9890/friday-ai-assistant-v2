/* ==========================================================================
   F.R.I.D.A.Y. // SECURITY — POLICY KERNEL
   Phase 1 (S3/S4/S5/S6). The single authority that decides whether a requested
   action may run. Executors never make this decision themselves and never see a
   request that the kernel has not approved.
   ========================================================================== */

import path from 'path';
import { DECISION, RISK, CONFIRMATION, deny } from './risk.js';
import { PERMISSION, getToolMetadata, validateInput } from './permissions.js';
import { resolveApp, validateProcessTarget, SENSITIVE_EXECUTABLES } from './app-policy.js';
import { checkUrl, checkUrlForAgent } from './network-policy.js';
import { checkWritePath, checkReadPath, checkDeletePath, checkFileName, checkIndexPath } from './path-policy.js';
import { classifyCommand, COMMAND_DECISION } from './command-policy.js';
import { documentsDir, desktopDir, homeDir } from '../lib/paths.js';
import { auditEvent } from './audit.js';

function fail(reason) {
  return deny(reason);
}

/**
 * Runs the policy for one permission. Returns null when the permission has no
 * additional constraint beyond the risk level.
 *
 * @param {string} permission
 * @param {object} args  validated args, plus internal __-hints
 * @param {string} tool  capability key, for permissions shared by many skills
 */
function checkPermission(permission, args, tool) {
  switch (permission) {
    case PERMISSION.LAUNCH_PROCESS: {
      if (args.appName !== undefined) {
        const app = resolveApp(args.appName);
        if (!app.ok) return { reason: app.reason };
        // H4: a launcher must not hand the model a shell. The macro branch has
        // always refused these; the direct-launch branch did not.
        if (app.sensitive || SENSITIVE_EXECUTABLES.has(String(app.target || '').toLowerCase())) {
          return { reason: `launching a shell (${app.target}) is not allowed` };
        }
        args.__resolvedApp = app.target;
      }
      return null;
    }

    case PERMISSION.SCRIPT_EXECUTE: {
      // Macros: every step is validated before any step runs (fail closed).
      const steps = args.steps;
      if (!Array.isArray(steps)) return { reason: 'steps must be an array' };
      if (steps.length === 0 || steps.length > 20) {
        return { reason: 'steps must contain between 1 and 20 items' };
      }
      let cumulative = 0;
      for (const step of steps) {
        if (!step || typeof step !== 'object') return { reason: 'invalid macro step' };
        if (step.type === 'app') {
          const app = resolveApp(step.target);
          if (!app.ok) return { reason: `macro app step: ${app.reason}` };
          if (app.target && SENSITIVE_EXECUTABLES.has(String(app.target).toLowerCase())) {
            return { reason: `macro cannot launch ${app.target}` };
          }
        } else if (step.type === 'url') {
          const url = checkUrl(step.target, { allowPrivate: false });
          if (!url.ok) return { reason: `macro url step: ${url.reason}` };
        } else if (step.type === 'delay') {
          const ms = Number(step.ms) || 1000;
          if (ms < 0 || ms > 10000) return { reason: 'delay ms must be between 0 and 10000' };
          cumulative += ms;
          if (cumulative > 30000) return { reason: 'cumulative delay cannot exceed 30000ms' };
        } else {
          return { reason: `unknown step type: ${step.type}` };
        }
      }
      return null;
    }

    case PERMISSION.WRITE_FILES: {
      if (args.__fileName !== undefined) {
        const file = checkFileName(args.__fileName);
        if (!file.ok) return { reason: file.reason };
      }
      if (args.__targetPath !== undefined) {
        const dest = checkWritePath(args.__targetPath);
        if (!dest.ok) return { reason: dest.reason };
      }
      return null;
    }

    case PERMISSION.READ_FILES: {
      // Validate the file name and the resolved file path, not just the
      // folder — a directory-only check is bypassed by traversal (C1).
      if (args.__fileName !== undefined) {
        const file = checkFileName(args.__fileName);
        if (!file.ok) return { reason: file.reason };
      }
      if (args.__targetPath !== undefined) {
        const target = checkReadPath(args.__targetPath);
        if (!target.ok) return { reason: target.reason };
      }
      if (Array.isArray(args.__readDirs)) {
        for (const dir of args.__readDirs) {
          const check = checkReadPath(dir);
          if (!check.ok) return { reason: check.reason };
        }
      }
      return null;
    }

    case PERMISSION.INDEX_READ: {
      // Knowledge indexing reads files whose text is embedded and fed back to
      // the model, so it validates the resolved path exactly like READ_FILES
      // (C1) and additionally refuses the segments the indexer must not crawl
      // (FRIDAY's own data/, .git, node_modules) — checkIndexPath.
      if (args.__fileName !== undefined) {
        const file = checkFileName(args.__fileName);
        if (!file.ok) return { reason: file.reason };
      }
      if (args.__targetPath !== undefined) {
        const target = checkIndexPath(args.__targetPath);
        if (!target.ok) return { reason: target.reason };
      }
      if (Array.isArray(args.__readDirs)) {
        for (const dir of args.__readDirs) {
          const check = checkIndexPath(dir);
          if (!check.ok) return { reason: check.reason };
        }
      }
      return null;
    }

    case PERMISSION.EXEC_COMMAND: {
      // The command policy classifies the exact argv: DENY never runs, ALLOW
      // (read-only verb, read-only arguments) runs without asking, anything
      // else must be approved. The verdict is carried on the decision as the
      // effective confirmation mode, so the caller obeys rather than decides.
      const verdict = classifyCommand({ command: args.command, args: args.args });
      if (verdict.decision === COMMAND_DECISION.DENY) return { reason: verdict.reason };
      if (args.cwd !== undefined) {
        const dir = checkReadPath(args.cwd);
        if (!dir.ok) return { reason: `cwd: ${dir.reason}` };
      }
      args.__confirmation = verdict.decision === COMMAND_DECISION.CONFIRM ? CONFIRMATION.ALWAYS : CONFIRMATION.NONE;
      args.__commandVerdict = verdict.decision;
      return null;
    }

    case PERMISSION.DELETE_FILES: {
      if (args.__targetPath !== undefined) {
        const dest = checkDeletePath(args.__targetPath);
        if (!dest.ok) return { reason: dest.reason };
      }
      return null;
    }

    case PERMISSION.NETWORK_FETCH: {
      const url = args.url;
      if (typeof url === 'string' && url.trim()) {
        const result = args.__viaAgent === true
          ? checkUrlForAgent(url)
          : checkUrl(url, { allowPrivate: false });
        if (!result.ok) return { reason: result.reason };
      }
      return null;
    }

    case PERMISSION.BROWSER_AUTOMATE: {
      const url = args.url;
      if (typeof url === 'string' && url.trim()) {
        const result = checkUrlForAgent(url);
        if (!result.ok) return { reason: result.reason };
      }
      return null;
    }

    case PERMISSION.UI_AUTOMATE: {
      // Desktop agent targets a RUNNING process window, not a launch target:
      // certify the name is bare and injection-free. The sensitive-process
      // block also lives in the engine (defence in depth).
      if (args.appName !== undefined && args.appName !== '') {
        const target = validateProcessTarget(args.appName);
        if (!target.ok) return { reason: target.reason };
      }
      return null;
    }

    case PERMISSION.SCHEDULE_WRITE: {
      // Only the reminder-creating skill carries a timestamp; cancel_task
      // shares the permission but has nothing time-shaped to certify.
      if (tool !== 'set_reminder') return null;

      if (typeof args.text !== 'string' || args.text.trim().length < 2) {
        return { reason: 'text is required' };
      }

      const when = args.when;
      const delay = args.delay_minutes;
      const hasWhen = typeof when === 'string' && when.trim() !== '';
      const hasDelay = delay !== undefined && delay !== null;

      if (!hasWhen && !hasDelay) return { reason: 'set_reminder needs either "when" or "delay_minutes"' };
      if (hasWhen && hasDelay) return { reason: 'set_reminder takes either "when" or "delay_minutes", not both' };

      if (hasDelay) {
        if (typeof delay !== 'number' || !Number.isFinite(delay)) {
          return { reason: 'delay_minutes must be a number' };
        }
        if (delay <= 0 || delay > 43200) {
          return { reason: 'delay_minutes must be greater than 0 and at most 43200 (30 days)' };
        }
      }

      if (hasWhen) {
        const at = Date.parse(when);
        if (Number.isNaN(at)) return { reason: 'when must be an ISO 8601 date-time (e.g. 2026-10-18T17:30:00)' };
        const delta = at - Date.now();
        if (delta < -60000) return { reason: 'when is in the past' };
        if (delta > 366 * 24 * 60 * 60 * 1000) return { reason: 'when must be within the next year' };
      }
      return null;
    }

    case PERMISSION.NOTIFY: {
      const message = args.message;
      if (typeof message !== 'string' || message.trim().length < 2) {
        return { reason: 'message is required' };
      }
      if (message.length > 500) return { reason: 'message must be 500 characters or fewer' };
      return null;
    }

    case PERMISSION.SCHEDULE_READ:
      return null;

    default:
      return null;
  }
}

/**
 * Authorises a single action.
 *
 * @param {{
 *   tool: string,            // capability key (tool name or endpoint-mapped key)
 *   args?: object,           // model- or caller-supplied arguments
 *   actor?: string,          // 'api' | 'agent' | 'ui'
 *   taskId?: string,
 *   __fileName?: string,     // internal: file name for write policy
 *   __targetPath?: string,   // internal: absolute destination path
 *   __readDirs?: string[],   // internal: directories to be read
 *   __viaAgent?: boolean     // internal: request originates from the browser agent
 * }} request
 *
 * @returns {{decision: string, reason: string, risk: string, confirmation: string,
 *            meta: object|null, clean: object}}
 */
export function authorize(request = {}) {
  const started = Date.now();
  const { tool, actor = 'api', taskId = null } = request;
  const args = { ...(request.args || {}) };

  // Internal hints travel alongside args but are not part of the tool schema.
  for (const key of ['__fileName', '__targetPath', '__readDirs', '__viaAgent']) {
    if (request[key] !== undefined) args[key] = request[key];
  }

  const meta = getToolMetadata(tool);

  const finish = (result) => {
    auditEvent({
      actor,
      tool,
      action: typeof args.action === 'string' ? args.action : null,
      risk: meta ? meta.risk : RISK.BLOCKED,
      decision: result.decision,
      reason: result.reason,
      target: args.__targetPath || args.appName || args.url || args.query || args.command || null,
      outcome: 'authorized',
      durationMs: Date.now() - started,
      taskId
    });
    return {
      decision: result.decision,
      reason: result.reason || '',
      risk: meta ? meta.risk : RISK.BLOCKED,
      confirmation: args.__confirmation || (meta ? meta.confirmation : 'none'),
      meta,
      clean: args.__clean || {},
      resolvedApp: args.__resolvedApp || null
    };
  };

  // 1. Unknown capabilities fail closed — FRIDAY never guesses.
  if (!meta) {
    return finish(fail(`unknown capability: ${tool}`));
  }

  // 2. Structurally blocked capabilities never execute.
  if (meta.risk === RISK.BLOCKED) {
    return finish(fail(`${tool} is blocked by policy`));
  }

  // 3. Argument shape validation (schema-first; unknown keys are dropped).
  const shape = validateInput(meta.inputSchema, args);
  if (!shape.ok) {
    return finish(fail(shape.reason));
  }
  args.__clean = shape.clean;

  // 4. Permission-specific policy.
  for (const permission of meta.permissions) {
    const result = checkPermission(permission, args, tool);
    if (result && result.reason) {
      return finish(fail(result.reason));
    }
  }

  // 5. Confirmation requirement is surfaced, never silently satisfied.
  return finish({ decision: DECISION.ALLOW, reason: '' });
}

/** Convenience helper for callers that only need a boolean. */
export function isAllowed(request) {
  return authorize(request).decision === DECISION.ALLOW;
}

/**
 * Resolves the exact destination a write will land in — the same path the
 * save-file route builds, so policy validates what will really be written.
 */
export function resolveWriteTarget(fileName, targetFolder = 'Desktop', format = 'txt') {
  const dir = String(targetFolder).toLowerCase() === 'documents' ? documentsDir : desktopDir;
  const safe = String(fileName).replace(/[^a-zA-Z0-9_\-\.]/g, '_');
  let full = path.join(dir, safe);
  if (format === 'docx') {
    if (!full.endsWith('.docx')) full += '.docx';
  } else if (!full.endsWith('.txt') && !full.endsWith('.md')) {
    full += '.txt';
  }
  return full;
}

export { RISK };
export const READ_ROOTS_META = { homeDir, desktopDir, documentsDir };