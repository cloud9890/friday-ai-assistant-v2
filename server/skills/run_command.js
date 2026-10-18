/* ==========================================================================
   F.R.I.D.A.Y. // SKILL — RUN COMMAND (Phase C: DOER)
   Runs one program, argv-only, with NO shell (M5). `;`, `&&`, `|`, backticks
   and redirects are therefore literal characters, never operators. The
   command policy classified this request before the executor ran; a read-only
   verb reached here without prompting, everything else was approved by Boss.
   ========================================================================== */

import { execFile } from 'child_process';
import { RISK, CONFIRMATION, PERMISSION } from '../security/risk.js';
import { describeCommand } from '../security/command-policy.js';
import { homeDir } from '../lib/paths.js';

export const DEFAULT_TIMEOUT_MS = 15000;
export const MAX_OUTPUT_CHARS = 8000;
const MAX_BUFFER_BYTES = 200000;

/**
 * Runs the command and always resolves to a plain result object (never throws),
 * so a failing command is honest output for the model rather than a crash.
 * `execFileImpl` is the seam tests stub; production passes node's execFile.
 *
 * @returns {Promise<{code: number|null, signal: string|null, stdout: string,
 *                    stderr: string, message: string|null, timedOut: boolean,
 *                    notFound: boolean}>}
 */
export function runCommand({
  command,
  args = [],
  cwd,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  execFileImpl = execFile
} = {}) {
  return new Promise((resolve) => {
    execFileImpl(
      command,
      args,
      {
        cwd,
        timeout: timeoutMs,
        maxBuffer: MAX_BUFFER_BYTES,
        windowsHide: true,
        shell: false
      },
      (err, stdout, stderr) => {
        const timedOut = Boolean(err && err.killed);
        resolve({
          code: err ? (typeof err.code === 'number' ? err.code : null) : 0,
          signal: err && err.signal ? err.signal : null,
          stdout: String(stdout || ''),
          stderr: String(stderr || ''),
          message: err ? String(err.message || '') : null,
          timedOut,
          notFound: Boolean(err && err.code === 'ENOENT')
        });
      }
    );
  });
}

function clamp(text) {
  const s = String(text || '').trim();
  if (s.length <= MAX_OUTPUT_CHARS) return s;
  return `${s.slice(0, MAX_OUTPUT_CHARS)}\n…[output truncated at ${MAX_OUTPUT_CHARS} characters]`;
}

/** Turns a run result into the text the model reads. */
export function formatResult(command, args, result, cwd) {
  const line = describeCommand({ command, args });
  const header = [`$ ${line}`, `(working directory: ${cwd})`];

  if (result.notFound) {
    return [
      ...header,
      `Command not found: ${command}.`,
      'It may be a shell builtin — F.R.I.D.A.Y. never spawns a shell, so ask for the equivalent file tool instead (list_dir, read_file, write_file, delete_path).'
    ].join('\n');
  }

  if (result.timedOut) {
    return [
      ...header,
      `The command was killed after ${DEFAULT_TIMEOUT_MS}ms without finishing.`,
      clamp(result.stdout) ? `Output so far:\n${clamp(result.stdout)}` : ''
    ].filter(Boolean).join('\n');
  }

  const parts = [...header, `exit code: ${result.code === null ? 'unknown' : result.code}`];
  const out = clamp(result.stdout);
  const err = clamp(result.stderr);
  parts.push(out ? `stdout:\n${out}` : 'stdout: (empty)');
  if (err) parts.push(`stderr:\n${err}`);
  if (result.message && !out && !err) parts.push(`error: ${result.message}`);
  return parts.join('\n');
}

export default {
  name: 'run_command',
  description: 'Runs one program with an argument list and returns its output. Read-only commands (git status/log/diff/branch/show, npm ls/outdated/view, node -v, ipconfig, tasklist, systeminfo, where, whoami, hostname, tree, ping) run right away; every other command asks Boss to confirm first. There is no shell, so do not use ;, &&, |, redirects or shell builtins (dir, del, type) — use the file tools for those.',
  parameters: {
    type: 'object',
    properties: {
      command: { type: 'string', description: 'Program name only, no path (e.g. "git", "npm", "ipconfig")' },
      args: { type: 'array', items: { type: 'string' }, description: 'Arguments, one per array item (e.g. ["status", "--short"])' },
      cwd: { type: 'string', description: 'Optional working directory inside the user profile; defaults to the home folder' }
    },
    required: ['command']
  },
  risk: RISK.HIGH,
  permissions: [PERMISSION.EXEC_COMMAND],
  // Fail-safe default: a command needs approval unless the command policy
  // proved it is read-only, in which case the kernel downgrades this to none.
  confirmation: CONFIRMATION.ALWAYS,

  describe(args) {
    const line = describeCommand({ command: args.command, args: args.args });
    return `Run this command on your PC?\n\n    ${line}`;
  },

  execute(args, ctx, hints) {
    const command = String(args.command || '');
    const list = Array.isArray(args.args) ? args.args.map(a => String(a)) : [];
    const cwd = typeof args.cwd === 'string' && args.cwd.trim() ? args.cwd : homeDir;
    return runCommand({ command, args: list, cwd })
      .then(result => formatResult(command, list, result, cwd));
  }
};
