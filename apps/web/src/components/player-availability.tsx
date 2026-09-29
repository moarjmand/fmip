import Link from 'next/link';
import type { PlayerAvailability } from '@fmip/contracts';
import { formatDateTime } from '@/i18n/format';
import { availabilityStale } from '@/lib/player';
import { Translated } from '@/components/translated';

/**
 * The player page's current availability (blueprint 5.3, T-1007, D-127):
 * the team's next scheduled match and what the feed's absence list says about
 * the player for it. Nothing is said before the feed was asked; once asked, a
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
    <section className="flex flex-col gap-2" data-testid="player-availability" data-state={state}>
      <h2 className="text-lg font-semibold">
        <Translated locale={locale} message="player.availability.title" />
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
            <p className="text-sm" data-testid="player-availability-fixture">
              <Translated locale={locale} message="player.availability.nextMatch" />
              {': '}
              <Link href={`/${locale}/match/${fixture.id}`} className="underline">
                {team.name}
                {fixture.opponent === null ? '' : ` – ${fixture.opponent.name}`}
              </Link>
              {' · '}
              <time dateTime={fixture.kickoff_at}>
                {formatDateTime(locale, fixture.kickoff_at, timeZone)}
              </time>
            </p>
          )}
        </>
      )}
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
                  <Translated
                    locale={locale}
                    message={`player.availability.kind.${listing.data.kind}`}
                  />
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
