/* Memory store: facts and episodes persist, search and delete behave. */
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

// Point the store at a scratch directory before importing it.
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'friday-mem-'));
process.chdir(scratch);
const { saveFact, deleteFact, allFacts, searchFacts, recentFacts, appendEpisode, lastEpisodes } =
  await import('../../server/memory/store.js');
const { memoryContextBlock } = await import('../../server/memory/context.js');

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

/* M3: one key, one fact — a different spelling must update, not duplicate. */
test('keys are matched case-insensitively so a fact cannot be duplicated', () => {
  saveFact('Favourite_Music', 'lo-fi');
  saveFact('favourite_music', 'jazz');
  saveFact('FAVOURITE_MUSIC', 'ambient');

  assert.equal(allFacts().length, 1);
  assert.equal(allFacts()[0].value, 'ambient');
  assert.equal(allFacts()[0].key, 'Favourite_Music', 'the first spelling is kept');
  assert.equal(deleteFact('favourite_music'), true);
  assert.equal(allFacts().length, 0);
});

/* M2: the agent must be fed the newest facts, not the first-inserted ones. */
test('recentFacts returns the most recently updated facts first', () => {
  for (let i = 1; i <= 12; i++) saveFact(`fact_${i}`, `v${i}`);
  saveFact('fact_1', 'updated'); // touches only this one

  const recent = recentFacts(10);
  assert.equal(recent.length, 10);
  assert.equal(recent[0].key, 'fact_1', 'the just-updated fact leads');
  assert.ok(!recent.some(f => f.key === 'fact_2'), 'the oldest fact falls out of the window');
});

test('the injected context block carries the newest facts, not the oldest', () => {
  for (let i = 1; i <= 12; i++) saveFact(`fact_${i}`, `v${i}`);
  saveFact('fact_1', 'updated');

  const block = memoryContextBlock();
  assert.match(block, /fact_1: updated/);
  assert.doesNotMatch(block, /fact_2: v2/, 'fact_2 is the oldest and must not be injected');
});
