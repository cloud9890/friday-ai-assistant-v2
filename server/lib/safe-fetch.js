/* ==========================================================================
   F.R.I.D.A.Y. // LIB — SAFE FETCH
   Redirect-safe server-side fetch (H1). `network-policy` validates the
   hostname of the URL it is handed, but a 3xx response can bounce the request
   to a private/loopback destination that was never checked. Every hop is
   re-validated here, and the policy check + fetch impl are injectable so tests
   never touch the network.

   Residual gap (documented, not hidden): a hostname can still resolve to a
   private address *after* it has been checked (DNS rebinding / TOCTOU), since
   the DNS lookup happens inside fetch. Closing that needs a pinned-IP
   dispatcher (undici Agent with a custom lookup); tracked in HANDOFF §4 H1.
   ========================================================================== */

import { checkUrl } from '../security/network-policy.js';

export const MAX_REDIRECTS = 5;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

function unsafe(reason, code) {
  const err = new Error(`blocked destination: ${reason}`);
  err.code = code;
  return err;
}

/**
 * Fetches a URL, following redirects manually and re-validating every hop
 * against the network policy. Throws instead of silently landing somewhere
 * that was never approved.
 *
 * @param {string} rawUrl
 * @param {{
 *   fetchImpl?: Function,   // injectable for tests
 *   check?: Function,       // injectable policy (defaults to checkUrl)
 *   maxRedirects?: number,
 *   headers?: object,
 *   timeoutMs?: number
 * }} [opts]
 * @returns {Promise<Response>}
 */
export async function safeFetch(rawUrl, opts = {}) {
  const {
    fetchImpl = fetch,
    check = (url, o) => checkUrl(url, o),
    maxRedirects = MAX_REDIRECTS,
    headers = { 'User-Agent': 'Mozilla/5.0' },
    timeoutMs = 15000
  } = opts;

  let current = rawUrl;

  for (let hop = 0; hop <= maxRedirects; hop++) {
    const checked = check(current, { allowPrivate: false });
    if (!checked.ok) throw unsafe(checked.reason, 'UNSAFE_URL');

    const res = await fetchImpl(checked.url.toString(), {
      redirect: 'manual',
      headers,
      signal: AbortSignal.timeout(timeoutMs)
    });

    const location = res.headers?.get?.('location');
    if (!REDIRECT_STATUSES.has(res.status) || !location) return res;

    // Resolve relative redirects against the hop that produced them, so the
    // next iteration validates the real absolute destination.
    current = new URL(location, checked.url).toString();
  }

  throw unsafe(`too many redirects (>${maxRedirects})`, 'TOO_MANY_REDIRECTS');
}
