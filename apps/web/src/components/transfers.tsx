import Link from '@/components/ui/link';
import type { PlayerTransfers, TeamTransfers, TransferClub, TransferLine } from '@fmip/contracts';
import { Coverage, Panel } from '@/components/competition-page';
import { Stamp } from '@/components/stamp';
import { Translated } from '@/components/translated';
import { inlineTargetClasses } from '@/components/ui';
import { formatDate, formatNumber } from '@/i18n/format';
import type { MessageKey } from '@/i18n/messages';
import { say } from '@/lib/competition';
import { emptyTransfersKey, namesUnheld, transferDay, transferType } from '@/lib/transfers';

/**
 * The club page's arrivals and departures and the player page's moves, as the
 * provider lists them (T-1440, D-231). Each says whose list it is and when it
 * was fetched. A club or player we hold links to its page under our name; one
 * we do not hold is the provider's name in plain text, never a link (rule 1).
 */

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
    <p className="text-xs text-muted" data-testid="transfers-fetched">
      {say(locale, 'transfers.fetched', { source })}{' '}
      <Stamp iso={iso} locale={locale} timeZone={timeZone} />
    </p>
  );
}

/** A club: a link to ours, the provider's name as text for one we do not hold, or "no club". */
function Club({ locale, club }: { locale: string; club: TransferClub | null }) {
  if (club === null) {
    return (
      <span className="text-muted" data-testid="transfer-no-club">
        <Translated locale={locale} message="transfers.noClub" />
      </span>
    );
  }
  if (club.id === null) {
    return <bdi data-testid="transfer-unheld">{club.name}</bdi>;
  }
  return (
    <Link href={`/${locale}/team/${club.id}`} className={inlineTargetClasses('hover:underline')}>
      <bdi>{club.name}</bdi>
    </Link>
  );
}

function Player({ locale, line }: { locale: string; line: TransferLine }) {
  if (line.player.id === null) return <bdi data-testid="transfer-unheld">{line.player.name}</bdi>;
  return (
    <Link
      href={`/${locale}/player/${line.player.id}`}
      className={inlineTargetClasses('font-semibold hover:underline')}
    >
      <bdi>{line.player.name}</bdi>
    </Link>
  );
}

function Type({ locale, line }: { locale: string; line: TransferLine }) {
  const type = transferType(line);
  return 'fee' in type ? (
    <bdi dir="ltr" data-testid="transfer-fee">
      {type.fee}
    </bdi>
  ) : (
    <Translated locale={locale} message={type.key} />
  );
}

function Day({ locale, line }: { locale: string; line: TransferLine }) {
  return (
    <time dateTime={line.date}>
      {formatDate(locale, transferDay(line), 'UTC', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      })}
    </time>
  );
}

type Column = 'player' | 'from' | 'to';

