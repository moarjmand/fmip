import type { PendingPick, PredictionHistoryResponse, ScoreCard } from '@fmip/contracts';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { nothingToPick } from '@/lib/scores-filters';
import { FirstPick, showsFirstPick } from './first-pick';

/**
 * What a new member sees first (T-1964, D-467): on "Not picked yet", where
 * `/welcome` leaves a new account, «پیش‌بینی کن» / "Make a prediction" leads
 * to the first open match's pick (the sheet on a phone, the side column on a
 * desktop), only until the first pick. The page itself, with the card, the
 * next-day line and the chips, is rendered in `scores-page.spec.tsx`.
 */

const NOW = Date.parse('2026-11-27T18:00:00Z');
type Card = Pick<ScoreCard, 'status' | 'kickoff_at'>;
const OPEN: Card = { status: 'scheduled', kickoff_at: '2026-11-27T20:00:00Z' };
const STARTED: Card = { status: 'scheduled', kickoff_at: '2026-11-27T17:00:00Z' };
const FINISHED: Card = { status: 'finished', kickoff_at: '2026-11-27T12:00:00Z' };

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
    view: 'unpicked',
    signedIn: true,
    history: history(0),
    pending: null,
    card: OPEN,
    now: NOW,
    ...over,
  });

describe('a member’s first prediction', () => {
  it('is offered on "Not picked yet" to a member with no prediction, on a match still open', () => {
    expect(shows()).toBe(true);
  });

  it('is only on "Not picked yet"', () => {
    for (const view of ['all', 'live', 'mine'] as const) expect(shows({ view }), view).toBe(false);
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

  it('is one card: «پیش‌بینی کن» to the match’s sheet on a phone, to the side column on a desktop', () => {
    const href = '/en/scores?unpicked=1&pick=f1#m-f1';
    const en = renderToStaticMarkup(<FirstPick locale="en" href={href} />);
    expect(en).toContain('data-testid="first-pick"');
    expect(en).toContain('>Your first prediction<');
    expect(en).toContain(
      'The model’s forecast, when it has one, is shown beside your pick, never mixed into it.',
    );
    const links = [...en.matchAll(/<a [^>]*>Make a prediction<\/a>/g)].map((m) => m[0]);
    expect(links).toHaveLength(2);
    const [phone, desk] = links as [string, string];
    expect(phone).toContain('data-testid="first-pick-action"');
    expect(phone).toContain('href="/en/scores?unpicked=1&amp;pick=f1#m-f1"');
    expect(phone).toMatch(/class="[^"]*\blg:hidden\b/);
    expect(desk).toContain('data-testid="first-pick-beside"');
    expect(desk).toContain('href="#pick"');
    expect(desk).toMatch(/class="[^"]*\bmax-lg:hidden\b/);
    for (const link of links) expect(link).toContain('bg-brand');
    const fa = renderToStaticMarkup(<FirstPick locale="fa" href={href} />);
    expect(fa).toContain('>نخستین پیش‌بینی شما<');
    expect(fa.match(/>پیش‌بینی کن<\/a>/g)).toHaveLength(2);
    expect(fa).toContain('پیش‌بینی مدل، اگر داشته باشد، کنار انتخاب شما نشان داده می‌شود');
    expect(fa).not.toContain('data-translation="untranslated"');
  });
});

describe('a day with nothing to pick', () => {
  it('is one with no match, or with every match kicked off or over', () => {
    expect(nothingToPick([], NOW)).toBe(true);
    expect(nothingToPick([STARTED, FINISHED], NOW)).toBe(true);
    expect(nothingToPick([FINISHED, OPEN], NOW)).toBe(false);
  });
});
