/* Phase 1 (R6/S4): the model names an application; only a trusted target runs. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveApp, SENSITIVE_EXECUTABLES, ALLOWED_APPS } from '../../server/security/app-policy.js';

test('known applications resolve to their curated executable', () => {
  assert.equal(resolveApp('notepad').target, 'notepad.exe');
  assert.equal(resolveApp('calculator').target, 'calc.exe');
  assert.equal(resolveApp('vscode').target, 'code');
  assert.equal(resolveApp(' VS Code ').target, 'code');
  assert.equal(resolveApp('CHROME').target, 'chrome.exe');
});

test('shell executables are flagged as sensitive', () => {
  assert.equal(resolveApp('cmd').sensitive, true);
  assert.equal(resolveApp('powershell').sensitive, true);
  for (const exe of ['cmd.exe', 'powershell.exe', 'wscript.exe', 'mshta.exe']) {
    assert.ok(SENSITIVE_EXECUTABLES.has(exe), `${exe} must be sensitive`);
  }
});

test('paths, arguments and quoting games are refused outright', () => {
  for (const bad of [
    'C:\\Windows\\System32\\cmd.exe',
    '..\\..\\Windows\\System32\\calc.exe',
    'notepad & shutdown /s',
    'notepad; rm -rf /',
    'notepad | net user',
    'notepad" && calc',
    "notepad' ; calc",
    'notepad`calc`',
    '$(calc)',
    '%COMSPEC%'
  ]) {
    assert.equal(resolveApp(bad).ok, false, `${bad} must be refused`);
  }
});

test('NUL bytes, over-long names and empty input are refused', () => {
  assert.equal(resolveApp('note\0pad').ok, false);
  assert.equal(resolveApp('a'.repeat(65)).ok, false);
  assert.equal(resolveApp('').ok, false);
  assert.equal(resolveApp('   ').ok, false);
  assert.equal(resolveApp(null).ok, false);
  assert.equal(resolveApp(undefined).ok, false);
});

test('the failure reason is explicit so the model can correct itself', () => {
  const res = resolveApp('definitely-not-installed-xyz');
  assert.equal(res.ok, false);
  assert.match(res.reason, /unknown application/i);
});

test('the allow-list is not empty and excludes raw shell entry points by name', () => {
  assert.ok(ALLOWED_APPS.size >= 15);
  assert.equal(ALLOWED_APPS.has('notepad'), true);
});