/** A table of moves, newest first: the day, the columns asked for, and the type. */
function MovesTable({
  locale,
  lines,
  columns,
  testId,
}: {
  locale: string;
  lines: TransferLine[];
  columns: Column[];
  testId: string;
}) {
  const heads: Record<Column, MessageKey> = {
    player: 'transfers.col.player',
    from: 'transfers.col.from',
    to: 'transfers.col.to',
  };
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm" data-testid={testId}>
        <thead>
          <tr className="border-b border-strong text-xs text-muted">
            <th scope="col" className="py-1.5 pe-2 text-start font-bold">
              <Translated locale={locale} message="transfers.col.date" />
            </th>
            {columns.map((c) => (
              <th key={c} scope="col" className="py-1.5 pe-2 text-start font-bold">
                <Translated locale={locale} message={heads[c]} />
              </th>
            ))}
            <th scope="col" className="py-1.5 text-start font-bold">
              <Translated locale={locale} message="transfers.col.type" />
            </th>
          </tr>
        </thead>
        <tbody>
          {lines.map((line, index) => (
            <tr
              key={`${line.date}-${index}`}
              className="border-b border-default last:border-b-0"
              data-testid="transfer-line"
              data-kind={line.kind}
            >
              <td className="whitespace-nowrap py-2 pe-2 text-muted tabular-nums">
                <Day locale={locale} line={line} />
              </td>
              {columns.map((c) => (
                <td key={c} className="py-2 pe-2">
                  {c === 'player' ? (
                    <Player locale={locale} line={line} />
                  ) : (
                    <Club locale={locale} club={c === 'from' ? line.from : line.to} />
                  )}
                </td>
              ))}
              <td className="py-2">
                <Type locale={locale} line={line} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** "Showing the latest 25 of 340." when a list was cut, else nothing. */
function Shown({ locale, shown, total }: { locale: string; shown: number; total: number }) {
  if (total <= shown) return null;
  return (
    <p className="text-xs text-muted" data-testid="transfers-shown">
      {say(locale, 'transfers.shown', {
        shown: formatNumber(locale, shown),
        total: formatNumber(locale, total),
      })}
    </p>
  );
}

export function TeamTransfersPanel({
  data,
  locale,
  timeZone,
}: {
  data: TeamTransfers;
  locale: string;
  timeZone: string;
}) {
  const source = data.source_name;
  const covered = data.transfers;
  const moves = covered.data;
  return (
    <Panel
      testId="team-transfers"
      title={say(locale, 'transfers.title', { source })}
      aside={<Coverage locale={locale} state={covered.coverage} />}
    >
      {moves === null ? (
        <p className="text-sm text-muted" data-testid="team-transfers-empty">
          {say(locale, emptyTransfersKey(covered.last_updated_at, 'team'), { source })}
        </p>
      ) : (
        <>
          <p className="text-sm text-muted">{say(locale, 'transfers.note', { source })}</p>
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
            <div className="flex min-w-0 flex-col gap-2" data-testid="team-arrivals">
              <h3 className="text-sm font-bold">
                <Translated locale={locale} message="transfers.arrivals" />
              </h3>
              {moves.arrivals.length === 0 ? (
                <p className="text-sm text-muted">
                  <Translated locale={locale} message="transfers.noArrivals" />
                </p>
              ) : (
                <MovesTable
                  locale={locale}
                  lines={moves.arrivals}
                  columns={['player', 'from']}
                  testId="team-arrivals-table"
                />
              )}
              <Shown locale={locale} shown={moves.arrivals.length} total={moves.arrivals_total} />
            </div>
            <div className="flex min-w-0 flex-col gap-2" data-testid="team-departures">
              <h3 className="text-sm font-bold">
                <Translated locale={locale} message="transfers.departures" />
              </h3>
              {moves.departures.length === 0 ? (
                <p className="text-sm text-muted">
                  <Translated locale={locale} message="transfers.noDepartures" />
                </p>
              ) : (
                <MovesTable
                  locale={locale}
                  lines={moves.departures}
                  columns={['player', 'to']}
                  testId="team-departures-table"
                />
              )}
              <Shown
                locale={locale}
                shown={moves.departures.length}
                total={moves.departures_total}
              />
            </div>
          </div>
          {namesUnheld([...moves.arrivals, ...moves.departures]) && (
            <p className="text-xs text-muted" data-testid="transfers-unheld-note">
              {say(locale, 'transfers.unheld', { source })}
            </p>
          )}
        </>
      )}
      <Fetched locale={locale} timeZone={timeZone} source={source} iso={covered.last_updated_at} />
    </Panel>
  );
}

export function PlayerTransfersPanel({
  data,
  locale,
  timeZone,
}: {
  data: PlayerTransfers;
  locale: string;
  timeZone: string;
}) {
  const source = data.source_name;
  const covered = data.transfers;
  const lines = covered.data?.lines ?? null;
  return (
    <Panel
      testId="player-transfers"
      title={say(locale, 'transfers.title', { source })}
      aside={<Coverage locale={locale} state={covered.coverage} />}
    >
      {lines === null ? (
        <p className="text-sm text-muted" data-testid="player-transfers-empty">
          {say(locale, emptyTransfersKey(covered.last_updated_at, 'player'), { source })}
        </p>
      ) : (
        <>
          {covered.coverage === 'limited' && (
            <p className="text-sm text-muted" data-testid="player-transfers-limited">
              {say(locale, 'transfers.player.limited', { source })}
            </p>
          )}
          <MovesTable
            locale={locale}
            lines={lines}
            columns={['from', 'to']}
            testId="player-transfers-table"
          />
          {namesUnheld(lines) && (
            <p className="text-xs text-muted" data-testid="transfers-unheld-note">
              {say(locale, 'transfers.unheld', { source })}
            </p>
          )}
        </>
      )}
      <Fetched locale={locale} timeZone={timeZone} source={source} iso={covered.last_updated_at} />
    </Panel>
  );
}
