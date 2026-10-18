/* H2: a popup the agent never opened must still pass the agent URL policy. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BrowserSession } from '../../server/web-agent/session.js';

function fakePage(url, opts = {}) {
  return {
    _url: url,
    _closed: Boolean(opts.closed),
    url() { return this._url; },
    isClosed() { return this._closed; },
    setDefaultTimeout() {},
    setDefaultNavigationTimeout() {},
    on() {},
    async close() { this._closed = true; }
  };
}

function sessionWith(...pages) {
  const session = new BrowserSession();
  session.browser = { pages: async () => pages, on() {} };
  return session;
}

test('a popup to a blocked destination is refused, closed and reported', async () => {
  const evil = fakePage('https://accounts.google.com/signin');
  const session = sessionWith(evil);

  const adopted = await session.adoptPopups();

  assert.deepEqual(adopted, []);
  assert.equal(session.pages.size, 0, 'a refused popup is never tracked');
  assert.equal(evil._closed, true, 'a refused popup is closed');

  const blocked = session.takeBlockedPopups();
  assert.equal(blocked.length, 1);
  assert.match(blocked[0].url, /accounts\.google\.com/);
  assert.match(blocked[0].reason, /blocked/i);
  assert.deepEqual(session.takeBlockedPopups(), [], 'the report drains');
});

test('a popup to a normal page is adopted and becomes the active tab', async () => {
  const good = fakePage('https://example.com/article');
  const session = sessionWith(good);

  const adopted = await session.adoptPopups();

  assert.equal(adopted.length, 1);
  assert.equal(session.pages.size, 1);
  assert.equal(session.activeTabId, adopted[0]);
  assert.deepEqual(session.takeBlockedPopups(), []);
});

test('a popup that is still blank is adopted; enforcement happens at read time', async () => {
  const blank = fakePage('about:blank');
  const session = sessionWith(blank);

  const adopted = await session.adoptPopups();
  assert.equal(adopted.length, 1);
});

test('local pages the user is allowed to drive are adopted', async () => {
  const local = fakePage('http://localhost:5173/app');
  const session = sessionWith(local);

  const adopted = await session.adoptPopups();
  assert.equal(adopted.length, 1);
});

test('an already-tracked page is never adopted twice', async () => {
  const page = fakePage('https://example.com/x');
  const session = sessionWith(page);

  await session.adoptPopups();
  const second = await session.adoptPopups();

  assert.deepEqual(second, []);
  assert.equal(session.pages.size, 1);
});

test('a closed popup is ignored rather than adopted', async () => {
  const dead = fakePage('https://example.com/gone', { closed: true });
  const session = sessionWith(dead);

  assert.deepEqual(await session.adoptPopups(), []);
  assert.equal(session.pages.size, 0);
});
