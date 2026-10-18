/* M6: create_document declares WRITE_FILES — the write policy must be real. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { authorize } from '../../server/security/kernel.js';
import { RISK } from '../../server/security/risk.js';
import { desktopDir } from '../../server/lib/paths.js';
import skill from '../../server/skills/create_document.js';

const request = (topic) => ({
  tool: 'create_document',
  args: { topic, originalRequest: 'write it' },
  ...skill.policyHints({ topic })
});

test('create_document declares the destination its write policy validates', () => {
  const hints = skill.policyHints({ topic: 'Quarterly Report' });
  assert.ok(hints.__targetPath, 'the skill must declare the real destination');
  assert.ok(hints.__fileName);
  assert.match(hints.__targetPath.replace(/\\/g, '/'), /\/Desktop\/Document_Quarterly_Report\.docx$/);

  const res = authorize(request('Quarterly Report'));
  assert.equal(res.decision, 'allow');
  assert.equal(res.risk, RISK.HIGH);
});

/* The kernel must now see the path — before M6 this branch was a no-op. */
test('a traversal-shaped topic is sanitised into a name the policy accepts', () => {
  const hints = skill.policyHints({ topic: '..\\..\\Windows\\evil' });
  assert.ok(!hints.__fileName.includes('\\') && !hints.__fileName.includes('/'),
    'separators are stripped when the name is built');
  assert.equal(path.dirname(hints.__targetPath), desktopDir,
    'the destination stays directly inside Desktop');
  assert.equal(authorize(request('..\\..\\Windows\\evil')).decision, 'allow');
});

test('a hostile file name is refused by the kernel, not silently allowed', () => {
  const res = authorize({
    tool: 'create_document',
    args: { topic: 'x', originalRequest: 'y' },
    __fileName: '..\\evil.docx',
    __targetPath: 'C:\\Windows\\evil.docx'
  });
  assert.equal(res.decision, 'deny');
});
