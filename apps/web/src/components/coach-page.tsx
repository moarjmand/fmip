import Link from '@/components/ui/link';
import type { CoachPage } from '@fmip/contracts';
import { Coverage, CoveredPanel, Panel } from '@/components/competition-page';
import { EntityBand } from '@/components/entity-band';
import { EntityImage } from '@/components/entity-image';
import { Translated } from '@/components/translated';
import { Icon, inlineTargetClasses } from '@/components/ui';
import { formatNumber } from '@/i18n/format';
import { coachSpellPeriod, currentSpells, staleRecordDays } from '@/lib/coach';
import { formatFixtureDate, say } from '@/lib/competition';
import { ageOn, dayText } from '@/lib/player';

/**
 * The coach page (T-1439, D-230) in the data mode: the band with the photo,
 * the current team, nationality and age; the career as the provider lists it
 * at the teams we cover; and the line-ups that name him. Every module
 * carries its coverage (rule 3), and a spell is called current only by the
 * rule `CoachCareerSpell.current` states.
 */

/** The coaching record's update time: the career's own, else the page's. */
function recordUpdatedAt(page: CoachPage): string | null {
  return page.career.last_updated_at ?? page.last_updated_at;
}

/**
 * "Coaching now" from a record older than `COACH_RECORD_STALE_DAYS` (T-1807,
 * D-406; rule 4): the clock and the age in words, never colour alone.
 */
function StaleMark({ days, locale }: { days: number; locale: string }) {
  return (
    <span
      className="inline-flex items-center gap-1 font-semibold text-warning"
      data-testid="coach-stale"
    >
      <Icon name="clock" size={14} />
      <Translated locale={locale} message="coachPage.recordAge" count={days} />
    </span>
  );
}

export function CoachBand({
  page,
  locale,
  now = new Date(),
}: {
  page: CoachPage;
  locale: string;
  /** The page's clock, for the record's age. */
  now?: Date;
}) {
  const c = page.coach;
  const current = currentSpells(page);
  const staleDays = staleRecordDays(recordUpdatedAt(page), now);
  const age = ageOn(c.date_of_birth, new Date());
  return (
    <EntityBand
      testId="coach-header"
      media={
        <EntityImage
          media={c.photo}
          kind="photo"
          name={c.name}
          size={96}
          aboveFold
          className="ring-4 ring-surface-raised"
        />
      }
      eyebrow={say(locale, 'coachPage.eyebrow')}
      title={c.name}
      details={
        <dl
          className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted"
          data-testid="identity"
        >
          <div data-testid="coach-current-team">
            <dt className="sr-only">
              <Translated locale={locale} message="coachPage.currentTeam" />
            </dt>
            <dd>
              {current.length === 0 ? (
                <Translated locale={locale} message="coachPage.noCurrentTeam" />
              ) : (
                current.map((s, i) => (
                  <span key={s.team.id}>
                    {i > 0 && ' · '}
                    <Link
                      href={`/${locale}/team/${s.team.id}`}
                      className={inlineTargetClasses('font-bold text-fg hover:underline')}
                    >
                      {s.team.name}
                    </Link>
                    {s.start_date !== null &&
                      ` · ${say(locale, 'team.headCoach.since', { date: dayText(locale, s.start_date) })}`}
                  </span>
                ))
              )}
              {current.length > 0 && staleDays !== null && (
                <>
                  {' · '}
                  <StaleMark days={staleDays} locale={locale} />
                </>
              )}
            </dd>
          </div>
          {c.nationality !== null && (
            <div>
              <dt className="sr-only">
                <Translated locale={locale} message="playerPage.nationality" />
              </dt>
              <dd>{c.nationality.name}</dd>
            </div>
          )}
          <div className="flex items-center gap-2" data-testid="birth">
            {c.date_of_birth === null || age === null ? (
              <>
                <dt>
                  <Translated locale={locale} message="playerPage.dateOfBirth" />
                </dt>
                <dd>
                  <Coverage locale={locale} state="not_supplied" />
                </dd>
              </>
            ) : (
              <>
                <dt className="sr-only">
                  <Translated locale={locale} message="playerPage.age" />
                </dt>
                <dd>
                  {say(locale, 'playerPage.ageBorn', {
                    age: formatNumber(locale, age),
                    date: dayText(locale, c.date_of_birth),
                  })}
                </dd>
              </>
            )}
          </div>
        </dl>
      }
      actions={null}
      tabs={null}
    />
  );
}

