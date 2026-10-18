/* ==========================================================================
   F.R.I.D.A.Y. // SERVER LIB — CHUNKER
   Splits a document into deterministic, heading-aware chunks that carry their
   character offsets, so a retrieval hit can always be cited as `path:line`.

   Deterministic means: same input -> same chunks, always. No randomness, no
   clock, no environment. That is what makes an incremental index trustworthy
   (an unchanged file re-chunks to the same ids) and what makes tests real.
   ========================================================================== */

const DEFAULT_MAX_CHARS = 1200;
const DEFAULT_OVERLAP_CHARS = 150;

/** A heading forces a fresh section once the current chunk has real content. */
const HEADING_MIN_FILL = 0.5;

function isHeading(line) {
  const t = line.trim();
  if (!t) return false;
  if (/^#{1,6}\s+\S/.test(t)) return true;                 // markdown ATX
  if (/^(={3,}|\*{3,})$/.test(t) && t.length <= 8) return true; // setext underline
  if (/^[A-Za-z0-9][^.!?]{0,58}:$/.test(t) && t.length <= 60) return true; // "Summary:"
  return false;
}

/** 1-based line number of a character offset. */
export function lineOf(text, offset) {
  const src = String(text ?? '');
  const end = Math.max(0, Math.min(offset, src.length));
  let line = 1;
  for (let i = 0; i < end; i++) {
    if (src.charCodeAt(i) === 10) line++;
  }
  return line;
}

/** Splits raw text into paragraph/heading segments with absolute offsets. */
function segments(text) {
  const out = [];
  let cur = null;
  let i = 0;
  while (i < text.length) {
    const nl = text.indexOf('\n', i);
    const end = nl === -1 ? text.length : nl + 1;
    const raw = text.slice(i, end).replace(/\r?\n$/, '');
    const blank = raw.trim() === '';
    if (blank) {
      if (cur) { out.push(cur); cur = null; }
    } else if (isHeading(raw)) {
      if (cur) { out.push(cur); cur = null; }
      out.push({ start: i, end, heading: true });
    } else if (!cur) {
      cur = { start: i, end, heading: false };
    } else {
      cur.end = end;
    }
    if (nl === -1) break;
    i = end;
  }
  if (cur) out.push(cur);
  return out;
}

function makeChunk(src, start, end, index) {
  const raw = src.slice(start, end);
  const lead = raw.length - raw.trimStart().length;
  const trail = raw.length - raw.trimEnd().length;
  const s = start + lead;
  const e = end - trail;
  return { index, start: s, end: e, line: lineOf(src, s), text: src.slice(s, e) };
}

/**
 * Chunks `text` into heading-aware pieces.
 *
 * @param {string} text
 * @param {{maxChars?: number, overlapChars?: number}} [options]
 * @returns {Array<{index: number, start: number, end: number, line: number, text: string}>}
 */
export function chunkText(text, options = {}) {
  const src = String(text ?? '');
  if (!src.trim()) return [];

  const maxChars = Math.max(200, Number(options.maxChars) || DEFAULT_MAX_CHARS);
  const overlapChars = Math.max(0, Math.min(
    Number.isFinite(options.overlapChars) ? Number(options.overlapChars) : DEFAULT_OVERLAP_CHARS,
    Math.floor(maxChars / 2)
  ));

  const pieces = [];
  let cur = null;
  const flush = () => { if (cur && cur.end > cur.start) pieces.push(cur); cur = null; };

  for (const seg of segments(src)) {
    // A single oversized block is hard-split on character count.
    if (seg.end - seg.start > maxChars) {
      flush();
      let s = seg.start;
      while (s < seg.end) {
        const e = Math.min(seg.end, s + maxChars);
        pieces.push({ start: s, end: e });
        if (e >= seg.end) break;
        const back = e - overlapChars;
        s = back > s ? back : e;
      }
      continue;
    }
    if (seg.heading && cur && (cur.end - cur.start) >= Math.floor(maxChars * HEADING_MIN_FILL)) flush();
    if (!cur) cur = { start: seg.start, end: seg.end };
    else if (seg.end - cur.start > maxChars) { flush(); cur = { start: seg.start, end: seg.end }; }
    else cur.end = seg.end;
  }
  flush();

  const chunks = [];
  for (let i = 0; i < pieces.length; i++) {
    const p = pieces[i];
    const start = (i > 0 && overlapChars > 0)
      ? Math.max(pieces[i - 1].start + 1, p.start - overlapChars)
      : p.start;
    chunks.push(makeChunk(src, start, p.end, chunks.length));
  }
  return chunks;
}

/** Relative offsets of a chunk inside its own text, for a self-contained quote. */
export const CHUNK_DEFAULTS = { maxChars: DEFAULT_MAX_CHARS, overlapChars: DEFAULT_OVERLAP_CHARS };
