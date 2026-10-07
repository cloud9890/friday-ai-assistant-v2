/* ==========================================================================
   F.R.I.D.A.Y. // WEB AGENT — DOM READER
   Complete rewrite of the legacy getSimplifiedDOM blob.
   Produces: interactive-element map (stable data-agent-id), readable/full
   markdown, CSS-or-text filtering, and a hard char budget.
   ========================================================================== */

import { DOM_MAX_CHARS, INTERACTIVE_MAX } from './validate.js';

/* Runs inside the browser via page.evaluate(). Self-contained: any value it
   needs is passed via `cfg`. Side effect: stamps data-agent-id on indexed
   interactive elements so later click/type/select actions can target them. */
function snapshotScript(cfg) {
  const MODE = cfg.mode;
  const MAX_CHARS = cfg.maxChars;
  const QUERY = cfg.query ? String(cfg.query).trim().toLowerCase() : null;
  const MAX_IDX = cfg.interactiveMax;

  const IGNORED = new Set(['SCRIPT','STYLE','NOSCRIPT','SVG','IFRAME','CANVAS','TEMPLATE','LINK','META','HEAD','TITLE']);
  const BLOCKS = new Set(['DIV','P','LI','UL','OL','H1','H2','H3','H4','H5','H6','SECTION','ARTICLE','MAIN','NAV','HEADER','FOOTER','TABLE','TR','BLOCKQUOTE','FORM','ASIDE']);
  const READABLE_SKIP = new Set(['NAV','FOOTER','ASIDE','FORM','SCRIPT','STYLE','NOSCRIPT','SVG','IFRAME','CANVAS','TEMPLATE']);
  const INTERACTIVE_SELECTORS = 'a, button, input, textarea, select, summary, [role="button"], [role="link"], [role="menuitem"]';

  const isVisible = (el) => {
    try {
      const style = window.getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
      const rect = el.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    } catch { return false; }
  };

  const inViewport = (el) => {
    const rect = el.getBoundingClientRect();
    return rect.top >= 0 && rect.bottom <= (window.innerHeight || document.documentElement.clientHeight)
        && rect.left >= 0 && rect.right <= (window.innerWidth || document.documentElement.clientWidth);
  };

  /* ---------- 1. Index interactive elements ---------- */
  const elements = [];
  let idCounter = 1;
  let runIdx = 0;
  const indexedMeta = new Map();       // id -> meta
  const indexedEl = new Map();         // id -> element
  const allInteractives = Array.from(document.querySelectorAll(INTERACTIVE_SELECTORS)).filter(isVisible);
  for (const el of allInteractives) {
    if (runIdx >= MAX_IDX) break;
    runIdx++;
    const id = `el-${idCounter++}`;
    el.setAttribute('data-agent-id', id);
    const tag = el.tagName.toUpperCase();
    let kind = 'interactive';
    const role = (el.getAttribute('role') || '').toLowerCase();
    if (tag === 'A') kind = 'link';
    else if (tag === 'BUTTON' || role === 'button') kind = 'button';
    else if (tag === 'INPUT') kind = 'input';
    else if (tag === 'TEXTAREA') kind = 'textarea';
    else if (tag === 'SELECT') kind = 'select';
    else if (tag === 'SUMMARY') kind = 'summary';
    else if (role === 'link') kind = 'link';
    let label = '';
    try {
      label = (
        el.getAttribute('aria-label') ||
        (el.labels && el.labels.length ? Array.from(el.labels).map(l => String(l.innerText || '').trim()).filter(Boolean).join(' ') : '') ||
        el.getAttribute('placeholder') || el.getAttribute('name') || el.getAttribute('value') ||
        el.getAttribute('alt') ||
        String(el.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 120) ||
        el.getAttribute('title') || tag.toLowerCase()
      );
    } catch {}
    label = String(label || tag.toLowerCase()).trim();
    const meta = { id, tag: tag.toLowerCase(), kind, label, href: el.getAttribute('href') || '' };
    elements.push(meta);
    indexedMeta.set(id, meta);
    indexedEl.set(id, el);
  }

  /* ---------- 2. Query filter (CSS selector or text search) ---------- */
  let queryHits = null;
  if (QUERY) {
    queryHits = [];
    try {
      const byCss = Array.from(document.querySelectorAll(QUERY)).filter(isVisible);
      if (byCss.length > 0) queryHits = byCss.slice(0, 100);
    } catch {}
    if (queryHits.length === 0) {
      const walker = document.createTreeWalker(document.body, Node.ELEMENT_NODE);
      const hits = [];
      while (walker.nextNode()) {
        const el = walker.currentNode;
        try {
          if (el === document.body || el === document.documentElement) continue;
          if (!isVisible(el)) continue;
          const text = String(el.innerText || '').trim();
          if (!text || text.length > 2000) continue;
          const idx = text.toLowerCase().indexOf(QUERY);
          if (idx >= 0) hits.push({ el, idx });
        } catch {}
      }
      hits.sort((a, b) => a.idx - b.idx);
      queryHits = hits.slice(0, 100).map((h) => h.el);
    }

    // No matches found → fall back to rendering the full page instead of nothing.
    if (queryHits.length === 0) queryHits = null;
  }

  /* ---------- 3. Recursive markdown builder with strict budget ---------- */
  let out = [];
  let chars = 0;
  let truncated = false;
  const push = (str) => {
    if (truncated) return;
    if (chars + str.length > MAX_CHARS) { truncated = true; return; }
    chars += str.length;
    out.push(str);
  };

  const inFilteredSubtree = (el) => {
    if (!queryHits) return true;
    let n = el;
    while (n && n !== document.body) {
      if (queryHits.includes(n)) return true;
      n = n.parentNode || null;
    }
    return false;
  };

  const HEADINGS = new Set(['H1','H2','H3','H4','H5','H6']);

  // Query mode: render each matched element directly (deterministic, dedup'd).
  const renderHit = (el) => {
    if (truncated || !isVisible(el)) return;
    const ht = el.tagName.toUpperCase();
    if (IGNORED.has(ht)) return;
    // Skip elements nested inside another matched element (avoid duplication).
    let a = el.parentNode;
    while (a) {
      if (queryHits.includes(a)) return;
      a = a.parentNode || null;
    }
    const raw = String(el.innerText || '').replace(/\s+/g, ' ').trim();
    if (!raw) return;
    const id = el.getAttribute('data-agent-id');
    const idSuffix = id ? ` (ID: ${id})` : '';
    const label = el.getAttribute('aria-label') || el.getAttribute('title') || '';
    let text = raw;
    if (text.length > 300) text = text.slice(0, 300) + '…';
    if (HEADINGS.has(ht)) push(`\n# ${text}\n`);
    else if (ht === 'LI') push(`\n- ${text}\n`);
    else if (ht === 'P' || ht === 'TD' || ht === 'TH' || ht === 'BLOCKQUOTE') push(`\n${text}\n`);
    else if (ht === 'IMG') push(`\n[IMAGE: ${label || text}]\n`);
    else push(`\n[${ht}] ${text}${idSuffix}\n`);
  };

  const parseNode = (node) => {
    if (truncated) return;
    if (node.nodeType === Node.TEXT_NODE) {
      const text = String(node.textContent || '').replace(/\s+/g, ' ');
      if (text.trim()) push(text);
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const el = node;
    const tag = el.tagName.toUpperCase();
    if (IGNORED.has(tag)) return;
    if (MODE === 'readable' && READABLE_SKIP.has(tag)) return;
    if (!inFilteredSubtree(el)) return;
    if (!isVisible(el)) return;
    if (MODE === 'interactive') {
      const rect = el.getBoundingClientRect();
      const hasId = indexedEl.has(el.getAttribute('data-agent-id'));
      if (rect.width > 0 && rect.height > 0 && !inViewport(el) && !hasId) return;
    }

    const id = el.getAttribute('data-agent-id');
    if (id && indexedMeta.has(id)) {
      const m = indexedMeta.get(id);
      let url = m.href;
      if (m.kind === 'link' && url) {
        try { const u = new URL(url, location.href); url = u.origin + u.pathname; } catch {}
      }
      const entry = (() => {
        switch (m.kind) {
          case 'link': return `[LINK] "${m.label}" (ID: ${m.id})`;
          case 'button': return `[BUTTON] "${m.label}" (ID: ${m.id})`;
          case 'input': return `[INPUT ${String(el.getAttribute('type') || 'text').toUpperCase()}] "${m.label}" (ID: ${m.id})`;
          case 'textarea': return `[TEXTAREA] "${m.label}" (ID: ${m.id})`;
          case 'select': {
            const sel = el.options && el.options[el.selectedIndex] ? String(el.options[el.selectedIndex].text || '') : '';
            return `[SELECT] "${m.label}" [Selected: ${sel}] (ID: ${m.id})`;
          }
          case 'summary': return `[SUMMARY] "${m.label}" (ID: ${m.id})`;
          default: return `[INTERACTIVE] "${m.label}" (ID: ${m.id})`;
        }
      })();
      push(`\n${entry}\n`);
      return;
    }

    if (tag === 'IMG') {
      const alt = String(el.getAttribute('alt') || '').trim();
      if (alt) push(`\n[IMAGE: ${alt}]\n`);
      return;
    }

    const isBlock = BLOCKS.has(tag);
    if (isBlock) push('\n');

    const kids = Array.from(el.childNodes);
    if (kids.length === 1 && kids[0].nodeType === Node.TEXT_NODE) {
      const text = String(kids[0].textContent || '').replace(/\s+/g, ' ').trim();
      if (text) {
        if (tag === 'H1') push(`# ${text}\n`);
        else if (tag === 'H2') push(`## ${text}\n`);
        else if (tag === 'H3') push(`### ${text}\n`);
        else if (tag === 'H4') push(`#### ${text}\n`);
        else if (tag === 'H5') push(`##### ${text}\n`);
        else if (tag === 'H6') push(`###### ${text}\n`);
        else if (tag === 'LI') push(`- ${text}\n`);
        else if (tag === 'P') push(`${text}\n`);
        else if (tag === 'TD' || tag === 'TH') push(` ${text} `);
        else push(text);
        return;
      }
    }

    for (const child of kids) parseNode(child);
    if (isBlock) push('\n');
  };

  if (queryHits && queryHits.length > 0) {
    for (const el of queryHits) {
      if (truncated) break;
      renderHit(el);
    }
  } else {
    parseNode(document.body);
  }

  let markdown = out.join('');
  markdown = markdown.replace(/\n{3,}/g, '\n\n').trim();
  if (truncated) markdown += '\n[...TRUNCATED FOR LENGTH]';

  if (MODE === 'readable' && elements.length > 0) {
    markdown += '\n\n## Interactive Elements\n' +
      elements.map((e) => `- [${e.kind.toUpperCase()}] "${e.label}" (ID: ${e.id})`).join('\n');
  }

  return { markdown, elements, title: document.title || '', url: location.href, truncated, mode: MODE };
}
/* ---------- Public entry ---------- */
export async function snapshotDOM(page, opts = {}) {
  const cfg = {
    mode: ['interactive', 'readable', 'full'].includes(opts.mode) ? opts.mode : 'interactive',
    maxChars: Number(opts.maxChars) > 0 ? Number(opts.maxChars) : DOM_MAX_CHARS,
    query: typeof opts.query === 'string' && opts.query.trim() ? opts.query.trim() : null,
    interactiveMax: Number(opts.interactiveMax) > 0 ? Number(opts.interactiveMax) : INTERACTIVE_MAX
  };
  try {
    return await page.evaluate(snapshotScript, cfg);
  } catch (err) {
    return {
      markdown: `Error reading DOM: ${err.message}. The page might still be loading or has blocked the agent.`,
      elements: [], title: '', url: page.url(), truncated: false, error: err.message
    };
  }
}

/** DOM read with legacy retry semantics (a companion to snapshotDOM). */
export async function snapshotDOMWithRetry(page, opts = {}) {
  let last;
  const tries = opts.retries ?? 2;
  for (let i = 0; i <= tries; i++) {
    last = await snapshotDOM(page, { ...opts, retries: undefined });
    if (!last.error) return last;
    await new Promise((r) => setTimeout(r, 2000));
  }
  return last;
}