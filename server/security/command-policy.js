/* ==========================================================================
   F.R.I.D.A.Y. // SECURITY — COMMAND POLICY (Phase C: DOER)

   Decides whether a command may run. Three verdicts:
     ALLOW   - a read-only verb with read-only arguments: run immediately.
     CONFIRM - anything else: the user must approve the exact argv first.
     DENY    - never runs, whatever the user says: shells, disk/system verbs,
               destructive argv patterns, and anything that dodges the network
               policy.

   The command is ALWAYS executed as an argument array (execFile, no shell), so
   `;`, `&&`, `|`, backticks and redirects are never interpreted — they can only
   ever be literal arguments. This module decides; the caller obeys, exactly like
   path-policy and network-policy.

   Residual (documented, not hidden): a weaponised `git.exe` placed earlier in
   PATH would still be executed. Closing that needs a signed/known-path
   allow-list of binaries; until then the mitigation is that unknown verbs are
   CONFIRM, never ALLOW, and the confirmation shows the full argv.
   ========================================================================== */

export const COMMAND_DECISION = { ALLOW: 'allow', CONFIRM: 'confirm', DENY: 'deny' };

export const MAX_COMMAND_CHARS = 64;
export const MAX_ARGS = 32;
export const MAX_ARG_CHARS = 500;

/**
 * Verbs that are never executed: they are shells (arbitrary execution), they
 * manage disks/users/services/registry (system-level and irreversible), or they
 * fetch network content outside the audited network policy.
 */
const DENY_VERBS = new Set([
  // shells and script hosts — these ARE arbitrary execution
  'cmd', 'cmd.exe', 'powershell', 'powershell.exe', 'pwsh', 'pwsh.exe',
  'bash', 'sh', 'zsh', 'wsl', 'wsl.exe', 'cscript', 'cscript.exe',
  'wscript', 'wscript.exe', 'mshta', 'mshta.exe', 'rundll32', 'rundll32.exe',
  'installutil', 'regasm', 'regsvcs', 'conhost', 'start',
  // disks, boot, firmware
  'format', 'format.com', 'diskpart', 'diskpart.exe', 'bcdedit', 'bootrec',
  'mkfs', 'dd', 'fsutil', 'cipher', 'vssadmin', 'wbadmin', 'chkdsk',
  // accounts, registry, services, scheduled tasks, privilege
  'reg', 'reg.exe', 'regedit', 'regedit.exe', 'net', 'net1', 'sc', 'sc.exe',
  'wmic', 'wmic.exe', 'schtasks', 'at', 'runas', 'psexec', 'msiexec',
  'takeown', 'icacls', 'netstat-mock', 'whoami-priv',
  // network fetch outside the network policy
  'curl', 'curl.exe', 'wget', 'wget.exe', 'certutil', 'bitsadmin', 'ftp', 'tftp'
]);

/**
 * Argument patterns that mean "destroy or reconfigure the machine". Scanned
 * against the whole argv, so `del /f /s X` and `Remove-Item -Recurse X` are
 * caught wherever they appear.
 */
