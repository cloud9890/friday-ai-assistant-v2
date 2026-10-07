/* Phase 1 (R12): risk model invariants. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RISK, atLeast, riskLevel, allow, deny, DECISION } from '../../server/security/risk.js';

test('risk levels are strictly ordered, blocked last', () => {
  assert.ok(riskLevel(RISK.SAFE) < riskLevel(RISK.LOW));
  assert.ok(riskLevel(RISK.LOW) < riskLevel(RISK.MEDIUM));
  assert.ok(riskLevel(RISK.MEDIUM) < riskLevel(RISK.HIGH));
  assert.ok(riskLevel(RISK.HIGH) < riskLevel(RISK.BLOCKED));
});

test('an unknown risk is treated as the strictest level (fail closed)', () => {
  assert.equal(riskLevel('made-up-risk'), riskLevel(RISK.BLOCKED));
  assert.ok(atLeast('made-up-risk', RISK.BLOCKED));
});

test('atLeast compares correctly', () => {
  assert.ok(atLeast(RISK.HIGH, RISK.MEDIUM));
  assert.ok(atLeast(RISK.MEDIUM, RISK.MEDIUM));
  assert.ok(!atLeast(RISK.LOW, RISK.MEDIUM));
  assert.ok(!atLeast(RISK.SAFE, RISK.LOW));
});

test('allow/deny helpers carry the decision', () => {
  assert.equal(allow().decision, DECISION.ALLOW);
  assert.equal(deny('nope').decision, DECISION.DENY);
  assert.equal(deny('nope').reason, 'nope');
});
