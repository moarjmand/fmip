import type { MatchHeader, VenueSurface } from '@fmip/contracts';
import { formatNumber } from '@/i18n/format';
import { filled } from '@/lib/words';
import type { MatchWords } from '@/lib/words-server';
import { drawable } from '@/components/entity-image';
import { Pictured } from '@/components/lite-mode';
import { CARD, COVERAGE_KEY, MODULE_HEADING, TITLE } from '@/components/match-centre-cards';
import { MessageText } from '@/components/message-text';
import { CoverageBadge } from '@/components/ui/coverage-badge';

const SURFACE_KEY = {
  grass: 'matchCentre.venue.surface.grass',
  artificial: 'matchCentre.venue.surface.artificial',
  hybrid: 'matchCentre.venue.surface.hybrid',
} as const satisfies Record<VenueSurface, keyof MatchWords['m']>;

/**
 * The ground's card on the match page (T-1438, D-229): its picture from our
 * own origin, name and city, capacity, surface and address, with the
 * coverage of those facts beside the title. A fact the source has not given
 * is left out, never shown as zero; with none of them, one sentence says
 * whether the source has no description or it has not been fetched yet
 * (rule 3). Nothing without a ground, or without the card's facts attached.
 */
export function VenueCard({
  venue,
  locale,
  words,
}: {
  venue: MatchHeader['venue'];
  locale: string;
  words: MatchWords;
}) {
  if (venue === null || venue.details === undefined) return null;
  const m = words.m;
  const d = venue.details;
  const facts = [
    ...(d.capacity !== null
      ? [filled(m['matchCentre.venue.capacity'], { count: formatNumber(locale, d.capacity) })]
      : []),
    ...(d.surface !== null ? [m[SURFACE_KEY[d.surface]]] : []),
  ];
  return (
    <section className={CARD} data-testid="venue-card" data-coverage={d.coverage}>
      <h2 className={MODULE_HEADING}>
        <span className={TITLE}>
          <MessageText message={m['matchCentre.venue.title']} />
        </span>
        <CoverageBadge
          state={d.coverage}
          label={<MessageText message={m[COVERAGE_KEY[d.coverage]]} />}
        />
      </h2>
      {drawable(d.image) && (
        <Pictured>
          {/* A plain image, as `EntityImage`: our own origin, no optimiser. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={d.image.url}
            width={600}
            height={450}
            alt=""
            loading="lazy"
            decoding="async"
            className="aspect-[4/3] w-full rounded-tile bg-surface-raised object-cover"
            data-testid="venue-image"
          />
        </Pictured>
      )}
      <div className="flex flex-col gap-1">
        <p className="font-bold text-fg" dir="auto">
          {venue.name}
          {venue.city !== null && <span className="font-normal text-muted">, {venue.city}</span>}
        </p>
        {facts.length > 0 && (
          <ul
            className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted"
            data-testid="venue-facts"
          >
            {facts.map((fact, i) => (
              <li key={i}>
                <MessageText message={fact} />
              </li>
            ))}
          </ul>
        )}
        {d.address !== null && (
          <p className="text-sm text-muted" dir="auto" data-testid="venue-address">
            {d.address}
          </p>
        )}
        {d.coverage === 'not_supplied' || d.coverage === 'delayed' ? (
          <p className="text-sm text-muted" dir="auto">
            <MessageText
              message={
                m[
                  d.coverage === 'delayed'
                    ? 'matchCentre.venue.notYet'
                    : 'matchCentre.venue.notSupplied'
                ]
              }
            />
          </p>
        ) : null}
      </div>
    </section>
  );
}
