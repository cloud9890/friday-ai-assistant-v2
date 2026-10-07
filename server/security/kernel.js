/* ==========================================================================
   F.R.I.D.A.Y. // SECURITY — POLICY KERNEL
   Phase 1 (S3/S4/S5/S6). The single authority that decides whether a requested
   action may run. Executors never make this decision themselves and never see a
   request that the kernel has not approved.
   ========================================================================== */

import path from 'path';
import { DECISION, RISK, deny } from './risk.js';
import { PERMISSION, getToolMetadata, validateInput } from './permissions.js';
import { resolveApp, SENSITIVE_EXECUTABLES } from './app-policy.js';
import { checkUrl, checkUrlForAgent } from './network-policy.js';
import { checkWritePath, checkReadPath, checkDeletePath, checkFileName } from './path-policy.js';
import { documentsDir, desktopDir, homeDir } from '../lib/paths.js';
import { auditEvent } from './audit.js';

function fail(reason) {
  return deny(reason);
}

/**
 * Runs the policy for one permission. Returns null when the permission has no
 * additional constraint beyond the risk level.
 */
function checkPermission(permission, args) {
  switch (permission) {
    case PERMISSION.LAUNCH_PROCESS: {
      if (args.appName !== undefined) {
        const app = resolveApp(args.appName);
        if (!app.ok) return { reason: app.reason };
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
      if (Array.isArray(args.__readDirs)) {
        for (const dir of args.__readDirs) {
          const check = checkReadPath(dir);
          if (!check.ok) return { reason: check.reason };
        }
      }
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
      target: args.__targetPath || args.appName || args.url || args.query || null,
      outcome: 'authorized',
      durationMs: Date.now() - started,
      taskId
    });
    return {
      decision: result.decision,
      reason: result.reason || '',
      risk: meta ? meta.risk : RISK.BLOCKED,
      confirmation: meta ? meta.confirmation : 'none',
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
    const result = checkPermission(permission, args);
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