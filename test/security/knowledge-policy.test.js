/* Knowledge policy: indexing reads files whose text is embedded and fed back
   to the model, so the resolved path is checked like a read AND restricted to
   the segments the indexer must never crawl (data/, .git, node_modules). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { checkIndexPath } from '../../server/security/path-policy.js';
import { authorize } from '../../server/security/kernel.js';
import { policyHints, capabilityTable } from '../../server/skills/registry.js';
import { desktopDir, documentsDir, homeDir } from '../../server/lib/paths.js';

test('checkIndexPath accepts a normal folder inside a read root', () => {
  assert.equal(checkIndexPath(path.join(documentsDir, 'reports')).ok, true);
  assert.equal(checkIndexPath(path.join(desktopDir, 'notes.md')).ok, true);
});

test('checkIndexPath refuses to leave the read roots or read a credential', () => {
  assert.equal(checkIndexPath(path.join(documentsDir, '..', '..', 'secrets')).ok, false);
  assert.equal(checkIndexPath(path.join(homeDir, '.ssh', 'id_rsa')).ok, false);
  assert.equal(checkIndexPath(path.join(documentsDir, '.env')).ok, false);
  assert.equal(checkIndexPath(`${path.join(documentsDir, 'notes.md')}:stream`).ok, false);
});

test('checkIndexPath excludes build output, VCS metadata, dependencies and data/', () => {
  for (const segment of ['node_modules', 'data', 'dist', 'build']) {
    const target = path.join(homeDir, segment, 'thing.md');
    const result = checkIndexPath(target);
    assert.equal(result.ok, false, `${segment} must not be indexed`);
    assert.match(result.reason, /excluded from indexing/);
  }
  // .git and AppData are already protected by the read denylist; either reason
  // is a refusal, which is all the indexer cares about.
  for (const segment of ['.git', 'AppData']) {
    const target = path.join(homeDir, segment, 'thing.md');
    const result = checkIndexPath(target);
    assert.equal(result.ok, false, `${segment} must not be indexed`);
    assert.match(result.reason, /excluded from indexing|protected location/);
  }
});

test('every knowledge skill declares the index:read permission', () => {
  const table = capabilityTable();
  for (const name of ['index_folder', 'search_knowledge', 'ask_my_document']) {
    assert.ok(table[name], `${name} must be registered`);
    assert.ok(table[name].permissions.includes('index:read'), `${name} must declare index:read`);
  }
});

test('the kernel authorises a valid folder and denies a denied segment', () => {
  const good = path.join(documentsDir, 'reports');
  const allow = authorize({ tool: 'index_folder', args: { path: good }, actor: 'api', ...policyHints('index_folder', { path: good }) });
  assert.equal(allow.decision, 'allow');

  const bad = path.join(homeDir, 'data');
  const deny = authorize({ tool: 'index_folder', args: { path: bad }, actor: 'api', ...policyHints('index_folder', { path: bad }) });
  assert.equal(deny.decision, 'deny');
  assert.match(deny.reason, /excluded from indexing|outside/);
});

test('an unknown folder name never resolves to a read root', () => {
  const hints = policyHints('index_folder', { path: 'Z:\\nowhere' });
  const decision = authorize({ tool: 'index_folder', args: { path: 'Z:\\nowhere' }, actor: 'api', ...hints });
  assert.equal(decision.decision, 'deny');
});

test('ask_my_document cannot traverse out of its parent folder (C1)', () => {
  const args = { fileName: '..\\..\\.env', parent: 'documents', question: 'what is the key?' };
  const decision = authorize({ tool: 'ask_my_document', args, actor: 'agent', ...policyHints('ask_my_document', args) });
  assert.equal(decision.decision, 'deny');
});

test('search_knowledge needs only a query and is authorised', () => {
  const decision = authorize({ tool: 'search_knowledge', args: { query: 'budget' }, actor: 'ui' });
  assert.equal(decision.decision, 'allow');
});
