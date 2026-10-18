/* Desktop agent unit tests (pure logic) + a Windows-guarded live loop
   against a dedicated Notepad instance targeted BY PID, so the test can
   never touch a user's open windows. */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'child_process';

import { parseUiaOutput, DesktopUseError } from '../../server/desktop-agent/uia.js';
import {
  formatApps, formatElements, formatObserve, resetDesktopSession
} from '../../server/desktop-agent/engine.js';

/* Live UI automation drives a real Windows desktop and is opt-in: when the
   fixture window is slow/flaky the polling loop is long, and a wedged run can
   leave handles that stop `node --test` from exiting. Run it deliberately with
   `set FRIDAY_LIVE_TESTS=1` (Windows) — a plain `npm test` stays deterministic. */
const LIVE = process.env.FRIDAY_LIVE_TESTS === '1';

/* ------------------------------ pure units -------------------------------- */

test('parseUiaOutput extracts the JSON object from bridge stdout', () => {
  const payload = parseUiaOutput('{"ok":true,"action":"observe","treeCount":3}');
  assert.equal(payload.ok, true);
  assert.equal(payload.treeCount, 3);
});

test('parseUiaOutput fails closed on empty, non-JSON and malformed output', () => {
  for (const bad of ['', null, 'no json here', '{"ok":true', '{"ok":false']) {
    assert.throws(() => parseUiaOutput(bad), DesktopUseError, `"${bad}" must throw`);
  }
  // Prefix noise before the JSON is tolerated (first-'{' to last-'}' extraction).
  const payload = parseUiaOutput('some noise\n{"ok":true}');
  assert.equal(payload.ok, true);
  // But a payload claiming ok:false still parses — the caller turns it into
  // a structured DesktopUseError, not a parse failure.
  const failed = parseUiaOutput('{"ok":false,"code":"APP_NOT_FOUND","error":"nope"}');
  assert.equal(failed.ok, false);
  assert.equal(failed.code, 'APP_NOT_FOUND');
});

test('parseUiaError-like payloads keep the structured contract', () => {
  const err = new DesktopUseError('ELEMENT_UNAVAILABLE', 'index 9 outside tree');
  assert.equal(err.code, 'ELEMENT_UNAVAILABLE');
  assert.equal(err.retry, 'reobserve');
  assert.equal(err.actionSent, false);
  assert.equal(new DesktopUseError('SENSITIVE_APP', 'no').retry, 'never');
  // Unknown codes collapse to INTERNAL.
  assert.equal(new DesktopUseError('MADE_UP', 'no').code, 'INTERNAL');
});

