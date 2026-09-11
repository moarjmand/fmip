import type { FavouriteIds, ScoreCard, ScoresGroup } from '@fmip/contracts';
import { compareByFavourites, favouriteRank } from '../../profile/profile.service';
import type { ScoredRow } from './scores-store';

/**
 * Pinning and grouping (blueprint 4.1): favourites above the standard list,
 * the rest grouped by competition under its country. Pure, so the order is
 * tested without a database.
 *
 * Ranks come from the profile boundary's `favouriteRank`: 0 favourite team,
 * 1 favourite competition, 2 followed team, 3 followed competition, 4 rest.
 * Ranks 0 and 1 are pinned; ranks 2 and 3 lift their group up the list.
 */
export interface Arranged {
  pinned: ScoreCard[];
  groups: ScoresGroup[];
}

const rankable = (card: ScoreCard) => ({
  id: card.id,
  competitionId: card.competition.id,
  homeTeamId: card.home.id,
  awayTeamId: card.away.id,
  kickoffAt: card.kickoff_at,
});

export function rankOf(card: ScoreCard, prefs: FavouriteIds | null): number {
  return prefs === null ? 4 : favouriteRank(rankable(card), prefs);
}

/** Only fixtures the viewer follows in some way (ranks 0–3). */
export function onlyFollowed(rows: ScoredRow[], prefs: FavouriteIds): ScoredRow[] {
  return rows.filter((row) => rankOf(row.card, prefs) < 4);
}

export function arrange(rows: ScoredRow[], prefs: FavouriteIds | null): Arranged {
  const pinned: ScoreCard[] = [];
  const groups = new Map<string, ScoresGroup & { rank: number }>();

  for (const row of rows) {
    const rank = rankOf(row.card, prefs);
    if (rank <= 1) {
      pinned.push({ ...row.card, pinned: true });
      continue;
    }
    const key = row.card.competition.id;
    const group = groups.get(key) ?? {
      country: row.country,
      competition: {
        id: row.card.competition.id,
        name: row.card.competition.name,
        short_name: row.card.competition.short_name,
      },
      fixtures: [],
      rank,
    };
    group.fixtures.push(row.card);
    group.rank = Math.min(group.rank, rank);
    groups.set(key, group);
  }

  if (prefs !== null) {
    const compare = compareByFavourites(prefs);
    pinned.sort((a, b) => compare(rankable(a), rankable(b)));
  }

  const byKickoff = (a: ScoreCard, b: ScoreCard): number =>
    a.kickoff_at < b.kickoff_at ? -1 : a.kickoff_at > b.kickoff_at ? 1 : a.id < b.id ? -1 : 1;

  const ordered = [...groups.values()]
    .sort(
      (a, b) =>
        a.rank - b.rank ||
        (a.country?.name ?? '').localeCompare(b.country?.name ?? '') ||
        a.competition.name.localeCompare(b.competition.name),
    )
    .map(({ rank: _rank, ...group }) => ({
      ...group,
      fixtures: [...group.fixtures].sort(byKickoff),
    }));

  return { pinned, groups: ordered };
}
