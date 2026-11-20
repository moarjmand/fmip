import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { clipProblems, parseClipProps } from './props.ts';
import { badgeLetters, countdownText, persianDigits, shareRank } from './text.ts';
import { NIGHT } from './tokens.ts';

const fixture = (): Record<string, unknown> =>
  JSON.parse(
    readFileSync(new URL('../fixtures/matchday-preview.json', import.meta.url), 'utf8'),
  ) as Record<string, unknown>;

describe('clip props', () => {
  it('takes the fixture, in English and in Persian', () => {
    expect(clipProblems(fixture())).toEqual([]);
    expect(clipProblems({ ...fixture(), locale: 'fa' })).toEqual([]);
  });

  it('refuses a clip that mixes two prediction products (rule 6)', () => {
    const community = { product: 'community_consensus', percent: { home: 50, draw: 20, away: 30 } };
    for (const key of ['community', 'community_consensus', 'founder_analysis', 'predictions']) {
      const problems = clipProblems({ ...fixture(), [key]: community });
      expect(problems.join('\n'), key).toMatch(/second prediction product/);
    }
    // Nested beside the model's figures as well.
    const nested = fixture();
    (nested.prediction as Record<string, unknown>).founder = { pick: 'home' };
    expect(clipProblems(nested).join('\n')).toMatch(/prediction\.founder: a second prediction/);
    expect(() => parseClipProps(nested)).toThrow(/Refused clip props/);
  });

  it("refuses another product in the model's place", () => {
    const props = fixture();
    (props.prediction as Record<string, unknown>).product = 'community_consensus';
    expect(clipProblems(props).join('\n')).toMatch(/statistical model's clip/);
  });

  it('refuses a missing or malformed model version (rule 5)', () => {
    for (const version of [undefined, '', 'latest', '0.7']) {
      const props = fixture();
      const model = (props.prediction as { model: Record<string, unknown> }).model;
      if (version === undefined) delete model.version;
      else model.version = version;
      expect(clipProblems(props).join('\n'), String(version)).toMatch(/model\.version/);
    }
  });

  it('refuses a picture or an address under any key', () => {
    const props = fixture();
    (props.home as Record<string, unknown>).crest = 'https://example.org/crest.png';
    expect(clipProblems(props)).toContain('home.crest: a picture or an address is not allowed');
  });

  it('refuses shares that do not sum to 100, and a Persian clip with no Persian name', () => {
    const shares = fixture();
    (shares.prediction as Record<string, unknown>).percent = { home: 50, draw: 30, away: 30 };
    expect(clipProblems(shares).join('\n')).toMatch(/sums to 110\.0/);
    const persian = { ...fixture(), locale: 'fa', away: { name: { en: 'Esteghlal' }, code: null } };
    expect(clipProblems(persian)).toContain('away.name.fa: missing for a Persian clip');
  });
});

describe('clip words', () => {
  it('counts down from as_of by whole seconds of the clip, never from the clock', () => {
    const times = { as_of: '2026-11-19T07:00:00Z', kickoff_at: '2026-11-19T13:00:00Z' };
    expect(countdownText(times, 0, 30, 'en')).toBe('06:00:00');
    expect(countdownText(times, 29, 30, 'en')).toBe('06:00:00');
    expect(countdownText(times, 449, 30, 'en')).toBe('05:59:46');
    expect(countdownText(times, 449, 30, 'fa')).toBe('۰۵:۵۹:۴۶');
  });

  it('letters a badge and ranks the shares as the card does', () => {
    expect(badgeLetters({ name: { en: 'Kheybar Khorramabad' }, code: null })).toBe('KK');
    expect(badgeLetters({ name: { en: 'Esteghlal' }, code: null })).toBe('ES');
    expect(badgeLetters({ name: { en: 'Newcastle United' }, code: 'new' })).toBe('NEW');
    expect(shareRank({ home: 24.8, draw: 35.2, away: 40 }, 'away')).toBe(1);
    expect(shareRank({ home: 40, draw: 20, away: 40 }, 'home')).toBe(1);
    expect(persianDigits('24.8')).toBe('۲۴٫۸');
  });
});

describe('tokens', () => {
  it("are the social card's Night values", () => {
    const source = readFileSync(
      new URL('../../../apps/web/src/lib/brand-colours.ts', import.meta.url),
      'utf8',
    );
    const night = /export const NIGHT_COLOURS = \{([^}]*)\}/.exec(source)?.[1] ?? '';
    for (const [name, value] of Object.entries(NIGHT)) {
      expect(night, name).toMatch(new RegExp(`['"]?${name}['"]?: '${value}'`));
    }
  });
});
