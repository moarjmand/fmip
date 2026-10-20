import Link from 'next/link';
import type { PlayerProviderSeasonLine, PlayerProviderSeasons } from '@fmip/contracts';
import { Coverage, Panel } from '@/components/competition-page';
import { Stamp } from '@/components/stamp';
import { Translated } from '@/components/translated';
import { inlineTargetClasses } from '@/components/ui';
import { formatNumber, localDigits } from '@/i18n/format';
import type { MessageKey } from '@/i18n/messages';
import { say } from '@/lib/competition';
import { hasKeeperFigures, sentOff, splitProviderLines, yearRuns } from '@/lib/player-provider';

/**
 * The player page's provider modules (T-1431, D-223): the season in every
 * competition as the provider counts it, and the career it lists. Both say
 * whose numbers they are and when they were fetched; a competition our own
 * record counts for this player is named, not repeated, because the record is
 * the authority there and the two are never shown as one (rule 3).
 */

/** "Fetched from API-Football 20 Oct 2026, 06:00", or nothing before the first answer. */
function Fetched({
  locale,
  timeZone,
  source,
  iso,
}: {
  locale: string;
  timeZone: string;
  source: string;
  iso: string | null;
}) {
  if (iso === null) return null;
  return (
    <p className="text-xs text-muted" data-testid="provider-fetched">
      {say(locale, 'playerPage.provider.fetched', { source })}{' '}
      <Stamp iso={iso} locale={locale} timeZone={timeZone} />
    </p>
  );
}

/** A figure the provider gave, or a dash for one it did not (explained under the table). */
function Cell({ locale, value }: { locale: string; value: number | null }) {
  return (
    <td className="py-2 ps-2 text-end" data-supplied={value !== null}>
      {value === null ? <span className="text-muted">–</span> : formatNumber(locale, value)}
    </td>
  );
}

const COLUMNS: readonly MessageKey[] = [
  'playerPage.col.apps',
  'playerPage.col.starts',
  'playerPage.col.minutes',
  'playerPage.col.goals',
  'playerPage.col.assists',
  'playerPage.col.yellow',
  'playerPage.col.red',
  'playerPage.col.rating',
];
const KEEPER_COLUMNS: readonly MessageKey[] = ['playerPage.col.saves', 'playerPage.col.conceded'];

function LineRow({
  line,
  locale,
  keeper,
}: {
  line: PlayerProviderSeasonLine;
  locale: string;
  keeper: boolean;
}) {
  return (
    <tr className="border-b border-default last:border-b-0" data-testid="provider-line">
      <td className="py-2 pe-2 text-muted">
        <Link
          href={`/${locale}/competition/${line.competition.id}`}
          className={inlineTargetClasses('hover:underline')}
        >
          {line.competition.short_name ?? line.competition.name}
        </Link>
      </td>
      <td className="py-2 pe-2">
        <Link
          href={`/${locale}/team/${line.team.id}`}
          className={inlineTargetClasses('hover:underline')}
        >
          {line.team.short_name ?? line.team.name}
        </Link>
      </td>
      <Cell locale={locale} value={line.appearances} />
      <Cell locale={locale} value={line.starts} />
      <Cell locale={locale} value={line.minutes} />
      <Cell locale={locale} value={line.goals} />
      <Cell locale={locale} value={line.assists} />
      <Cell locale={locale} value={line.yellow_cards} />
      <Cell locale={locale} value={sentOff(line)} />
      <Cell locale={locale} value={line.rating} />
      {keeper && <Cell locale={locale} value={line.saves} />}
      {keeper && <Cell locale={locale} value={line.goals_conceded} />}
    </tr>
  );
}

