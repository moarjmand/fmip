/**
 * Data-quality checks over the stored feed (T-820, E82, D-097).
 *
 * Each check reads what ingestion has already stored -- never a new provider
 * request -- and names what contradicts itself. A finding is a question for a
 * person: nothing is corrected automatically.
 *
 * - `finished_without_score`: a finished match with no full-time score.
 * - `goals_disagree`: the goals in the timeline do not add up to the score.
 * - `live_overrun`: a match still live far past its expected length.
 * - `lineup_not_eleven`: one side's line-up does not have eleven starters.
 * - `fixture_mapped_twice`: one fixture carries two ids from one provider.
 * - `duplicate_fixture`: two fixtures of one season with the same home and
 *   away teams within three days -- one match stored twice.
 * - `table_disagrees`: the provider's table and the table computed from our
 *   results (D-038) disagree on how many matches a team has played.
 */
export type DataQualityCheck =
  | 'finished_without_score'
  | 'goals_disagree'
  | 'live_overrun'
  | 'lineup_not_eleven'
  | 'fixture_mapped_twice'
  | 'duplicate_fixture'
  | 'table_disagrees';

export const DATA_QUALITY_CHECKS: readonly DataQualityCheck[] = [
  'finished_without_score',
  'goals_disagree',
  'live_overrun',
  'lineup_not_eleven',
  'fixture_mapped_twice',
  'duplicate_fixture',
  'table_disagrees',
];
