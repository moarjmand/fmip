import { describe, expect, it } from 'vitest';
import {
  checkTranslation,
  latinDigits,
  unresolvedFailures,
  type TranslationCheck,
  type TranslationCheckContext,
  type TranslationTexts,
} from './translation-checks';

/**
 * The automatic checks (T-1012, D-131): a passing and a failing pair for each,
 * with right-to-left targets among them, and the promise that a check only
 * ever returns a verdict.
 */
const TEAM = 'team.00000000-0000-4000-8000-000000000101';
const context = (overrides: Partial<TranslationCheckContext> = {}): TranslationCheckContext => ({
  sourceLanguage: 'en',
  targetLanguage: 'ar',
  names: [],
  ...overrides,
});
const texts = (headline: string, summary: string | null = null): TranslationTexts => ({
  headline,
  summary,
  byline: null,
});

function outcome(
  check: TranslationCheck,
  source: string,
  target: string,
  ctx: TranslationCheckContext = context(),
) {
  const result = checkTranslation(texts(source), texts(target), ctx).find(
    (entry) => entry.check === check && entry.field === 'headline',
  );
  return result;
}

describe('digits', () => {
  it('reads Arabic-Indic and Persian digits and separators as Latin ones', () => {
    expect(latinDigits('٢٫٥ و ۱۲۳۴')).toBe('2.5 و 1234');
  });
});

describe('numbers', () => {
  it('passes the same numbers in Persian digits and Latin grouping', () => {
    expect(
      outcome('numbers', 'A 1,500 crowd saw 3 goals', 'حضور ۱۵۰۰ تماشاگر و ۳ گل')?.outcome,
    ).toBe('pass');
    expect(outcome('numbers', '2.5 goals a game', '٢٫٥ هدف في المباراة')?.outcome).toBe('pass');
  });

  it('fails a number the translation dropped or changed, and names it', () => {
    const result = outcome('numbers', 'Out for 6 weeks', 'غائب لمدة ٥ أسابيع');
    expect(result?.outcome).toBe('fail');
    expect(result?.detail).toContain('missing 6');
    expect(result?.detail).toContain('not in the source: 5');
  });
});

describe('scorelines', () => {
  it('passes the same score, in Arabic digits right to left', () => {
    expect(
      outcome('scorelines', 'Esteghlal win 2-1 at home', 'استقلال يفوز ٢-١ على أرضه')?.outcome,
    ).toBe('pass');
    expect(
      outcome('scorelines', 'Won 3–0', 'Gewann 3:0', context({ targetLanguage: 'de' }))?.outcome,
    ).toBe('pass');
  });

  it('fails a score the other way round, though every number is still there', () => {
    const numbers = outcome('numbers', 'Esteghlal win 2-1', 'استقلال يفوز ١-٢');
    const scorelines = outcome('scorelines', 'Esteghlal win 2-1', 'استقلال يفوز ١-٢');
    expect(numbers?.outcome).toBe('pass');
    expect(scorelines?.outcome).toBe('fail');
    expect(scorelines?.detail).toContain('missing 2-1');
  });
});

describe('dates', () => {
  it('passes a date written with the target language month name, and a numeric one', () => {
    expect(outcome('dates', 'Final on 12 May 2026', 'النهائي في ١٢ مايو ٢٠٢٦')?.outcome).toBe(
      'pass',
    );
    expect(
      outcome('dates', 'Final on May 12', 'Finale am 12. Mai', context({ targetLanguage: 'de' }))
        ?.outcome,
    ).toBe('pass');
    expect(
      outcome(
        'dates',
        'Match moved to 2026-09-29',
        'Partido trasladado al 29 de septiembre de 2026',
        context({ targetLanguage: 'es' }),
      )?.outcome,
    ).toBe('pass');
  });

  it('does not count a date as numbers that went missing', () => {
    expect(
      outcome(
        'numbers',
        'Match moved to 2026-09-29',
        'Partido trasladado al 29 de septiembre de 2026',
        context({ targetLanguage: 'es' }),
      )?.outcome,
    ).toBe('pass');
  });

  it('fails a different day', () => {
    const result = outcome('dates', 'Final on 12 May', 'النهائي في ١٣ مايو');
    expect(result?.outcome).toBe('fail');
    expect(result?.detail).toContain('missing 12/5');
  });
});

