import type { MessageKey } from '@/i18n/messages';
import type { AboutIconName } from './about-icons';

/**
 * What the About page's two pictures say (T-1615, D-286), as data, so the
 * rules they carry are unit-tested (`about-content.spec.ts`) and the
 * components only draw.
 *
 * "How Stadiomind works" runs the three prediction products in lanes of
 * their own (rule 6): each lane starts at the one match record, passes
 * kick-off and full time on its own, and ends at a record of its own. No
 * lane shares an outcome with another, and nothing joins them.
 *
 * "Find your way" is the site's main sections as tiles, each a real link.
 */

/** The three prediction products, in the order every page shows them. */
export type Product = 'model' | 'founder' | 'community';

export interface Lane {
  product: Product;
  icon: AboutIconName;
  name: MessageKey;
  body: MessageKey;
  /** What the lane builds once the match is settled: its own record. */
  outcome: { icon: AboutIconName; name: MessageKey; body: MessageKey };
}

export const LANES: readonly Lane[] = [
  {
    product: 'model',
    icon: 'model',
    name: 'about.how.model.name',
    body: 'about.how.model.body',
    outcome: {
      icon: 'trend',
      name: 'about.how.outcome.model.name',
      body: 'about.how.outcome.model.body',
    },
  },
  {
    product: 'founder',
    icon: 'founder',
    name: 'about.how.founder.name',
    body: 'about.how.founder.body',
    outcome: {
      icon: 'check',
      name: 'about.how.outcome.founder.name',
      body: 'about.how.outcome.founder.body',
    },
  },
  {
    product: 'community',
    icon: 'community',
    name: 'about.how.community.name',
    body: 'about.how.community.body',
    outcome: {
      icon: 'gauge',
      name: 'about.how.outcome.community.name',
      body: 'about.how.outcome.community.body',
    },
  },
];

/** The surfaces the one match record feeds, in the record's card. */
export const RECORD_SURFACES: readonly MessageKey[] = [
  'about.how.record.live',
  'about.how.record.centre',
  'about.how.record.competitions',
  'about.how.record.clubs',
  'about.how.record.players',
];

/** A tile's colour: the brand's for the football, a product's own for its section. */
export type Tone = 'accent' | Product;

export interface Tile {
  /** Stable name: the `data-testid` suffix. */
  id: string;
  /** Where the tile leads, without the locale. May carry a query or a `#fragment`. */
  path: string;
  icon: AboutIconName;
  tone: Tone;
  name: MessageKey;
  body: MessageKey;
}

export interface TileGroup {
  id: 'football' | 'forecasts';
  title: MessageKey;
  tiles: readonly Tile[];
}

/**
 * The sections, in two groups. The match centre has no page of its own to
 * open on (a match's page is reached through a match), so its tile leads to
 * the matches and says so; the founder's analysis is on the matches page
 * at `#analysis`, and picks are made there too (D-269).
 */
export const TILE_GROUPS: readonly TileGroup[] = [
  {
    id: 'football',
    title: 'about.map.football',
    tiles: [
      {
        id: 'matches',
        path: '/scores',
        icon: 'ball',
        tone: 'accent',
        name: 'about.map.matches.name',
        body: 'about.map.matches.body',
      },
      {
        id: 'centre',
        path: '/scores',
        icon: 'pitch',
        tone: 'accent',
        name: 'about.map.centre.name',
        body: 'about.map.centre.body',
      },
      {
        id: 'competitions',
        path: '/competitions',
        icon: 'trophy',
        tone: 'accent',
        name: 'about.map.competitions.name',
        body: 'about.map.competitions.body',
      },
      {
        id: 'news',
        path: '/news',
        icon: 'news',
        tone: 'accent',
        name: 'about.map.news.name',
        body: 'about.map.news.body',
      },
      {
        id: 'highlights',
        path: '/highlights',
        icon: 'play',
        tone: 'accent',
        name: 'about.map.highlights.name',
        body: 'about.map.highlights.body',
      },
      {
        id: 'watch',
        path: '/watch',
        icon: 'screen',
        tone: 'accent',
        name: 'about.map.watch.name',
        body: 'about.map.watch.body',
      },
    ],
  },
  {
    id: 'forecasts',
    title: 'about.map.forecasts',
    tiles: [
      {
        id: 'model',
        path: '/model-accuracy',
        icon: 'model',
        tone: 'model',
        name: 'about.map.model.name',
        body: 'about.map.model.body',
      },
      {
        id: 'analysis',
        path: '/scores#analysis',
        icon: 'founder',
        tone: 'founder',
        name: 'about.map.analysis.name',
        body: 'about.map.analysis.body',
      },
      {
        id: 'predictions',
        path: '/scores?unpicked=1',
        icon: 'pick',
        tone: 'community',
        name: 'about.map.predictions.name',
        body: 'about.map.predictions.body',
      },
      {
        id: 'leaderboard',
        path: '/leaderboard',
        icon: 'podium',
        tone: 'community',
        name: 'about.map.leaderboard.name',
        body: 'about.map.leaderboard.body',
      },
    ],
  },
];

/** A tile's address in a locale: `/fa/scores?unpicked=1`. */
export function tileHref(locale: string, path: string): string {
  return `/${locale}${path}`;
}

/** The page a path opens: its first segment, without query or fragment (`/scores#analysis` → `scores`). */
export function routeOf(path: string): string {
  return path.split(/[?#]/, 1)[0]?.split('/')[1] ?? '';
}
