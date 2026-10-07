/* Shared helpers for skills. No policy logic lives here. */

import { exec } from 'child_process';
import { desktopDir, documentsDir } from '../lib/paths.js';

/** Allowed parent folders for file skills ('desktop' | 'documents'). */
export function resolveParent(parent) {
  const key = String(parent || 'desktop').toLowerCase().trim();
  if (key === 'documents') return documentsDir;
  if (key === 'desktop') return desktopDir;
  return null;
}

export function openWithOS(target) {
  const command = process.platform === 'win32' ? `start "" "${target}"`
    : process.platform === 'darwin' ? `open "${target}"` : `xdg-open "${target}"`;
  exec(command);
}

export async function youtubeFirstVideoId(query) {
  const searchUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
  const res = await fetch(searchUrl, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(10000) });
  const html = await res.text();
  const match = html.match(/\/watch\?v=([a-zA-Z0-9_-]{11})/);
  return match ? `https://www.youtube.com/watch?v=${match[1]}` : searchUrl;
}

export function runPowerShellScript(scriptPath, args) {
  exec(`powershell -ExecutionPolicy Bypass -WindowStyle Hidden -File "${scriptPath}" ${args}`);
}
