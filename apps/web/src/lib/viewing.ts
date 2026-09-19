import type {
  BroadcasterKind,
  Highlight,
  MatchViewing,
  ViewingAccess,
  ViewingOption,
} from '@fmip/contracts';
import { TERRITORY_CODE } from '@fmip/contracts';
import type { MessageKey } from '@/i18n/messages';
import type { ScoresPageQuery } from '@/lib/scores';

/**
 * The Watch surfaces' pure helpers (blueprint 11, T-314): reading the
 * territory a guest chose, the state a module is in -- and there are four,
 * because "not supplied" and "nothing listed" are different sentences and
 * the difference is the whole epic -- and the links that keep a guest's
 * choice with them from one surface to the next.
 */
export const ACCESS_KEY: Record<ViewingAccess, MessageKey> = {
  free: 'viewing.access.free',
  registration: 'viewing.access.registration',
  subscription: 'viewing.access.subscription',
  pay_per_view: 'viewing.access.payPerView',
};

export const KIND_KEY: Record<BroadcasterKind, MessageKey> = {
  tv: 'viewing.kind.tv',
  streaming: 'viewing.kind.streaming',
  radio: 'viewing.kind.radio',
};

type Params = Record<string, string | string[] | undefined>;

/**
 * `?territory=` as a guest picked it: a code, or nothing. Anything else is
 * dropped here rather than sent on to be refused, and nothing is inferred in
 * its place (T-312).
 */
export function readTerritoryQuery(params: Params): string | undefined {
  const raw = params.territory;
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (value === undefined) return undefined;
  const code = value.trim().toUpperCase();
  return TERRITORY_CODE.test(code) ? code : undefined;
}

/**
 * `ask`: nobody chose a territory, so the surface asks. `not_supplied`: no
 * source has said anything about this territory, so the surface says it
 * knows nothing. `nothing_listed`: a source covers it and listed nothing,
 * which is the one case "nothing to watch here" is a fact. `listed`: rows.
 */
export type OptionsState = 'ask' | 'not_supplied' | 'nothing_listed' | 'listed';

export function optionsState(viewing: MatchViewing): OptionsState {
  if (viewing.territory.state === 'not_chosen') return 'ask';
  if (viewing.options.coverage === 'not_supplied' || viewing.options.data === null) {
    return 'not_supplied';
  }
  return viewing.options.data.length === 0 ? 'nothing_listed' : 'listed';
}

export type HighlightsState = 'ask' | 'not_supplied' | 'none' | 'page' | 'embed';

export function highlightsState(viewing: MatchViewing): HighlightsState {
  if (viewing.territory.state === 'not_chosen') return 'ask';
  if (viewing.highlights.coverage === 'not_supplied' || viewing.highlights.data === null) {
    return 'not_supplied';
  }
  const highlight = viewing.highlights.data[0];
  if (highlight === undefined) return 'none';
  return embeddable(highlight) ? 'embed' : 'page';
}

/**
 * Whether a surface may put a player on the page (T-315): only for a
 * highlight whose source grants an embed and which has one. Anything less is
 * the official page, which every highlight carries, so there is never a dead
 * player and never one the rights do not allow.
 */
export function embeddable(highlight: Highlight): boolean {
  return (
    highlight.kind === 'embed' &&
    highlight.embed_url !== null &&
    highlight.source.rights === 'embed'
  );
}

/** A link with a guest's territory kept on it; a member's is stored, so nothing to keep. */
export function withTerritory(href: string, territory: string | undefined): string {
  if (territory === undefined) return href;
  return `${href}${href.includes('?') ? '&' : '?'}territory=${encodeURIComponent(territory)}`;
}

/** The territory a surface carries on its links: a guest's explicit choice, and nothing else. */
export function carriedTerritory(viewing: MatchViewing, signedIn: boolean): string | undefined {
  return !signedIn && viewing.territory.state === 'chosen'
    ? viewing.territory.territory.code
    : undefined;
}

/** The Watch page's own address: the day, an explicit zone, and a guest's territory. */
export function watchHref(
  locale: string,
  q: ScoresPageQuery,
  territory: string | undefined,
  over: { date?: string } = {},
): string {
  const p = new URLSearchParams();
  p.set('date', over.date ?? q.date);
  if (q.explicitTimezone) p.set('tz', q.timezone);
  if (territory !== undefined) p.set('territory', territory);
  return `/${locale}/watch?${p.toString()}`;
}

/** The services, named, for a one-line surface. */
export function serviceNames(options: ViewingOption[]): string {
  return options.map((option) => option.broadcaster.name).join(', ');
}
