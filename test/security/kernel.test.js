/* Phase 1 (R3/R12): the kernel is the only authority. Fail closed, always. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { authorize, isAllowed, resolveWriteTarget } from '../../server/security/kernel.js';
import { RISK } from '../../server/security/risk.js';
import { desktopDir, documentsDir } from '../../server/lib/paths.js';

const decisionOf = (req) => authorize(req).decision;

test('an unknown capability is denied â€” FRIDAY never guesses', () => {
  const res = authorize({ tool: 'arbitrary_shell_command', args: { cmd: 'whoami' } });
  assert.equal(res.decision, 'deny');
  assert.match(res.reason, /unknown capability/i);
  assert.equal(res.risk, RISK.BLOCKED);
});

test('a missing tool name is denied, not allowed', () => {
  assert.equal(decisionOf({ args: {} }), 'deny');
  assert.equal(decisionOf({}), 'deny');
});

test('read-only system status is allowed without confirmation', () => {
  const res = authorize({ tool: 'fetch_system_status', args: {} });
  assert.equal(res.decision, 'allow');
  assert.equal(res.confirmation, 'none');
});

test('low-risk, reversible controls are allowed', () => {
  for (const req of [
    { tool: 'change_system_volume', args: { action: 'volume-up', amount: 10 } },
    { tool: 'control_media', args: { action: 'next' } },
    { tool: 'remember_fact', args: { key: 'colour', value: 'blue' } }
  ]) {
    assert.equal(decisionOf(req), 'allow', JSON.stringify(req));
  }
});

test('launching a known application is allowed on the spoken command', () => {
  const res = authorize({ tool: 'open_desktop_app', args: { appName: 'notepad' } });
  assert.equal(res.decision, 'allow');
  assert.equal(res.confirmation, 'none');
  assert.equal(res.risk, RISK.HIGH);
  assert.equal(res.resolvedApp, 'notepad.exe');
});

test('deleting a path is allowed by the kernel but always requires user confirmation', () => {
  const res = authorize({
    tool: 'delete_path',
    args: { name: 'old-project', parent: 'desktop' },
    __targetPath: path.join(desktopDir, 'old-project')
  });
  assert.equal(res.decision, 'allow');
  assert.equal(res.confirmation, 'always');
  assert.equal(res.risk, RISK.HIGH);
});

test('launching an unknown or injected application is denied', () => {
  assert.equal(decisionOf({ tool: 'open_desktop_app', args: { appName: 'evil-tool' } }), 'deny');
  assert.equal(decisionOf({ tool: 'open_desktop_app', args: { appName: 'notepad & shutdown /s' } }), 'deny');
  assert.equal(decisionOf({ tool: 'open_desktop_app', args: { appName: 'C:\\Windows\\System32\\cmd.exe' } }), 'deny');
  assert.equal(decisionOf({ tool: 'open_desktop_app', args: { appName: '..\\..\\evil.exe' } }), 'deny');
});

test('wrong argument types are denied before any executor sees them', () => {
  assert.equal(decisionOf({ tool: 'change_system_volume', args: { amount: 'lots' } }), 'deny');
  assert.equal(decisionOf({ tool: 'open_desktop_app', args: { appName: { toString: () => 'notepad' } } }), 'deny');
});

test('filesystem writes are constrained to Desktop and Documents', () => {
  assert.equal(decisionOf({ tool: 'create_document', args: {}, __fileName: 'report.docx', __targetPath: path.join(desktopDir, 'report.docx') }), 'allow');
  assert.equal(decisionOf({ tool: 'create_document', args: {}, __fileName: 'notes.txt', __targetPath: path.join(documentsDir, 'notes.txt') }), 'allow');

  const escaped = path.join(desktopDir, '..', '.ssh', 'id_rsa');
  assert.equal(decisionOf({ tool: 'create_document', args: {}, __fileName: 'id_rsa', __targetPath: escaped }), 'deny');
  assert.equal(decisionOf({ tool: 'create_document', args: {}, __fileName: '..\\evil.txt' }), 'deny');
  assert.equal(decisionOf({ tool: 'create_document', args: {}, __fileName: 'ok.txt', __targetPath: 'C:\\Windows\\evil.txt' }), 'deny');
});

test('local file search is limited to the read roots', () => {
  assert.equal(decisionOf({ tool: 'search_local_files', args: { query: 'tax' }, __readDirs: [desktopDir, documentsDir] }), 'allow');
  assert.equal(decisionOf({ tool: 'search_local_files', args: { query: 'sam' }, __readDirs: ['C:\\Windows\\System32'] }), 'deny');
  assert.equal(decisionOf({ tool: 'search_local_files', args: { query: 'keys' }, __readDirs: [path.join(desktopDir, '..', '.ssh')] }), 'deny');
});

test('server-side fetches cannot reach the local machine or the LAN', () => {
  for (const url of [
    'http://localhost:11434/api/tags',
    'http://127.0.0.1:5173/api/health',
    'http://169.254.169.254/latest/meta-data/',
    'http://192.168.1.1/',
    'http://10.1.2.3/',
    'file:///C:/Windows/win.ini'
  ]) {
    assert.equal(decisionOf({ tool: 'search_web_summary', args: { url } }), 'deny', url);
  }
  assert.equal(decisionOf({ tool: 'search_web_summary', args: { url: 'https://en.wikipedia.org/wiki/AI' } }), 'allow');
});

test('the browser agent may open local apps but not credential surfaces', () => {
  assert.equal(decisionOf({ tool: 'inspect_and_interact_web', args: { action: 'navigate', url: 'http://localhost:3000' } }), 'allow');
  assert.equal(decisionOf({ tool: 'inspect_and_interact_web', args: { action: 'navigate', url: 'https://accounts.google.com/signin' } }), 'deny');
  assert.equal(decisionOf({ tool: 'inspect_and_interact_web', args: { action: 'navigate', url: 'https://example.com' } }), 'allow');
});

test('macros are validated step by step before anything runs (fail closed)', () => {
  assert.equal(decisionOf({ tool: 'execute_macro', args: { steps: [{ type: 'app', target: 'notepad' }, { type: 'delay', ms: 500 }] } }), 'allow');
  assert.equal(decisionOf({ tool: 'execute_macro', args: { steps: [{ type: 'app', target: 'cmd' }] } }), 'deny');
  assert.equal(decisionOf({ tool: 'execute_macro', args: { steps: [{ type: 'url', target: 'http://127.0.0.1/secret' }] } }), 'deny');
  assert.equal(decisionOf({ tool: 'execute_macro', args: { steps: [{ type: 'shell', target: 'whoami' }] } }), 'deny');
  assert.equal(decisionOf({ tool: 'execute_macro', args: { steps: [] } }), 'deny');
  assert.equal(decisionOf({ tool: 'execute_macro', args: { steps: 'not-an-array' } }), 'deny');
  assert.equal(decisionOf({ tool: 'execute_macro', args: { steps: Array.from({ length: 21 }, () => ({ type: 'delay', ms: 1 })) } }), 'deny');
  assert.equal(decisionOf({ tool: 'execute_macro', args: { steps: Array.from({ length: 5 }, () => ({ type: 'delay', ms: 9000 })) } }), 'deny');
});

test('a denial carries a human-readable reason and no side effects', () => {
  const res = authorize({ tool: 'open_desktop_app', args: { appName: 'definitely-not-installed-xyz' } });
  assert.equal(res.decision, 'deny');
  assert.ok(res.reason.length > 0);
  assert.equal(res.resolvedApp, null);
});

test('isAllowed mirrors the decision', () => {
  assert.equal(isAllowed({ tool: 'fetch_system_status', args: {} }), true);
  assert.equal(isAllowed({ tool: 'nope', args: {} }), false);
});

test('resolveWriteTarget reproduces the save-file destination exactly', () => {
  assert.equal(resolveWriteTarget('report', 'Desktop', 'docx'), path.join(desktopDir, 'report.docx'));
  assert.equal(resolveWriteTarget('report', 'documents', 'docx'), path.join(documentsDir, 'report.docx'));
  assert.equal(resolveWriteTarget('notes', 'Desktop', 'txt'), path.join(desktopDir, 'notes.txt'));
  assert.equal(resolveWriteTarget('notes.md', 'Desktop', 'md'), path.join(desktopDir, 'notes.md'));
  assert.equal(resolveWriteTarget('a/b:c*d', 'Desktop', 'txt'), path.join(desktopDir, 'a_b_c_d.txt'));
});
