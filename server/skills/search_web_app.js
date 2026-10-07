/* ==========================================================================
   F.R.I.D.A.Y. // SKILL — SEARCH / OPEN WEB APP
   ========================================================================== */

import { RISK, CONFIRMATION, PERMISSION } from '../security/risk.js';
import { openWithOS } from './helpers.js';

export default {
  name: 'search_web_app',
  description: 'Opens any website in the browser; youtube/google get search URLs.',
  parameters: {
    type: 'object',
    properties: {
      targetApp: { type: 'string' },
      searchQuery: { type: 'string' },
      action: { type: 'string', enum: ['search', 'play'] }
    },
    required: ['targetApp']
  },
  risk: RISK.LOW,
  permissions: [PERMISSION.LAUNCH_PROCESS],
  confirmation: CONFIRMATION.NONE,

  execute(args) {
    // Any site the user names opens in their own browser; only YouTube/Google
    // get special search-URL treatment.
    let site = String(args.targetApp || '').toLowerCase().trim()
      .replace(/^https?:\/\//, '').replace(/\/+$/, '').replace(/\s+/g, '');
    if (!site) return 'Error: no website specified.';
    const query = args.searchQuery || '';
    let url;
    if (site === 'youtube' || site.endsWith('youtube.com')) {
      url = query ? `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}` : 'https://www.youtube.com/';
    } else if (site === 'google' || site.endsWith('google.com')) {
      url = query ? `https://www.google.com/search?q=${encodeURIComponent(query)}` : 'https://www.google.com/';
    } else if (/^[a-z0-9][a-z0-9-]*$/.test(site)) {
      url = `https://www.${site}.com/`; // bare name like "github" or "reddit"
    } else if (/^[a-z0-9.-]+\.[a-z]{2,}$/.test(site)) {
      url = `https://${site}/`; // fully qualified domain like "en.wikipedia.org"
    } else {
      return `Error: cannot open '${args.targetApp}' — not a valid website name.`;
    }
    openWithOS(url);
    return `Opened ${site}${query ? ` with the search "${query}"` : ''}.`;
  }
};
