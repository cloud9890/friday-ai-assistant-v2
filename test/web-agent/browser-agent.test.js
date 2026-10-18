/* Web-agent browser tests: headless Puppeteer against a local fixture page.
   The engine's network policy blocks localhost, so these exercise
   dom-reader / actions / session directly — the modules that do the work. */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { BrowserSession } from '../../server/web-agent/session.js';
import { snapshotDOM } from '../../server/web-agent/dom-reader.js';
import { clickElement, clickAt, typeInto, scrollPage } from '../../server/web-agent/actions.js';

process.env.WEB_AGENT_HEADLESS = '1'; // headless for tests

const MAIN = `<!DOCTYPE html>
<html><head><title>Fixture Main</title></head><body>
<h1>Test Page</h1>
<p>Readable paragraph text for extract mode.</p>
<label><input type="checkbox" id="cb" checked> Dark mode</label>
<div role="switch" tabindex="0" aria-checked="false" aria-label="Notifications">N</div>
<input type="text" id="ti" value="laptops" aria-label="Search">
<select id="sel"><option value="a">Alpha</option><option value="b" selected>Beta</option></select>
<iframe srcdoc="<p>IFRAME-CONTENT-42</p>"></iframe>
<button id="adder" onclick="insertAbove()">Add button above</button>
<button id="victim">Original victim button</button>
<a href="/popup" target="_blank" id="poplink">Open popup</a>
<button id="fixed" style="position:fixed;left:8px;top:8px;width:120px;height:60px"
  onclick="this.dataset.n=(parseInt(this.dataset.n||0)+1);this.textContent='hit '+this.dataset.n">coord target</button>
<script>
function insertAbove(){
  var b=document.createElement('button');
  b.textContent='Inserted new button';
  b.onclick=function(){};
  document.getElementById('adder').parentNode.insertBefore(b, document.getElementById('adder'));
}
</script>
</body></html>`;

const POPUP = `<!DOCTYPE html><html><head><title>Fixture Popup</title></head>
<body><h1>Popup Page Marker</h1></body></html>`;

let server;
let baseUrl;
let session;
let page;

before(async () => {
  server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(req.url === '/popup' ? POPUP : MAIN);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  baseUrl = `http://127.0.0.1:${server.address().port}`;

  session = new BrowserSession();
  const tab = await session.ensureActivePage();
  page = tab.page;
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
});

after(async () => {
  await session.closeAll();
  await new Promise((r) => server.close(r));
});

const idForLabel = (snap, label) => {
  const el = snap.elements.find((e) => e.label === label);
  return el ? el.id : null;
};

test('snapshot renders ARIA roles, names, states and values', async () => {
  const snap = await snapshotDOM(page, { mode: 'interactive' });
  assert.match(snap.markdown, /\[CHECKBOX\] "Dark mode" \[checked\]/);
  assert.match(snap.markdown, /\[SWITCH\] "Notifications"/);
  assert.match(snap.markdown, /\[INPUT TEXT\] "Search" value="laptops"/);
  assert.match(snap.markdown, /\[SELECT\] "Search"|Beta/); // select renders its selected option
  assert.match(snap.markdown, /\[BUTTON\] "Add button above"/);
  assert.match(snap.markdown, /\[LINK\] "Open popup"/);
});

test('same-origin iframe content is rendered', async () => {
  const snap = await snapshotDOM(page, { mode: 'interactive' });
  assert.ok(snap.markdown.includes('IFRAME-CONTENT-42'), 'iframe body text must appear in the snapshot');
});

test('element IDs stay stable when the DOM shifts above them', async () => {
  const snap1 = await snapshotDOM(page, { mode: 'interactive' });
  const victimId = idForLabel(snap1, 'Original victim button');
  const adderId = idForLabel(snap1, 'Add button above');
  assert.ok(victimId && adderId, 'both buttons must be indexed');

  // Clicking "add" inserts a NEW button above both existing ones.
  const click = await clickElement(page, adderId);
  assert.ok(click.ok);

  const snap2 = await snapshotDOM(page, { mode: 'interactive' });
  assert.equal(idForLabel(snap2, 'Original victim button'), victimId,
    'the original button must keep its ID after a node is inserted above it');
  assert.equal(idForLabel(snap2, 'Add button above'), adderId);
  const newId = idForLabel(snap2, 'Inserted new button');
  assert.ok(newId, 'the inserted button must be indexed');
  assert.notEqual(newId, victimId);
  assert.notEqual(newId, adderId);
  // No duplicate IDs handed out.
  const ids = snap2.elements.map((e) => e.id);
  assert.equal(new Set(ids).size, ids.length);
});

test('typeInto clears and types real text into inputs', async () => {
  const snap = await snapshotDOM(page, { mode: 'interactive' });
  const inputId = idForLabel(snap, 'Search');
  assert.ok(inputId);
  const r = await typeInto(page, inputId, 'hello world');
  assert.ok(r.ok);
  const value = await page.evaluate(() => document.getElementById('ti').value);
  assert.equal(value, 'hello world');
});

test('clickAt hits coordinate targets the DOM cannot name', async () => {
  const r = await clickAt(page, 68, 38); // center of the fixed 120x60 button
  assert.ok(r.ok);
  const text = await page.evaluate(() => document.getElementById('fixed').textContent);
  assert.match(text, /^hit 1$/);
});

test('scroll accepts a direction and an elementId', async () => {
  assert.ok((await scrollPage(page, 'down')).ok);
  const snap = await snapshotDOM(page, { mode: 'interactive' });
  const selId = snap.elements.find((e) => e.kind === 'select').id;
  assert.ok((await scrollPage(page, null, selId)).ok);
});

test('target=_blank clicks are adopted as tracked tabs with awaited titles', async () => {
  const snap = await snapshotDOM(page, { mode: 'interactive' });
  const linkId = idForLabel(snap, 'Open popup');
  assert.ok(linkId);
  const click = await clickElement(page, linkId);
  assert.ok(click.ok);

  // Popup opening races the click settle; give adoption a short window.
  let adopted = [];
  for (let i = 0; i < 10 && adopted.length === 0; i++) {
    await new Promise((r) => setTimeout(r, 300));
    adopted = await session.adoptPopups();
  }
  assert.equal(adopted.length, 1, 'the popup must be adopted exactly once');

  const tabs = await session.listTabs();
  const popup = tabs.find((t) => t.id === adopted[0]);
  assert.ok(popup, 'adopted tab must be listed');
  assert.equal(popup.title, 'Fixture Popup'); // titles are awaited strings, not Promises
  assert.equal(popup.active, true, 'the popup becomes the active tab');

  // A second adoption pass must not re-adopt the same page.
  assert.deepEqual(await session.adoptPopups(), []);
});
