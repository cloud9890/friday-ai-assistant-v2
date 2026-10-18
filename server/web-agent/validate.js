/* ==========================================================================
   F.R.I.D.A.Y. // WEB AGENT — VALIDATION & CONSTANTS
   ========================================================================== */

export const NAV_TIMEOUT = 30000;      // ms for page loads
export const ACTION_TIMEOUT = 20000;   // ms default per UI action
export const WAIT_MAX = 10000;         // ms cap for wait action
export const DOM_MAX_CHARS = 8000;     // default DOM budget (kept from legacy reader)
export const INTERACTIVE_MAX = 150;    // max interactive elements indexed per read

/** Returns a validated, absolute http(s) URL, or null. */
export function validateUrl(raw) {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  let url = raw.trim();
  if (!url.includes('://')) url = `https://${url}`;
  try {
    const u = new URL(url);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return u.href;
  } catch {
    return null;
  }
}

/** Coerces a value to an int within [min,max]; falls back to `def`. */
export function clampInt(value, def, min, max) {
  const n = Number(value);
  if (Number.isNaN(n)) return def;
  return Math.max(min, Math.min(max, Math.trunc(n)));
}

/** Normalizes a scroll direction; defaults to 'down'. */
export function validateDirection(direction) {
  const d = String(direction || 'down').toLowerCase();
  return ['down', 'up', 'top', 'bottom'].includes(d) ? d : 'down';
}

/** Validates a web-agent element id (e.g. el-12). */
export function validateElementId(id) {
  if (typeof id !== 'string' || !id.trim()) return null;
  return id.trim();
}

/** Validates a coordinate pair for clickAt: non-negative finite numbers,
 *  truncated to ints. null/undefined/'' are invalid (Number(null) is 0 and
 *  must not pass as "click at x=0"); negatives are invalid input too
 *  (clickAt clamps the upper bound to the viewport itself). */
export function validateCoordinates(x, y) {
  if (x === null || x === undefined || x === '' || y === null || y === undefined || y === '') return null;
  const nx = Number(x);
  const ny = Number(y);
  if (!Number.isFinite(nx) || !Number.isFinite(ny) || nx < 0 || ny < 0) return null;
  return { x: Math.trunc(nx), y: Math.trunc(ny) };
}

/** Validates a DOM read mode; defaults to 'interactive'. */
export function validateMode(mode) {
  const m = String(mode || 'interactive').toLowerCase();
  return ['interactive', 'readable', 'full'].includes(m) ? m : 'interactive';
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));