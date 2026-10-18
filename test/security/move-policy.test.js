/* The move policy is new kernel surface: a bulk reorganisation is a write AND
   a delete, so every pair has to satisfy both, and the kernel must refuse a
   plan that escapes a write root, targets a protected path, or is unbounded. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { checkMovePath } from '../../server/security/path-policy.js';
import { authorize, MAX_MOVES } from '../../server/security/kernel.js';
import { desktopDir, documentsDir, homeDir } from '../../server/lib/paths.js';

const D = (name) => path.join(desktopDir, name);
const DOC = (name) => path.join(documentsDir, name);

test('a move across the allowed folders is certified', () => {
  assert.equal(checkMovePath({ from: D('a.png'), to: D(path.join('Images', 'a.png')) }).ok, true);
  assert.equal(checkMovePath({ from: D('a.zip'), to: DOC('archive.zip') }).ok, true);
});

test('a move must be a write AND a delete, so both ends are checked', () => {
  // Source outside the write roots (home is readable but not writable).
  const outside = checkMovePath({ from: path.join(homeDir, 'notes.txt'), to: D('notes.txt') });
  assert.equal(outside.ok, false);
  assert.match(outside.reason, /move source/);

  // Destination outside the write roots.
  const dest = checkMovePath({ from: D('notes.txt'), to: path.join(homeDir, 'notes.txt') });
  assert.equal(dest.ok, false);
  assert.match(dest.reason, /move destination/);
});

test('the write roots themselves can never be a move source', () => {
  const result = checkMovePath({ from: desktopDir, to: DOC('Desktop') });
  assert.equal(result.ok, false);
  assert.match(result.reason, /root folder/);
});

test('protected and alternate-stream paths are refused on either end', () => {
  assert.equal(checkMovePath({ from: path.join(desktopDir, '.ssh', 'id_rsa'), to: D('id_rsa') }).ok, false);
  assert.equal(checkMovePath({ from: D('a.png'), to: `${D('a.png')}:evil` }).ok, false);
  assert.equal(checkMovePath({ from: D('a.png'), to: D('.env') }).ok, false);
});

test('a move onto itself, or a folder into itself, is refused', () => {
  assert.match(checkMovePath({ from: D('a.png'), to: D('a.png') }).reason, /same/);
  assert.match(
    checkMovePath({ from: D('folder'), to: path.join(desktopDir, 'folder', 'sub', 'x.png') }).reason,
    /into itself/
  );
});

test('malformed moves fail closed', () => {
  assert.equal(checkMovePath(null).ok, false);
  assert.equal(checkMovePath({ from: D('a') }).ok, false);
});

function authorizeOrganize(moves) {
  return authorize({
    tool: 'organize_files',
    args: { parent: 'desktop' },
    actor: 'agent',
    __moves: moves,
    __targetPath: desktopDir
  });
}

test('the kernel allows a certified plan and carries the skill default confirmation', () => {
  const decision = authorizeOrganize([{ from: D('a.png'), to: D(path.join('Images', 'a.png')) }]);
  assert.equal(decision.decision, 'allow');
  assert.equal(decision.confirmation, 'always', 'a bulk move always asks first');
});

test('a plan with an escaping move is denied as a whole', () => {
  const decision = authorizeOrganize([
    { from: D('a.png'), to: D(path.join('Images', 'a.png')) },
    { from: D('b.txt'), to: path.join(homeDir, 'b.txt') }
  ]);
  assert.equal(decision.decision, 'deny');
  assert.match(decision.reason, /move destination/);
});

test('a missing, empty or oversized plan is denied', () => {
  assert.match(authorizeOrganize(undefined).reason, /no move plan/);
  assert.match(authorizeOrganize([]).reason, /nothing to move/);
  const tooMany = Array.from({ length: MAX_MOVES + 1 }, (_, i) => ({
    from: D(`f${i}.txt`), to: D(path.join('Documents', `f${i}.txt`))
  }));
  assert.match(authorizeOrganize(tooMany).reason, /too many files/);
});

test('organize_files is registered with the move permission, not write or delete', () => {
  const decision = authorizeOrganize([{ from: D('a.png'), to: D(path.join('Images', 'a.png')) }]);
  assert.ok(decision.meta.permissions.includes('move:files'));
});
