/* ==========================================================================
   F.R.I.D.A.Y. // WEB AGENT — DOM READER
   ARIA-grade snapshot producer. Ported from the control-browser skill's
   discipline: a semantic snapshot (roles, accessible names, states) with
   STABLE element refs, so an ID read before a click still targets the same
   element after the DOM shifts. Element IDs survive re-reads: the indexer
   reuses the data-agent-id already stamped on a live element and only
   numbers newly-seen interactives.
   Produces: interactive-element map (stable data-agent-id), readable/full
   markdown, CSS-or-text filtering, same-origin iframe content, and a hard
   char budget.
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

  const IGNORED = new Set(['SCRIPT','STYLE','NOSCRIPT','SVG','TEMPLATE','LINK','META','HEAD','TITLE']);
  const BLOCKS = new Set(['DIV','P','LI','UL','OL','H1','H2','H3','H4','H5','H6','SECTION','ARTICLE','MAIN','NAV','HEADER','FOOTER','TABLE','TR','BLOCKQUOTE','FORM','ASIDE']);
  const READABLE_SKIP = new Set(['NAV','FOOTER','ASIDE','FORM','SCRIPT','STYLE','NOSCRIPT','SVG','TEMPLATE','IFRAME','CANVAS']);
  const INTERACTIVE_SELECTORS = [
    'a', 'button', 'input', 'textarea', 'select', 'summary',
    '[contenteditable="true"]',
    '[role="button"]', '[role="link"]', '[role="checkbox"]', '[role="switch"]',
    '[role="radio"]', '[role="tab"]', '[role="option"]', '[role="menuitem"]',
    '[role="menuitemcheckbox"]', '[role="menuitemradio"]', '[role="combobox"]',
    '[role="slider"]', '[role="spinbutton"]', '[role="textbox"]', '[role="searchbox"]'
  ].join(', ');
  const SELECTABLE_KINDS = new Set(['option', 'tab', 'radio', 'menuitemradio']);
  const CHECKABLE_KINDS = new Set(['checkbox', 'switch', 'menuitemcheckbox']);

  /* All visibility math must run in the element's own window (iframes). */
  const viewOf = (el) => el.ownerDocument.defaultView || window;

  const isVisible = (el) => {
    try {
      const view = viewOf(el);
      const style = view.getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
      const rect = el.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    } catch { return false; }
  };

  /* Intersecting counts: an element partially in view IS in view. */
  const intersectsViewport = (el) => {
    const view = viewOf(el);
    const vw = view.innerWidth || document.documentElement.clientWidth;
    const vh = view.innerHeight || document.documentElement.clientHeight;
    const r = el.getBoundingClientRect();
    return r.top < vh && r.bottom > 0 && r.left < vw && r.right > 0;
  };

  /* ---------- accessible name (ARIA computation order) ---------- */
  const nameFromLabelledby = (el) => {
    const ref = el.getAttribute('aria-labelledby');
    if (!ref) return '';
    try {
      return ref.split(/\s+/)
        .map((id) => el.ownerDocument.getElementById(id))
        .filter(Boolean)
        .map((n) => String(n.innerText || n.textContent || '').trim())
        .filter(Boolean)
        .join(' ');
    } catch { return ''; }
  };

  const accessibleName = (el, tag) => {
    const byRef = nameFromLabelledby(el);
    if (byRef) return byRef;
    const aria = el.getAttribute('aria-label');
    if (aria && aria.trim()) return aria.trim();
    if (el.labels && el.labels.length) {
      const lbl = Array.from(el.labels).map((l) => String(l.innerText || '').trim()).filter(Boolean).join(' ');
      if (lbl) return lbl;
    }
    const ph = el.getAttribute('placeholder');
    if (ph && ph.trim()) return ph.trim();
    const text = String(el.innerText || '').replace(/\s+/g, ' ').trim();
    if (text) return text.slice(0, 120);
    const title = el.getAttribute('title');
    if (title && title.trim()) return title.trim();
    if (tag === 'IMG') {
      const alt = el.getAttribute('alt');
      if (alt && alt.trim()) return alt.trim();
    }
    // Last resort: a value-bearing control names itself (submit buttons).
    const type = (el.getAttribute('type') || '').toLowerCase();
    if (type !== 'password' && el.value !== undefined && String(el.value).trim()) {
      return String(el.value).slice(0, 60);
    }
    return '';
  };

  /* ---------- role/kind mapping (explicit role wins) ---------- */
  const kindOf = (el, tag) => {
    const role = (el.getAttribute('role') || '').toLowerCase();
    const type = (el.getAttribute('type') || '').toLowerCase();
    if (role === 'button' || tag === 'BUTTON' || (tag === 'INPUT' && ['button', 'submit', 'reset'].includes(type))) return 'button';
    if (role === 'link' || tag === 'A') return 'link';
    if (role === 'checkbox' || (tag === 'INPUT' && type === 'checkbox')) return 'checkbox';
    if (role === 'switch') return 'switch';
    if (role === 'radio' || (tag === 'INPUT' && type === 'radio')) return 'radio';
    if (role === 'tab') return 'tab';
    if (role === 'option') return 'option';
    if (role === 'menuitem' || role === 'menuitemcheckbox' || role === 'menuitemradio') return role;
    if (role === 'combobox') return 'combobox';
    if (role === 'slider') return 'slider';
    if (role === 'spinbutton') return 'spinbutton';
    if (role === 'textbox' || role === 'searchbox') return 'textbox';
    if (tag === 'SELECT') return 'select';
    if (tag === 'TEXTAREA') return 'textarea';
    if (tag === 'INPUT') return 'input';
    if (tag === 'SUMMARY') return 'summary';
    if (el.isContentEditable) return 'textbox';
    return 'interactive';
  };

  /* ---------- state flags (checked/selected/expanded/disabled/...) ---------- */
  const stateString = (el, kind) => {
    const s = [];
    if (el.disabled || el.getAttribute('aria-disabled') === 'true') s.push('disabled');
    if (el.required || el.getAttribute('aria-required') === 'true') s.push('required');
    if (el.readOnly) s.push('readonly');
    const ariaChecked = el.getAttribute('aria-checked');
    const isCheckable = CHECKABLE_KINDS.has(kind) || kind === 'checkbox';
    const isSelectable = SELECTABLE_KINDS.has(kind);
    if (isCheckable || isSelectable) {
      const on = el.checked === true || ariaChecked === 'true' || el.selected === true;
      if (isSelectable && on) s.push('selected');
      else if (isCheckable && on) s.push('checked');
      if (ariaChecked === 'mixed') s.push('mixed');
    }
    const ariaSel = el.getAttribute('aria-selected');
    if (ariaSel === 'true' && !s.includes('selected')) s.push('selected');
    const ariaExp = el.getAttribute('aria-expanded');
    if (ariaExp === 'true') s.push('expanded');
    else if (ariaExp === 'false') s.push('collapsed');
    return s.join(' ');
  };

  /* Current value of a value-bearing control (never passwords). */
  const valueString = (el, kind) => {
    if (!['input', 'textbox', 'combobox', 'slider', 'spinbutton'].includes(kind)) return '';
    const type = (el.getAttribute('type') || '').toLowerCase();
    if (type === 'password') return '';
    if (el.isContentEditable) return '';
    if (el.value === undefined || el.value === null || String(el.value) === '') return '';
    return String(el.value).slice(0, 60);
  };

  /* ---------- 1. Index interactive elements (stable IDs) ---------- */
  const elements = [];
  const indexedMeta = new Map();       // id -> meta
  const indexedEl = new Map();         // id -> element
  const processed = new Set();         // element -> registered (closest() dedup)

  // Continue numbering beyond anything stamped earlier on this page, so a
  // re-read can never hand out a duplicate ID.
  let idCounter = 1;
  for (const stamped of Array.from(document.querySelectorAll('[data-agent-id]'))) {
    const m = /^el-(\d+)$/.exec(stamped.getAttribute('data-agent-id') || '');
    if (m) idCounter = Math.max(idCounter, Number(m[1]) + 1);
  }

  const registerEl = (el) => {
    if (processed.has(el)) return;
    processed.add(el);
    const tag = el.tagName.toUpperCase();
    let id = el.getAttribute('data-agent-id');
    if (!(id && /^el-\d+$/.test(id))) {
      // New element: it consumes indexing budget. Previously-stamped IDs are
      // reused for free so refs stay stable across re-reads.
      if (elements.length >= MAX_IDX) return;
      id = `el-${idCounter++}`;
      el.setAttribute('data-agent-id', id);
    }
    const kind = kindOf(el, tag);
    const label = String(accessibleName(el, tag) || tag.toLowerCase()).trim().slice(0, 120);
    const states = stateString(el, kind);
    const value = valueString(el, kind);
    const meta = {
      id, tag: tag.toLowerCase(), kind, label, states, value,
      href: el.getAttribute('href') || ''
    };
    elements.push(meta);
    indexedMeta.set(id, meta);
    indexedEl.set(id, el);
  };

  const collectFrom = (root) => {
    for (const el of Array.from(root.querySelectorAll(INTERACTIVE_SELECTORS))) {
      if (!isVisible(el)) continue;
      // A click target inside a link/button pair registers the outer control.
      let target = el;
      for (const sel of ['a', 'button', '[role="button"]', '[role="link"]']) {
        const outer = target.closest && target.closest(sel);
        if (outer && outer !== target && root.contains(outer)) { target = outer; break; }
      }
      registerEl(target);
    }
  };
  collectFrom(document);
  // Same-origin iframes index too (the click lands in the iframe's own view).
  for (const frame of Array.from(document.querySelectorAll('iframe'))) {
    try {
      const doc = frame.contentDocument;
      if (doc && doc.body) collectFrom(doc);
    } catch { /* cross-origin */ }
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

  const renderEntry = (m, el) => {
    let url = m.href;
    if (m.kind === 'link' && url) {
      try { const u = new URL(url, location.href); url = u.origin + u.pathname; } catch {}
    }
    const states = m.states ? ` [${m.states}]` : '';
    const value = m.value ? ` value="${m.value}"` : '';
    switch (m.kind) {
      case 'link': {
        const href = url ? ` -> ${url}` : '';
        push(`\n[LINK] "${m.label}"${states} (ID: ${m.id})${href}\n`);
        return;
      }
      case 'button': push(`\n[BUTTON] "${m.label}"${states} (ID: ${m.id})\n`); return;
      case 'checkbox': push(`\n[CHECKBOX] "${m.label}"${states} (ID: ${m.id})\n`); return;
      case 'switch': push(`\n[SWITCH] "${m.label}"${states} (ID: ${m.id})\n`); return;
      case 'radio': push(`\n[RADIO] "${m.label}"${states} (ID: ${m.id})\n`); return;
      case 'tab': push(`\n[TAB] "${m.label}"${states} (ID: ${m.id})\n`); return;
      case 'option': push(`\n[OPTION] "${m.label}"${states} (ID: ${m.id})\n`); return;
      case 'menuitem': case 'menuitemcheckbox': case 'menuitemradio':
        push(`\n[MENU ITEM] "${m.label}"${states} (ID: ${m.id})\n`); return;
      case 'combobox': push(`\n[COMBOBOX] "${m.label}"${states}${value} (ID: ${m.id})\n`); return;
      case 'slider': push(`\n[SLIDER] "${m.label}"${states}${value} (ID: ${m.id})\n`); return;
      case 'spinbutton': push(`\n[SPINBUTTON] "${m.label}"${states}${value} (ID: ${m.id})\n`); return;
      case 'textbox': push(`\n[TEXTBOX] "${m.label}"${states}${value} (ID: ${m.id})\n`); return;
      case 'input': {
        const type = String(el && el.getAttribute('type') || 'text').toUpperCase();
        push(`\n[INPUT ${type}] "${m.label}"${states}${value} (ID: ${m.id})\n`);
        return;
      }
      case 'textarea': push(`\n[TEXTAREA] "${m.label}"${states}${value} (ID: ${m.id})\n`); return;
      case 'select': {
        const sel = el && el.options && el.options[el.selectedIndex]
          ? String(el.options[el.selectedIndex].text || '') : '';
        push(`\n[SELECT] "${m.label}"${states} [Selected: ${sel}] (ID: ${m.id})\n`);
        return;
      }
      case 'summary': push(`\n[SUMMARY] "${m.label}"${states} (ID: ${m.id})\n`); return;
      default: push(`\n[INTERACTIVE] "${m.label}"${states} (ID: ${m.id})\n`); return;
    }
  };

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
    const id = el.getAttribute('data-agent-id');
    if (id && indexedMeta.has(id)) { renderEntry(indexedMeta.get(id), el); return; }
    const raw = String(el.innerText || '').replace(/\s+/g, ' ').trim();
    if (!raw) return;
    const label = el.getAttribute('aria-label') || el.getAttribute('title') || '';
    let text = raw;
    if (text.length > 300) text = text.slice(0, 300) + '…';
    const idSuffix = id ? ` (ID: ${id})` : '';
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
      const hasId = indexedEl.has(el.getAttribute('data-agent-id'));
      // Indexed interactives always render; other nodes only while they
      // intersect the viewport.
      if (!hasId && !intersectsViewport(el)) return;
    }

    const id = el.getAttribute('data-agent-id');
    if (id && indexedMeta.has(id)) {
      renderEntry(indexedMeta.get(id), el);
      return;
    }

    if (tag === 'IMG') {
      const alt = String(el.getAttribute('alt') || '').trim();
      if (alt) push(`\n[IMAGE: ${alt}]\n`);
      return;
    }

    if (tag === 'IFRAME') {
      const src = el.getAttribute('src') || (el.getAttribute('srcdoc') !== null ? '[inline srcdoc]' : '');
      let doc = null;
      try { doc = el.contentDocument; } catch { /* cross-origin */ }
      if (doc && doc.body) {
        push(`\n[IFRAME ${src} — same-origin content follows]\n`);
        for (const child of Array.from(doc.body.childNodes)) parseNode(child);
        push('\n[/IFRAME]\n');
      } else {
        push(`\n[IFRAME ${src} — content not accessible (cross-origin)]\n`);
      }
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

  /* ---------- 4. Assemble ---------- */
  const scrollMax = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
  const scrollPct = Math.round((window.scrollY / scrollMax) * 100);
  push(`# Page: ${document.title || '(untitled)'}\nURL: ${location.href}\nScroll: ${scrollPct}% down\n\n`);

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
      elements.map((e) => {
        const states = e.states ? ` [${e.states}]` : '';
        return `- [${e.kind.toUpperCase()}] "${e.label}"${states} (ID: ${e.id})`;
      }).join('\n');
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
