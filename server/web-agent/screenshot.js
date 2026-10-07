/* ==========================================================================
   F.R.I.D.A.Y. // WEB AGENT — SCREENSHOT CAPTURE
   ========================================================================== */

/**
 * Captures the page and returns a JPEG data URL suitable for multimodal
 * providers. v1 note: no server-side downscaling (kept simple); use
 * fullPage:false (default) for the common case.
 */
export async function captureScreenshot(page, { fullPage = false, quality = 80 } = {}) {
  const opts = { type: 'jpeg', quality, encoding: 'base64' };
  if (fullPage) opts.fullPage = true;
  const b64 = await page.screenshot(opts);
  return `data:image/jpeg;base64,${b64}`;
}