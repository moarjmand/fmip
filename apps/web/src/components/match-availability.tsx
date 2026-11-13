import type {
  AbsenceReasonCode,
  MatchAbsence,
  MatchAbsenceGap,
  MatchCentre,
} from '@fmip/contracts';
import { AVAILABILITY_STALE_AFTER_MS } from '@fmip/contracts';
import { formatNumber } from '@/i18n/format';
import { freshnessStamp } from '@/lib/scores';
import { filled } from '@/lib/words';
import { listName } from '@/lib/person-name';
import type { MatchWords } from '@/lib/words-server';
import Link from '@/components/ui/link';
import { Module } from '@/components/match-centre-cards';
import { MessageText } from '@/components/message-text';
import { CoverageGlyph } from '@/components/ui/coverage-badge';

/**
 * Who will or may miss the match (T-103, T-1626, T-1746), drawn on the
 * server and handed to the match centre as its `availability` slot
 * (T-1810, D-409): the absences are a pre-match answer and do not move in
 * play, so none of this is in the page's JavaScript and the stream does
 * not draw it again (D-409 point 1). When the feed was asked is an absolute
 * time ("asked at 14:05"), so the line stays true on a page left open; its
 * "may be out of date" is judged on the page's clock when it is drawn.
 *
 * No directive: a server module. Its words still come from the page's
 * `MatchWords`, as they did in the client view.
 */

type Key = keyof MatchWords['m'];

/** Why the absence list is empty (T-1364): each reason its own sentence. */
const ABSENCE_GAP_KEY = {
  not_covered: 'matchCentre.absencesNotCovered',
  not_yet: 'matchCentre.absencesNotYet',
  not_asked: 'matchCentre.moduleNotSupplied',
} as const satisfies Record<MatchAbsenceGap, Key>;

/**
 * An absence's reason in our words (T-1601, T-1626), never the feed's
 * English: the key is the code under one prefix. Written as a template and
 * not a table of fifty lines, which the page's JavaScript would carry
 * (T-1746); the type still refuses a code the catalogue has no words for.
 */
const absenceReasonWords = (code: AbsenceReasonCode): Key => `matchCentre.absenceReason.${code}`;

/** An absence's broad kind, when its reason is not one we can name. */
const ABSENCE_KIND_KEY = {
  injury: 'player.availability.kind.injury',
  suspension: 'player.availability.kind.suspension',
  illness: 'player.availability.kind.illness',
  other: 'player.availability.kind.other',
} as const satisfies Record<NonNullable<MatchAbsence['kind']>, Key>;

/** The order a side's absences are read in: who is out, then who may be. */
const ABSENCE_KIND_ORDER = ['suspension', 'injury', 'illness', 'other'] as const;

/**
 * One side's absences in reading order (T-1626): out before doubtful, then
 * suspended, injured, ill and the rest, then by name. Pure.
 */
export function absenceOrder(absences: MatchAbsence[]): MatchAbsence[] {
  const kind = (a: MatchAbsence) =>
    a.kind === null ? ABSENCE_KIND_ORDER.length : ABSENCE_KIND_ORDER.indexOf(a.kind);
  return [...absences].sort(
    (a, b) =>
      Number(a.status === 'doubtful') - Number(b.status === 'doubtful') ||
      kind(a) - kind(b) ||
      a.name.localeCompare(b.name),
  );
}

/**
 * The reason a reader sees (T-1626): ours from `reason_code`, else the broad
 * kind, else -- on an English page only -- the feed's own words; never the
 * feed's English on a page in another language (T-1601).
 */
export function absenceReasonKey(a: MatchAbsence): Key | null {
  if (a.reason_code !== undefined && a.reason_code !== null)
    return absenceReasonWords(a.reason_code);
  return a.kind === null ? null : ABSENCE_KIND_KEY[a.kind];
}

/** One group of a side's absences: who, by status and by why (T-1746). */
export interface AbsenceGroup {
  status: MatchAbsence['status'];
  /** The group's reason in our words; `null` when the feed gave none we can name. */
  reason: Key | null;
  /** Closed whole behind "Show N names": a selection choice, not an injury. */
  folded: boolean;
  absences: MatchAbsence[];
}

/** How many of a group stand open before "Show N more". */
export const ABSENCES_SHOWN = 4;

/** A reason code that says no more than its broad kind does. */
const GENERIC_REASON = new Set<AbsenceReasonCode>(['injury', 'suspended', 'illness']);

/**
 * One side's absences grouped by status and by why (T-1746, D-367; board
 * P2-5), in reading order (`absenceOrder`): an injury, a suspension or an
 * illness by its broad kind, so "Out · Injury (7)" holds the knee and the
 * calf alike; every other reason by its own code, so "Not in the squad" is
 * its own group and never weighs like an injury. Pure.
 */
export function absenceGroups(absences: MatchAbsence[]): AbsenceGroup[] {
  const groups = new Map<string, AbsenceGroup>();
  for (const a of absenceOrder(absences)) {
    const broad = a.kind !== null && a.kind !== 'other';
    const by = broad ? a.kind : (a.reason_code ?? a.kind ?? 'none');
    const key = `${a.status}:${by}`;
    const group = groups.get(key) ?? {
      status: a.status,
      reason: a.kind !== null && broad ? ABSENCE_KIND_KEY[a.kind] : absenceReasonKey(a),
      folded: !broad && a.reason_code === 'off_roster',
      absences: [],
    };
    group.absences.push(a);
    groups.set(key, group);
  }
  return [...groups.values()];
}

/**
 * What a row adds to its group's reason: the specific one ("Knee injury"
 * under "Injury"), nothing when it says the same.
 */
