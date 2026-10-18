/* ==========================================================================
   F.R.I.D.A.Y. // SKILL — ZIP FOLDER (Phase C tail)
   Compresses a Desktop/Documents folder into a .zip beside it.

   The archiver is Windows' bundled bsdtar (libarchive), invoked argv-only with
   NO shell (M5): the folder name never becomes part of a command line. The
   kernel certifies the source with READ_FILES and the destination .zip with
   WRITE_FILES before this runs.
   ========================================================================== */

import { execFile } from 'child_process';
import path from 'path';
import { RISK, CONFIRMATION, PERMISSION } from '../security/risk.js';
import { checkFileName } from '../security/path-policy.js';
import { resolveParent } from './helpers.js';

export const DEFAULT_TIMEOUT_MS = 30000;

/**
 * Archives `source` into `zipPath` with bsdtar. Resolves to a plain result
 * (never throws) so a failure is honest output for the model.
 * `execFileImpl` is the seam tests stub; production passes node's execFile.
 *
 * @returns {Promise<{ok: boolean, code: number|null, message: string|null, notFound: boolean}>}
 */
export function zipFolder({ source, zipPath, timeoutMs = DEFAULT_TIMEOUT_MS, execFileImpl = execFile } = {}) {
  return new Promise((resolve) => {
    execFileImpl(
      'tar',
      ['-a', '-c', '-f', zipPath, '-C', source, '.'],
      { timeout: timeoutMs, windowsHide: true, shell: false, maxBuffer: 200000 },
      (err, stdout, stderr) => {
        resolve({
          ok: !err,
          code: err ? (typeof err.code === 'number' ? err.code : null) : 0,
          message: err ? String(err.message || stderr || '') : String(stdout || ''),
          notFound: Boolean(err && err.code === 'ENOENT')
        });
      }
    );
  });
}

/** Resolves the folder to zip and the .zip to create, or null when unsafe. */
function resolveZip(args) {
  const base = resolveParent(args.parent);
  if (!base) return null;
  const name = String(args.name || '').trim();
  if (!name || !checkFileName(name).ok) return null;
  const stem = name.toLowerCase().endsWith('.zip') ? name.slice(0, -4) : name;
  if (!stem) return null;
  return { source: path.join(base, name), zipPath: path.join(base, `${stem}.zip`) };
}

export default {
  name: 'zip_folder',
  description: 'Compresses a Desktop or Documents folder into a .zip file next to it (recursively). Give the folder name and which top-level parent it lives in.',
  parameters: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'Folder name to compress (a bare name, no path)' },
      parent: { type: 'string', enum: ['desktop', 'documents'] }
    },
    required: ['name', 'parent']
  },
  risk: RISK.HIGH,
  permissions: [PERMISSION.READ_FILES, PERMISSION.WRITE_FILES],
  confirmation: CONFIRMATION.NONE,

  policyHints(args) {
    const target = resolveZip(args);
    if (!target) return {};
    return { __readDirs: [target.source], __targetPath: target.zipPath };
  },

  describe(args) {
    const target = resolveZip(args);
    return target ? `Compress ${target.source} into ${target.zipPath}.` : `Compress "${args.name}".`;
  },

  async execute(args, ctx, hints) {
    const source = Array.isArray(hints.__readDirs) ? hints.__readDirs[0] : null;
    const zipPath = hints.__targetPath;
    if (!source || !zipPath) return 'Error: no certified archive target.';

    const result = await zipFolder({ source, zipPath });
    if (result.ok) return `Created ${zipPath} from ${source}.`;
    if (result.notFound) return 'Error: no archiver is available on this PC (tar was not found).';
    return `Error: could not create ${zipPath}: ${result.message}`;
  }
};
