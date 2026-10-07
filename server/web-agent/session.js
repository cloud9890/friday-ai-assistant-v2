/* ==========================================================================
   F.R.I.D.A.Y. // WEB AGENT — BROWSER SESSION MANAGER
   One shared Puppeteer browser. Tab scaffold (v1: single active tab used by
   the LLM; tab APIs available for future multi-tab workflows).
   ========================================================================== */

import puppeteer from 'puppeteer';
import { NAV_TIMEOUT, ACTION_TIMEOUT } from './validate.js';

let singleton = null;

export class BrowserSession {
  constructor() {
    this.browser = null;
    this.pages = new Map();       // tabId -> Page
    this.activeTabId = null;
    this.tabCounter = 0;
  }

  /* ---------------- lifecycle ---------------- */

  async ensureBrowser() {
    const alive = this.browser && this.browser.process() !== null;
    if (alive) return;

    this.browser = await puppeteer.launch({
      headless: false,
      defaultViewport: null,
      args: ['--window-size=1280,800', '--start-maximized']
    });

    // If the whole browser dies, drop every cached page reference atomically.
    this.browser.on('disconnected', () => {
      this.pages.clear();
      this.activeTabId = null;
    });
  }

  /** Lazily return (creating if needed) the single active page. */
  async ensureActivePage() {
    await this.ensureBrowser();
    if (this.activeTabId && this.pages.has(this.activeTabId)) {
      const page = this.pages.get(this.activeTabId);
      if (!page.isClosed()) return { id: this.activeTabId, page };
    }
    return this.newTab();
  }

  /* ---------------- tabs ---------------- */

  async newTab(url = null) {
    await this.ensureBrowser();
    const page = await this.browser.newPage();
    page.setDefaultTimeout(ACTION_TIMEOUT);
    page.setDefaultNavigationTimeout(NAV_TIMEOUT);

    const id = `tab-${++this.tabCounter}`;
    page.on('close', () => {
      if (this.pages.get(id) === page) this.pages.delete(id);
      if (this.activeTabId === id) this.activeTabId = null;
    });
    this.pages.set(id, page);
    this.activeTabId = id;

    if (url) {
      try {
        await page.goto(url, { waitUntil: 'networkidle2', timeout: NAV_TIMEOUT });
      } catch {
        // navigation failure surfaces on the first action
      }
    }
    return { id, page };
  }

  getTab(tabId) {
    if (tabId && typeof tabId === 'string' && this.pages.has(tabId)) {
      const page = this.pages.get(tabId);
      if (!page.isClosed()) return { id: tabId, page };
    }
    return null;
  }

  async closeTab(tabId) {
    const tab = this.getTab(tabId);
    if (!tab) return false;
    try { await tab.page.close(); } catch {}
    if (this.activeTabId === tab.id) this.activeTabId = null;
    // Fall back to any remaining tab.
    if (!this.activeTabId && this.pages.size > 0) {
      this.activeTabId = this.pages.keys().next().value;
    }
    return true;
  }

  listTabs() {
    const out = [];
    for (const [id, page] of this.pages.entries()) {
      let title = '';
      try { title = page.title(); } catch {}
      out.push({ id, url: page.url(), title, active: id === this.activeTabId });
    }
    return out;
  }

  /* ---------------- teardown ---------------- */

  async closeAll() {
    try {
      if (this.browser) await this.browser.close();
    } catch {}
    this.browser = null;
    this.pages.clear();
    this.activeTabId = null;
  }
}

export function getSession() {
  if (!singleton) singleton = new BrowserSession();
  return singleton;
}

// Best effort teardown so a dev-server restart does not orphan Chromium.
process.on('exit', () => {
  try {
    if (singleton) singleton.closeAll();
  } catch {}
});