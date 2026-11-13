'use server';

import type { MatchCentre } from '@fmip/contracts';
import type { ReactNode } from 'react';
import { DEFAULT_LOCALE, isLocale, isPseudoLocale } from '@/i18n/locales';
import { type ApiResult, fetchMatchCentre } from '@/lib/api';
import {
  LIVE_PARTS,
  SHARED_FOR_MS,
  type LivePart,
  type LiveRefresh,
  type LiveSlot,
  isLivePart,
  liveSignature,
  slotsReading,
} from '@/lib/live-modules';
import { isTimeZone } from '@/lib/scores';
import { matchWords } from '@/lib/words-server';
import { liveSlot, prerender } from '@/components/match-live-slots';

/**
 * The match centre's moving modules, drawn again by the server when the live
 * page's stream says they changed (T-1811, D-409 point 2): the key events,
 * the statistics, the line-ups and Top rated (`liveSlots`). The page calls it
 * from `LiveMatch`, and only when a snapshot changed what these modules read
 * (`lib/live-modules`), naming the parts that changed, so only the slots
 * that read them are drawn and sent (review m2).
 *
 * Public and read-only, like `refreshCompetitionsMenu` (D-301): a fixture
 * id, a locale, an IANA zone and the parts, nothing else; no cookie is read,
 * so the answer is the same document for every reader. It never draws from
 * what a client sends: it asks the API for the match itself. `null` for
 * anything else, or when the match cannot be read -- the page keeps what it
 * has. The answer carries the signature of the data it was drawn from
 * (review B2), so the page marks as drawn only what was.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface Shared {
  /** When the read started, on this server's clock. */
  readAt: number;
  read: Promise<ApiResult<MatchCentre>>;
  /** Each card drawn from this read, drawn once, on first ask. */
  drawn: Map<LiveSlot, ReactNode>;
}

const shared = new Map<string, Shared>();

function sharedRead(fixtureId: string, locale: string, timeZone: string, now: number): Shared {
  const key = `${fixtureId} ${locale} ${timeZone}`;
  const current = shared.get(key);
  if (current !== undefined && now - current.readAt < SHARED_FOR_MS) return current;
  // A pseudo-locale reads as the default language, whose words it carries,
  // as the page's own read does (`withReaderLocale`; review m1).
  const readLocale = isPseudoLocale(locale) ? DEFAULT_LOCALE : locale;
  const entry: Shared = {
    readAt: now,
    read: fetchMatchCentre(fixtureId, readLocale),
    drawn: new Map(),
  };
  shared.set(key, entry);
  // Forgotten once it has served its time; a failed read is not kept at all.
  void entry.read.then((result) => {
    const forget = () => {
      if (shared.get(key) === entry) shared.delete(key);
    };
    if (!result.ok) forget();
    else setTimeout(forget, SHARED_FOR_MS);
  });
  return entry;
}

function partsOf(value: unknown): LivePart[] | null {
  if (value === undefined) return [...LIVE_PARTS];
  if (!Array.isArray(value) || value.length === 0 || value.length > LIVE_PARTS.length) return null;
  if (!value.every(isLivePart)) return null;
  return LIVE_PARTS.filter((part) => value.includes(part));
}

export async function refreshLiveModules(
  fixtureId: string,
  locale: string,
  timeZone: string,
  parts?: LivePart[],
): Promise<LiveRefresh | null> {
  if (typeof fixtureId !== 'string' || !UUID.test(fixtureId)) return null;
  if (typeof locale !== 'string' || !isLocale(locale)) return null;
  if (typeof timeZone !== 'string' || !isTimeZone(timeZone)) return null;
  const asked = partsOf(parts);
  if (asked === null) return null;
  const entry = sharedRead(fixtureId, locale, timeZone, Date.now());
  const result = await entry.read;
  if (!result.ok) return null;
  const props = { centre: result.data, locale, timeZone, words: matchWords(locale) };
  const modules: LiveRefresh['modules'] = {};
  // The same cards the page draws (`liveSlot`), each drawn once per read.
  for (const slot of slotsReading(asked)) {
    let card = entry.drawn.get(slot);
    if (card === undefined) {
      card = prerender(liveSlot(slot, props));
      entry.drawn.set(slot, card);
    }
    modules[slot] = card;
  }
  return { modules, parts: asked, drawn: liveSignature(result.data), readAt: entry.readAt };
}
