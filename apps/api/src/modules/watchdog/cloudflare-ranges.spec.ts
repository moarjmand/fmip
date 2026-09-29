import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  COMMITTED_CLOUDFLARE_RANGES,
  RANGES_RECHECK_MS,
  RANGES_RETRY_MS,
  WeeklyRangesCheck,
  compareRanges,
  parseRangeList,
} from './internal/cloudflare-ranges';
import { cloudflareRanges } from './internal/conditions';

const CADDY_FILE = join(
  __dirname,
  '..',
  '..',
  '..',
  '..',
  '..',
  'deploy',
  'cloudflare-ranges.caddy',
);

const V4 = COMMITTED_CLOUDFLARE_RANGES.filter((r) => r.includes('.'));
const V6 = COMMITTED_CLOUDFLARE_RANGES.filter((r) => r.includes(':'));
const at = new Date('2026-09-30T08:00:00Z');

/** A reader answering the two published lists, counting its calls. */
function reader(v4: string, v6: string) {
  const calls: string[] = [];
  const read = (url: string) => {
    calls.push(url);
    return Promise.resolve(url.endsWith('v4') ? v4 : v6);
  };
  return { read, calls };
}

describe('the committed Cloudflare ranges (T-930)', () => {
  it('are exactly the ranges Caddy enforces in deploy/cloudflare-ranges.caddy', () => {
    const caddy = readFileSync(CADDY_FILE, 'utf8')
      .split(/\r?\n/)
      .map((line) => /^\s*remote_ip\s+(\S+)\s*$/.exec(line)?.[1])
      .filter((range): range is string => range !== undefined);
    expect(caddy).toEqual([...COMMITTED_CLOUDFLARE_RANGES]);
    expect(V4.length).toBeGreaterThan(0);
    expect(V6.length).toBeGreaterThan(0);
  });

  it('reads a published list, and refuses an answer that is not one', () => {
    expect(parseRangeList('173.245.48.0/20\r\n2400:CB00::/32\n\n', 'x')).toEqual([
      '173.245.48.0/20',
      '2400:cb00::/32',
    ]);
    expect(() => parseRangeList('', 'x')).toThrow(/empty/);
    expect(() => parseRangeList('<html>Just a moment...</html>', 'x')).toThrow(/not a list/);
  });

  it('names the ranges on each side only', () => {
    expect(compareRanges(['a/1', 'b/2'], ['B/2', 'c/3'])).toEqual({
      notCommitted: ['c/3'],
      noLongerPublished: ['a/1'],
    });
  });
});

describe('the cloudflare_ranges condition', () => {
  it('is ok when the lists match, and failing on any difference, naming it', () => {
    expect(cloudflareRanges({ notCommitted: [], noLongerPublished: [], at })).toMatchObject({
      key: 'cloudflare_ranges',
      level: 'ok',
      observed: 0,
    });
    const added = cloudflareRanges({ notCommitted: ['1.2.3.0/24'], noLongerPublished: [], at });
    expect(added.level).toBe('failing');
    expect(added.observed).toBe(1);
    expect(added.note).toContain('published and not in deploy/cloudflare-ranges.caddy: 1.2.3.0/24');
    const dropped = cloudflareRanges({ notCommitted: [], noLongerPublished: ['9.9.0.0/16'], at });
    expect(dropped.level).toBe('failing');
    expect(dropped.note).toContain('no longer published: 9.9.0.0/16');
  });

  it('is unknown when the lists could not be read, and ok when the check is off', () => {
    expect(cloudflareRanges({ unreadable: 'timeout', at }).level).toBe('unknown');
    expect(cloudflareRanges({ configured: false })).toMatchObject({ level: 'ok', observed: null });
  });
});

describe('the weekly comparison', () => {
  it('is off unless set to on, and says so for a value it does not know', async () => {
    const r = reader(V4.join('\n'), V6.join('\n'));
    const check = new WeeklyRangesCheck(r.read);
    expect(await check.seen(at, undefined)).toEqual({ configured: false });
    expect(await check.seen(at, 'off')).toEqual({ configured: false });
    expect(await check.seen(at, 'yes')).toMatchObject({ unreadable: /on or off/ });
    expect(r.calls).toEqual([]);
  });

  it('reads both lists once, then again only after a week', async () => {
    const r = reader(V4.join('\n'), V6.join('\n'));
    const check = new WeeklyRangesCheck(r.read);
    expect(await check.seen(at, 'on')).toEqual({ notCommitted: [], noLongerPublished: [], at });
    expect(r.calls).toHaveLength(2);
    await check.seen(new Date(at.getTime() + RANGES_RECHECK_MS - 1), 'on');
    expect(r.calls).toHaveLength(2);
    await check.seen(new Date(at.getTime() + RANGES_RECHECK_MS), 'on');
    expect(r.calls).toHaveLength(4);
  });

  it('reports a range Cloudflare added', async () => {
    const r = reader([...V4, '198.51.100.0/24'].join('\n'), V6.join('\n'));
    const seen = await new WeeklyRangesCheck(r.read).seen(at, 'on');
    expect(seen).toMatchObject({ notCommitted: ['198.51.100.0/24'], noLongerPublished: [] });
  });

  it('retries an unanswered read after an hour, never reporting it as a difference', async () => {
    let fail = true;
    const calls: string[] = [];
    const check = new WeeklyRangesCheck((url) => {
      calls.push(url);
      if (fail) return Promise.reject(new Error('connect ETIMEDOUT'));
      return Promise.resolve(url.endsWith('v4') ? V4.join('\n') : V6.join('\n'));
    });
    expect(await check.seen(at, 'on')).toMatchObject({ unreadable: 'connect ETIMEDOUT' });
    const before = calls.length;
    await check.seen(new Date(at.getTime() + RANGES_RETRY_MS - 1), 'on');
    expect(calls.length).toBe(before);
    fail = false;
    expect(await check.seen(new Date(at.getTime() + RANGES_RETRY_MS), 'on')).toMatchObject({
      notCommitted: [],
      noLongerPublished: [],
    });
  });
});
