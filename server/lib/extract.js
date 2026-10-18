/* ==========================================================================
   F.R.I.D.A.Y. // SERVER LIB — TEXT EXTRACTION
   One entry point that turns a file on disk into indexable plain text.

   Native: plain text, markdown, code, config, CSV/JSON/YAML, HTML (tags
   stripped). Heavy formats are optional deps, loaded lazily so the server
   boots without them: PDF via `pdf-parse`, DOCX via `mammoth`.
   OCR is NOT guessed at: an image reports "unavailable" honestly rather than
   inventing text (the repo's "no simulated values" rule).
   ========================================================================== */

import fs from 'fs';
import path from 'path';

export const MAX_EXTRACT_BYTES = 5 * 1024 * 1024;

const TEXT_EXTENSIONS = new Set([
  '.txt', '.text', '.md', '.markdown', '.mdx', '.rst', '.log', '.csv', '.tsv',
  '.json', '.jsonl', '.ndjson', '.yml', '.yaml', '.toml', '.ini', '.cfg', '.conf',
  '.xml', '.html', '.htm', '.css', '.scss', '.less', '.sql',
  '.js', '.mjs', '.cjs', '.jsx', '.ts', '.tsx', '.py', '.rb', '.go', '.rs',
  '.java', '.kt', '.c', '.h', '.cpp', '.hpp', '.cs', '.php', '.swift', '.sh',
  '.ps1', '.bat', '.cmd', '.gradle', '.properties', '.env'
]);

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp', '.tif', '.tiff', '.heic', '.ico']);

/** Extensions extract() can return real text for. */
export function isExtractable(filePath) {
  const ext = path.extname(String(filePath || '')).toLowerCase();
  return TEXT_EXTENSIONS.has(ext) || ext === '.pdf' || ext === '.docx';
}

function kindOf(filePath) {
  const ext = path.extname(String(filePath || '')).toLowerCase();
  if (TEXT_EXTENSIONS.has(ext)) return 'text';
  if (ext === '.pdf') return 'pdf';
  if (ext === '.docx') return 'docx';
  if (IMAGE_EXTENSIONS.has(ext)) return 'image';
  return 'binary';
}

/** Cheap binary sniff: a NUL byte in the first block means "not text". */
function looksBinary(buffer) {
  const n = Math.min(buffer.length, 8000);
  for (let i = 0; i < n; i++) if (buffer[i] === 0) return true;
  return false;
}

function stripHtml(html) {
  return String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

async function extractPdf(buffer) {
  let pdfParse;
  try {
    const mod = await import('pdf-parse');
    pdfParse = mod.default || mod;
  } catch {
    throw new Error('PDF support is not installed (npm install pdf-parse)');
  }
  const data = await pdfParse(buffer);
  return { text: String(data.text || '').trim(), pages: data.numpages || null };
}

async function extractDocx(buffer) {
  let mammoth;
  try {
    const mod = await import('mammoth');
    mammoth = mod.default || mod;
  } catch {
    throw new Error('DOCX support is not installed (npm install mammoth)');
  }
  const result = await mammoth.extractRawText({ buffer });
  return { text: String(result.value || '').trim() };
}

/**
 * Extracts indexable text from one file.
 * @returns {Promise<{ok: boolean, kind: string, text: string, bytes: number, note?: string}>}
 */
export async function extractText(filePath) {
  const abs = path.resolve(String(filePath || ''));
  const kind = kindOf(abs);

  let stat;
  try {
    stat = fs.statSync(abs);
  } catch (e) {
    return { ok: false, kind, text: '', bytes: 0, note: `unreadable: ${e.message}` };
  }
  if (!stat.isFile()) return { ok: false, kind, text: '', bytes: 0, note: 'not a regular file' };
  if (stat.size > MAX_EXTRACT_BYTES) {
    return { ok: false, kind, text: '', bytes: stat.size, note: `too large to index (over ${Math.round(MAX_EXTRACT_BYTES / 1024 / 1024)} MB)` };
  }

  let buffer;
  try {
    buffer = fs.readFileSync(abs);
  } catch (e) {
    return { ok: false, kind, text: '', bytes: stat.size, note: `unreadable: ${e.message}` };
  }

  try {
    if (kind === 'pdf') {
      const { text, pages } = await extractPdf(buffer);
      if (!text) return { ok: false, kind, text: '', bytes: stat.size, note: 'no extractable text (scanned PDF — OCR unavailable)' };
      return { ok: true, kind, text, bytes: stat.size, note: pages ? `${pages} pages` : undefined };
    }
    if (kind === 'docx') {
      const { text } = await extractDocx(buffer);
      if (!text) return { ok: false, kind, text: '', bytes: stat.size, note: 'no extractable text' };
      return { ok: true, kind, text, bytes: stat.size };
    }
    if (kind === 'image') {
      return { ok: false, kind, text: '', bytes: stat.size, note: 'OCR unavailable — image content is not indexed' };
    }
    if (kind === 'text') {
      if (looksBinary(buffer)) {
        return { ok: false, kind: 'binary', text: '', bytes: stat.size, note: 'binary content' };
      }
      const raw = buffer.toString('utf8');
      const text = (path.extname(abs).toLowerCase() === '.html' || path.extname(abs).toLowerCase() === '.htm')
        ? stripHtml(raw) : raw;
      if (!text.trim()) return { ok: false, kind, text: '', bytes: stat.size, note: 'empty file' };
      return { ok: true, kind, text, bytes: stat.size };
    }
    return { ok: false, kind: 'binary', text: '', bytes: stat.size, note: 'unsupported file type' };
  } catch (e) {
    return { ok: false, kind, text: '', bytes: stat.size, note: e.message };
  }
}
