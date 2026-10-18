/* M1: system stats must report reality, never a fabricated floor. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { systemStats } from '../../server/skills/fetch_system_status.js';

const fakeOs = ({ times = [], total = 1024, free = 512 } = {}) => ({
  totalmem: () => total,
  freemem: () => free,
  cpus: () => times.map(t => ({ times: t }))
});

test('a genuinely busy CPU reports the real number, not a 5% floor', () => {
  // 95% busy: 5 idle out of 100 total.
  const stats = systemStats(fakeOs({ times: [{ user: 95, idle: 5 }] }));
  assert.equal(stats.cpuUsagePercent, 95);
});

test('an idle machine reports a low number instead of the old 5% floor', () => {
  const stats = systemStats(fakeOs({ times: [{ user: 0, idle: 100 }] }));
  assert.equal(stats.cpuUsagePercent, 0);
});

test('when the OS gives nothing to measure, stats are null — not invented', () => {
  const stats = systemStats(fakeOs({ times: [] }));
  assert.equal(stats.cpuUsagePercent, null, 'no fabricated 15 with no CPUs');

  const noMem = systemStats({ totalmem: () => 0, freemem: () => 0, cpus: () => [] });
  assert.equal(noMem.memUsagePercent, null);
});

test('memory usage is computed from total and free, and stays in range', () => {
  const stats = systemStats(fakeOs({ total: 1000, free: 250 }));
  assert.equal(stats.memUsagePercent, 75);
});

test('the live machine still yields a usable reading', () => {
  const stats = systemStats();
  assert.ok(stats.cpuUsagePercent === null || (stats.cpuUsagePercent >= 0 && stats.cpuUsagePercent <= 100));
  assert.ok(stats.memUsagePercent === null || (stats.memUsagePercent >= 0 && stats.memUsagePercent <= 100));
});
