/* ==========================================================================
   F.R.I.D.A.Y. // SERVER LIB — SCHEDULE TIME
   One place that turns a reminder/task request into a concrete instant and
   back into speech. The kernel certifies the time (SCHEDULE_WRITE) before a
   skill ever calls resolveAt, so a malformed or past time cannot get here.
   ========================================================================== */

/**
 * Resolves the requested instant from either a relative delay or a clock time.
 * @param {{when?: string, delay_minutes?: number}} args
 * @returns {Date} Invalid when neither form is usable.
 */
export function resolveAt(args = {}) {
  if (typeof args.delay_minutes === 'number' && Number.isFinite(args.delay_minutes)) {
    return new Date(Date.now() + args.delay_minutes * 60000);
  }
  return new Date(Date.parse(args.when));
}

/** Human-readable time: time-only today, weekday + time otherwise. */
export function humanTime(date) {
  const now = new Date();
  const sameDay = date.toDateString() === now.toDateString();
  return date.toLocaleString(undefined, sameDay
    ? { hour: '2-digit', minute: '2-digit' }
    : { weekday: 'short', hour: '2-digit', minute: '2-digit' });
}
