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

/**
 * Roots FRIDAY may read/list. Home is intentionally excluded from writes.
 *
 * H6: home is deliberately kept readable — the "search my files" feature
 * depends on it — so the real boundary is the denylists below, not the root
 * breadth. Every credential store that can be reached from home is denied by
 * name/segment/extension, and a colon (ADS) can no longer smuggle a protected
 * file past the basename check (M4). Revisit if a future phase narrows the
 * read surface on purpose (see HANDOFF §4 H6).
 */
export const READ_ROOTS = [desktopDir, documentsDir, homeDir];

// Names/segments that are never valid targets, even inside an allowed root.
const SENSITIVE_SEGMENTS = [
  '.ssh', '.aws', '.gnupg', '.azure', '.kube', '.docker', '.git',
  '.config', '.password-store', '.mozilla', '.thunderbird', '.terraform.d',
  'appdata', 'windows', 'system32', 'program files', 'program files (x86)',
  'ntuser.dat', 'passwords', 'credentials', 'id_rsa', 'id_ed25519'
];

// Exact file names (lowercased) that hold credentials or history.
const SENSITIVE_FILES = [
  '.env', '.env.local', '.env.production', 'cookies.sqlite', 'login data',
  '.netrc', '_netrc', '.git-credentials', '.gitconfig', '.npmrc', '.pypirc',
  '.wgetrc', '.curlrc', '.my.cnf', '.pgpass', '.htpasswd', '.terraformrc',
  'terraform.tfstate', 'unattend.xml', 'consolehost_history.txt',
  '.bash_history', '.zsh_history', '.python_history', '.node_repl_history'
];

// Extensions that always mean "key material", wherever they live.
const SENSITIVE_EXTENSIONS = ['.pem', '.key', '.pfx', '.p12', '.keystore', '.jks'];

function normalize(p) {
  return path.resolve(p).replace(/[\\/]+$/, '').toLowerCase();
}

function isInside(child, root) {
  const c = normalize(child);
  const r = normalize(root);
  return c === r || c.startsWith(r + path.sep.toLowerCase()) || c.startsWith(r + '/');
}

/**
 * Rejects Windows Alternate Data Streams. A drive-qualified path may carry
 * exactly one colon, immediately after the drive letter; any other colon
 * (`secret.txt:hidden`, `name::$DATA`) is an ADS and is refused (M4). Without
 * this, `C:\…\.env:stream` would sidestep the SENSITIVE_FILES basename check.
 */
function hasAlternateDataStream(target) {
  const rest = /^[a-zA-Z]:/.test(target) ? target.slice(2) : target;
  return rest.includes(':');
}

function hasSensitiveSegment(target) {
  const segments = normalize(target).split(/[\\/]/).filter(Boolean);
  for (const seg of segments) {
    if (SENSITIVE_SEGMENTS.includes(seg)) return seg;
  }
  const base = path.basename(target).toLowerCase();
  if (SENSITIVE_FILES.includes(base)) return base;
  const ext = path.extname(base);
  return SENSITIVE_EXTENSIONS.includes(ext) ? base : null;
}

/**
 * Validates a write destination (full path, already joined with a filename).
 * @returns {{ok: boolean, reason?: string}}
 */
export function checkWritePath(target) {
  if (typeof target !== 'string' || !target.trim()) return { ok: false, reason: 'path required' };
  if (target.includes('\0')) return { ok: false, reason: 'invalid path' };
  if (/^\\\\/.test(target)) return { ok: false, reason: 'UNC paths are not allowed' };
  if (hasAlternateDataStream(target)) return { ok: false, reason: 'alternate data streams are not allowed' };

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
  if (hasAlternateDataStream(target)) return { ok: false, reason: 'alternate data streams are not allowed' };

  const resolved = path.resolve(target);
  const sensitive = hasSensitiveSegment(resolved);
  if (sensitive) return { ok: false, reason: `protected location: ${sensitive}` };

  if (!READ_ROOTS.some(root => isInside(resolved, root))) {
    return { ok: false, reason: 'folder is outside the allowed read roots' };
  }
  return { ok: true };
}

/**
 * Segments the knowledge indexer must never crawl, even inside a read root:
 * build output, dependency trees, VCS metadata, and FRIDAY's own data store
 * (which holds the index, memory and the audit log).
 */
const INDEX_DENY_SEGMENTS = [
  'node_modules', 'data', '.git', 'dist', 'build', 'out', 'target',
  '.cache', '.next', '.venv', 'venv', '__pycache__', '$recycle.bin',
  'appdata', 'windows', 'program files', 'program files (x86)'
];

/**
 * Validates a folder/file for indexing (Phase B KNOWLEDGEABLE). This is a read
 * plus an exfiltration surface: the result is embedded and fed back into the
 * model's context, so it is checked like a read AND restricted to segments the
 * indexer should never ingest (M-spec §3, "denies data/, .git, node_modules").
 *
 * @returns {{ok: boolean, reason?: string}}
 */
export function checkIndexPath(target) {
  const read = checkReadPath(target);
  if (!read.ok) return read;

  const segments = normalize(target).split(/[\\/]/).filter(Boolean);
  for (const seg of segments) {
    if (INDEX_DENY_SEGMENTS.includes(seg)) return { ok: false, reason: `excluded from indexing: ${seg}` };
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
  if (name.includes(':')) return { ok: false, reason: 'fileName must not contain ":" (alternate data stream)' };
  if (/^[.]+$/.test(name)) return { ok: false, reason: 'invalid fileName' };
  return { ok: true };
}