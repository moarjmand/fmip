import type { GroupFavourite, GroupSummary, GroupVisibility } from '@fmip/contracts';
import type { GroupRow } from './groups-store';

/** A BCP 47 tag, the same shape a member's preferred language has (T-020). */
export const LANGUAGE_TAG = /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/;
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The favourite as a reader sees it: the id is the key (rule 1), the name is
 * only what is shown. `null` when the group has none -- and the page then says
 * nothing, rather than "none" (T-1022).
 */
export function favouriteOf(row: GroupRow): GroupFavourite | null {
  if (row.favourite_team_id !== null) {
    return { type: 'team', id: row.favourite_team_id, name: row.favourite_team_name ?? '' };
  }
  if (row.favourite_competition_id !== null) {
    return {
      type: 'competition',
      id: row.favourite_competition_id,
      name: row.favourite_competition_name ?? '',
    };
  }
  return null;
}

/** One group row as every surface of the boundary shows it. */
export function groupSummary(row: GroupRow): GroupSummary {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    visibility: row.visibility as GroupVisibility,
    member_count: Number(row.member_count),
    created_at: row.created_at.toISOString(),
    language: row.language,
    favourite: favouriteOf(row),
  };
}
