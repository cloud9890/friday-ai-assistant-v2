/* ==========================================================================
   F.R.I.D.A.Y. // SKILL — PLAY MEDIA
   ========================================================================== */

import { RISK, CONFIRMATION, PERMISSION } from '../security/risk.js';
import { openWithOS, youtubeFirstVideoId } from './helpers.js';

export default {
  name: 'play_media',
  description: 'Auto-plays a song or video on YouTube or Spotify.',
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string' },
      platform: { type: 'string', enum: ['youtube', 'spotify'] }
    },
    required: ['query', 'platform']
  },
  risk: RISK.LOW,
  permissions: [PERMISSION.NETWORK_FETCH, PERMISSION.LAUNCH_PROCESS],
  confirmation: CONFIRMATION.NONE,

  async execute(args) {
    const platform = String(args.platform || 'youtube').toLowerCase();
    let url;
    if (platform === 'youtube') url = await youtubeFirstVideoId(args.query);
    else if (platform === 'spotify') url = `https://open.spotify.com/search/${encodeURIComponent(args.query)}`;
    else return `Error: unsupported platform '${platform}'.`;
    openWithOS(url);
    return `Playing "${args.query}" on ${platform}.`;
  }
};