/** The career at the teams we cover, newest first, and a count of the rest. */
export function CoachCareerPanel({
  page,
  locale,
  timeZone,
  now = new Date(),
}: {
  page: CoachPage;
  locale: string;
  timeZone: string;
  /** The page's clock, for the record's age. */
  now?: Date;
}) {
  const staleDays = staleRecordDays(recordUpdatedAt(page), now);
  return (
    <CoveredPanel
      testId="coach-career"
      title={<Translated locale={locale} message="coachPage.career" />}
      module={page.career}
      locale={locale}
      timeZone={timeZone}
      intro={
        <>
          {staleDays !== null && (page.career.data?.length ?? 0) > 0 && (
            <p
              className="flex items-start gap-1.5 rounded-control border border-warning/40 bg-warning/10 px-3 py-2 text-sm"
              data-testid="coach-career-stale"
            >
              <Icon name="clock" size={16} className="mt-0.5 shrink-0 text-warning" />
              <span>
                <Translated locale={locale} message="coachPage.careerAge" count={staleDays} />
              </span>
            </p>
          )}
          <p className="text-xs text-muted">
            <Translated locale={locale} message="coachPage.careerIntro" />
          </p>
        </>
      }
      empty={
        page.career.data === null ? (
          <Translated locale={locale} message="coachPage.noData" />
        ) : undefined
      }
      footer={
        page.spells_not_carried > 0 ? (
          <p className="text-xs text-muted" data-testid="coach-not-carried">
            {say(locale, 'coachPage.notCarried', {
              count: formatNumber(locale, page.spells_not_carried),
            })}
          </p>
        ) : undefined
      }
    >
      {(spells) => (
        <ol className="flex flex-col divide-y divide-default">
          {spells.map((s) => (
            <li
              key={`${s.team.id}-${s.start_date ?? ''}-${s.end_date ?? ''}`}
              className="flex min-h-touch items-center gap-3 py-2"
              data-testid="coach-spell"
              data-current={s.current ? 'true' : 'false'}
            >
              <EntityImage media={s.team.crest} kind="crest" name={s.team.name} size={22} />
              <div className="min-w-0 flex-1">
                <Link
                  href={`/${locale}/team/${s.team.id}`}
                  className={inlineTargetClasses('font-semibold hover:underline')}
                >
                  {s.team.name}
                </Link>
                <p className="text-xs text-muted">{coachSpellPeriod(locale, s)}</p>
              </div>
              {s.current && (
                <span className="rounded-full bg-accent/10 px-2 py-0.5 text-xs font-bold text-accent">
                  <Translated locale={locale} message="coachPage.current" />
                </span>
              )}
            </li>
          ))}
        </ol>
      )}
    </CoveredPanel>
  );
}

/** How many of our line-ups name him, and the latest one. */
export function CoachLineupsPanel({
  page,
  locale,
  timeZone,
}: {
  page: CoachPage;
  locale: string;
  timeZone: string;
}) {
  const { count, latest } = page.lineups;
  return (
    <Panel
      testId="coach-lineups"
      title={<Translated locale={locale} message="coachPage.lineups" />}
    >
      {count === 0 || latest === null ? (
        <p className="text-sm text-muted">
          <Translated locale={locale} message="coachPage.noLineups" />
        </p>
      ) : (
        <div className="flex flex-col gap-1 text-sm">
          <p>{say(locale, 'coachPage.lineupsCount', { count: formatNumber(locale, count) })}</p>
          <p className="text-muted">
            <Link
              href={`/${locale}/match/${latest.fixture_id}`}
              className={inlineTargetClasses('underline')}
            >
              {say(locale, 'coachPage.lineupsLatest', {
                team: latest.team.name,
                date: formatFixtureDate(locale, latest.kickoff_at, timeZone),
              })}
            </Link>
          </p>
        </div>
      )}
    </Panel>
  );
}

/**
 * The record under him -- played, won, drawn, lost (T-1807, D-406): no API
 * gives a coach's matches with their results yet, so the card is a labelled
 * gap with the not-supplied state, never numbers (rule 3).
 */
export function CoachRecordPanel({ page, locale }: { page: CoachPage; locale: string }) {
  const team = currentSpells(page)[0]?.team ?? null;
  return (
    <Panel
      testId="coach-record"
      title={
        team === null ? (
          <Translated locale={locale} message="coachPage.record" />
        ) : (
          say(locale, 'coachPage.recordWith', { team: team.name })
        )
      }
      aside={<Coverage locale={locale} state="not_supplied" />}
    >
      <p className="text-sm text-muted" data-testid="coach-record-gap">
        <Translated locale={locale} message="coachPage.recordNotSupplied" />
      </p>
    </Panel>
  );
}
