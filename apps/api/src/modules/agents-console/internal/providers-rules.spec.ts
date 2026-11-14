import { describe, expect, it } from 'vitest';
import { checkProviders, safeUrl } from './providers-rules';

/**
 * The data providers' comparison at the server's edge (T-1830, D-423): a
 * clean comparison passes unchanged, one that is not one is dropped whole, a
 * provider or criterion the console does not know is dropped and counted, a
 * link that is not http(s) never survives, and nothing unverified becomes
 * verified.
 */

const fact = (overrides: Record<string, unknown> = {}) => ({
  value_fa: 'بیش از ۱۱۰۰ لیگ',
  score: 5,
  source_url: 'https://www.api-football.com/coverage',
  source_note: null,
  checked: '2026-11-12',
  verified: true,
  ...overrides,
});

const provider = (overrides: Record<string, unknown> = {}) => ({
  key: 'api-football',
  name: 'API-Football',
  url: 'https://www.api-football.com/',
  status: 'current',
  plans: [
    {
      name: 'Ultra',
      price_month: 29,
      currency: 'USD',
      requests: '75,000 / day',
      leagues: '1,100+',
      trial: false,
      trial_note: null,
    },
  ],
  facts: { coverage: fact(), price: fact({ score: 4, verified: false }) },
  pros_fa: ['ارزان'],
  cons_fa: ['مجوز روشن نیست'],
  licence_fa: 'نیاز به تأیید کتبی',
  sanctions_fa: null,
  summary_fa: 'ارائه‌دهنده‌ی فعلی',
  confidence: 'high',
  ...overrides,
});

const comparison = (overrides: Record<string, unknown> = {}) => ({
  schema: 1,
  updated_at: '2026-11-13T09:40:00Z',
  method_fa: 'روش',
  needs_fa: ['پوشش'],
  criteria: [
    { key: 'coverage', label_fa: 'پوشش', weight: 20 },
    { key: 'price', label_fa: 'قیمت', weight: 15 },
  ],
  providers: [provider()],
  recommendation_fa: 'نگه داریم',
  current_stack_fa: 'API-Football',
  next_steps_fa: ['ایمیل'],
  skipped: 0,
  ...overrides,
});

describe('checkProviders', () => {
  it('passes a clean comparison unchanged', () => {
    expect(checkProviders(comparison())).toEqual(comparison());
  });

  it('drops a comparison that is not one', () => {
    expect(checkProviders(undefined)).toBeNull();
    expect(checkProviders(null)).toBeNull();
    expect(checkProviders(comparison({ schema: 2 }))).toBeNull();
    expect(checkProviders(comparison({ providers: 'all' }))).toBeNull();
    expect(checkProviders(comparison({ updated_at: 'today' }))).toBeNull();
  });

  it('drops and counts a provider or criterion it does not know', () => {
    const checked = checkProviders(
      comparison({
        skipped: 1,
        criteria: [
          { key: 'coverage', label_fa: 'پوشش', weight: 20 },
          { key: 'price', label_fa: 'قیمت', weight: 15 },
          { key: 'Bad Key', label_fa: 'x', weight: 1 },
          { key: 'zero', label_fa: 'x', weight: 0 },
        ],
        providers: [
          provider(),
          provider({ status: 'maybe', key: 'other' }),
          provider(),
          provider({ key: 'nameless', name: '' }),
        ],
      }),
    );
    expect(checked?.criteria.map((c) => c.key)).toEqual(['coverage', 'price']);
    expect(checked?.providers.map((p) => p.key)).toEqual(['api-football']);
    expect(checked?.skipped).toBe(1 + 2 + 3);
  });

  it('never keeps a link that is not http(s)', () => {
    const checked = checkProviders(
      comparison({
        providers: [
          provider({
            url: 'javascript:alert(1)',
            facts: { coverage: fact({ source_url: 'data:text/html,<b>x</b>' }) },
          }),
        ],
      }),
    );
    expect(checked?.providers[0]?.url).toBeNull();
    expect(checked?.providers[0]?.facts.coverage?.source_url).toBeNull();
    expect(safeUrl('https://example.com')).toBe('https://example.com/');
  });

  it('keeps a fact unverified unless it says true, and drops a score outside 1 to 5', () => {
    const checked = checkProviders(
      comparison({
        providers: [
          provider({
            facts: {
              coverage: fact({ verified: 'yes', score: 6 }),
              price: fact({ score: 2.5 }),
              speed: fact(),
            },
          }),
        ],
      }),
    );
    const facts = checked?.providers[0]?.facts;
    expect(facts?.coverage).toMatchObject({ verified: false, score: null });
    expect(facts?.price?.score).toBeNull();
    expect(facts?.speed).toBeUndefined();
  });

  it('keeps a confidence only when it is one of the three', () => {
    expect(
      checkProviders(comparison({ providers: [provider({ confidence: 0.9 })] }))?.providers[0]
        ?.confidence,
    ).toBeNull();
  });

  it('refuses a key named like an object property, and never reads a fact through the prototype (sec-2026-11-13-07)', () => {
    const checked = checkProviders(
      comparison({
        criteria: [
          { key: 'coverage', label_fa: 'پوشش', weight: 20 },
          { key: 'constructor', label_fa: 'x', weight: 1 },
          { key: 'prototype', label_fa: 'x', weight: 1 },
          { key: '__proto__', label_fa: 'x', weight: 1 },
        ],
        providers: [
          provider({ key: 'constructor' }),
          provider({ key: 'prototype' }),
          provider({
            facts: JSON.parse(
              '{"__proto__": {"value_fa": "x", "score": 5}, "coverage": ' +
                JSON.stringify(fact()) +
                '}',
            ),
          }),
        ],
      }),
    );
    expect(checked?.criteria.map((c) => c.key)).toEqual(['coverage']);
    expect(checked?.providers.map((p) => p.key)).toEqual(['api-football']);
    const facts = checked!.providers[0]!.facts;
    expect(Object.keys(facts)).toEqual(['coverage']);
    expect(Object.getPrototypeOf(facts)).toBe(Object.prototype);
  });
});
