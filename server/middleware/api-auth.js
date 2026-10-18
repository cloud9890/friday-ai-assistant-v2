/* ==========================================================================
   F.R.I.D.A.Y. // MIDDLEWARE — LOCAL API AUTH WIRING
   Makes the local session authority (authentication.js) live:
     - loading the app (HTML / static assets) issues an HttpOnly,
       SameSite=Strict session cookie to the same-origin UI, so no client code
       has to bootstrap anything;
     - /api/auth/session is an explicit (re)issue endpoint for callers that
       want it;
     - every other /api/* request must present that cookie (fail closed).
   Both Vite plugins import this module, so there is a single token/instance.

   Scope: this is defence-in-depth on top of the origin guard. It does NOT by
   itself stop a local non-browser process (a request with no Origin header is
   indistinguishable from a same-origin navigation and is allowed), which could
   already read .env directly — see HANDOFF.md C3.
   ========================================================================== */

import { createAuth, SESSION_COOKIE } from './authentication.js';

/** One session authority for the whole dev/preview server (ESM module cache). */
export const auth = createAuth();

/** Explicit session bootstrap endpoint. */
export const SESSION_PATH = '/api/auth/session';

/** Path of a connect request, with the query string stripped. */
function pathOf(req) {
  const raw = String(req.url || '');
  const q = raw.indexOf('?');
  return q === -1 ? raw : raw.slice(0, q);
}

function reject(res, status, code, error) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify({ success: false, code, error }));
}

/** Explicit bootstrap: (re)issues the cookie, same-origin UI only. */
export function handleSession(req, res) {
  if (!auth.isSameOriginBrowser(req)) {
    return reject(res, 403, 'CROSS_ORIGIN_BLOCKED', 'Forbidden: session bootstrap is same-origin only.');
  }
  auth.issueCookie(res);
  res.statusCode = 204;
  res.end();
}

/**
 * Installs the session gate and bootstrap route on a Vite server.
 * Idempotent: calling it from both plugins installs the middleware only once.
 */
export function installApiAuth(server) {
  if (server.__fridayApiAuthInstalled) return;
  server.__fridayApiAuthInstalled = true;

  // (1) Hand the session cookie to the same-origin UI when it loads the app.
  //     Non-/api requests only (assets + the SPA document); /api/* is gated
  //     below. Once the browser holds a valid cookie this is a no-op.
  server.middlewares.use((req, res, next) => {
    const p = pathOf(req);
    if (!p.startsWith('/api/') && !auth.isSessionValid(req) && auth.isSameOriginBrowser(req)) {
      auth.issueCookie(res);
    }
    next();
  });

  // (2) Explicit bootstrap endpoint.
  server.middlewares.use((req, res, next) => {
    if (pathOf(req) !== SESSION_PATH) return next();
    return handleSession(req, res);
  });

  // (3) Gate every other /api/* request (public paths are handled in-module).
  auth.install(server.middlewares);
}

export { SESSION_COOKIE };
