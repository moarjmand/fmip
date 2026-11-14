import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { confidenceOf, httpUrl, providersFrom } from './providers.ts';

/**
 * The data providers' comparison file, checked on the computer (T-1830,
 * D-423): a provider with no key, name or known status is left out and
 * counted, a bad score loses its score and keeps its words, a source that is
 * not an http(s) link is never a link, a fact not marked verified is not
 * verified, and a file that is not a comparison publishes none.
 */

const CHANGED = '2026-11-13T08:00:00.000Z';
const fixture = (): Record<string, unknown> =>
  JSON.parse(
    readFileSync(new URL('../fixtures/providers-comparison.json', import.meta.url), 'utf8'),
  ) as Record<string, unknown>;

describe('providersFrom', () => {
  it('reads the fixture whole, with no problem', () => {
    const read = providersFrom(fixture(), CHANGED);
    expect(read.problems).toEqual([]);
    expect(read.providers?.schema).toBe(1);
    expect(read.providers?.updated_at).toBe('2026-11-13T09:40:00Z');
    expect(read.providers?.criteria.map((c) => c.key)).toEqual([
      'coverage',
      'live',
      'depth',
      'history',
      'price',
      'licence',
      'sanctions',
      'reliability',
    ]);
    expect(read.providers?.providers.map((p) => p.status)).toEqual([
      'current',
      'candidate',
      'candidate',
      'not-suitable',
    ]);
    expect(read.providers?.skipped).toBe(0);
  });

  it('keeps a trial in words apart from a yes or no, and a missing price as null', () => {
    const sportmonks = providersFrom(fixture(), CHANGED).providers!.providers[1]!;
    expect(sportmonks.plans[0]).toMatchObject({ trial: null, trial_note: '14 روز' });
    expect(sportmonks.plans[3]).toMatchObject({
      price_month: null,
      trial: false,
      trial_note: null,
    });
  });

  it('bands a numeric confidence and reads the three words', () => {
    expect(providersFrom(fixture(), CHANGED).providers!.providers[3]!.confidence).toBe('medium');
    expect(confidenceOf('High')).toBe('high');
    expect(confidenceOf('متوسط')).toBe('medium');
    expect(confidenceOf(0.2)).toBe('low');
    expect(confidenceOf(4)).toBeNull();
    expect(confidenceOf('sure')).toBeNull();
  });

  it('never makes a link of a source that is not http(s)', () => {
    expect(httpUrl('javascript:alert(1)')).toBeNull();
    expect(httpUrl('/relative')).toBeNull();
    expect(httpUrl('https://example.com/a')).toBe('https://example.com/a');
    const raw = fixture();
    const providers = raw.providers as Record<string, unknown>[];
    (providers[0]!.facts as Record<string, Record<string, unknown>>).coverage!.source =
      'javascript:alert(1)';
    providers[0]!.url = 'javascript:alert(1)';
    const first = providersFrom(raw, CHANGED).providers!.providers[0]!;
    expect(first.url).toBeNull();
    expect(first.facts.coverage).toMatchObject({
      source_url: null,
      source_note: 'javascript:alert(1)',
    });
  });

  it('marks unverified whatever is not explicitly verified', () => {
    const raw = fixture();
    const facts = (raw.providers as Record<string, unknown>[])[0]!.facts as Record<
      string,
      Record<string, unknown>
    >;
    delete facts.coverage!.verified;
    facts.live!.verified = 'yes';
    const first = providersFrom(raw, CHANGED).providers!.providers[0]!;
    expect(first.facts.coverage!.verified).toBe(false);
    expect(first.facts.live!.verified).toBe(false);
  });

  it('leaves out and counts a provider with a problem, naming it', () => {
    const raw = fixture();
    const providers = raw.providers as Record<string, unknown>[];
    providers.push({ key: 'Bad Key', name: 'x', status: 'current' });
    providers.push({ key: 'nostatus', name: 'No status', status: 'maybe' });
    providers.push({ ...providers[0], name: 'Twice' });
    const read = providersFrom(raw, CHANGED);
    expect(read.providers!.providers).toHaveLength(4);
    expect(read.providers!.skipped).toBe(3);
    expect(read.problems.join('\n')).toMatch(/Bad Key: the key/);
    expect(read.problems.join('\n')).toMatch(/nostatus: the status maybe/);
    expect(read.problems.join('\n')).toMatch(/api-football: the key is used twice/);
  });

  it('drops a bad score but keeps the words, and drops a fact on an unknown criterion', () => {
    const raw = fixture();
    const facts = (raw.providers as Record<string, unknown>[])[0]!.facts as Record<
      string,
      Record<string, unknown>
    >;
    facts.live!.score = 7;
    facts.speed = { value_fa: 'x', score: 3, verified: true };
    const read = providersFrom(raw, CHANGED);
    const first = read.providers!.providers[0]!;
    expect(first.facts.live).toMatchObject({
      score: null,
      value_fa: 'به‌روزرسانی هر ۱۵ ثانیه در بازی زنده',
    });
    expect(first.facts.speed).toBeUndefined();
    expect(read.providers!.skipped).toBe(2);
    expect(read.problems).toHaveLength(2);
  });

  it('drops a criterion without a positive weight, and its facts with it', () => {
    const raw = fixture();
    (raw.criteria as Record<string, unknown>[])[7]!.weight = 0;
    const read = providersFrom(raw, CHANGED);
    expect(read.providers!.criteria).toHaveLength(7);
    expect(read.providers!.providers[0]!.facts.reliability).toBeUndefined();
    expect(read.problems[0]).toMatch(/reliability: the weight/);
  });

  it('publishes none when the file is not a comparison', () => {
    expect(providersFrom([], CHANGED).providers).toBeNull();
    expect(providersFrom({ criteria: [] }, CHANGED).providers).toBeNull();
    expect(providersFrom({ providers: [], criteria: 'all' }, CHANGED).providers).toBeNull();
  });

  it('takes the file time when the file names none', () => {
    const raw = fixture();
    delete raw.updated_at;
    expect(providersFrom(raw, CHANGED).providers!.updated_at).toBe(CHANGED);
  });

  it('refuses a key named like an object property (sec-2026-11-13-07)', () => {
    const raw = fixture();
    (raw.criteria as Record<string, unknown>[]).push(
      { key: 'constructor', label_fa: 'x', weight: 1 },
      { key: 'prototype', label_fa: 'x', weight: 1 },
    );
    (raw.providers as Record<string, unknown>[]).push({
      key: 'constructor',
      name: 'x',
      status: 'candidate',
    });
    const read = providersFrom(raw, CHANGED);
    expect(read.providers!.criteria.map((c) => c.key)).not.toContain('constructor');
    expect(read.providers!.criteria.map((c) => c.key)).not.toContain('prototype');
    expect(read.providers!.providers.map((p) => p.key)).not.toContain('constructor');
    expect(read.problems.join('\n')).toMatch(/criterion 9: the key is missing or not a key/);
  });
});
