/* ==========================================================================
   F.R.I.D.A.Y. // SECURITY — APPLICATION LAUNCH POLICY
   Phase 1 (S4). The LLM may name an application, but only a machine-verified
   target is ever executed. Arbitrary strings are no longer passed to
   PowerShell Start-Process.
   ========================================================================== */

import { APP_EXECUTABLES, findAppShortcut, findStartApp } from '../lib/app-launcher.js';

/** Friendly names FRIDAY recognises. Mirrors the existing launcher table. */
export const ALLOWED_APPS = new Set(Object.keys(APP_EXECUTABLES));

/** Executables that hand the model a shell and are therefore never auto-approved. */
export const SENSITIVE_EXECUTABLES = new Set([
  'cmd.exe', 'powershell.exe', 'pwsh.exe', 'wscript.exe', 'cscript.exe', 'mshta.exe'
]);

/**
 * Resolves a model-supplied application name to a concrete, trusted target.
 *
 * Resolution order (unchanged behaviour for known apps):
 *   1. the curated APP_EXECUTABLES table
 *   2. a real .lnk shortcut in the user's Start Menu / Desktop
 * Anything else is denied instead of being passed through as a raw command.
 *
 * @param {string} appName
 * @returns {{ok: boolean, target?: string, sensitive?: boolean, reason?: string}}
 */
export function resolveApp(appName) {
  if (typeof appName !== 'string' || !appName.trim()) {
    return { ok: false, reason: 'appName required' };
  }

  const clean = appName.toLowerCase().trim();

  // Reject anything that is not a bare name — no paths, no arguments, no quoting games.
  if (/[\\/]/.test(clean)) return { ok: false, reason: 'appName must not contain a path' };
  if (/["'`;|&$(){}<>]/.test(clean)) return { ok: false, reason: 'appName contains invalid characters' };
  if (clean.includes('..') || clean.includes('\0')) return { ok: false, reason: 'invalid appName' };
  if (clean.length > 64) return { ok: false, reason: 'appName is too long' };

  if (ALLOWED_APPS.has(clean)) {
    const exe = APP_EXECUTABLES[clean];
    return { ok: true, target: exe, sensitive: SENSITIVE_EXECUTABLES.has(exe.toLowerCase()) };
  }

  const shortcut = findAppShortcut(clean);
  if (shortcut) {
    return { ok: true, target: shortcut, sensitive: false, source: 'shortcut' };
  }

  // Store/installed apps resolved from the Start Menu cache (name -> shell: target).
  const startApp = findStartApp(clean);
  if (startApp) {
    return { ok: true, target: startApp, sensitive: false, source: 'start-apps' };
  }

  return {
    ok: false,
    reason: `unknown application "${appName}" — not in the allow-list and no matching shortcut was found`
  };
}

/**
 * Process names whose windows must never be automated (typing into a shell
 * window is arbitrary command execution). Matches Get-Process names, not
 * exe filenames: SENSITIVE_EXECUTABLES covers launch policy, this covers the
 * desktop agent's window targeting.
 */
export const SENSITIVE_PROCESS_NAMES = new Set([
  'cmd', 'powershell', 'pwsh', 'wscript', 'cscript', 'mshta'
]);

/**
 * Static validation for a desktop-agent process target. Unlike resolveApp
 * this does NOT resolve to a launch target — it only certifies that the
 * name is a bare, injection-free process name the UIA bridge may match on.
 * The engine additionally refuses SENSITIVE_PROCESS_NAMES at execution time
 * (belt and braces with the kernel).
 *
 * @param {string} appName
 * @returns {{ok: boolean, reason?: string}}
 */
export function validateProcessTarget(appName) {
  if (typeof appName !== 'string' || !appName.trim()) {
    return { ok: false, reason: 'appName required' };
  }
  const clean = appName.toLowerCase().trim();
  if (/[\\/]/.test(clean)) return { ok: false, reason: 'appName must not contain a path' };
  if (/["'`;|&$(){}<>]/.test(clean)) return { ok: false, reason: 'appName contains invalid characters' };
  if (clean.includes('..') || clean.includes('\0')) return { ok: false, reason: 'invalid appName' };
  if (clean.length > 64) return { ok: false, reason: 'appName is too long' };
  if (SENSITIVE_PROCESS_NAMES.has(clean)) {
    return { ok: false, reason: `automating a ${clean} window is not allowed` };
  }
  return { ok: true };
}
