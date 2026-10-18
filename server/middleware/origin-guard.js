/* ==========================================================================
   F.R.I.D.A.Y. // MIDDLEWARE — ORIGIN GUARD
   The API surface must only serve the local FRIDAY UI:
     - Host header must be loopback (DNS-rebinding protection).
     - A cross-site Origin is rejected outright, so pages you browse cannot
       drive-by POST to /api/agent and burn quota or trigger actions.
   Non-browser clients (curl, tests) send no Origin and pass through.
   ========================================================================== */

const LOCAL_HOSTNAMES = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

function isLocalHost(hostname) {
  return LOCAL_HOSTNAMES.has(String(hostname || '').toLowerCase().replace(/^\[|\]$/g, ''));
}

/**
 * Extracts the hostname from a Host header. A bracketed IPv6 literal is
 * `[::1]:5173`, so splitting on ':' yields "[" and 403s every request from a
 * v6-localhost UI (M7). Strip the brackets first, then the port.
 */
function hostnameOf(hostHeader) {
  const raw = String(hostHeader || '').trim();
  if (raw.startsWith('[')) {
    const end = raw.indexOf(']');
    return end === -1 ? raw : raw.slice(1, end);
  }
  return raw.split(':')[0];
}

function sendForbidden(res, reason) {
  res.statusCode = 403;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify({ error: `Forbidden: ${reason}` }));
}

export function createOriginGuard() {
  return (req, res, next) => {
    const hostHeader = hostnameOf(req.headers.host);
    if (hostHeader && !isLocalHost(hostHeader)) {
      return sendForbidden(res, 'API is restricted to the local machine');
    }

    const origin = req.headers.origin;
    if (origin) {
      try {
        const originHost = new URL(origin).hostname;
        if (!isLocalHost(originHost)) {
          return sendForbidden(res, 'cross-site requests are not allowed');
        }
      } catch {
        return sendForbidden(res, 'malformed Origin header');
      }
    }

    return next();
  };
}

const INSTALLED = Symbol.for('friday.originGuard');

/**
 * Installs the guard once per Vite server. Both plugins (`vite-plugin-ai`,
 * `vite-plugin-agent`) share one middleware stack, so a plain
 * `server.middlewares.use(createOriginGuard())` in each registered it twice
 * (M7). Re-installing is now a no-op.
 */
export function installOriginGuard(server) {
  const middlewares = server && server.middlewares;
  if (!middlewares || middlewares[INSTALLED]) return;
  middlewares[INSTALLED] = true;
  middlewares.use(createOriginGuard());
}
