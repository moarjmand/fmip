import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { PlayerSeasonMinutes } from '@fmip/contracts';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { MinutesFigure } from './minutes-figure';

/**
 * Minutes on the competition's leaders and the team's squad (T-824), under
 * T-823's rule: a total only when whole, "at least" with the matches it
 * covers, and two different sentences for "the feed sent none" and "no
 * line-up of ours names the player".
 */
const minutes = (over: Partial<PlayerSeasonMinutes>): PlayerSeasonMinutes => ({
  coverage: 'available',
  total: 900,
  matches: 10,
  matches_with_minutes: 10,
  supplied_minutes: 900,
  ...over,
});

const render = (m: PlayerSeasonMinutes, locale = 'en') =>
  renderToStaticMarkup(<MinutesFigure locale={locale} minutes={m} />);

describe('MinutesFigure (T-824)', () => {
  it('shows a whole season as its total', () => {
    const html = render(minutes({}));
    expect(html).toContain('900 minutes');
    expect(html).toContain('data-coverage="available"');
  });

  it('never shows a partial sum as the season, only "at least" and what it covers', () => {
    const html = render(
      minutes({ coverage: 'limited', total: null, matches_with_minutes: 8, supplied_minutes: 700 }),
    );
    expect(html).toContain('at least 700 minutes');
    expect(html).toContain('8 of 10 matches');
    expect(html).not.toMatch(/>700 minutes/);
  });

  it('tells "not supplied" apart from "no minutes recorded"', () => {
    expect(
      render(minutes({ coverage: 'not_supplied', total: null, matches_with_minutes: 0 })),
    ).toContain('minutes not supplied');
    const none = render(
      minutes({
        coverage: 'not_supplied',
        total: null,
        matches: 0,
        matches_with_minutes: 0,
        supplied_minutes: 0,
      }),
    );
    expect(none).toContain('no minutes recorded');
    expect(none).not.toContain('0 minutes');
  });

  it('marks the English as untranslated on a locale nobody has translated yet', () => {
    expect(render(minutes({}), 'ar')).toContain('data-translation="untranslated"');
  });
});

describe('where the minutes are shown (T-824)', () => {
  const HERE = __dirname;
  const read = (...path: string[]) =>
    readFileSync(join(HERE, '..', 'app', '[locale]', ...path), 'utf8');

  it('puts the floor in the URL on the competition page and minutes on each leader', () => {
    const page = read('competition', '[id]', 'page.tsx');
    expect(page).toContain('readMinMinutesParam(query)');
    expect(page).toContain('leadersHref(');
    expect(page).toContain('minutes={leader.minutes}');
    expect(page).toContain('message="competition.leaders.unproven"');
  });

  it('shows minutes beside each squad member on the team page', () => {
    const page = read('team', '[id]', 'page.tsx');
    expect(page).toContain('minutes={player.minutes}');
    expect(page).toContain('"team.squad.minutes"');
  });
});
