/* ==========================================================================
   F.R.I.D.A.Y. // SKILL — SEARCH WEB SUMMARY
   ========================================================================== */

import { RISK, CONFIRMATION, PERMISSION } from '../security/risk.js';

export default {
  name: 'search_web_summary',
  description: 'Fetches a URL and summarises its contents.',
  parameters: {
    type: 'object',
    properties: { url: { type: 'string' } },
    required: ['url']
  },
  risk: RISK.MEDIUM,
  permissions: [PERMISSION.NETWORK_FETCH],
  confirmation: CONFIRMATION.NONE,

  async execute(args, ctx) {
    const fetchRes = await fetch(args.url, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(15000) });
    const html = await fetchRes.text();
    const text = html.replace(/<script[^>]*>([\S\s]*?)<\/script>/gmi, '')
      .replace(/<style[^>]*>([\S\s]*?)<\/style>/gmi, '')
      .replace(/<\/?[^>]+(>|$)/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .substring(0, 6000);
    const summary = await ctx.chat({
      messages: [{ role: 'user', content: `Based on this webpage content: "${text}". Answer the user's underlying request in 2-3 short spoken sentences. Address the user as Boss.` }],
      max_tokens: 400
    });
    return summary.ok && summary.reply ? summary.reply : 'I could not extract useful data from that webpage.';
  }
};
