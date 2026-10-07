/* ==========================================================================
   F.R.I.D.A.Y. // SECURITY — NETWORK POLICY
   Phase 1 (S6). Server-side requests may only reach public http(s) hosts.
   Blocks loopback/link-local/private ranges so the agent cannot be used to
   probe the local machine or the LAN (SSRF), and refuses credential-bearing
   or non-web URLs. The user's own browser is handled by allowPrivate.
   ========================================================================== */

const PRIVATE_V4 = [
  /^0\./,
  /^10\./,
  /^127\./,
  /^169\.254\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./ // carrier-grade NAT
];

const PRIVATE_HOSTNAMES = [
  'localhost', 'localhost.localdomain', 'ip6-localhost', 'ip6-loopback',
  'metadata.google.internal', 'metadata'
];

/**
 * @param {string} hostname
 * @returns {boolean} true when the host resolves to a local/private destination.
 */
export function isPrivateHost(hostname) {
  if (!hostname) return true;
  const host = String(hostname).toLowerCase().replace(/^\[|\]$/g, '');

  if (PRIVATE_HOSTNAMES.includes(host)) return true;
  if (host.endsWith('.local') || host.endsWith('.internal') || host.endsWith('.localhost')) return true;
  if (host === '::' || host === '::1') return true;
  if (host.startsWith('fc') || host.startsWith('fd') || host.startsWith('fe80:')) return true; // ULA / link-local
  if (PRIVATE_V4.some(re => re.test(host))) return true;
  if (!host.includes('.')) return true; // single-label hostnames are local by convention

  return false;
}

/**
 * Validates a URL that FRIDAY is about to request.
 *
 * @param {string} raw                     URL to check
 * @param {{allowPrivate?: boolean}} opts  allowPrivate is for URLs handed to the
 *                                         user's own browser (localhost apps, LAN UIs)
 * @returns {{ok: boolean, url?: URL, reason?: string}}
 */
export function checkUrl(raw, opts = {}) {
  const { allowPrivate = false } = opts;

  if (typeof raw !== 'string' || !raw.trim()) return { ok: false, reason: 'url required' };
  if (raw.includes('\0')) return { ok: false, reason: 'invalid url' };

  let url;
  try {
    url = new URL(raw.trim());
  } catch {
    return { ok: false, reason: 'url is not a valid absolute URL' };
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    // spotify: is used by the media tool, which handles it separately and never fetches.
    return { ok: false, reason: `scheme not allowed: ${url.protocol}` };
  }
  if (url.username || url.password) {
    return { ok: false, reason: 'credentials in URLs are not allowed' };
  }
  if (!url.hostname) return { ok: false, reason: 'url has no host' };

  if (!allowPrivate && isPrivateHost(url.hostname)) {
    return { ok: false, reason: `destination is local/private: ${url.hostname}` };
  }

  return { ok: true, url };
}

/**
 * Blocks destinations that could exfiltrate FRIDAY's own credentials while
 * still allowing the user to install/repair local services explicitly.
 * Applied to server-side fetches and to the browser agent.
 */
export const BLOCKED_HOSTS = [
  'accounts.google.com',   // no automated credential entry anywhere in Phase 1
  'mail.google.com'
];

/**
 * Password-manager and browser-internal surfaces the agent must never drive.
 */
export function checkUrlForAgent(raw) {
  const base = checkUrl(raw, { allowPrivate: true }); // agent may open the user's local apps
  if (!base.ok) return base;

  const host = base.url.hostname.toLowerCase();
  if (BLOCKED_HOSTS.includes(host)) {
    return { ok: false, reason: `host is blocked for automated browsing: ${host}` };
  }
  return base;
}
