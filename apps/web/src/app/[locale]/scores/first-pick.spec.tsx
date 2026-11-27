import type { PendingPick, PredictionHistoryResponse } from '@fmip/contracts';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { nothingToPick } from '@/lib/scores-filters';
import { FirstPick, showsFirstPick } from './first-pick';

/**
 * What a new member sees first (T-1964): `/welcome` leaves a new account on
 * the day's matches still to pick, where «پیش‌بینی کن» / "Make a prediction"
 * opens the first open match's pick in one tap, only until the first pick;
 * and "Not picked yet" on a day with nothing open points at the next day
 * with a match, never a dead end.
 */

const NOW = Date.parse('2026-11-27T18:00:00Z');
const OPEN = { status: 'scheduled', kickoff_at: '2026-11-27T20:00:00Z' };
const STARTED = { status: 'scheduled', kickoff_at: '2026-11-27T17:00:00Z' };
const FINISHED = { status: 'finished', kickoff_at: '2026-11-27T12:00:00Z' };

const history = (total: number): { ok: true; data: PredictionHistoryResponse } => ({
  ok: true,
  data: {
    kind: 'visible',
    username: 'newbie',
    is_self: true,
    total,
    limit: 50,
    offset: 0,
    items: [],
  } as unknown as PredictionHistoryResponse,
});
const PENDING = { outcome: 'home', status: 'pending' } as unknown as PendingPick;
const shows = (over: Partial<Parameters<typeof showsFirstPick>[0]> = {}) =>
  showsFirstPick({
    signedIn: true,
    history: history(0),
    pending: null,
    card: OPEN,
    now: NOW,
    ...over,
  });

const PAGE = readFileSync(join(__dirname, 'page.tsx'), 'utf8');

describe('a member’s first prediction', () => {
  it('is offered to a member with no prediction, on a match still open', () => {
    expect(shows()).toBe(true);
  });

  it('is not offered to a guest, after the first pick, or beside a pick waiting for the email', () => {
    expect(shows({ signedIn: false })).toBe(false);
    expect(shows({ history: history(1) })).toBe(false);
    expect(shows({ pending: PENDING })).toBe(false);
  });

  it('claims nothing about a history it could not read, nor on a match that kicked off', () => {
    expect(shows({ history: null })).toBe(false);
    expect(shows({ history: { ok: false } })).toBe(false);
    expect(shows({ card: STARTED })).toBe(false);
    expect(shows({ card: null })).toBe(false);
  });

  it('is one card with one action, «پیش‌بینی کن» on /fa, to the match’s pick', () => {
    const href = '/en/scores?unpicked=1&pick=f1#m-f1';
    const en = renderToStaticMarkup(<FirstPick locale="en" href={href} />);
    expect(en).toContain('data-testid="first-pick"');
    expect(en).toContain('>Your first prediction<');
    expect(en).toContain('The model’s forecast is shown beside your pick, never mixed into it.');
    const action = /<a [^>]*data-testid="first-pick-action"[^>]*>Make a prediction<\/a>/.exec(
      en,
    )?.[0];
    expect(action).toContain('href="/en/scores?unpicked=1&amp;pick=f1#m-f1"');
    expect(action).toContain('bg-brand');
    expect(en.match(/<a /g)).toHaveLength(1);
    const fa = renderToStaticMarkup(<FirstPick locale="fa" href={href} />);
    expect(fa).toContain('>نخستین پیش‌بینی شما<');
    expect(fa).toContain('>پیش‌بینی کن</a>');
    expect(fa).not.toContain('data-translation="untranslated"');
  });

  it('is drawn by the matches page above the list, from the first open match it previews', () => {
    expect(PAGE).toContain(
      '{firstPick !== null && <FirstPick locale={locale} href={firstPick} />}',
    );
    expect(PAGE).toMatch(/history: mine,\s+pending: pendingPick,\s+card: previewCard/);
  });
});

describe('a day with nothing to pick', () => {
  it('is one with no match, or with every match kicked off or over', () => {
    expect(nothingToPick([], NOW)).toBe(true);
    expect(nothingToPick([STARTED, FINISHED], NOW)).toBe(true);
    expect(nothingToPick([FINISHED, OPEN], NOW)).toBe(false);
  });

  it('sends "Not picked yet" to the next day with a match, as the All view’s empty day does', () => {
    expect(PAGE).toContain("(view === 'unpicked' && nothingToPick(allCards(result.data), now))");
  });
});
