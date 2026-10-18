/* Extraction: native text/code/HTML, honest failures for images and binaries.
   PDF/DOCX ride on optional deps and are only asserted to be *handled*, not to
   parse a fixture (there is no fixture, and inventing one would be dishonest). */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { extractText, isExtractable } from '../../server/lib/extract.js';

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'friday-extract-'));
after(() => fs.rmSync(scratch, { recursive: true, force: true }));

const write = (name, data) => {
  const full = path.join(scratch, name);
  fs.writeFileSync(full, data);
  return full;
};

test('isExtractable matches the formats the indexer can read', () => {
  assert.equal(isExtractable('notes.md'), true);
  assert.equal(isExtractable('report.PDF'), true);
  assert.equal(isExtractable('contract.docx'), true);
  assert.equal(isExtractable('photo.png'), false);
  assert.equal(isExtractable('archive.zip'), false);
});

test('plain text and code are read verbatim', async () => {
  const md = write('notes.md', '# Title\n\nHello world.');
  const result = await extractText(md);
  assert.equal(result.ok, true);
  assert.equal(result.kind, 'text');
  assert.match(result.text, /Hello world/);

  const js = write('snippet.js', 'export const answer = 42;\n');
  const code = await extractText(js);
  assert.equal(code.ok, true);
  assert.match(code.text, /answer = 42/);
});

test('HTML is stripped to readable text', async () => {
  const html = write('page.html', '<html><head><style>p{color:red}</style></head><body><h1>Report</h1><p>Body &amp; text</p><script>evil()</script></body></html>');
  const result = await extractText(html);
  assert.equal(result.ok, true);
  assert.match(result.text, /Report/);
  assert.match(result.text, /Body & text/);
  assert.ok(!result.text.includes('evil()'));
  assert.ok(!result.text.includes('color:red'));
});

test('an image reports "OCR unavailable" rather than inventing text', async () => {
  const png = write('shot.png', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01, 0x02]));
  const result = await extractText(png);
  assert.equal(result.ok, false);
  assert.equal(result.kind, 'image');
  assert.match(result.note, /OCR unavailable/);
});

test('a mislabelled binary is refused instead of decoded as garbage', async () => {
  const fake = write('not-really.txt', Buffer.from([0x00, 0x01, 0x02, 0x00, 0x41]));
  const result = await extractText(fake);
  assert.equal(result.ok, false);
  assert.match(result.note, /binary/);
});

test('an empty file and a missing file both fail honestly', async () => {
  const empty = write('empty.md', '   \n  ');
  const emptyResult = await extractText(empty);
  assert.equal(emptyResult.ok, false);
  assert.match(emptyResult.note, /empty/);

  const missing = await extractText(path.join(scratch, 'nope.md'));
  assert.equal(missing.ok, false);
  assert.match(missing.note, /unreadable/);
});

test('unsupported extensions are skipped, not guessed at', async () => {
  const zip = write('archive.zip', Buffer.from('PK\u0003\u0004not really'));
  const result = await extractText(zip);
  assert.equal(result.ok, false);
  assert.equal(result.kind, 'binary');
});
