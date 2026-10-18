/* ==========================================================================
   F.R.I.D.A.Y. // WEB AGENT — ENGINE (HTTP-facing orchestrator)
   Replaces the inline /api/web-agent handler. Response contract stays
   backward compatible: { success, error?, dom, ... } where `dom` is the
   simplified-DOM markdown string (exactly like the legacy response).
   ========================================================================== */

import { getSession } from './session.js';
import { snapshotDOMWithRetry } from './dom-reader.js';
import { captureScreenshot } from './screenshot.js';
import { runVisionAnalysis } from '../lib/vision-proxy.js';
import { checkUrlForAgent } from '../security/network-policy.js';
import {
  validateUrl, validateMode, clampInt, WAIT_MAX, sleep
} from './validate.js';
import {
  navigateTo, goBack, goForward, reloadPage, clickElement, clickAt, typeInto,
  pressKeys, selectOption, hoverElement, scrollPage
} from './actions.js';

const SYSTEM_PROMPT = `You are F.R.I.D.A.Y., Tony Stark's advanced tactical AI. Analyze the provided webpage screenshot and respond directly to Boss in 1-3 concise sentences. Focus only on what matters most for the user's request.`;

/**
 * Phase 1 / R9: the engine re-checks every destination itself. The kernel
 * already vetted the request, but a browser navigates many times per task, so
 * this is the second line of defence for the same rule.
 */
function resolveAgentUrl(raw) {
  const basic = validateUrl(raw);
  if (!basic) {
    return { ok: false, error: `Invalid or unsupported URL: ${raw}. Must be a valid http/https link.` };
  }
  const policy = checkUrlForAgent(basic);
  if (!policy.ok) {
    return { ok: false, error: `Blocked by network policy: ${policy.reason}` };
  }
  return { ok: true, url: policy.url.href };
}

/**
 * Redirects are revalidated: a trusted link must not hand the agent off to a
 * blocked destination after the initial check.
 */
function checkLandedUrl(page) {
  try {
    const landed = page.url();
    if (!landed || landed === 'about:blank') return { ok: true };
    const check = checkUrlForAgent(landed);
    if (!check.ok) {
      return { ok: false, error: `Navigation landed on a blocked destination: ${landed} (${check.reason})` };
    }
  } catch {
    // page.url() unavailable during teardown: nothing to enforce
  }
  return { ok: true };
}

function readOpts(body) {
  return {
    mode: validateMode(body.mode),
    query: typeof body.query === 'string' && body.query.trim() ? body.query.trim() : null,
    maxChars: clampInt(body.maxChars, 8000, 500, 20000)
  };
}

/** Pre-action page facts used to verify the action's effect afterwards. */
async function pageFacts(page) {
  let title = '';
  try { title = await page.title(); } catch {}
  return { url: page.url(), title };
}

/**
 * Skill discipline: judge an action by its visible effect, not by the
 * absence of an error. The observation tells the model what changed and,
 * when nothing did, where to look next (popups, scroll, screenshot).
 */
function buildObservation(before, snap, newTabs) {
  const lines = [];
  const urlChanged = before.url !== snap.url;
  const titleChanged = before.title !== snap.title;
  lines.push(
    `Observed after action: URL ${urlChanged ? `changed ${before.url} -> ${snap.url}` : 'unchanged'}` +
    `, title ${titleChanged ? 'now "' + snap.title + '"' : 'unchanged'}` +
    `, ${snap.elements.length} interactive elements on the page.`
  );
  if (newTabs && newTabs.length > 0) {
    lines.push(`A new tab opened and is now the active tab: ${newTabs.join(', ')}. The snapshot below shows it.`);
  } else if (!urlChanged && !titleChanged) {
    lines.push('No navigation or title change detected. If you expected a page change: check listTabs for a popup, scroll to reveal content, or take a screenshot to see the current state.');
  }
  return lines.join('\n');
}

async function attachSnapshot(result, page, opts, before = null, newTabs = []) {
  const snap = await snapshotDOMWithRetry(page, opts);
  result.dom = snap.markdown;
  result.markdown = snap.markdown;
  result.elements = snap.elements;
  result.title = snap.title;
  result.url = snap.url;
  result.truncated = snap.truncated;
  if (before) result.observation = buildObservation(before, snap, newTabs);
  return result;
}

