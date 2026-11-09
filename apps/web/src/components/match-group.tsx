import type { ScoresResponse } from '@fmip/contracts';
import { EntityImage } from '@/components/entity-image';
import Link from '@/components/ui/link';

/**
 * A day's competition block, as the matches page draws it (T-1496, T-1757;
 * shared since T-1792, D-394, so the Watch page draws the same block): one
 * card per competition, its heading sticking under the site header while
 * the rows scroll under it, the rows `ScoreCard`s in a container-sized list.
 * Server-component safe; `LiveScores` uses it in the browser.
 */

/**
 * A block's heading stays at the top of the screen, under the site header
 * (`match-group-head` in globals.css), while its matches scroll under it (T-605),
 * on the block's own surface so nothing shows through. 44px (T-1757,
 * D-374): the name and the "Updated" stamp on one line, a longer stamp
 * whole on a second.
 */
export const GROUP_HEADING =
  'match-group-head z-10 flex min-h-11 min-w-0 flex-wrap items-center gap-x-2.5 border-b border-default bg-surface px-4 text-sm font-extrabold';
/**
 * One card per block (T-1496, the canvas's competition groups), a hairline
 * between rows. `overflow-clip`, not `hidden`, so the sticky heading still sticks.
 */
export const GROUP_BLOCK =
  'flex flex-col overflow-clip rounded-xl border border-default bg-surface';
/** The rows' columns follow the list's width, not the screen's (T-1757). */
export const GROUP_LIST = '@container flex flex-col divide-y divide-default';

type Group = ScoresResponse['groups'][number];

/** The competition's name and logo, linking to its page, and its country beside it. */
export function GroupTitle({
  locale,
  competition,
  country,
}: {
  locale: string;
  competition: Group['competition'];
  country: Group['country'];
}) {
  return (
    <h2 className="flex min-w-0 flex-wrap items-center gap-x-2.5">
      <Link
        href={`/${locale}/competition/${competition.id}`}
        className="flex min-h-11 min-w-0 items-center gap-2.5 hover:underline"
        data-testid="competition-link"
      >
        <EntityImage media={competition.logo} kind="logo" name={competition.name} size={20} />
        <bdi className="truncate">{competition.name}</bdi>
      </Link>
      {country !== null && (
        <span className="shrink-0 text-xs font-medium text-muted">{country.name}</span>
      )}
    </h2>
  );
}