export function ProviderSeasonsPanel({
  data,
  locale,
  timeZone,
}: {
  data: PlayerProviderSeasons;
  locale: string;
  timeZone: string;
}) {
  const source = data.source_name;
  const seasons = data.seasons;
  const lines = seasons.data?.lines ?? [];
  const { shown, ours } = splitProviderLines(lines);
  const keeper = hasKeeperFigures(shown);
  const year = lines[0]?.season.year;
  const unlisted = seasons.data?.unlisted ?? 0;
  return (
    <Panel
      testId="provider-seasons"
      title={say(locale, 'playerPage.provider.seasons', { source })}
      aside={<Coverage locale={locale} state={seasons.coverage} />}
    >
      <p className="text-sm text-muted">
        {say(locale, 'playerPage.provider.seasonsNote', { source })}
      </p>
      {seasons.data === null ? (
        <p className="text-sm text-muted" data-testid="provider-seasons-empty">
          {say(locale, 'playerPage.provider.notAsked', { source })}
        </p>
      ) : (
        <>
          {year !== undefined && (
            <h3 className="text-sm font-bold">
              {say(locale, 'playerPage.provider.season', {
                year: localDigits(locale, String(year)),
              })}
            </h3>
          )}
          {shown.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[40rem] text-sm tabular-nums">
                <thead>
                  <tr className="border-b border-strong text-xs text-muted">
                    <th scope="col" className="py-1.5 pe-2 text-start font-bold">
                      <Translated locale={locale} message="competitionPage.title" />
                    </th>
                    <th scope="col" className="py-1.5 pe-2 text-start font-bold">
                      <Translated locale={locale} message="competitionPage.col.team" />
                    </th>
                    {[...COLUMNS, ...(keeper ? KEEPER_COLUMNS : [])].map((h) => (
                      <th key={h} scope="col" className="py-1.5 ps-2 text-end font-bold">
                        <Translated locale={locale} message={h} />
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {shown.map((line) => (
                    <LineRow
                      key={`${line.competition.id}-${line.team.id}`}
                      line={line}
                      locale={locale}
                      keeper={keeper}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-sm text-muted" data-testid="provider-seasons-none">
              {say(
                locale,
                lines.length === 0 ? 'playerPage.provider.noLines' : 'playerPage.provider.onlyOurs',
                { source },
              )}
            </p>
          )}
          {shown.length > 0 && ours.length > 0 && (
            <p className="text-sm text-muted" data-testid="provider-counted-by-us">
              {say(locale, 'playerPage.provider.countedByUs', {
                list: ours.join(say(locale, 'competitionPage.list.separator')),
              })}
            </p>
          )}
          {shown.length > 0 && (
            <p className="text-xs text-muted">
              {say(locale, 'playerPage.provider.dash', { source })}
            </p>
          )}
          {unlisted > 0 && (
            <p className="text-xs text-muted" data-testid="provider-unlisted">
              <Translated
                locale={locale}
                message="playerPage.provider.unlisted"
                count={unlisted}
                params={{ source }}
              />
            </p>
          )}
        </>
      )}
      <Fetched locale={locale} timeZone={timeZone} source={source} iso={seasons.last_updated_at} />
    </Panel>
  );
}

export function ProviderCareerPanel({
  data,
  locale,
  timeZone,
}: {
  data: PlayerProviderSeasons;
  locale: string;
  timeZone: string;
}) {
  const source = data.source_name;
  const career = data.career;
  const teams = career.data?.teams ?? [];
  const unlisted = career.data?.unlisted ?? 0;
  return (
    <Panel
      testId="provider-career"
      title={say(locale, 'playerPage.provider.career', { source })}
      aside={<Coverage locale={locale} state={career.coverage} />}
    >
      {career.data === null ? (
        <p className="text-sm text-muted" data-testid="provider-career-empty">
          {say(locale, 'playerPage.provider.notAsked', { source })}
        </p>
      ) : teams.length === 0 ? (
        <p className="text-sm text-muted" data-testid="provider-career-none">
          {say(locale, 'playerPage.provider.noCareer', { source })}
        </p>
      ) : (
        <>
          <p className="text-xs text-muted">
            {say(locale, 'playerPage.provider.careerNote', { source })}
          </p>
          <ul className="flex flex-col">
            {teams.map((entry) => (
              <li
                key={entry.team.id}
                className="flex flex-wrap items-baseline gap-x-3 border-b border-default py-2 text-sm last:border-b-0"
                data-testid="provider-career-team"
              >
                <Link
                  href={`/${locale}/team/${entry.team.id}`}
                  className={inlineTargetClasses('font-semibold hover:underline')}
                >
                  {entry.team.name}
                </Link>
                <span className="text-muted">
                  <bdi>
                    {yearRuns(locale, entry.season_years).join(
                      say(locale, 'competitionPage.list.separator'),
                    )}
                  </bdi>
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
      {unlisted > 0 && (
        <p className="text-xs text-muted" data-testid="provider-career-unlisted">
          <Translated
            locale={locale}
            message="playerPage.provider.unlisted"
            count={unlisted}
            params={{ source }}
          />
        </p>
      )}
      <Fetched locale={locale} timeZone={timeZone} source={source} iso={career.last_updated_at} />
    </Panel>
  );
}
