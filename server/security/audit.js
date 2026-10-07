/* ==========================================================================
   F.R.I.D.A.Y. // SECURITY — AUDIT TRAIL
   Phase 1 (S9). Every policy decision and every executed action is recorded as
   one JSON line, with secrets redacted before they ever reach the file.
   ========================================================================== */

import fs from 'fs';
import path from 'path';

const AUDIT_DIR = path.resolve('data');
const AUDIT_FILE = path.join(AUDIT_DIR, 'audit.jsonl');

// Values under these keys are replaced before writing.
const SECRET_KEY = /(key|token|secret|password|passwd|authorization|auth|cookie|session|credential|apikey)/i;

// Free-text patterns that look like credentials.
const SECRET_VALUE_PATTERNS = [
  /\bsk-[A-Za-z0-9_-]{12,}\b/g,
  /\bgsk_[A-Za-z0-9_-]{12,}\b/g,
  /\bBearer\s+[A-Za-z0-9._-]{12,}\b/gi,
  /\bxi-api-key\b/gi
];

const MAX_STRING = 500;
const MAX_DEPTH = 5;

function redactString(value) {
  let out = value;
  for (const re of SECRET_VALUE_PATTERNS) out = out.replace(re, '[REDACTED]');
  if (out.length > MAX_STRING) out = out.slice(0, MAX_STRING) + '…[truncated]';
  return out;
}

/**
 * Recursively redacts an arbitrary value. Never throws.
 * @param {*} value
 * @param {number} depth
 */
export function redact(value, depth = 0) {
  if (value === null || value === undefined) return value;
  if (depth > MAX_DEPTH) return '[depth-limit]';

  if (typeof value === 'string') return redactString(value);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'function') return '[function]';

  if (Array.isArray(value)) {
    return value.slice(0, 50).map(v => redact(v, depth + 1));
  }

  if (typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = SECRET_KEY.test(k) ? '[REDACTED]' : redact(v, depth + 1);
    }
    return out;
  }
  return String(value);
}

function ensureDir() {
  try {
    if (!fs.existsSync(AUDIT_DIR)) fs.mkdirSync(AUDIT_DIR, { recursive: true });
    return true;
  } catch {
    return false;
  }
}

/**
 * Appends one audit event. Auditing must never break a user action, so all
 * failures are swallowed after a single console warning.
 *
 * @param {{
 *   actor?: string, tool?: string, action?: string, risk?: string,
 *   decision?: string, reason?: string, target?: *, outcome?: string,
 *   durationMs?: number, taskId?: string
 * }} event
 */
export function auditEvent(event = {}) {
  try {
    if (!ensureDir()) {
      console.log('⚠ F.R.I.D.A.Y. audit: cannot create data/ directory');
      return;
    }
    const line = JSON.stringify({
      ts: new Date().toISOString(),
      actor: event.actor || 'api',
      tool: event.tool || 'unknown',
      action: event.action || null,
      risk: event.risk || null,
      decision: event.decision || null,
      reason: event.reason ? redactString(String(event.reason)) : null,
      target: event.target === undefined ? null : redact(event.target),
      outcome: event.outcome || null,
      durationMs: typeof event.durationMs === 'number' ? event.durationMs : null,
      taskId: event.taskId || null
    });
    fs.appendFileSync(AUDIT_FILE, line + '\n', 'utf8');
  } catch (e) {
    console.log('⚠ F.R.I.D.A.Y. audit write skipped:', e.message);
  }
}

export function auditFilePath() {
  return AUDIT_FILE;
}