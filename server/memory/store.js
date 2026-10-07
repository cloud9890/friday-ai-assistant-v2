/* ==========================================================================
   F.R.I.D.A.Y. // MEMORY — PERSISTENT STORE
   JSON-file-backed long-term memory (facts + episodic log). No native deps;
   writes are atomic (tmp file + rename) and the parsed store is cached.
   File lives in data/ (gitignored).
   ========================================================================== */

import fs from 'fs';
import path from 'path';

const MEMORY_FILE = path.join(process.cwd(), 'data', 'memory.json');
const MAX_FACTS = 200;
const MAX_EPISODES = 100;
const MAX_VALUE_CHARS = 500;
const MAX_EPISODE_CHARS = 400;

let cache = null;

function load() {
  if (cache) return cache;
  try {
    const raw = fs.readFileSync(MEMORY_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    cache = {
      facts: Array.isArray(parsed.facts) ? parsed.facts : [],
      episodes: Array.isArray(parsed.episodes) ? parsed.episodes : []
    };
  } catch {
    cache = { facts: [], episodes: [] };
  }
  return cache;
}

function persist() {
  try {
    fs.mkdirSync(path.dirname(MEMORY_FILE), { recursive: true });
    const tmp = MEMORY_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(cache, null, 2), 'utf8');
    fs.renameSync(tmp, MEMORY_FILE);
  } catch (e) {
    console.warn('Memory persist failed:', e.message);
  }
}

export function saveFact(key, value) {
  const store = load();
  const cleanKey = String(key || '').trim().slice(0, 64);
  const cleanValue = String(value || '').trim().slice(0, MAX_VALUE_CHARS);
  if (!cleanKey || !cleanValue) return false;
  const existing = store.facts.find(f => f.key === cleanKey);
  if (existing) {
    existing.value = cleanValue;
    existing.updatedAt = new Date().toISOString();
  } else {
    store.facts.push({ key: cleanKey, value: cleanValue, updatedAt: new Date().toISOString() });
    while (store.facts.length > MAX_FACTS) store.facts.shift();
  }
  persist();
  return true;
}

export function deleteFact(key) {
  const store = load();
  const cleanKey = String(key || '').trim().toLowerCase();
  const before = store.facts.length;
  store.facts = store.facts.filter(f => f.key.toLowerCase() !== cleanKey);
  const removed = store.facts.length < before;
  if (removed) persist();
  return removed;
}

export function allFacts() {
  return load().facts.slice();
}

/** Substring search over keys and values, most recently updated first. */
export function searchFacts(query) {
  const store = load();
  const q = String(query || '').toLowerCase().trim();
  const facts = q
    ? store.facts.filter(f => f.key.toLowerCase().includes(q) || f.value.toLowerCase().includes(q))
    : store.facts.slice();
  return facts.sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
}

export function appendEpisode(entry) {
  const store = load();
  store.episodes.push({
    date: new Date().toISOString(),
    user: String(entry.user || '').slice(0, MAX_EPISODE_CHARS),
    reply: String(entry.reply || '').slice(0, MAX_EPISODE_CHARS)
  });
  while (store.episodes.length > MAX_EPISODES) store.episodes.shift();
  persist();
}

export function lastEpisodes(n = 3) {
  return load().episodes.slice(-n);
}
