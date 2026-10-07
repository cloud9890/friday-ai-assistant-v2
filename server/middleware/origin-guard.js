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

function sendForbidden(res, reason) {
  res.statusCode = 403;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify({ error: `Forbidden: ${reason}` }));
}

export function createOriginGuard() {
  return (req, res, next) => {
    const hostHeader = String(req.headers.host || '').split(':')[0];
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
