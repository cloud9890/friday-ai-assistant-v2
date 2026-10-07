/* ==========================================================================
   F.R.I.D.A.Y. // MEMORY — CONTEXT INJECTION
   Builds the memory block injected into the agent's system prompt so Friday
   knows the user across restarts. Token-budgeted: ~10 facts + last 3 episodes.
   ========================================================================== */

import { allFacts, lastEpisodes } from './store.js';

export function memoryContextBlock() {
  const parts = [];

  const facts = allFacts();
  if (facts.length > 0) {
    const lines = facts.slice(0, 10).map(f => `- ${f.key}: ${f.value}`);
    parts.push(`Permanent facts you know about the user:\n${lines.join('\n')}`);
  }

  const episodes = lastEpisodes(3);
  if (episodes.length > 0) {
    const lines = episodes
      .reverse()
      .map(e => `- (${(e.date || '').slice(0, 10)}) User asked: "${e.user}" — you answered: "${e.reply}"`);
    parts.push(`Recent past interactions:\n${lines.join('\n')}`);
  }

  return parts.length > 0 ? `\n\n${parts.join('\n\n')}` : '';
}
