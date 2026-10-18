/* ==========================================================================
   F.R.I.D.A.Y. // DESKTOP AGENT — NODE BRIDGE
   Runs the UIA PowerShell bridge (execFile array args — no shell, no
   injection surface) and normalises its JSON output. Error contract mirrors
   the computer-use skill: { code, actionSent, retry }.
   ========================================================================== */

import { execFile } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const UIA_SCRIPT = path.join(__dirname, 'uia.ps1');
export const CAPTURE_SCRIPT = path.join(__dirname, 'capture.ps1');

export const ERROR_CODES = {
  APP_NOT_FOUND: { retry: 'never' },
  AMBIGUOUS_APP: { retry: 'retry' },       // retry with an exact pid
  SENSITIVE_APP: { retry: 'never' },
  ELEMENT_UNAVAILABLE: { retry: 'reobserve' },
  STALE_STATE: { retry: 'reobserve' },
  ACTION_UNAVAILABLE: { retry: 'never' },
  INVALID_ARGUMENT: { retry: 'never' },
  NOT_WINDOWS: { retry: 'never' },
  TIMEOUT: { retry: 'retry' },
  INTERNAL: { retry: 'retry' }
};

export class DesktopUseError extends Error {
  constructor(code, message, actionSent = false) {
    super(message);
    this.name = 'DesktopUseError';
    this.code = ERROR_CODES[code] ? code : 'INTERNAL';
    this.retry = ERROR_CODES[this.code].retry;
    this.actionSent = actionSent;
  }
}

/** Pure JSON parser for the bridge's stdout (unit-tested). */
export function parseUiaOutput(stdout) {
  const raw = String(stdout || '').trim();
  if (!raw) {
    throw new DesktopUseError('INTERNAL', 'UIA bridge produced no output');
  }
  // PS Write-Output may interleave benign stderr-style noise; the JSON object
  // is the only thing on stdout, so take the first '{' to the last '}'.
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) {
    throw new DesktopUseError('INTERNAL', `UIA bridge output was not JSON: ${raw.slice(0, 200)}`);
  }
  let parsed;
  try {
    parsed = JSON.parse(raw.slice(start, end + 1));
  } catch (e) {
    throw new DesktopUseError('INTERNAL', `UIA bridge returned malformed JSON: ${e.message}`);
  }
  if (!parsed || typeof parsed !== 'object') {
    throw new DesktopUseError('INTERNAL', 'UIA bridge returned a non-object payload');
  }
  return parsed;
}

/**
 * Runs one bridge script. Resolves with the JSON payload (ok:true) or
 * rejects with DesktopUseError.
 * @param {object} args  script parameters (action, appName, pid, ...)
 * @param {string} scriptPath  which bridge script to run (uia.ps1 default)
 */
export function runScript(args = {}, scriptPath = UIA_SCRIPT) {
  if (process.platform !== 'win32') {
    return Promise.reject(new DesktopUseError('NOT_WINDOWS', 'desktop control is only available on Windows'));
  }
  const argv = [
    '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
    '-File', scriptPath
  ];
  // Only uia.ps1 dispatches on -Action; capture.ps1 has no such parameter.
  if (scriptPath === UIA_SCRIPT) argv.push('-Action', String(args.action || ''));
  const opt = (flag, value) => {
    if (value === undefined || value === null || value === '') return;
    argv.push(flag, String(value));
  };
  opt('-AppName', args.appName);
  opt('-WindowTitle', args.windowTitle);
  opt('-Text', args.text);
  opt('-Key', args.key);
  opt('-Direction', args.direction);
  opt('-ActionName', args.actionName);
  opt('-Query', args.query);
  if (Number(args.pid) > 0) argv.push('-ProcId', String(Math.trunc(Number(args.pid))));
  if (Number.isFinite(Number(args.index)) && Number(args.index) >= 0) argv.push('-Index', String(Math.trunc(Number(args.index))));
  if (Number(args.maxElements) > 0) argv.push('-MaxElements', String(Math.trunc(Number(args.maxElements))));

  return new Promise((resolve, reject) => {
    execFile('powershell.exe', argv, {
      timeout: 30000,
      maxBuffer: 32 * 1024 * 1024,
      windowsHide: true
    }, (err, stdout) => {
      if (err && !stdout) {
        const code = err.killed ? 'TIMEOUT' : 'INTERNAL';
        return reject(new DesktopUseError(code, `UIA bridge failed: ${err.message}`));
      }
      try {
        const payload = parseUiaOutput(stdout);
        if (payload.ok) return resolve(payload);
        return reject(new DesktopUseError(
          payload.code || 'INTERNAL',
          payload.error || 'UIA action failed',
          Boolean(payload.actionSent)
        ));
      } catch (e) {
        reject(e);
      }
    });
  });
}

/** UIA actions (observe, click, setValue, ...). */
export function runUia(args = {}) {
  return runScript(args, UIA_SCRIPT);
}

/** Window capture. Separate script: capture must never ship input injection. */
export function runCapture(args = {}) {
  return runScript(args, CAPTURE_SCRIPT);
}

/** The bridge is usable on Windows hosts only. */
export function desktopAgentAvailable() {
  return process.platform === 'win32';
}