test('formatElements renders roles, names, values, states, patterns and rects', () => {
  const text = formatElements([
    { index: 0, role: 'window', name: 'Doc - Notepad', value: '', enabled: true, focused: false, offscreen: false, patterns: [], rect: null },
    { index: 2, role: 'document', name: '', value: 'hello', enabled: true, focused: true, offscreen: false, patterns: ['Value'], rect: { x: 8, y: 8, w: 100, h: 50 } },
    { index: 5, role: 'button', name: 'Save', value: '', enabled: false, focused: false, offscreen: true, patterns: ['Invoke'], rect: null }
  ]);
  assert.match(text, /#0 \[WINDOW\] "Doc - Notepad"/);
  assert.match(text, /#2 \[DOCUMENT\] "" value="hello" \[focused\] patterns=Value rect=8,8 100x50/);
  assert.match(text, /#5 \[BUTTON\] "Save" \[disabled,offscreen\] patterns=Invoke/);
});

test('formatElements handles an empty tree with a re-observe hint', () => {
  assert.match(formatElements([]), /Re-observe without a query/);
});

test('formatObserve caps runaway observation output', () => {
  const many = Array.from({ length: 400 }, (_, i) => ({
    index: i, role: 'button', name: `x${i}`.repeat(60), value: '', enabled: true,
    focused: false, offscreen: false, patterns: [], rect: null
  }));
  const text = formatObserve({ process: 'p', pid: 1, windowTitle: 'w', treeCount: 400, listed: 400, elements: many });
  assert.ok(text.length <= 40100, 'observation must be capped');
});

test('formatApps marks sensitive apps for the model', () => {
  const text = formatApps([
    { process: 'notepad', pid: 5, title: 'Untitled', sensitive: false },
    { process: 'cmd', pid: 7, title: 'Prompt', sensitive: true }
  ]);
  assert.match(text, /notepad \(pid 5\) "Untitled"/);
  assert.match(text, /cmd \(pid 7\).*\[blocked for automation\]/);
  assert.match(formatApps([]), /No running apps/);
});

/* --------------------------- live Windows loop ---------------------------- */

test('live: observe -> setValue -> verify -> close, on a dedicated fixture window', {
  timeout: 120000,
  skip: LIVE ? false : 'live Windows UI test — set FRIDAY_LIVE_TESTS=1 to run'
}, async (t) => {
  const { runUia, runCapture } = await import('../../server/desktop-agent/uia.js');
  if (process.platform !== 'win32') return t.skip('windows only');

  // Win11 Notepad is a store app: the launched process hands off and the
  // window belongs to another pid. Target by a unique document title instead,
  // so only OUR fixture window can match — never a user's open document.
  const os = await import('os');
  const fs = await import('fs');
  const path = await import('path');
  const fixturePath = path.join(os.tmpdir(), `friday-uia-fixture-${Date.now()}.txt`);
  fs.writeFileSync(fixturePath, '');
  const child = execFile('notepad.exe', [fixturePath]);
  child.unref(); // never let the launcher handle keep the test runner alive
  const fixtureTitle = path.basename(fixturePath); // window title contains it
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  try {
    let observed = null;
    for (let i = 0; i < 24; i++) {
      await sleep(500);
      try {
        const probe = await runUia({ action: 'observe', appName: 'notepad', windowTitle: fixtureTitle, maxElements: 60 });
        observed = probe;
        break;
      } catch (e) {
        if (e.code !== 'APP_NOT_FOUND') throw e;
      }
    }
    if (!observed) return t.skip('fixture notepad window did not appear in time');

    assert.ok(observed.windowTitle.includes(fixtureTitle), 'observation must be of the fixture window');
    const editor = observed.elements.find((e) => e.role === 'Document' || e.role === 'Edit' || e.patterns.includes('Value'));
    if (!editor) return t.skip('no value-bearing element found in notepad tree');

    const set = await runUia({ action: 'setValue', appName: 'notepad', windowTitle: fixtureTitle, index: editor.index, text: 'friday desktop agent test' });
    assert.equal(set.landed, true, 'setValue read-back must verify the text landed');
    assert.equal(set.readBack, 'friday desktop agent test');

    const re = await runUia({ action: 'observe', appName: 'notepad', windowTitle: fixtureTitle, query: 'friday desktop' });
    assert.equal(re.listed, 1, 'query filter must find the typed text');

    const key = await runUia({ action: 'pressKey', appName: 'notepad', windowTitle: fixtureTitle, key: 'ctrl+a' });
    assert.equal(key.ok, true);
    assert.ok(key.focusedAfter, 'pressKey must report keyboard focus');

    const shot = await runCapture({ appName: 'notepad', windowTitle: fixtureTitle });
    assert.match(shot.screenshot, /^data:image\/jpeg;base64,/);
    assert.ok(shot.size.w > 0 && shot.size.h > 0);
  } finally {
    child.kill();
    resetDesktopSession();
    // Win11 store Notepad hands off to another process, so killing the stub
    // pid leaves the window alive. Kill only windows whose title carries our
    // unique fixture name — never the user's documents.
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command',
        'Get-Process notepad -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowTitle -like "*$env:FRIDAY_FIXTURE*" } | Stop-Process -Force'],
      { env: { ...process.env, FRIDAY_FIXTURE: fixtureTitle } },
      () => {}
    );
    fs.rmSync(fixturePath, { force: true });
  }
});
