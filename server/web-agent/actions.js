/* ==========================================================================
   F.R.I.D.A.Y. // WEB AGENT — PAGE ACTIONS (low-level, page-agnostic)
   ========================================================================== */

import { validateElementId, validateDirection, NAV_TIMEOUT, sleep } from './validate.js';

const KEY_MAP = {
  enter: 'Enter', 'return': 'Enter', escape: 'Escape', esc: 'Escape', tab: 'Tab',
  backspace: 'Backspace', delete: 'Delete', space: 'Space', ' ': 'Space',
  arrowleft: 'ArrowLeft', arrowright: 'ArrowRight', arrowup: 'ArrowUp', arrowdown: 'ArrowDown',
  home: 'Home', end: 'End', pageup: 'PageUp', pagedown: 'PageDown',
  f5: 'F5', f11: 'F11'
};
const MODIFIER_MAP = { shift: 'Shift', control: 'Control', ctrl: 'Control', alt: 'Alt', meta: 'Meta' };

const queryBy = (id) => `[data-agent-id="${id}"]`;

export async function navigateTo(page, url) {
  await page.goto(url, { waitUntil: 'networkidle2', timeout: NAV_TIMEOUT });
  return { ok: true };
}

export async function goBack(page) {
  try { await page.goBack({ waitUntil: 'networkidle2', timeout: NAV_TIMEOUT }); return { ok: true }; }
  catch (e) { return { ok: false, error: `Could not navigate back: ${e.message}` }; }
}

export async function goForward(page) {
  try { await page.goForward({ waitUntil: 'networkidle2', timeout: NAV_TIMEOUT }); return { ok: true }; }
  catch (e) { return { ok: false, error: `Could not navigate forward: ${e.message}` }; }
}

export async function reloadPage(page) {
  try { await page.reload({ waitUntil: 'networkidle2', timeout: NAV_TIMEOUT }); return { ok: true }; }
  catch (e) { return { ok: false, error: `Could not reload: ${e.message}` }; }
}

export async function clickElement(page, elementId) {
  const id = validateElementId(elementId);
  if (!id) return { ok: false, error: 'Missing elementId for click.' };
  const el = await page.$(queryBy(id));
  if (!el) return { ok: false, error: `Element ${id} not found. The page may have changed - re-read it with getDOM first.` };
  await page.evaluate((eid) => {
    const target = document.querySelector(`[data-agent-id="${eid}"]`);
    if (target) target.click();
  }, id);
  await sleep(2000); // allow navigation / dynamic renders
  return { ok: true };
}

export async function typeInto(page, elementId, text) {
  const id = validateElementId(elementId);
  if (!id) return { ok: false, error: 'Missing elementId for type.' };
  if (typeof text !== 'string') return { ok: false, error: 'Missing text for type.' };
  const el = await page.$(queryBy(id));
  if (!el) return { ok: false, error: `Element ${id} not found. The page may have changed - re-read it with getDOM first.` };
  await page.evaluate((eid) => {
    const target = document.querySelector(`[data-agent-id="${eid}"]`);
    if (target) { target.focus(); target.value = ''; }
  }, id);
  await el.type(text, { delay: 50 });
  await sleep(500);
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
  await page.keyboard.press(mainKey, modifiers.length > 0 ? { modifiers } : undefined);
  await sleep(300);
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
  await el.hover();
  await sleep(400);
  return { ok: true };
}

export async function scrollPage(page, direction = 'down') {
  const dir = validateDirection(direction);
  await page.evaluate((d) => {
    if (d === 'top') window.scrollTo(0, 0);
    else if (d === 'bottom') window.scrollTo(0, document.documentElement.scrollHeight);
    else if (d === 'up') window.scrollBy(0, -window.innerHeight * 0.8);
    else window.scrollBy(0, window.innerHeight * 0.8);
  }, dir);
  await sleep(1500);
  return { ok: true };
}