/* ==========================================================================
   F.R.I.D.A.Y. // WEB AGENT — PAGE ACTIONS (low-level, page-agnostic)
   Real-input discipline ported from the control-browser skill: actions use
   real mouse/keyboard events, then wait on what the PAGE does (navigation
   or network settle) instead of blind fixed sleeps.
   ========================================================================== */

import { validateElementId, validateDirection, validateCoordinates, NAV_TIMEOUT, sleep } from './validate.js';

const KEY_MAP = {
  enter: 'Enter', 'return': 'Enter', escape: 'Escape', esc: 'Escape', tab: 'Tab',
  backspace: 'Backspace', delete: 'Delete', space: 'Space', ' ': 'Space',
  arrowleft: 'ArrowLeft', arrowright: 'ArrowRight', arrowup: 'ArrowUp', arrowdown: 'ArrowDown',
  home: 'Home', end: 'End', pageup: 'PageUp', pagedown: 'PageDown',
  insert: 'Insert', f5: 'F5', f11: 'F11', f12: 'F12'
};
const MODIFIER_MAP = { shift: 'Shift', control: 'Control', ctrl: 'Control', alt: 'Alt', meta: 'Meta' };

const queryBy = (id) => `[data-agent-id="${id}"]`;

/** domcontentloaded plus a short bounded network-idle probe — never hangs
 *  on SPAs that keep persistent sockets open. */
async function settleLoad(page) {
  await page.waitForNetworkIdle({ idleTime: 500, timeout: 5000 }).catch(() => {});
}

/**
 * Post-action settle: resolves as soon as the page navigates OR its network
 * goes quiet OR the cap elapses — whichever comes first. A pure JS handler
 * (no nav, no fetch) settles in ~1s instead of a fixed multi-second sleep.
 */
async function settleAfterAction(page, capMs = 8000) {
  const nav = page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: capMs })
    .then(() => 'nav').catch(() => null);
  const idle = (async () => {
    await sleep(400);
    await page.waitForNetworkIdle({ idleTime: 500, timeout: Math.max(1000, capMs - 1200) }).catch(() => {});
    return 'idle';
  })();
  await Promise.race([nav, idle]);
}

async function scrollIntoView(el) {
  try { await el.scrollIntoViewIfNeeded(); }
  catch { await el.evaluate((n) => n.scrollIntoView({ block: 'center' })).catch(() => {}); }
}

export async function navigateTo(page, url) {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT });
  await settleLoad(page);
  return { ok: true };
}

export async function goBack(page) {
  try {
    await page.goBack({ waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT });
    await settleLoad(page);
    return { ok: true };
  } catch (e) { return { ok: false, error: `Could not navigate back: ${e.message}` }; }
}

export async function goForward(page) {
  try {
    await page.goForward({ waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT });
    await settleLoad(page);
    return { ok: true };
  } catch (e) { return { ok: false, error: `Could not navigate forward: ${e.message}` }; }
}

export async function reloadPage(page) {
  try {
    await page.reload({ waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT });
    await settleLoad(page);
    return { ok: true };
  } catch (e) { return { ok: false, error: `Could not reload: ${e.message}` }; }
}

export async function clickElement(page, elementId) {
  const id = validateElementId(elementId);
  if (!id) return { ok: false, error: 'Missing elementId for click.' };
  const el = await page.$(queryBy(id));
  if (!el) return { ok: false, error: `Element ${id} not found. The page may have changed - re-read it with getDOM first.` };
  const urlBefore = page.url();
  await scrollIntoView(el);
  // Real mouse click at the element (honours overlays and pointer handlers);
  // programmatic .click() only as a fallback when the real click throws.
  const settle = settleAfterAction(page);
  let real = true;
  try { await el.click(); }
  catch {
    real = false;
    await page.evaluate((eid) => {
      const target = document.querySelector(`[data-agent-id="${eid}"]`);
      if (target) target.click();
    }, id);
  }
  await settle;
  return { ok: true, urlBefore, urlAfter: page.url(), realClick: real };
}

