/* Phase 1 (R9/S8): the browser agent can never be handed a non-web target. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  validateUrl, validateMode, validateDirection, validateElementId, validateCoordinates, clampInt,
  NAV_TIMEOUT, ACTION_TIMEOUT, WAIT_MAX, DOM_MAX_CHARS, INTERACTIVE_MAX
} from '../../server/web-agent/validate.js';

test('http and https targets are accepted and get an absolute href', () => {
  assert.equal(validateUrl('https://example.com'), 'https://example.com/');
  assert.equal(validateUrl('http://example.com/path?q=1'), 'http://example.com/path?q=1');
  assert.equal(validateUrl('example.com'), 'https://example.com/');
  assert.equal(validateUrl('  example.com  '), 'https://example.com/');
});

test('the browser agent may not be pointed at local files, scripts or privileged schemes', () => {
  for (const bad of [
    'file:///C:/Windows/System32/cmd.exe',
    'file:///C:/Users/YASH/.ssh/id_rsa',
    'javascript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'vbscript:msgbox',
    'chrome://settings',
    'about:blank',
    'ftp://example.com',
    'ms-settings:privacy'
  ]) {
    assert.equal(validateUrl(bad), null, `${bad} must be refused`);
  }
});

test('malformed, empty and non-string targets are refused', () => {
  assert.equal(validateUrl(''), null);
  assert.equal(validateUrl('   '), null);
  assert.equal(validateUrl(null), null);
  assert.equal(validateUrl(undefined), null);
  assert.equal(validateUrl(1234), null);
  assert.equal(validateUrl({}), null);
  assert.equal(validateUrl(['https://example.com']), null);
  assert.equal(validateUrl({ toString: () => 'https://example.com' }), null);
});

test('DOM read mode is whitelisted and defaults to interactive', () => {
  assert.equal(validateMode('readable'), 'readable');
  assert.equal(validateMode('FULL'), 'full');
  assert.equal(validateMode(undefined), 'interactive');
  assert.equal(validateMode('__proto__'), 'interactive');
  assert.equal(validateMode('constructor'), 'interactive');
  assert.equal(validateMode('../../etc'), 'interactive');
});

test('scroll direction is whitelisted and defaults to down', () => {
  assert.equal(validateDirection('up'), 'up');
  assert.equal(validateDirection('top'), 'top');
  assert.equal(validateDirection('bottom'), 'bottom');
  assert.equal(validateDirection(undefined), 'down');
  assert.equal(validateDirection('sideways'), 'down');
  assert.equal(validateDirection('__proto__'), 'down');
});

test('element ids are non-empty strings only', () => {
  assert.equal(validateElementId('el-12'), 'el-12');
  assert.equal(validateElementId('  el-3  '), 'el-3');
  assert.equal(validateElementId(''), null);
  assert.equal(validateElementId('   '), null);
  assert.equal(validateElementId(null), null);
  assert.equal(validateElementId(12), null);
  assert.equal(validateElementId({ id: 'el-1' }), null);
});

test('clickAt coordinates are finite numbers truncated to non-negative ints', () => {
  assert.deepEqual(validateCoordinates(68, 38), { x: 68, y: 38 });
  assert.deepEqual(validateCoordinates(0, 0), { x: 0, y: 0 });
  assert.deepEqual(validateCoordinates('12', 40.9), { x: 12, y: 40 });
  assert.equal(validateCoordinates(-5, 10), null); // negatives are invalid input
  assert.equal(validateCoordinates(5, -0.5), null);
  assert.equal(validateCoordinates('nope', 10), null);
  assert.equal(validateCoordinates(undefined, undefined), null);
  assert.equal(validateCoordinates(NaN, 10), null);
  assert.equal(validateCoordinates(Infinity, 10), null);
  assert.equal(validateCoordinates(null, 10), null);
});

test('numeric bounds are enforced and non-numbers fall back to the default', () => {
  assert.equal(clampInt(500, 300, -2000, 2000), 500);
  assert.equal(clampInt(999999, 300, -2000, 2000), 2000);
  assert.equal(clampInt(-999999, 300, -2000, 2000), -2000);
  assert.equal(clampInt('nonsense', 300, -2000, 2000), 300);
  assert.equal(clampInt(undefined, 300, -2000, 2000), 300);
  assert.equal(clampInt(null, 300, -2000, 2000), 0);
  assert.equal(clampInt(12.9, 300, 0, 2000), 12);
});

test('budgets stay bounded so a page cannot exhaust the model context', () => {
  assert.ok(DOM_MAX_CHARS > 0 && DOM_MAX_CHARS <= 20000);
  assert.ok(INTERACTIVE_MAX > 0 && INTERACTIVE_MAX <= 500);
  assert.ok(NAV_TIMEOUT > 0 && NAV_TIMEOUT <= 60000);
  assert.ok(ACTION_TIMEOUT > 0 && ACTION_TIMEOUT <= 60000);
  assert.ok(WAIT_MAX > 0 && WAIT_MAX <= 30000);
});