export async function handleWebAgent(body = {}) {
  const action = typeof body.action === 'string' ? body.action.trim() : '';
  if (!action) return { success: false, error: 'Missing "action".' };

  const session = getSession();
  let tab;
  try {
    tab = session.getTab(body.tabId) || await session.ensureActivePage();
  } catch (e) {
    return { success: false, error: `Web agent could not be initialized: ${e.message}` };
  }
  const page = tab.page;
  const result = { success: true, action, tabId: tab.id };
  const opts = readOpts(body);

  // Popups opened by an action (target=_blank) get adopted and become the
  // active tab; the post-action snapshot then shows the popup, not the source.
  let newTabs = [];
  let before = null;

  try {
    switch (action) {
      case 'navigate': {
        const resolved = resolveAgentUrl(body.url);
        if (!resolved.ok) {
          return { success: false, action, error: resolved.error };
        }
        before = await pageFacts(page);
        const nav = await navigateTo(page, resolved.url);
        if (!nav.ok) return { success: false, action, error: nav.error };
        const landed = checkLandedUrl(page);
        if (!landed.ok) return { success: false, action, error: landed.error };
        break;
      }
      case 'reload': {
        before = await pageFacts(page);
        const r = await reloadPage(page);
        if (!r.ok) return { success: false, action, error: r.error };
        break;
      }
      case 'back': {
        before = await pageFacts(page);
        const r = await goBack(page);
        if (!r.ok) return { success: false, action, error: r.error };
        const landed = checkLandedUrl(page);
        if (!landed.ok) return { success: false, action, error: landed.error };
        break;
      }
      case 'forward': {
        before = await pageFacts(page);
        const r = await goForward(page);
        if (!r.ok) return { success: false, action, error: r.error };
        const landed = checkLandedUrl(page);
        if (!landed.ok) return { success: false, action, error: landed.error };
        break;
      }
      case 'click': {
        before = await pageFacts(page);
        const r = await clickElement(page, body.elementId);
        if (!r.ok) return { success: false, action, error: r.error };
        const landed = checkLandedUrl(page);
        if (!landed.ok) return { success: false, action, error: landed.error };
        newTabs = await session.adoptPopups();
        break;
      }
      case 'clickAt': {
        before = await pageFacts(page);
        const r = await clickAt(page, body.x, body.y);
        if (!r.ok) return { success: false, action, error: r.error };
        result.clickAt = { x: r.x, y: r.y };
        const landed = checkLandedUrl(page);
        if (!landed.ok) return { success: false, action, error: landed.error };
        newTabs = await session.adoptPopups();
        break;
      }
      case 'type': {
        before = await pageFacts(page);
        const r = await typeInto(page, body.elementId, body.text, { submit: Boolean(body.submit) });
        if (!r.ok) return { success: false, action, error: r.error };
        if (body.submit) newTabs = await session.adoptPopups();
        break;
      }
      case 'keypress': {
        before = await pageFacts(page);
        const r = await pressKeys(page, body.keys);
        if (!r.ok) return { success: false, action, error: r.error };
        newTabs = await session.adoptPopups();
        break;
      }
      case 'select': {
        before = await pageFacts(page);
        const r = await selectOption(page, body.elementId, body.value);
        if (!r.ok) return { success: false, action, error: r.error };
        break;
      }
      case 'hover': {
        before = await pageFacts(page);
        const r = await hoverElement(page, body.elementId);
        if (!r.ok) return { success: false, action, error: r.error };
        break;
      }
      case 'scroll': {
        before = await pageFacts(page);
        const r = await scrollPage(page, body.direction, body.elementId || null);
        if (!r.ok) return { success: false, action, error: r.error };
        break;
      }
      case 'wait': {
        await sleep(clampInt(body.ms, 2000, 0, WAIT_MAX));
        break;
      }
      case 'extract':
      case 'getDOM': {
        if (action === 'extract') opts.mode = 'readable';
        break;
      }
      case 'screenshot': {
        const dataUrl = await captureScreenshot(page, { fullPage: Boolean(body.fullPage) });
        result.screenshot = dataUrl;
        result.screenshotBytes = dataUrl.length;
        if (typeof body.prompt === 'string' && body.prompt.trim()) {
          try {
            const vdata = await runVisionAnalysis({ image_url: dataUrl, text: body.prompt, system_prompt: SYSTEM_PROMPT });
            result.analysis = vdata.choices?.[0]?.message?.content || '';
          } catch (e) {
            result.analysisError = e.message;
          }
        }
        break;
      }
      case 'openTab': {
        const resolved = resolveAgentUrl(body.url);
        if (!resolved.ok) return { success: false, action, error: resolved.error };
        const nt = await session.newTab(resolved.url);
        result.tabId = nt.id;
        await attachSnapshot(result, nt.page, { mode: validateMode(body.mode), maxChars: clampInt(body.maxChars, 8000, 500, 20000) });
        return result;
      }
      case 'closeTab': {
        session.closeTab(tab.id);
        result.dom = '';
        break;
      }
      case 'listTabs': {
        result.tabs = await session.listTabs();
        result.dom = result.tabs.map((t) => `- ${t.active ? '[ACTIVE] ' : ''}${t.id} "${t.title}" ${t.url}`).join('\n');
        break;
      }
      default:
        return { success: false, action, error: `Unknown web agent action: ${action}` };
    }
  } catch (e) {
    return { success: false, action, error: `Web agent error: ${e.message}` };
  }

  // Every state-changing action returns a fresh DOM read (legacy behavior)
  // plus an observation of what actually changed.
  if (!['screenshot', 'listTabs', 'closeTab'].includes(action)) {
    if (newTabs.length > 0) {
      const next = session.getTab(session.activeTabId) || tab;
      result.tabId = next.id;
      await attachSnapshot(result, next.page, opts, before, newTabs);
    } else {
      await attachSnapshot(result, page, opts, before);
    }
  }
  return result;
}