export async function clickAt(page, x, y) {
  const coords = validateCoordinates(x, y);
  if (!coords) return { ok: false, error: 'Missing or invalid x/y coordinates for clickAt (numbers, viewport pixels).' };
  const dims = await page.evaluate(() => ({
    w: window.innerWidth || document.documentElement.clientWidth,
    h: window.innerHeight || document.documentElement.clientHeight
  }));
  const cx = Math.min(coords.x, Math.max(0, dims.w - 1));
  const cy = Math.min(coords.y, Math.max(0, dims.h - 1));
  const urlBefore = page.url();
  const settle = settleAfterAction(page);
  await page.mouse.click(cx, cy);
  await settle;
  return { ok: true, x: cx, y: cy, urlBefore, urlAfter: page.url() };
}

export async function typeInto(page, elementId, text, { submit = false } = {}) {
  const id = validateElementId(elementId);
  if (!id) return { ok: false, error: 'Missing elementId for type.' };
  if (typeof text !== 'string') return { ok: false, error: 'Missing text for type.' };
  const el = await page.$(queryBy(id));
  if (!el) return { ok: false, error: `Element ${id} not found. The page may have changed - re-read it with getDOM first.` };
  await scrollIntoView(el);
  await el.focus();
  // Clear via keyboard (Ctrl+A, Delete) so controlled inputs (React, Vue)
  // see the change through real events instead of a silent .value write.
  await page.keyboard.down('Control');
  await page.keyboard.press('a');
  await page.keyboard.up('Control');
  await page.keyboard.press('Delete');
  await el.type(text, { delay: 35 });
  if (submit) {
    const settle = settleAfterAction(page);
    await page.keyboard.press('Enter');
    await settle;
  } else {
    await sleep(300);
  }
  return { ok: true };
}

export async function pressKeys(page, keys) {
  if (typeof keys !== 'string' || !keys.trim()) return { ok: false, error: 'Missing keys for keypress (e.g. "Enter", "ctrl+c").' };
  const parts = keys.split('+').map((p) => p.trim()).filter(Boolean);
  const modifiers = [];
  const mainParts = [];
  for (const p of parts) {
    const mapped = MODIFIER_MAP[p.toLowerCase()];
    if (mapped) modifiers.push(mapped);
    else mainParts.push(KEY_MAP[p.toLowerCase()] || p);
  }
  const mainKey = mainParts[mainParts.length - 1] || 'Enter';
  const settle = settleAfterAction(page, 5000);
  await page.keyboard.press(mainKey, modifiers.length > 0 ? { modifiers } : undefined);
  await settle;
  return { ok: true };
}

export async function selectOption(page, elementId, value) {
  const id = validateElementId(elementId);
  if (!id || value === undefined || value === null) return { ok: false, error: 'Missing elementId/value for select.' };
  const el = await page.$(queryBy(id));
  if (!el) return { ok: false, error: `Element ${id} not found. The page may have changed - re-read it with getDOM first.` };
  try {
    await el.select(String(value));
  } catch (e) {
    return { ok: false, error: `Could not select option: ${e.message}` };
  }
  await sleep(400);
  return { ok: true };
}

export async function hoverElement(page, elementId) {
  const id = validateElementId(elementId);
  if (!id) return { ok: false, error: 'Missing elementId for hover.' };
  const el = await page.$(queryBy(id));
  if (!el) return { ok: false, error: `Element ${id} not found. The page may have changed - re-read it with getDOM first.` };
  await scrollIntoView(el);
  await el.hover();
  await sleep(400);
  return { ok: true };
}

export async function scrollPage(page, direction = 'down', elementId = null) {
  if (elementId) {
    const id = validateElementId(elementId);
    if (!id) return { ok: false, error: 'Invalid elementId for scroll.' };
    const el = await page.$(queryBy(id));
    if (!el) return { ok: false, error: `Element ${id} not found. The page may have changed - re-read it with getDOM first.` };
    await scrollIntoView(el);
    await sleep(600);
    return { ok: true };
  }
  const dir = validateDirection(direction);
  await page.evaluate((d) => {
    if (d === 'top') window.scrollTo({ top: 0 });
    else if (d === 'bottom') window.scrollTo({ top: document.documentElement.scrollHeight });
    else if (d === 'up') window.scrollBy({ top: -window.innerHeight * 0.8 });
    else window.scrollBy({ top: window.innerHeight * 0.8 });
  }, dir);
  await sleep(1000);
  return { ok: true };
}
