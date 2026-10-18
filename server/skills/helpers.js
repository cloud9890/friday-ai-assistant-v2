/* Shared helpers for skills. No policy logic lives here. */

import { execFile } from 'child_process';
import { desktopDir, documentsDir } from '../lib/paths.js';
import { safeFetch } from '../lib/safe-fetch.js';

/** Allowed parent folders for file skills ('desktop' | 'documents'). */
export function resolveParent(parent) {
  const key = String(parent || 'desktop').toLowerCase().trim();
  if (key === 'documents') return documentsDir;
  if (key === 'desktop') return desktopDir;
  return null;
}

/**
 * Opens a URL or file with the OS handler. The target is passed as an argument
 * array, never interpolated into a shell string, so quotes and metacharacters
 * in it cannot become operators (M5).
 */
export function openWithOS(target) {
  const value = String(target);
  const [cmd, args] = process.platform === 'win32'
    ? ['rundll32.exe', ['url.dll,FileProtocolHandler', value]]
    : process.platform === 'darwin'
      ? ['open', [value]]
      : ['xdg-open', [value]];
  execFile(cmd, args, { windowsHide: true }, () => {});
}

export async function youtubeFirstVideoId(query) {
  const searchUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
  const res = await safeFetch(searchUrl, { timeoutMs: 10000 });
  const html = await res.text();
  const match = html.match(/\/watch\?v=([a-zA-Z0-9_-]{11})/);
  return match ? `https://www.youtube.com/watch?v=${match[1]}` : searchUrl;
}

/**
 * Runs a PowerShell script file with an argument ARRAY. The script path and
 * every argument travel as separate argv entries, so nothing the caller passes
 * can alter the command line (M5).
 */
export function runPowerShellScript(scriptPath, args = []) {
  const argv = Array.isArray(args) ? args.map(a => String(a)) : [];
  execFile(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-File', String(scriptPath), ...argv],
    { windowsHide: true, timeout: 20000 },
    () => {}
  );
}
