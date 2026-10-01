import type { MatchViewing } from '@fmip/contracts';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { KnockoutBracket } from './knockout-bracket';
import { ViewingPanel } from './viewing-panel';

/**
 * The Watch line and the knockout bracket in Persian (T-1304): the sentence
 * about a territory keeps the name where Persian word order puts it, and the
 * bracket's own words come from the catalogue.
 */
const NONE = { coverage: 'not_supplied', last_updated_at: null, data: null } as const;

const viewing = (): MatchViewing => ({
  fixture_id: 'f1',
  territory: { state: 'chosen', territory: { code: 'IR', name: 'Iran' } },
  options: NONE,
  highlights: NONE,
});

const line = (locale: string) =>
  renderToStaticMarkup(
    <ViewingPanel
      variant="line"
      locale={locale}
      timeZone="UTC"
      viewing={viewing()}
      kickoffAt="2026-10-01T16:00:00Z"
      status="scheduled"
      signedIn={false}
      href="/fa/match/f1"
    />,
  );

describe('ViewingPanel line (T-1304)', () => {
  it('keeps the English sentence word for word', () => {
    expect(line('en')).toContain('No viewing information yet for Iran');
  });

  it('writes the sentence in Persian with the territory inside it', () => {
    const html = line('fa');
    expect(html).toMatch(/هنوز اطلاعات پخشی برای .+ ثبت نشده است/);
    expect(html).not.toContain('data-translation="untranslated"');
  });
});

describe('KnockoutBracket (T-1304)', () => {
  it('names the section and a round’s format in Persian', () => {
    const html = renderToStaticMarkup(
      <KnockoutBracket
        locale="fa"
        timeZone="UTC"
        bracket={{
          rounds: [{ key: 'final', legs: 1, state: 'not_drawn', expected_ties: 1, ties: [] }],
        }}
      />,
    );
    expect(html).toContain('مرحله‌ی حذفی');
    expect(html).toContain('تک‌بازی');
  });
});
