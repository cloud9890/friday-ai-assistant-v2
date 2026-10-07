/* ==========================================================================
   F.R.I.D.A.Y. // SERVER LIB — REQUEST BODY PARSER (verbatim from vite-plugin-os.js)
   Phase 1: reuses the body already parsed by the security gate, so the request
   stream is read exactly once.
   ========================================================================== */

export function parseBody(req) {
  if (req.__fridayBody !== undefined) {
    return Promise.resolve(req.__fridayBody);
  }
  return new Promise((resolve) => {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try { resolve(JSON.parse(body)); }
      catch (e) { resolve({}); }
    });
  });
}
