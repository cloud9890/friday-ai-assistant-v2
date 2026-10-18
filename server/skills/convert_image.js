/* ==========================================================================
   F.R.I.D.A.Y. // SKILL — CONVERT IMAGE (Phase C tail)
   Converts one Desktop/Documents image to png / jpg / bmp.

   Windows' System.Drawing does the work via a fixed helper script, invoked
   argv-only with NO shell (M5): the file names travel as separate arguments,
   never interpolated into a command line. The kernel certifies the source with
   READ_FILES and the destination image with WRITE_FILES before this runs.
   ========================================================================== */

import { execFile } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { RISK, CONFIRMATION, PERMISSION } from '../security/risk.js';
import { checkFileName } from '../security/path-policy.js';
import { resolveParent } from './helpers.js';

export const DEFAULT_TIMEOUT_MS = 30000;
export const FORMATS = ['png', 'jpg', 'bmp'];
const SCRIPT_PATH = fileURLToPath(new URL('../lib/convert-image.ps1', import.meta.url));

/**
 * Runs the converter. Resolves to a plain result (never throws).
 * `execFileImpl` and `platform` are the seams tests stub.
 *
 * @returns {Promise<{ok: boolean, code: number|null, message: string, unsupportedPlatform: boolean}>}
 */
export function convertImage({
  source,
  dest,
  format,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  execFileImpl = execFile,
  platform = process.platform
} = {}) {
  if (platform !== 'win32') {
    return Promise.resolve({
      ok: false, code: null, message: 'image conversion needs Windows (System.Drawing)', unsupportedPlatform: true
    });
  }
  const fmt = String(format || '').toLowerCase();
  if (!FORMATS.includes(fmt)) {
    return Promise.resolve({ ok: false, code: null, message: `unsupported format: ${format}`, unsupportedPlatform: false });
  }
  return new Promise((resolve) => {
    execFileImpl(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden',
        '-File', SCRIPT_PATH, '-Source', source, '-Dest', dest, '-Format', fmt],
      { timeout: timeoutMs, windowsHide: true, shell: false, maxBuffer: 200000 },
      (err, stdout, stderr) => {
        resolve({
          ok: !err,
          code: err ? (typeof err.code === 'number' ? err.code : null) : 0,
          message: err ? String(err.message || stderr || '') : String(stdout || '').trim(),
          unsupportedPlatform: false
        });
      }
    );
  });
}

/** Resolves the source image and the converted destination, or null. */
function resolveConvert(args) {
  const base = resolveParent(args.parent);
  if (!base) return null;
  const name = String(args.name || '').trim();
  if (!name || !checkFileName(name).ok) return null;

  const format = String(args.format || '').toLowerCase();
  if (!FORMATS.includes(format)) return null;

  const ext = path.extname(name);
  const stem = ext ? name.slice(0, -ext.length) : name;
  if (!stem) return null;
  return { source: path.join(base, name), dest: path.join(base, `${stem}.${format}`), format };
}

export default {
  name: 'convert_image',
  description: 'Converts one image in Desktop or Documents to a different format (png, jpg or bmp), saved beside the original.',
  parameters: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'Image file name, including extension (a bare name, no path)' },
      parent: { type: 'string', enum: ['desktop', 'documents'] },
      format: { type: 'string', enum: FORMATS, description: 'Target format' }
    },
    required: ['name', 'parent', 'format']
  },
  risk: RISK.HIGH,
  permissions: [PERMISSION.READ_FILES, PERMISSION.WRITE_FILES],
  confirmation: CONFIRMATION.NONE,

  policyHints(args) {
    const target = resolveConvert(args);
    if (!target) return {};
    return { __readDirs: [target.source], __targetPath: target.dest };
  },

  describe(args) {
    const target = resolveConvert(args);
    return target ? `Convert ${target.source} to ${target.format.toUpperCase()}.` : 'Convert an image.';
  },

  async execute(args, ctx, hints) {
    const source = Array.isArray(hints.__readDirs) ? hints.__readDirs[0] : null;
    const dest = hints.__targetPath;
    if (!source || !dest) return 'Error: no certified conversion target.';

    if (!fs.existsSync(source)) return `Error: I could not find ${source}.`;

    const result = await convertImage({ source, dest, format: String(args.format || '').toLowerCase() });
    if (result.ok) return `Converted ${source} to ${dest}.`;
    if (result.unsupportedPlatform) return `Error: ${result.message}.`;
    return `Error: could not convert ${source}: ${result.message}`;
  }
};
