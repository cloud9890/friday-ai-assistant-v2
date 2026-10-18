/* The organizer is the deterministic half of organize_files: the kernel
   certifies its output, so the bucketing must be predictable and side-effect
   free given the entries. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { categoryFor, planMoves, summarize } from '../../server/lib/organizer.js';

const ROOT = path.join('C:', 'Users', 'tester', 'Documents');

function plan(entries, options = {}) {
  return planMoves({ root: ROOT, entries, exists: () => false, ...options });
}

test('files are bucketed by extension, unknown types into Other', () => {
  assert.equal(categoryFor('holiday.JPG'), 'Images');
  assert.equal(categoryFor('budget.pdf'), 'Documents');
  assert.equal(categoryFor('sheet.csv'), 'Spreadsheets');
  assert.equal(categoryFor('talk.key'), 'Presentations');
  assert.equal(categoryFor('song.mp3'), 'Audio');
  assert.equal(categoryFor('clip.mkv'), 'Video');
  assert.equal(categoryFor('backup.7z'), 'Archives');
  assert.equal(categoryFor('main.py'), 'Code');
  assert.equal(categoryFor('mystery.xyz'), 'Other');
  assert.equal(categoryFor('LICENSE'), 'Other');
});

test('a plan moves only loose files, into a category folder', () => {
  const result = plan([
    { name: 'photo.png', isDir: false },
    { name: 'notes.txt', isDir: false },
    { name: 'projects', isDir: true },
    { name: '.env', isDir: false }
  ]);

  assert.deepEqual(result.moves.map(m => path.basename(m.to)), ['notes.txt', 'photo.png']);
  assert.equal(result.moves[0].to, path.join(ROOT, 'Documents', 'notes.txt'));
  assert.equal(result.moves[1].to, path.join(ROOT, 'Images', 'photo.png'));
  assert.equal(result.moves[1].from, path.join(ROOT, 'photo.png'));
  // Directories and dotfiles are left alone.
  assert.equal(result.skipped, 2);
});

test('a name already present in the category folder is given a suffix', () => {
  const result = plan([{ name: 'a.png', isDir: false }], {
    exists: (candidate) => candidate === path.join(ROOT, 'Images', 'a.png')
  });
  assert.equal(result.moves[0].to, path.join(ROOT, 'Images', 'a (2).png'));
});

test('two planned files can never collide with each other', () => {
  // Same stem/extension cannot exist twice in one folder, but the guard still
  // holds: the reserved set is keyed on the full destination path.
  const result = plan([
    { name: 'a.png', isDir: false },
    { name: 'a.PNG', isDir: false }
  ]);
  assert.equal(new Set(result.moves.map(m => m.to.toLowerCase())).size, result.moves.length);
});

test('the plan is capped and says so', () => {
  const entries = Array.from({ length: 10 }, (_, i) => ({ name: `f${i}.txt`, isDir: false }));
  const result = plan(entries, { max: 4 });
  assert.equal(result.moves.length, 4);
  assert.equal(result.capped, true);
});

test('an empty folder plans nothing', () => {
  const result = plan([]);
  assert.deepEqual(result.moves, []);
  assert.equal(result.capped, false);
});

test('summarize ranks the buckets biggest first', () => {
  const result = plan([
    { name: 'a.png', isDir: false },
    { name: 'b.png', isDir: false },
    { name: 'c.mp3', isDir: false }
  ]);
  assert.deepEqual(summarize(result), [['Images', 2], ['Audio', 1]]);
});
