import Link from '@/components/ui/link';
import type { PlayerAvailability } from '@fmip/contracts';
import { formatDateTime } from '@/i18n/format';
import { availabilityStale } from '@/lib/player';
import { Translated } from '@/components/translated';
import { CoverageBadge } from '@/components/ui';
import { COVERAGE_KEY, say } from '@/lib/competition';

const KIND_MESSAGE = {
  injury: 'player.availability.kind.injury',
  suspension: 'player.availability.kind.suspension',
  illness: 'player.availability.kind.illness',
  other: 'player.availability.kind.other',
} as const;

/**
 * The player page's next match and his availability for it (blueprint 5.3,
 * T-1007, D-127; the Stadiomind card, T-1500): the team's next scheduled
 * match, when it kicks off, and what the feed's absence list says about the
 * player for it. Nothing is said before the feed was asked; once asked, a
 * player it does not list is "not listed", never "fit" (T-103), and the time
 * of the ask is always shown, with a warning once it is old (rule 4).
 */
export function PlayerAvailabilitySection({
  locale,
  timeZone,
  availability,
  now,
}: {
  locale: string;
  timeZone: string;
  availability: PlayerAvailability;
  now: Date;
}) {
  const { team, fixture, listing, reason } = availability;
  const state = reason ?? listing.data?.status ?? 'not_listed';
  return (
    <section
      aria-labelledby="player-availability-heading"
      className="flex min-w-0 flex-col gap-2 rounded-card border border-default bg-surface p-4"
      data-testid="player-availability"
      data-state={state}
    >
      <h2 id="player-availability-heading" className="text-sm font-extrabold">
        <Translated locale={locale} message="player.availability.nextMatch" />
      </h2>
      {team === null ? (
        <p className="text-sm text-muted">
          <Translated locale={locale} message="player.availability.noTeam" />
        </p>
      ) : (
        <>
          {team.basis === 'lineup' && (
            <p className="text-xs text-muted">
              <Translated locale={locale} message="player.availability.fromLineup" />
            </p>
          )}
          {fixture === null ? (
            <p className="text-sm text-muted">
              <Link href={`/${locale}/team/${team.id}`} className="underline">
                {team.name}
              </Link>
              {' · '}
              <Translated locale={locale} message="player.availability.noNextMatch" />
            </p>
          ) : (
            <p className="flex flex-col gap-0.5" data-testid="player-availability-fixture">
              <Link
                href={`/${locale}/match/${fixture.id}`}
                className="text-sm font-bold text-fg hover:underline focus-visible:underline"
              >
                <bdi>{team.name}</bdi>
                {fixture.opponent === null ? (
                  ''
                ) : (
                  <>
                    {' – '}
                    <bdi>{fixture.opponent.name}</bdi>
                  </>
                )}
              </Link>
              <time dateTime={fixture.kickoff_at} className="text-sm text-muted">
                {formatDateTime(locale, fixture.kickoff_at, timeZone)}
              </time>
            </p>
          )}
        </>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-default pt-2.5">
        <h3 className="text-xs font-bold text-caption">
          <Translated locale={locale} message="player.availability.title" />
        </h3>
        <CoverageBadge
          state={listing.coverage}
          label={say(locale, COVERAGE_KEY[listing.coverage])}
        />
      </div>
      {reason === 'not_asked' && (
        <p className="text-sm text-muted">
          <Translated locale={locale} message="player.availability.notAsked" />
        </p>
      )}
      {listing.data !== null && (
        <p className="text-sm" data-testid="player-availability-listing">
          {listing.data.status === 'not_listed' ? (
            <Translated locale={locale} message="player.availability.notListed" />
          ) : (
            <span className={listing.data.status === 'out' ? 'text-danger' : 'text-warning'}>
              <Translated
                locale={locale}
                message={
                  listing.data.status === 'out'
                    ? 'player.availability.out'
                    : 'player.availability.doubtful'
                }
              />
              {listing.data.kind !== null && (
                <>
                  {' · '}
                  <Translated locale={locale} message={KIND_MESSAGE[listing.data.kind]} />
                </>
              )}
              {listing.data.reason !== null && ` · ${listing.data.reason}`}
            </span>
          )}
        </p>
      )}
      {listing.last_updated_at !== null && (
        <p className="text-xs text-muted" data-testid="player-availability-freshness">
          <Translated locale={locale} message="player.availability.asked" />{' '}
          <time dateTime={listing.last_updated_at}>
            {formatDateTime(locale, listing.last_updated_at, timeZone)}
          </time>
          {availabilityStale(listing.last_updated_at, now) && (
            <>
              {' · '}
              <Translated locale={locale} message="player.availability.stale" />
            </>
          )}
        </p>
      )}
    </section>
  );
}
