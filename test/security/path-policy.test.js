/* Phase 1 (R7/S5): filesystem policy — writes stay in allow-listed roots. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { checkWritePath, checkReadPath, checkDeletePath, checkFileName, WRITE_ROOTS, READ_ROOTS } from '../../server/security/path-policy.js';
import { homeDir, desktopDir, documentsDir } from '../../server/lib/paths.js';

test('allowed roots are Desktop and Documents for writes, plus home for reads', () => {
  assert.deepEqual(WRITE_ROOTS, [desktopDir, documentsDir]);
  assert.deepEqual(READ_ROOTS, [desktopDir, documentsDir, homeDir]);
});

test('writes inside Desktop and Documents are allowed', () => {
  assert.equal(checkWritePath(path.join(desktopDir, 'report.docx')).ok, true);
  assert.equal(checkWritePath(path.join(documentsDir, 'notes.txt')).ok, true);
});

test('writes outside the allow-list are denied', () => {
  assert.equal(checkWritePath(path.join(homeDir, 'secret.txt')).ok, false);
  assert.equal(checkWritePath('C:\\Windows\\System32\\evil.dll').ok, false);
  assert.equal(checkWritePath(path.join(homeDir, '.ssh', 'authorized_keys')).ok, false);
});

test('traversal out of an allowed root is denied', () => {
  const escaped = path.join(desktopDir, '..', '..', 'Windows', 'System32', 'evil.exe');
  assert.equal(checkWritePath(escaped).ok, false);
  assert.equal(checkWritePath(path.join(desktopDir, '..', '.ssh', 'id_rsa')).ok, false);
});

test('sensitive locations are denied even when they sit under an allowed root', () => {
  assert.equal(checkWritePath(path.join(desktopDir, '.env')).ok, false);
  assert.equal(checkWritePath(path.join(documentsDir, 'login data')).ok, false);
});

test('UNC paths, NUL bytes and empty input are denied', () => {
  assert.equal(checkWritePath('\\\\attacker\\share\\x.txt').ok, false);
  assert.equal(checkWritePath(path.join(desktopDir, 'a\0b.txt')).ok, false);
  assert.equal(checkWritePath('').ok, false);
  assert.equal(checkWritePath(null).ok, false);
  assert.equal(checkWritePath(undefined).ok, false);
});

test('reads are limited to the read roots and reject protected folders', () => {
  assert.equal(checkReadPath(desktopDir).ok, true);
  assert.equal(checkReadPath(documentsDir).ok, true);
  assert.equal(checkReadPath(homeDir).ok, true);
  assert.equal(checkReadPath('C:\\Windows').ok, false);
  assert.equal(checkReadPath(path.join(homeDir, 'AppData', 'Local')).ok, false);
  assert.equal(checkReadPath(path.join(homeDir, '.ssh')).ok, false);
  assert.equal(checkReadPath('\\\\server\\share').ok, false);
});

test('file names may not contain separators or traversal', () => {
  assert.equal(checkFileName('report.docx').ok, true);
  assert.equal(checkFileName('FRIDAY_notes-2026.md').ok, true);
  assert.equal(checkFileName('../../evil.txt').ok, false);
  assert.equal(checkFileName('..\\evil.txt').ok, false);
  assert.equal(checkFileName('sub/dir.txt').ok, false);
  assert.equal(checkFileName('a\0b.txt').ok, false);
  assert.equal(checkFileName('...').ok, false);
  assert.equal(checkFileName('   ').ok, false);
});

test('deletes follow write rules but never allow removing the roots themselves', () => {
  assert.equal(checkDeletePath(path.join(desktopDir, 'old-project')).ok, true);
  assert.equal(checkDeletePath(path.join(documentsDir, 'notes', 'junk.txt')).ok, true);
  assert.equal(checkDeletePath(desktopDir).ok, false);
  assert.equal(checkDeletePath(documentsDir).ok, false);
  assert.equal(checkDeletePath(path.join(homeDir, 'secret.txt')).ok, false);
  assert.equal(checkDeletePath('C:\\Windows\\System32').ok, false);
  assert.equal(checkDeletePath(path.join(desktopDir, '.ssh')).ok, false);
  assert.equal(checkDeletePath('').ok, false);
  assert.equal(checkDeletePath(undefined).ok, false);
});

/* M4 (H6 bypass): a colon must never smuggle an ADS past the basename check. */
test('windows alternate data streams are rejected', () => {
  assert.equal(checkWritePath(path.join(desktopDir, 'report.txt:hidden')).ok, false);
  assert.equal(checkWritePath(path.join(desktopDir, '.env:stream')).ok, false);
  assert.equal(checkReadPath(path.join(desktopDir, 'notes.txt:$DATA')).ok, false);
  assert.equal(checkDeletePath(path.join(desktopDir, 'a.txt:zone')).ok, false);
  assert.equal(checkFileName('report.txt:hidden').ok, false);
  assert.match(checkFileName('report.txt:hidden').reason, /alternate data stream/i);
});

test('a colon is still fine as the drive separator, and plain names still pass', () => {
  assert.equal(checkWritePath(path.join(desktopDir, 'sub', 'a.txt')).ok, true);
  assert.equal(checkReadPath(path.join(documentsDir, 'sub', 'b.md')).ok, true);
  assert.equal(checkFileName('report.txt').ok, true);
});

/* H6: the read root is broad (home), so credential stores are denied by name. */
test('credential stores inside an allowed root are denied (H6)', () => {
  for (const name of ['.netrc', '.git-credentials', '.npmrc', '.gitconfig', '.pgpass', '.terraformrc']) {
    assert.equal(checkReadPath(path.join(desktopDir, name)).ok, false, `${name} must be denied`);
  }
  assert.equal(checkReadPath(path.join(documentsDir, 'server.pem')).ok, false);
  assert.equal(checkReadPath(path.join(documentsDir, 'private.key')).ok, false);
  assert.equal(checkReadPath(path.join(desktopDir, 'cert.pfx')).ok, false);
  assert.equal(checkReadPath(path.join(desktopDir, '.git', 'config')).ok, false);
  assert.equal(checkReadPath(path.join(desktopDir, '.config', 'gh', 'hosts.yml')).ok, false);
  assert.equal(checkWritePath(path.join(desktopDir, '.npmrc')).ok, false);
  // ...while ordinary files next to them are unaffected.
  assert.equal(checkReadPath(path.join(desktopDir, 'notes.md')).ok, true);
  assert.equal(checkReadPath(path.join(desktopDir, 'project', 'config.json')).ok, true);
});
