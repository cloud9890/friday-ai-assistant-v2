/* ==========================================================================
   F.R.I.D.A.Y. // SERVER LIB — NOTIFICATION BUS
   One place every proactive message goes through: a persisted ring buffer the
   HUD polls (so a reminder still lands if the tab was closed), plus a
   best-effort native Windows toast so it lands even when the HUD is not open.

   No in-process cache: the file IS the state, so a notification survives a
   server restart exactly like a scheduled job does. Toast failures never
   throw and never block — the HUD channel is the reliable path.
   ========================================================================== */

import fs from 'fs';
import path from 'path';
import { execFile } from 'child_process';

const NOTIFY_FILE = path.join(process.cwd(), 'data', 'notifications.json');
const MAX_KEPT = 100;
const MAX_TEXT_CHARS = 500;
const TOAST_TIMEOUT_MS = 8000;

// WinRT toast shown as PowerShell's own AppId — no extra module (BurntToast)
// and no AppUserModelID registration required on Windows 10/11.
const TOAST_SCRIPT = `
$ErrorActionPreference = 'Stop'
[void][Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType=WindowsRuntime]
[void][Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom, ContentType=WindowsRuntime]
$title = [System.Security.SecurityElement]::Escape($env:FRIDAY_NOTIFY_TITLE)
$body = [System.Security.SecurityElement]::Escape($env:FRIDAY_NOTIFY_BODY)
$xml = New-Object Windows.Data.Xml.Dom.XmlDocument
$xml.LoadXml("<toast><visual><binding template='ToastGeneric'><text>$title</text><text>$body</text></binding></visual></toast>")
$toast = New-Object Windows.UI.Notifications.ToastNotification $xml
$appId = '{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\\WindowsPowerShell\\v1.0\\powershell.exe'
[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($appId).Show($toast)
`;

function load() {
  try {
    const parsed = JSON.parse(fs.readFileSync(NOTIFY_FILE, 'utf8'));
    return { items: Array.isArray(parsed.items) ? parsed.items : [] };
  } catch {
    return { items: [] };
  }
}

function persist(store) {
  try {
    fs.mkdirSync(path.dirname(NOTIFY_FILE), { recursive: true });
    const tmp = NOTIFY_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(store, null, 2), 'utf8');
    fs.renameSync(tmp, NOTIFY_FILE);
    return true;
  } catch (e) {
    console.warn('Notification persist failed:', e.message);
    return false;
  }
}

function clean(text, max = MAX_TEXT_CHARS) {
  return String(text ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
}

/** Fires the native toast without ever blocking or throwing. */
function showWindowsToast(title, body) {
  if (process.platform !== 'win32') return;
  if (process.env.FRIDAY_NO_TOAST === '1') return; // headless / test runs
  try {
    const child = execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', TOAST_SCRIPT],
      {
        windowsHide: true,
        timeout: TOAST_TIMEOUT_MS,
        env: { ...process.env, FRIDAY_NOTIFY_TITLE: title, FRIDAY_NOTIFY_BODY: body }
      },
      () => {} // errors are the OS's problem; the HUD channel already carried it
    );
    child.unref?.();
  } catch (e) {
    console.warn('Windows toast skipped:', e.message);
  }
}

/**
 * Records a notification and shows a native toast. The id is monotonic, so the
 * HUD can ask for "everything newer than N" without ever duplicating or
 * missing one across a reload.
 *
 * @param {{title?: string, body: string, speak?: boolean}} entry
 * @returns {{id: number, ts: string, title: string, body: string, speak: boolean}}
 */
export function notify({ title = 'F.R.I.D.A.Y.', body = '', speak = true } = {}) {
  const store = load();
  const item = {
    id: store.items.reduce((max, n) => Math.max(max, Number(n.id) || 0), 0) + 1,
    ts: new Date().toISOString(),
    title: clean(title, 80) || 'F.R.I.D.A.Y.',
    body: clean(body),
    speak: Boolean(speak)
  };
  store.items.push(item);
  while (store.items.length > MAX_KEPT) store.items.shift();
  persist(store);
  showWindowsToast(item.title, item.body);
  return item;
}

/** Notifications newer than `sinceId`, oldest first (HUD order of delivery). */
export function listNotifications({ sinceId = 0, limit = 20 } = {}) {
  const since = Number(sinceId) || 0;
  return load().items.filter(n => Number(n.id) > since).slice(0, Math.max(1, limit));
}

/** Highest id recorded so far — lets a fresh HUD seed without replaying history. */
export function latestNotificationId() {
  return load().items.reduce((max, n) => Math.max(max, Number(n.id) || 0), 0);
}

export function notificationsFilePath() {
  return NOTIFY_FILE;
}