describe('names', () => {
  const names = context({
    names: [{ key: TEAM, sources: ['Esteghlal'], targets: ['استقلال'] }],
  });

  it('passes a linked name carried as the localised name or glossary term, right to left', () => {
    expect(
      outcome('names', 'Esteghlal sign a striker', 'استقلال يتعاقد مع مهاجم', names)?.outcome,
    ).toBe('pass');
  });

  it('fails a linked name written some other way', () => {
    const result = outcome('names', 'Esteghlal sign a striker', 'الاستقلال يتعاقد مع مهاجم', names);
    expect(result?.outcome).toBe('fail');
    expect(result?.detail).toContain('Esteghlal');
  });

  it('says a name nobody has written in the language could not be checked, never a pass', () => {
    const result = outcome(
      'names',
      'Esteghlal sign a striker',
      'فريق يتعاقد مع مهاجم',
      context({ names: [{ key: TEAM, sources: ['Esteghlal'], targets: [] }] }),
    );
    expect(result?.outcome).toBe('not_checked');
  });

  it('ignores a name the source does not carry', () => {
    expect(outcome('names', 'A striker signs', 'مهاجم يوقع', names)?.outcome).toBe('pass');
  });
});

describe('links', () => {
  it('passes the same link', () => {
    expect(
      outcome('links', 'Read https://example.org/a.', 'اقرأ https://example.org/a')?.outcome,
    ).toBe('pass');
  });

  it('fails a changed link', () => {
    expect(
      outcome('links', 'Read https://example.org/a', 'اقرأ https://example.org/b')?.outcome,
    ).toBe('fail');
  });
});

describe('markup', () => {
  it('passes the same tags and entities', () => {
    expect(outcome('markup', '<b>Goal</b> &amp; more', '<b>هدف</b> &amp; المزيد')?.outcome).toBe(
      'pass',
    );
  });

  it('fails a lost closing tag', () => {
    const result = outcome('markup', '<b>Goal</b>', '<b>هدف');
    expect(result?.outcome).toBe('fail');
    expect(result?.detail).toContain('</b>');
  });
});

describe('empty fields', () => {
  it('passes a field both carry and says nothing about a field neither carries', () => {
    const results = checkTranslation(texts('A', null), texts('ب', null), context());
    expect(results.filter((result) => result.field === 'summary')).toEqual([]);
    expect(results.find((result) => result.check === 'empty')?.outcome).toBe('pass');
  });

  it('fails a summary the translation left out, and one it added', () => {
    const left = checkTranslation(texts('A', 'Some summary'), texts('ب', null), context());
    expect(left.find((r) => r.field === 'summary')).toMatchObject({
      check: 'empty',
      outcome: 'fail',
    });
    const added = checkTranslation(texts('A', null), texts('ب', 'ملخص'), context());
    expect(added.find((r) => r.field === 'summary')).toMatchObject({
      check: 'empty',
      outcome: 'fail',
    });
  });
});

describe('the checks', () => {
  it('never change the texts they read', () => {
    const source = texts('Esteghlal win 2-1 on 12 May', 'See https://example.org');
    const target = texts('استقلال يفوز ٢-١ في ١٢ مايو', 'انظر https://example.org');
    const before = JSON.stringify([source, target]);
    checkTranslation(source, target, context());
    expect(JSON.stringify([source, target])).toBe(before);
  });

  it('leave a failure unresolved until a reason names that check on that field', () => {
    const results = checkTranslation(
      texts('Out for 6 weeks'),
      texts('غائب لمدة ٥ أسابيع'),
      context(),
    );
    expect(unresolvedFailures(results, [])).toHaveLength(1);
    expect(unresolvedFailures(results, [{ check: 'numbers', field: 'summary' }])).toHaveLength(1);
    expect(unresolvedFailures(results, [{ check: 'numbers', field: 'headline' }])).toHaveLength(0);
  });
});