function rowReasonKey(a: MatchAbsence, group: AbsenceGroup): Key | null {
  const key = absenceReasonKey(a);
  if (key === null || key === group.reason) return null;
  return a.reason_code != null && GENERIC_REASON.has(a.reason_code) ? null : key;
}

/**
 * Who will or may miss the match (T-103), each side's list grouped by status
 * and by why with a count -- "Out · Injury (7)", "Out · Not in the squad
 * (5)" -- the status an icon and a word; a long group shows its first four
 * and folds the rest behind a native `<details>` ("Show 3 more"), and the
 * squad-selection group is closed whole ("Show 5 names"). No script. When
 * the feed was asked stands under the list, as before (rule 4).
 */
export function MatchAvailability({
  centre,
  locale,
  timeZone,
  now,
  words,
}: {
  centre: MatchCentre;
  locale: string;
  timeZone: string;
  now: number | undefined;
  words: MatchWords;
}) {
  const m = words.m;
  const f = centre.fixture;
  const asked = centre.availability.last_updated_at;
  // An absence answer before kick-off is re-asked every three hours (D-127).
  const askedStamp =
    asked === null
      ? null
      : freshnessStamp(
          locale,
          asked,
          timeZone,
          now,
          f.status === 'scheduled' ? AVAILABILITY_STALE_AFTER_MS : undefined,
        );
  const row = (a: MatchAbsence, group: AbsenceGroup) => {
    const reason = rowReasonKey(a, group);
    return (
      <li
        key={a.id}
        className="flex flex-wrap items-baseline justify-between gap-x-3"
        data-status={a.status}
        data-kind={a.kind ?? undefined}
      >
        <Link href={`/${locale}/player/${a.id}`}>{listName(locale, a.name)}</Link>
        {reason !== null ? (
          <span className="text-muted">
            <MessageText message={m[reason]} />
          </span>
        ) : group.reason === null && locale === 'en' && a.reason !== null ? (
          // A reason we cannot name: the feed's own words, on an English page only (T-1601).
          <span className="text-muted">{a.reason}</span>
        ) : null}
      </li>
    );
  };
  return (
    <Module
      title={m['player.availability.title']}
      module={centre.availability}
      testId="availability"
      words={words}
      empty={ABSENCE_GAP_KEY[centre.availability.gap ?? 'not_asked']}
    >
      {(absences) =>
        absences.length === 0 ? (
          <p className="text-sm" data-testid="no-absences">
            {askedStamp === null ? (
              <MessageText message={m['matchCentre.noAbsences']} />
            ) : (
              <>
                <MessageText
                  message={filled(m['matchCentre.noAbsencesAsked'], { time: askedStamp.text })}
                />
                {askedStamp.stale && (
                  <>
                    {' '}
                    <MessageText message={m['player.availability.stale']} />
                  </>
                )}
              </>
            )}
          </p>
        ) : (
          <div className="flex flex-col gap-4 text-sm">
            {(
              [
                ['home', f.home.name],
                ['away', f.away.name],
              ] as const
            ).map(([side, team]) => {
              const groups = absenceGroups(absences.filter((a) => a.side === side));
              if (groups.length === 0) return null;
              return (
                <div key={side} className="flex flex-col gap-2.5" data-absence-side={side}>
                  <h3 className="font-bold">{team}</h3>
                  {groups.map((group) => {
                    const count = formatNumber(locale, group.absences.length);
                    const status =
                      m[group.status === 'out' ? 'matchCentre.out' : 'matchCentre.doubtful'].text;
                    const open = group.folded ? [] : group.absences.slice(0, ABSENCES_SHOWN);
                    const rest = group.absences.slice(open.length);
                    return (
                      <div
                        key={`${group.status}:${group.reason ?? 'none'}`}
                        className="flex flex-col gap-1"
                        data-absence-group={group.status}
                        data-count={group.absences.length}
                      >
                        <h4 className="inline-flex items-center gap-1.5 text-xs font-extrabold text-muted">
                          {/* The status is an icon and a word: struck for out, half for doubtful. */}
                          <CoverageGlyph
                            state={group.status === 'out' ? 'not_supplied' : 'limited'}
                          />
                          <MessageText
                            message={
                              group.reason === null
                                ? filled(m['matchCentre.absences.groupPlain'], { status, count })
                                : filled(m['matchCentre.absences.group'], {
                                    status,
                                    reason: m[group.reason].text,
                                    count,
                                  })
                            }
                          />
                        </h4>
                        {open.length > 0 && (
                          <ul className="flex flex-col gap-1">{open.map((a) => row(a, group))}</ul>
                        )}
                        {rest.length > 0 && (
                          <details data-testid="absences-more">
                            <summary className="inline-flex min-h-touch cursor-pointer items-center font-semibold underline md:min-h-0">
                              <MessageText
                                message={filled(
                                  m[
                                    group.folded
                                      ? 'matchCentre.absences.names'
                                      : 'matchCentre.absences.more'
                                  ],
                                  { count: formatNumber(locale, rest.length) },
                                )}
                              />
                            </summary>
                            <ul className="mt-1 flex flex-col gap-1">
                              {rest.map((a) => row(a, group))}
                            </ul>
                          </details>
                        )}
                      </div>
                    );
                  })}
                </div>
              );
            })}
            {askedStamp !== null && (
              // When the feed was asked, under the list too (rule 4).
              <p className="text-xs text-muted" data-testid="absences-asked">
                <MessageText
                  message={filled(m['matchCentre.absencesAsked'], { time: askedStamp.text })}
                />
                {askedStamp.stale && (
                  <>
                    {' '}
                    <MessageText message={m['player.availability.stale']} />
                  </>
                )}
              </p>
            )}
          </div>
        )
      }
    </Module>
  );
}
