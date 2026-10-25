import type { CSSProperties, ReactNode } from 'react';
import { cx } from '@/components/ui/cx';
import { bandColours } from '@/lib/band-colour';

/**
 * The top band of a club or a player page in the Hybrid data mode (T-1386,
 * D-204). The maintainer's rule is that a club's colour may appear here and
 * nowhere else on the page. With no colour known the band is the brand's, as
 * on the competition page (D-203): the theme's surface with a green rule
 * along its top and a green bar under the open tab, so it follows Day and
 * Night. With one (T-1418, D-218: `team.colour`, ours, never a provider
 * field) the identity block above the tabs is filled with it, and every text
 * on it is white or the ink at 4.5:1 or more (`bandColours`, darkened when
 * neither reaches it). Below the band, tabs, links and buttons are brand
 * green whatever the club.
 */
export function EntityBand({
  testId,
  media,
  eyebrow,
  title,
  details,
  actions,
  tabs,
  colour,
}: {
  testId: string;
  /** The crest or the photo, in its frame. */
  media: ReactNode;
  /** One line above the name: kind, country, position and shirt. */
  eyebrow: ReactNode;
  /** The name, already in the reader's script. */
  title: string;
  /** Under the name: the canonical name, the ground, the identity line. */
  details: ReactNode;
  /** Follow and compare. */
  actions: ReactNode;
  tabs: ReactNode;
  /** The club's colour, `#rrggbb`, when one is known (T-1418). */
  colour?: string | null;
}) {
  const paint = colour === undefined || colour === null ? null : bandColours(colour);
  // Every text token on the fill is the one text colour that reaches 4.5:1 on it.
  const filled: CSSProperties | undefined =
    paint === null
      ? undefined
      : ({
          backgroundColor: paint.fill,
          '--token-text': paint.text,
          '--token-text-muted': paint.text,
          '--token-caption': paint.text,
        } as CSSProperties);
  return (
    <div className="border-b border-default bg-surface" data-testid={testId}>
      {paint === null && <div aria-hidden="true" className="h-1 bg-accent" />}
      <div style={filled} data-band={paint === null ? 'brand' : 'club'}>
        <div className="page-frame">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-4 pt-6 pb-4 text-fg md:pt-7">
            {media}
            <div className="min-w-0 flex-[1_1_20rem]">
              <p
                className="text-xs font-bold text-muted uppercase ltr:tracking-wider"
                data-testid="band-eyebrow"
              >
                {eyebrow}
              </p>
              <h1
                className="mt-1.5 font-sans text-display-2 font-black font-stretch-condensed break-words uppercase md:text-display-3 lg:text-display-4 [:root:is(:lang(fa),:lang(ar))_&]:text-display-1 md:[:root:is(:lang(fa),:lang(ar))_&]:text-display-2"
                data-testid="title"
              >
                {title}
              </h1>
              {details}
            </div>
            <div className="flex flex-col items-start gap-2">{actions}</div>
          </div>
        </div>
      </div>
      <div className={cx('page-frame', paint !== null && 'pt-1')}>{tabs}</div>
    </div>
  );
}

/** A figure in a tile (T-1386): the condensed display weight over what it counts. */
export function StatTile({
  value,
  label,
  testId,
  note,
}: {
  value: ReactNode;
  label: ReactNode;
  testId: string;
  /** Under the label: what the figure covers, when it is not the whole. */
  note?: ReactNode;
}) {
  return (
    <div className="min-w-0 rounded-tile bg-surface-raised p-3.5" data-testid={testId}>
      <b className="block font-sans text-display-1 leading-none font-black font-stretch-condensed tabular-nums">
        {value}
      </b>
      <span className="text-sm font-semibold text-muted">{label}</span>
      {note !== undefined && note !== null && (
        <span className="block text-xs text-muted">{note}</span>
      )}
    </div>
  );
}

/** A figure we do not hold (T-1386): a dashed tile with its badge and name, never a zero. */
export function MissingTile({
  badge,
  label,
  testId,
}: {
  badge: ReactNode;
  label: ReactNode;
  testId: string;
}) {
  return (
    <div
      className="flex min-w-0 flex-col items-start gap-1.5 rounded-tile border border-dashed border-strong p-3.5"
      data-testid={testId}
      data-coverage="not_supplied"
    >
      {badge}
      <span className="text-sm font-semibold text-muted">{label}</span>
    </div>
  );
}

/** The tiles' grid: as many columns as fit at 9.5rem, one on the narrowest phone. */
export function TileGrid({ children }: { children: ReactNode }) {
  return (
    <div className="grid grid-cols-[repeat(auto-fit,minmax(min(9.5rem,100%),1fr))] gap-2.5">
      {children}
    </div>
  );
}
