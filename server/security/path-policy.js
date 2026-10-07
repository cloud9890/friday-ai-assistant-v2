/* ==========================================================================
   F.R.I.D.A.Y. // SECURITY — PATH POLICY
   Phase 1 (S5). Every filesystem access must stay inside an allow-listed root.
   Rejects traversal, UNC paths, and sensitive locations (.ssh, AppData, .env).
   Policy is source-of-truth agnostic: it decides, the caller obeys.
   ========================================================================== */

import path from 'path';
import { homeDir, desktopDir, documentsDir } from '../lib/paths.js';

/** Roots FRIDAY may write into. */
export const WRITE_ROOTS = [desktopDir, documentsDir];

/** Roots FRIDAY may read/list. Home is intentionally excluded from writes. */
export const READ_ROOTS = [desktopDir, documentsDir, homeDir];

// Names/segments that are never valid targets, even inside an allowed root.
const SENSITIVE_SEGMENTS = [
  '.ssh', '.aws', '.gnupg', '.azure', '.kube', '.docker',
  'appdata', 'windows', 'system32', 'program files', 'program files (x86)',
  'ntuser.dat', 'passwords', 'credentials', 'id_rsa', 'id_ed25519'
];

const SENSITIVE_FILES = ['.env', '.env.local', '.env.production', 'cookies.sqlite', 'login data'];

function normalize(p) {
  return path.resolve(p).replace(/[\\/]+$/, '').toLowerCase();
}

function isInside(child, root) {
  const c = normalize(child);
  const r = normalize(root);
  return c === r || c.startsWith(r + path.sep.toLowerCase()) || c.startsWith(r + '/');
}

function hasSensitiveSegment(target) {
  const segments = normalize(target).split(/[\\/]/).filter(Boolean);
  for (const seg of segments) {
    if (SENSITIVE_SEGMENTS.includes(seg)) return seg;
  }
  const base = path.basename(target).toLowerCase();
  return SENSITIVE_FILES.includes(base) ? base : null;
}

/**
 * Validates a write destination (full path, already joined with a filename).
 * @returns {{ok: boolean, reason?: string}}
 */
export function checkWritePath(target) {
  if (typeof target !== 'string' || !target.trim()) return { ok: false, reason: 'path required' };
  if (target.includes('\0')) return { ok: false, reason: 'invalid path' };
  if (/^\\\\/.test(target)) return { ok: false, reason: 'UNC paths are not allowed' };

  const resolved = path.resolve(target);
  if (!path.isAbsolute(resolved)) return { ok: false, reason: 'path must be absolute' };

  const sensitive = hasSensitiveSegment(resolved);
  if (sensitive) return { ok: false, reason: `protected location: ${sensitive}` };

  if (!WRITE_ROOTS.some(root => isInside(resolved, root))) {
    return { ok: false, reason: 'destination is outside the allowed folders (Desktop, Documents)' };
  }
  return { ok: true };
}

/**
 * Validates a directory used for listing/searching.
 * @returns {{ok: boolean, reason?: string}}
 */
export function checkReadPath(target) {
  if (typeof target !== 'string' || !target.trim()) return { ok: false, reason: 'path required' };
  if (target.includes('\0')) return { ok: false, reason: 'invalid path' };
  if (/^\\\\/.test(target)) return { ok: false, reason: 'UNC paths are not allowed' };

  const resolved = path.resolve(target);
  const sensitive = hasSensitiveSegment(resolved);
  if (sensitive) return { ok: false, reason: `protected location: ${sensitive}` };

  if (!READ_ROOTS.some(root => isInside(resolved, root))) {
    return { ok: false, reason: 'folder is outside the allowed read roots' };
  }
  return { ok: true };
}

/**
 * Validates a delete target. Stricter than writes: the path must sit strictly
 * BELOW an allowed write root, so the roots themselves can never be removed.
 * @returns {{ok: boolean, reason?: string}}
 */
export function checkDeletePath(target) {
  const write = checkWritePath(target);
  if (!write.ok) return write;

  const resolved = path.resolve(target);
  const isRoot = WRITE_ROOTS.some(root => normalize(resolved) === normalize(root));
  if (isRoot) return { ok: false, reason: 'cannot delete an allowed root folder' };
  return { ok: true };
}

/**
 * Validates a user-supplied file name (no separators, no reserved names).
 * @returns {{ok: boolean, reason?: string}}
 */
export function checkFileName(name) {
  if (typeof name !== 'string' || !name.trim()) return { ok: false, reason: 'fileName required' };
  if (/[\\/]/.test(name)) return { ok: false, reason: 'fileName must not contain path separators' };
  if (name.includes('..')) return { ok: false, reason: 'fileName must not contain ..' };
  if (name.includes('\0')) return { ok: false, reason: 'invalid fileName' };
  if (/^[.]+$/.test(name)) return { ok: false, reason: 'invalid fileName' };
  return { ok: true };
}