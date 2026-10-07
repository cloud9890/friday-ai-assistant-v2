/* ==========================================================================
   F.R.I.D.A.Y. // SERVER MIDDLEWARE — LOCAL API AUTHENTICATION
   Phase 1 / R2 + S2:
     - every /api/* route requires a local, HttpOnly session cookie
     - the cookie is issued only to the same-origin local FRIDAY UI
     - fails closed: no valid session  ->  no action is executed
   This module only makes decisions; it never logs secret material.
   ========================================================================== */

import crypto from 'crypto';

export const SESSION_COOKIE = 'friday_sid';
const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours

/** Routes callable without a session (bootstrap + read-only liveness only). */
const PUBLIC_PATHS = new Set(['/api/auth/session', '/api/health']);

/** Case-insensitive-neutral path (query string stripped) for a connect request. */
function pathOf(req) {
  const raw = String(req.url || '');
  const q = raw.indexOf('?');
  return q === -1 ? raw : raw.slice(0, q);
}

/** Reads one cookie value from the raw Cookie header (no dependency). */
function readCookie(req, name) {
  const header = req.headers && req.headers.cookie;
  if (!header) return null;
  for (const part of String(header).split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return null;
}

/** Constant-time equality that does not leak the compared lengths. */
function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const ha = crypto.createHash('sha256').update(a).digest();
  const hb = crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(ha, hb);
}

/**
 * True only when the caller is the local FRIDAY UI itself.
 * A cross-site page always sends an Origin header (or Sec-Fetch-Site:
 * cross-site), so both browser-side attack vectors are rejected here.
 */
export function isSameOriginBrowser(req) {
  const host = String((req.headers && req.headers.host) || '').toLowerCase();
  const origin = req.headers && req.headers.origin;

  if (origin) {
    try {
      const u = new URL(origin);
      if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
      return u.host.toLowerCase() === host;
    } catch (e) {
      return false;
    }
  }

  // No Origin header: a local non-browser client (curl / PowerShell) or a
  // same-origin navigation. Reject only when the browser marks it cross-site.
  const site = String((req.headers && req.headers['sec-fetch-site']) || '').toLowerCase();
  if (site && site !== 'same-origin' && site !== 'none') return false;
  return true;
}

/**
 * Creates the local session authority.
 * `install()` must be called before any /api/* route is registered.
 */
export function createAuth(options = {}) {
  const ttlMs = Number(options.ttlMs) > 0 ? Number(options.ttlMs) : SESSION_TTL_MS;
  const cookieName = options.cookieName || SESSION_COOKIE;

  let token = null;
  let expiresAt = 0;
  let rejections = 0;

  function ensureToken() {
    if (!token || Date.now() >= expiresAt) {
      token = crypto.randomBytes(32).toString('hex');
      expiresAt = Date.now() + ttlMs;
    }
    return token;
  }

  /** Issues (or refreshes) the session cookie on the response. */
  function issueCookie(res) {
    ensureToken();
    res.setHeader(
      'Set-Cookie',
      `${cookieName}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${Math.floor(ttlMs / 1000)}`
    );
    res.setHeader('Cache-Control', 'no-store');
  }

  /** True when the request carries a valid, unexpired session cookie. */
  function isSessionValid(req) {
    if (!token || Date.now() >= expiresAt) return false;
    const presented = readCookie(req, cookieName);
    if (!presented) return false;
    return safeEqual(presented, token);
  }

  /** connect middleware: gates every non-public /api/* request. */
  function install(middlewares) {
    middlewares.use((req, res, next) => {
      const p = pathOf(req);
      // Static assets, HMR and the SPA itself are untouched.
      if (!p.startsWith('/api/')) return next();
      if (PUBLIC_PATHS.has(p)) return next();

      // Defense in depth: a cross-site page never reaches an executor here,
      // even if it somehow obtained a cookie (SameSite also blocks that).
      if (!isSameOriginBrowser(req)) {
        rejections++;
        res.statusCode = 403;
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Cache-Control', 'no-store');
        res.end(JSON.stringify({
          success: false,
          code: 'CROSS_ORIGIN_BLOCKED',
          error: 'Forbidden: FRIDAY API calls are restricted to the local UI origin.'
        }));
        return;
      }

      if (isSessionValid(req)) return next();

      rejections++;
      res.statusCode = 401;
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Cache-Control', 'no-store');
      res.end(JSON.stringify({
        success: false,
        code: 'UNAUTHORIZED',
        error: 'Unauthorized: a local FRIDAY session is required.'
      }));
    });
  }

  return {
    install,
    issueCookie,
    isSessionValid,
    isSameOriginBrowser,
    get rejectionCount() { return rejections; },
    get expiresAt() { return expiresAt; },
    get publicPaths() { return Array.from(PUBLIC_PATHS); }
  };
}
