/* ==========================================================================
   F.R.I.D.A.Y. // SERVER LIB — APP LAUNCHER
   ========================================================================== */

import { exec, execFile } from 'child_process';
import fs from 'fs';
import path from 'path';
import { homeDir } from './paths.js';

export const APP_EXECUTABLES = {
  'notepad': 'notepad.exe',
  'calculator': 'calc.exe',
  'calc': 'calc.exe',
  'vscode': 'code',
  'vs code': 'code',
  'code': 'code',
  'explorer': 'explorer.exe',
  'file explorer': 'explorer.exe',
  'chrome': 'chrome.exe',
  'browser': 'chrome.exe',
  'task manager': 'taskmgr.exe',
  'cmd': 'cmd.exe',
  'command prompt': 'cmd.exe',
  'powershell': 'powershell.exe',
  'paint': 'mspaint.exe',
  'word': 'winword.exe',
  'excel': 'excel.exe',
  'snipping tool': 'snippingtool.exe'
};

/* --- Start Menu / UWP cache ---------------------------------------------
   Windows Store and installed apps have no .lnk shortcut FRIDAY can resolve.
   At server boot we cache the Get-StartApps listing (name -> AppUserModelID)
   so app-policy can resolve names like "spotify" or "telegram" synchronously
   into shell: targets. The cache holds names only — never paths or args. */
let startAppsCache = null;

export function primeStartAppsCache() {
  if (process.platform !== 'win32') return;
  exec(
    'powershell -NoProfile -Command "Get-StartApps | ConvertTo-Json -Compress"',
    { timeout: 20000 },
    (err, stdout) => {
      if (err || !stdout) return;
      try {
        const data = JSON.parse(stdout);
        const items = Array.isArray(data) ? data : [data];
        const map = new Map();
        for (const item of items) {
          if (item && item.Name && item.AppID && String(item.AppID).includes('!')) {
            map.set(String(item.Name).toLowerCase().trim(), String(item.AppID));
          }
        }
        startAppsCache = map;
        console.log(`  📋 Cached ${map.size} Start Menu apps for launch resolution`);
      } catch (e) { /* keep whatever cache existed */ }
    }
  );
}

export function findStartApp(appName) {
  if (!startAppsCache) return null;
  const clean = String(appName).toLowerCase().trim();
  if (startAppsCache.has(clean)) return `shell:AppsFolder\\${startAppsCache.get(clean)}`;
  const hits = [...startAppsCache.entries()].filter(([name]) => name.includes(clean));
  return hits.length === 1 ? `shell:AppsFolder\\${hits[0][1]}` : null;
}

export function findAppShortcut(appName) {
  const pathsToSearch = [
    path.join(homeDir, 'AppData', 'Roaming', 'Microsoft', 'Windows', 'Start Menu', 'Programs'),
    path.join(process.env.ALLUSERSPROFILE || 'C:\\ProgramData', 'Microsoft', 'Windows', 'Start Menu', 'Programs'),
    path.join(homeDir, 'Desktop'),
    path.join(process.env.PUBLIC || 'C:\\Users\\Public', 'Desktop')
  ];

  function searchDir(dirPath) {
    if (!fs.existsSync(dirPath)) return null;
    try {
      const files = fs.readdirSync(dirPath, { withFileTypes: true });
      for (const file of files) {
        if (file.isDirectory()) {
          const res = searchDir(path.join(dirPath, file.name));
          if (res) return res;
        } else if (file.name.toLowerCase().includes(appName.toLowerCase()) && file.name.toLowerCase().endsWith('.lnk')) {
          return path.join(dirPath, file.name);
        }
      }
    } catch(e) {}
    return null;
  }

  for (const dir of pathsToSearch) {
    const match = searchDir(dir);
    if (match) return match;
  }
  return null;
}

export function launchInInteractiveSession(target) {
  return new Promise((resolve) => {
    // UWP apps launch through the shell: namespace via explorer.
    if (String(target).startsWith('shell:')) {
      execFile('explorer.exe', [target], { timeout: 10000 }, (err) => {
        if (err) console.warn(`  ❌ Launch failed for "${target}":`, err.message);
        resolve(!err);
      });
      return;
    }
    const cmd = 'powershell.exe';
    const args = ['-Command', `Start-Process '${target.replace(/'/g, "''")}'`];

    execFile(cmd, args, { timeout: 10000 }, (err) => {
      if (err) {
        console.warn(`  ❌ Launch failed for "${target}":`, err.message);
        exec(`start "" "${target.replace(/"/g, '""')}"`, (err2) => {
          resolve(!err2);
        });
      } else {
        console.log(`  ✅ Launched: "${target}"`);
        resolve(true);
      }
    });
  });
}
