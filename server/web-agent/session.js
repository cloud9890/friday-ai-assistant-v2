/* ==========================================================================
   F.R.I.D.A.Y. // WEB AGENT — BROWSER SESSION MANAGER
   One shared Puppeteer browser. Tab scaffold (v1: single active tab used by
   the LLM; tab APIs available for future multi-tab workflows).
   ========================================================================== */

import puppeteer from 'puppeteer';
import { readEnv } from '../lib/env.js';
import { NAV_TIMEOUT, ACTION_TIMEOUT } from './validate.js';
import { checkUrlForAgent } from '../security/network-policy.js';

let singleton = null;

export class BrowserSession {
  constructor() {
    this.browser = null;
    this.pages = new Map();       // tabId -> Page
    this.activeTabId = null;
    this.tabCounter = 0;
    this.blockedPopups = [];      // popups refused by policy since the last drain
  }

  /* ---------------- lifecycle ---------------- */

  async ensureBrowser() {
    const alive = this.browser && this.browser.process() !== null;
    if (alive) return;

    // Visible window by default so the user can watch the agent work;
    // WEB_AGENT_HEADLESS=1 runs it invisible.
    const headless = /^(1|true)$/i.test(readEnv('WEB_AGENT_HEADLESS') || '');
    this.browser = await puppeteer.launch({
      headless,
      defaultViewport: null,
      args: ['--window-size=1280,800', '--start-maximized']
    });

    // If the whole browser dies, drop every cached page reference atomically.
    this.browser.on('disconnected', () => {
      this.pages.clear();
      this.activeTabId = null;
    });

    // Puppeteer pre-creates an initial page at launch; register it so popup
    // adoption later only ever reports genuinely new tabs.
    try {
      for (const p of await this.browser.pages()) this._registerPage(p);
    } catch { /* best effort */ }
  }

  /** Tracks a page under a fresh tab id and makes it the active tab. */
  _registerPage(page) {
    const id = `tab-${++this.tabCounter}`;
    page.setDefaultTimeout(ACTION_TIMEOUT);
    page.setDefaultNavigationTimeout(NAV_TIMEOUT);
    page.on('close', () => {
      if (this.pages.get(id) === page) this.pages.delete(id);
      if (this.activeTabId === id) this.activeTabId = null;
    });
    this.pages.set(id, page);
    this.activeTabId = id;
    return id;
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
    const id = this._registerPage(page);

    if (url) {
      try {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT });
        await page.waitForNetworkIdle({ idleTime: 500, timeout: 5000 }).catch(() => {});
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

  /**
   * Adopts browser pages the agent never created — target=_blank popups and
   * window.open links. The newest popup becomes the active tab, since popups
   * are almost always the effect the task wants to follow.
   *
   * H2: a page the agent did not open is exactly where a hostile page can
   * redirect it, so every adopted tab is validated against the agent URL
   * policy. Refused popups are closed and reported, never silently tracked.
   *
   * @returns {string[]} ids of newly adopted tabs
   */
  async adoptPopups() {
    if (!this.browser) return [];
    let open;
    try { open = await this.browser.pages(); } catch { return []; }
    const tracked = new Set(this.pages.values());
    const adopted = [];
    for (const page of open) {
      if (tracked.has(page) || page.isClosed()) continue;

      const verdict = this._checkPopupUrl(page);
      if (!verdict.ok) {
        this.blockedPopups.push({ url: verdict.url, reason: verdict.reason });
        try { await page.close(); } catch { /* best effort */ }
        continue;
      }
      adopted.push(this._registerPage(page));
    }
    return adopted;
  }

  /** @returns {{ok: boolean, url?: string, reason?: string}} */
  _checkPopupUrl(page) {
    let url = '';
    try { url = page.url(); } catch { /* treat as unverifiable */ }
    // A popup mid-flight may still be blank; the engine re-validates the
    // landed URL before its content is ever read (defence in depth).
    if (!url || url === 'about:blank') return { ok: true, url };
    const check = checkUrlForAgent(url);
    return check.ok ? { ok: true, url } : { ok: false, url, reason: check.reason };
  }

  /** Returns popups refused since the last call and clears the record. */
  takeBlockedPopups() {
    const blocked = this.blockedPopups;
    this.blockedPopups = [];
    return blocked;
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

  async listTabs() {
    const out = [];
    for (const [id, page] of this.pages.entries()) {
      let title = '';
      try { title = await page.title(); } catch {}
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