const DENY_PATTERNS = [
  /\b(rmdir|rd)\s+\/[sq]/i,
  /\bdel\s+\/[fsq]/i,
  /\berase\s+\/[fsq]/i,
  /\brm\s+-[a-z]*[rf]/i,
  /\bshred\b/i,
  /remove-item[\s\S]*-recurse/i,
  /\b(format|mkfs|diskpart|dd)\b/i,
  /\bdd\s+if=/i,
  /\bmkfs\.[a-z0-9]+\b/i,
  /(^|\s):\(\)\s*\{/,
  /\b(shutdown|reboot|poweroff|halt)\b/i,
  /\bstop-computer\b/i,
  /\b(restart-computer)\b/i,
  /\bnet\s+(user|localgroup|share|accounts)\b/i,
  /\breg\s+(add|delete|import|restore)\b/i,
  /\bsc\s+(delete|config|stop|start)\b/i,
  /\btaskkill\b[\s\S]*\/im\s+\*/i,
  /\bcipher\s+\/w/i,
  /\b(clear-disk|initialize-disk|remove-partition|new-partition|set-disk)\b/i,
  /\bvssadmin\b/i,
  /\bbcdedit\b/i,
  /\bicacls\b[\s\S]*\/(grant|deny|reset|setowner)/i,
  /\b(curl|wget|invoke-webrequest|iwr|invoke-restmethod)\b/i,
  /(^|\s)(>|>>|<)\s*[a-z]:\\/i   // shell redirection the runner cannot honour
];

/**
 * Shell composition operators. With argv-only execution these can never be
 * interpreted, but their presence means the user was composing a shell command
 * — never auto-approved.
 */
const SHELL_METACHARACTERS = /[;&|<>`]|\$\(|\r|\n/;

/**
 * Read-only verbs, each with a stricter rule for its arguments. A verb is only
 * auto-approved while every argument passes that rule.
 * A rule returns null (fine) or a reason string.
 */
const ALLOWED = [
  {
    name: 'git',
    allow(args) {
      const sub = (args[0] || '').toLowerCase();
      const readOnly = ['status', 'log', 'diff', 'show', 'rev-parse', 'ls-files', 'remote', 'describe', 'shortlog', 'blame'];
      if (sub === 'branch') {
        const bad = args.slice(1).find(a => !/^(-a|-r|-v|-vv|--all|--list|--verbose|--remotes)$/.test(a));
        return bad ? `git branch with "${bad}" can modify branches` : null;
      }
      if (!readOnly.includes(sub)) return 'git subcommand is not read-only';
      return null;
    }
  },
  {
    name: 'npm',
    allow(args) {
      const sub = (args[0] || '').toLowerCase();
      return ['ls', 'list', 'outdated', 'view'].includes(sub) ? null : 'npm subcommand is not read-only';
    }
  },
  {
    name: 'node',
    allow(args) {
      const exact = args.length === 1 && /^(-v|--version)$/.test(args[0]);
      return exact ? null : 'node is only allowed with -v or --version';
    }
  },
  { name: 'ipconfig', allow: () => null },
  { name: 'systeminfo', allow: () => null },
  { name: 'hostname', allow: () => null },
  { name: 'tasklist', allow: () => null },
  { name: 'tree', allow: () => null },
  { name: 'ping', allow: () => null },
  { name: 'where', allow: () => null },
  {
    name: 'whoami',
    // whoami on its own lists the local account; with /priv it reports
    // privileges, which is still read-only.
    allow: () => null
  }
];

const ALLOWED_BY_NAME = new Map(ALLOWED.map(entry => [entry.name, entry]));

function asArgs(raw) {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) return null;
  return raw;
}

/** True when the verb is a cmd.exe builtin that cannot be execFile'd. */
export const SHELL_BUILTINS = new Set([
  'dir', 'del', 'erase', 'copy', 'move', 'ren', 'rename', 'md', 'mkdir',
  'rd', 'rmdir', 'type', 'echo', 'set', 'cd', 'chdir', 'cls', 'ver', 'vol',
  'assoc', 'ftype', 'mklink', 'color', 'date', 'time', 'title', 'prompt'
]);

function isBuiltin(verb) {
  return SHELL_BUILTINS.has(verb) || SHELL_BUILTINS.has(verb.replace(/\.(exe|com)$/i, ''));
}

/**
 * Classifies one command request.
 * @param {{command?: string, args?: string[]}} request
 * @returns {{decision: string, reason: string}}
 */
export function classifyCommand({ command, args } = {}) {
  const verb = typeof command === 'string' ? command.trim() : '';
  if (!verb) return { decision: COMMAND_DECISION.DENY, reason: 'command is required' };
  if (verb.length > MAX_COMMAND_CHARS) {
    return { decision: COMMAND_DECISION.DENY, reason: `command name is too long (max ${MAX_COMMAND_CHARS})` };
  }
  if (/[\0\r\n]/.test(verb)) return { decision: COMMAND_DECISION.DENY, reason: 'command contains control characters' };
  if (/[\\/]/.test(verb)) {
    return { decision: COMMAND_DECISION.DENY, reason: 'command must be a bare program name (no path separators)' };
  }
  if (/[;&|<>`$]/.test(verb)) return { decision: COMMAND_DECISION.DENY, reason: 'command contains shell operators' };

  const list = asArgs(args);
  if (list === null) return { decision: COMMAND_DECISION.DENY, reason: 'args must be an array of strings' };
  if (list.length > MAX_ARGS) return { decision: COMMAND_DECISION.DENY, reason: `too many arguments (max ${MAX_ARGS})` };
  for (const arg of list) {
    if (typeof arg !== 'string') return { decision: COMMAND_DECISION.DENY, reason: 'every argument must be a string' };
    if (arg.length > MAX_ARG_CHARS) return { decision: COMMAND_DECISION.DENY, reason: `an argument is too long (max ${MAX_ARG_CHARS})` };
    if (arg.includes('\0')) return { decision: COMMAND_DECISION.DENY, reason: 'an argument contains a NUL byte' };
    if (/[\r\n]/.test(arg)) return { decision: COMMAND_DECISION.DENY, reason: 'an argument contains a line break' };
  }

  const lower = verb.toLowerCase();
  const joined = [verb, ...list].join(' ');

  if (DENY_VERBS.has(lower)) {
    return { decision: COMMAND_DECISION.DENY, reason: `"${verb}" is never executed by F.R.I.D.A.Y.` };
  }
  for (const pattern of DENY_PATTERNS) {
    if (pattern.test(joined)) {
      return { decision: COMMAND_DECISION.DENY, reason: `refused: the command matches a destructive pattern` };
    }
  }

  const entry = ALLOWED_BY_NAME.get(lower);
  if (entry && !SHELL_METACHARACTERS.test(joined)) {
    const why = entry.allow(list);
    if (!why) return { decision: COMMAND_DECISION.ALLOW, reason: '' };
    return { decision: COMMAND_DECISION.CONFIRM, reason: why };
  }

  if (isBuiltin(lower)) {
    return { decision: COMMAND_DECISION.CONFIRM, reason: `"${verb}" is a shell builtin — F.R.I.D.A.Y. never spawns a shell, so this cannot run as a program` };
  }
  if (SHELL_METACHARACTERS.test(joined)) {
    return { decision: COMMAND_DECISION.CONFIRM, reason: 'the arguments contain shell operators, which are never interpreted' };
  }
  return { decision: COMMAND_DECISION.CONFIRM, reason: 'this command is not on the read-only list' };
}

/** The read-only verbs the user can run without a confirmation. */
export function autoApprovedVerbs() {
  return ALLOWED.map(entry => entry.name);
}

/** Human-readable one-liner for a confirmation prompt. */
export function describeCommand({ command, args } = {}) {
  const list = Array.isArray(args) ? args : [];
  return [String(command || ''), ...list].join(' ').trim();
}
