/* Chunker: deterministic, heading-aware, citation-carrying chunks.
   The offsets must be exact slices of the source, because a retrieval hit is
   cited as `path:line` and the excerpt is sliced from those offsets. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chunkText, lineOf, CHUNK_DEFAULTS } from '../../server/lib/chunker.js';

const DOC = [
  '# Budget 2026',
  '',
  'The Q1 budget was approved in January with a five percent increase.',
  '',
  '# Travel',
  '',
  'Flights to Tokyo were booked for March.',
  '',
  '## Lodging',
  '',
  'The hotel near the office was cheaper than expected.'
].join('\n');

test('chunkText is deterministic', () => {
  assert.deepEqual(chunkText(DOC), chunkText(DOC));
});

test('every chunk is an exact slice of the source with correct offsets', () => {
  for (const chunk of chunkText(DOC)) {
    assert.equal(DOC.slice(chunk.start, chunk.end), chunk.text);
    assert.ok(chunk.end > chunk.start);
  }
});

test('line numbers are 1-based and point at the chunk start', () => {
  const chunks = chunkText(DOC);
  assert.equal(chunks[0].line, 1);
  assert.equal(DOC.slice(chunks[0].start).startsWith('# Budget'), true);
  assert.equal(lineOf(DOC, 0), 1);
  assert.equal(lineOf(DOC, DOC.indexOf('Flights to Tokyo')), 7);
});

test('a heading starts a new chunk once the section has real content', () => {
  const doc = ['# Budget', 'A long paragraph of real content. '.repeat(6), '# Travel', 'Flights to Tokyo.'].join('\n\n');
  const chunks = chunkText(doc, { maxChars: 200, overlapChars: 0 });
  assert.ok(chunks.length >= 2);
  assert.equal(chunks[0].text.startsWith('# Budget'), true);
  assert.equal(chunks.some(c => c.text.startsWith('# Travel')), true);
});

test('an oversized single paragraph is hard-split, never dropped', () => {
  const oneLine = 'word '.repeat(400).trim(); // ~2000 chars, no newlines
  const chunks = chunkText(oneLine, { maxChars: 300, overlapChars: 50 });
  assert.ok(chunks.length >= 6);
  // Every character of the source is covered by at least one chunk.
  const covered = new Set();
  for (const c of chunks) for (let i = c.start; i < c.end; i++) covered.add(i);
  assert.equal(covered.size, oneLine.length);
});

test('overlap makes consecutive chunks share a tail', () => {
  const para = (n) => `Paragraph ${n}: ${'detail '.repeat(30)}`;
  const doc = [para(1), '', para(2), '', para(3), '', para(4)].join('\n');
  const chunks = chunkText(doc, { maxChars: 300, overlapChars: 80 });
  assert.ok(chunks.length >= 2);
  for (let i = 1; i < chunks.length; i++) {
    assert.ok(chunks[i].start < chunks[i - 1].end, 'chunk must overlap the previous one');
  }
});

test('empty and whitespace-only input yield no chunks', () => {
  assert.deepEqual(chunkText(''), []);
  assert.deepEqual(chunkText('   \n\n  \t '), []);
});

test('defaults are exported and sane', () => {
  assert.ok(CHUNK_DEFAULTS.maxChars >= 400);
  assert.ok(CHUNK_DEFAULTS.overlapChars < CHUNK_DEFAULTS.maxChars);
});
