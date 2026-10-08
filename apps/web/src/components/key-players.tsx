import Link from 'next/link';
import type { Covered, KeyPlayers, KeyPlayersSide } from '@fmip/contracts';
import { formatNumber } from '@/i18n/format';
import {
  ABSENCE_STATE_KEY,
  absenceState,
  availabilityLine,
  coverageLine,
  figuresLine,
  positionLabel,
  ruleNote,
} from '@/lib/key-players';
import { DEFAULT_LOCALE, isLocale } from '@/i18n/locales';
import { message } from '@/i18n/messages';
import { formatStamp } from '@/lib/scores';
import { FilledMessage } from '@/components/filled-message';
import { COVERAGE_KEY } from '@/components/score-card';
import { Translated } from '@/components/translated';
import { Notice } from '@/components/ui';

/**
 * The match centre's key players (T-841, blueprint 4.2): each side's most
 * used players in this competition's season before the match, their minutes,
 * goals and assists, and what the provider said about this match. "Key" is
 * the rule in the footnote -- a count, not a judgement -- and no rating is
 * shown. A doubt reads as a doubt; with the provider never asked, nothing is
 * claimed. Sides stack below `sm`.
 */
export function KeyPlayersPanel({
  players,
  home,
  away,
  locale,
  timeZone,
  now = Date.now(),
}: {
  /** Null when the API could not be reached. */
  players: KeyPlayers | null;
  home: string;
  away: string;
  locale: string;
  timeZone: string;
  /** The clock the "asked" time is dated against (T-1371); now unless a test fixes it. */
  now?: number;
}) {
  if (players === null) {
    return (
      <section className="flex flex-col gap-2" data-testid="key-players" data-state="unreachable">
        <h2 className="text-lg font-semibold">
          <Translated locale={locale} message="matchCentre.keyPlayers.title" />
        </h2>
        <Notice tone="danger">
          <Translated locale={locale} message="matchCentre.keyPlayers.unreachable" />
        </Notice>
      </section>
    );
  }

  const absences = absenceState(players);
  return (
    <section className="flex flex-col gap-3" data-testid="key-players" data-state="loaded">
      <h2 className="text-lg font-semibold">
        <Translated locale={locale} message="matchCentre.keyPlayers.title" />
      </h2>
      <div className="grid grid-cols-1 gap-4 text-sm sm:grid-cols-2">
        <Side name={home} module={players.home} locale={locale} />
        <Side name={away} module={players.away} locale={locale} />
      </div>
      <p
        dir="auto"
        className="text-xs text-muted"
        data-testid="key-players-availability"
        data-state={absences.kind}
      >
        {absences.kind === 'asked' ? (
          <FilledMessage
            message={message(
              isLocale(locale) ? locale : DEFAULT_LOCALE,
              'matchCentre.keyPlayers.asked',
            )}
            params={{
              time: (
                <time dateTime={absences.at}>
                  {formatStamp(locale, absences.at, timeZone, now)}
                </time>
              ),
            }}
          />
        ) : (
          <Translated locale={locale} message={ABSENCE_STATE_KEY[absences.kind]} />
        )}
      </p>
      <p dir="auto" className="text-xs text-muted" data-testid="key-players-rule">
        {ruleNote(players.competition.name, players.season.label, locale)}
      </p>
    </section>
  );
}

function Side({
  name,
  module,
  locale,
}: {
  name: string;
  module: Covered<KeyPlayersSide>;
  locale: string;
}) {
  const side = module.data;
  return (
    <div
      className="flex min-w-0 flex-col gap-2"
      data-testid="key-players-side"
      data-coverage={module.coverage}
    >
      <h3 className="flex flex-wrap items-baseline gap-x-2 font-medium">
        <bdi>{name}</bdi>
        <span dir="auto" className="text-xs font-normal uppercase text-muted">
          <Translated locale={locale} message={COVERAGE_KEY[module.coverage]} />
        </span>
      </h3>
      {side === null ? (
        <p dir="auto" className="text-muted">
          <Translated
            locale={locale}
            message={
              module.coverage === 'delayed'
                ? 'matchCentre.keyPlayers.delayed'
                : 'matchCentre.keyPlayers.noFigures'
            }
          />
        </p>
      ) : (
        <>
          {side.players.length > 0 && (
            <ol className="flex flex-col gap-2">
              {side.players.map((p) => {
                const position = positionLabel(p.position, locale);
                const availability = availabilityLine(p, locale);
                return (
                  <li key={p.id} className="flex flex-col" data-testid="key-player">
                    <span className="break-words">
                      <Link href={`/${locale}/player/${p.id}`} className="underline">
                        {p.name}
                      </Link>
                      {position !== null && <span className="text-muted"> · {position}</span>}
                    </span>
                    <span className="text-muted">
                      {figuresLine(p, (n) => formatNumber(locale, n), locale)}
                    </span>
                    {availability !== null && (
                      <span
                        dir="auto"
                        className={
                          p.availability?.status === 'not_listed' ? 'text-muted' : 'font-medium'
                        }
                        data-testid="key-player-availability"
                        data-status={p.availability?.status}
                      >
                        {availability}
                      </span>
                    )}
                  </li>
                );
              })}
            </ol>
          )}
          <p dir="auto" className="text-xs text-muted">
            {coverageLine(side, locale)}
          </p>
        </>
      )}
    </div>
  );
}
