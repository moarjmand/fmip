import Link from 'next/link';
import type { KnockoutBracket as Bracket } from '@fmip/contracts';
import { Translated } from '@/components/translated';
import { formatFixtureDate, say, statusSuffix } from '@/lib/competition';
import { ROUND_LABEL, legLabel, legLine, roundNote, tieOutcome } from '@/lib/bracket';

/**
 * The knockout bracket on the competition page (blueprint 5.1, T-630): the
 * rounds in the order they are played, each tie with its legs and, only once
 * the API has decided it, the aggregate and who went through. A round nobody
 * has drawn is a sentence, never a row of placeholder teams. Rounds stack
 * one under another, so a phone and a right-to-left reading need nothing
 * extra; the ties sit two abreast from `sm` up.
 */
export function KnockoutBracket({
  bracket,
  locale,
  timeZone,
}: {
  bracket: Bracket;
  locale: string;
  timeZone: string;
}) {
  return (
    <section className="flex flex-col gap-4" data-testid="bracket">
      <h2 className="text-lg font-semibold">
        <Translated locale={locale} message="competitionPage.bracket.title" />
      </h2>
      <ol className="flex flex-col gap-6">
        {bracket.rounds.map((round) => {
          const note = roundNote(round);
          return (
            <li
              key={round.key}
              className="flex flex-col gap-2 border-s-2 border-s-default ps-3"
              data-testid="bracket-round"
              data-state={round.state}
            >
              <h3 className="font-semibold">
                {ROUND_LABEL[round.key]}
                <span className="ms-2 text-xs font-normal text-muted">
                  <Translated
                    locale={locale}
                    message={
                      round.legs === 2
                        ? 'competitionPage.bracket.twoLegs'
                        : 'competitionPage.bracket.oneMatch'
                    }
                  />
                </span>
              </h3>
              {round.ties.length > 0 && (
                <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {round.ties.map((tie) => (
                    <li
                      key={tie.legs[0]!.fixture_id}
                      className="flex min-w-0 flex-col gap-1 rounded border border-default p-3 text-sm"
                      data-testid="bracket-tie"
                    >
                      <p className="font-medium break-words">
                        <Link href={`/${locale}/team/${tie.teams[0].id}`} className="underline">
                          {tie.teams[0].name}
                        </Link>
                        <span className="mx-1 text-muted">{say(locale, 'competitionPage.v')}</span>
                        <Link href={`/${locale}/team/${tie.teams[1].id}`} className="underline">
                          {tie.teams[1].name}
                        </Link>
                      </p>
                      <ul className="flex flex-col gap-0.5">
                        {tie.legs.map((leg) => (
                          <li key={leg.fixture_id} className="flex flex-wrap gap-x-2">
                            <span className="text-muted">{legLabel(leg, round.legs)}</span>
                            <Link href={`/${locale}/match/${leg.fixture_id}`} className="underline">
                              {legLine(leg)}
                            </Link>
                            <span className="text-xs text-muted">
                              <time dateTime={leg.kickoff_at}>
                                {formatFixtureDate(locale, leg.kickoff_at, timeZone)}
                              </time>
                              {statusSuffix(locale, leg.status)}
                            </span>
                          </li>
                        ))}
                      </ul>
                      <p
                        className={
                          tie.winner === null ? 'text-xs text-muted' : 'text-xs font-semibold'
                        }
                        data-testid="bracket-outcome"
                      >
                        {tieOutcome(tie, round.legs)}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
              {note !== null && (
                <p className="text-sm text-muted" data-testid="bracket-note">
                  {note}
                </p>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
