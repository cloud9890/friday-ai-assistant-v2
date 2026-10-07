/* Memory store: facts and episodes persist, search and delete behave. */
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

// Point the store at a scratch directory before importing it.
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'friday-mem-'));
process.chdir(scratch);
const { saveFact, deleteFact, allFacts, searchFacts, appendEpisode, lastEpisodes } =
  await import('../../server/memory/store.js');

beforeEach(() => {
  for (const f of allFacts()) deleteFact(f.key);
});

test('facts are saved, updated and searched', () => {
  assert.equal(saveFact('boss_name', 'Yash'), true);
  assert.equal(saveFact('favourite_music', 'lo-fi'), true);
  assert.equal(saveFact('boss_name', 'Yash S.'), true); // update, not duplicate
  assert.equal(allFacts().length, 2);

  const hits = searchFacts('boss');
  assert.equal(hits.length, 1);
  assert.equal(hits[0].value, 'Yash S.');

  assert.deepEqual(searchFacts('no-such-thing'), []);
});

test('empty facts are rejected', () => {
  assert.equal(saveFact('', 'value'), false);
  assert.equal(saveFact('key', '   '), false);
});

test('facts can be forgotten', () => {
  saveFact('temp', 'x');
  assert.equal(deleteFact('TEMP'), true); // case-insensitive
  assert.equal(deleteFact('temp'), false);
  assert.equal(allFacts().length, 0);
});

test('episodes are appended and capped', () => {
  for (let i = 0; i < 5; i++) appendEpisode({ user: `question ${i}`, reply: `answer ${i}` });
  const episodes = lastEpisodes(3);
  assert.equal(episodes.length, 3);
  assert.equal(episodes[2].user, 'question 4'); // most recent last
});
