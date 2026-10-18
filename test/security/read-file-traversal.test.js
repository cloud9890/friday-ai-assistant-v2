/* Phase 0 (C1): reading a file must validate the resolved path, not just the
   folder the skill claims to read from. Exercises the real seam:
   skill-declared policy hints -> kernel decision. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { authorize } from '../../server/security/kernel.js';
import { policyHints } from '../../server/skills/registry.js';

/** Runs exactly what the agent loop does: hints from the skill, then authorize. */
function readDecision(args) {
  const hints = policyHints('read_file', args);
  return authorize({ tool: 'read_file', args, actor: 'agent', ...hints }).decision;
}

test('read_file allows a normal file inside the chosen folder', () => {
  assert.equal(readDecision({ fileName: 'notes.txt', parent: 'desktop' }), 'allow');
  assert.equal(readDecision({ fileName: 'report.md', parent: 'documents' }), 'allow');
});

test('read_file rejects path traversal out of the folder (C1)', () => {
  assert.equal(readDecision({ fileName: '..\\friday-ai-assistant\\.env', parent: 'desktop' }), 'deny');
  assert.equal(readDecision({ fileName: '../.env', parent: 'documents' }), 'deny');
  assert.equal(readDecision({ fileName: '..\\..\\.ssh\\id_rsa', parent: 'desktop' }), 'deny');
});

test('read_file rejects sensitive basenames even inside an allowed folder (C1)', () => {
  assert.equal(readDecision({ fileName: '.env', parent: 'desktop' }), 'deny');
  assert.equal(readDecision({ fileName: '.env.local', parent: 'documents' }), 'deny');
});

test('read_file rejects an absolute path smuggled into fileName', () => {
  assert.equal(readDecision({ fileName: 'C:\\Windows\\win.ini', parent: 'desktop' }), 'deny');
});

test('read_file fails closed on an unknown parent', () => {
  assert.equal(readDecision({ fileName: 'notes.txt', parent: 'C:\\Windows' }), 'deny');
});
