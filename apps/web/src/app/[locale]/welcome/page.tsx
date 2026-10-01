import type { Metadata } from 'next';
import Link from 'next/link';
import type { TeamSummary } from '@fmip/contracts';
import { TimeZoneField } from '@/components/time-zone-field';
import { Translated } from '@/components/translated';
import { DEFAULT_LOCALE, isLocale } from '@/i18n/locales';
import { attribute, message, t, type MessageKey } from '@/i18n/messages';
import { fetchFollowing, fetchMe, fetchOwnProfile, fetchTeams, fetchTerritories } from '@/lib/api';
import { STEPS, type Step, readStep, stepHref, teamMatches } from '@/lib/first-run';
import { finishFirstRunAction, saveFirstRunStepAction } from '@/lib/first-run-actions';
import { readGuestChoices } from '@/lib/first-run-cookie';
import { offeredNow } from '@/lib/language-hold';
import { offeredLocales } from '@/lib/language-picker';
import { sessionCookieHeader } from '@/lib/session';
import { territoryOptions } from '@/lib/territory';
import { Button, Notice, Select, controlClasses } from '@/components/ui';

// A reader's own choices: never indexed.
export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  return {
    title: `${t(isLocale(locale) ? locale : DEFAULT_LOCALE, 'welcome.meta.title')} · FMIP`,
    robots: { index: false, follow: false },
  };
}
export const dynamic = 'force-dynamic';

const STEP_KEY: Record<Step, MessageKey> = {
  language: 'firstRun.step.language',
  territory: 'firstRun.step.territory',
  timezone: 'firstRun.step.timezone',
  teams: 'firstRun.step.teams',
};

/** What the reader has chosen so far, from the account or from the guest's cookie. */
interface Current {
  language: string;
  territory: string;
  timezone: string | null;
  favourites: Set<string>;
}

/**
 * The first-run flow (blueprint 2.3 and 7.1, T-620): language, territory,
 * time zone and favourite teams, one step per page, each skippable. A member's
 * answers are saved to the account as they go; a guest's are kept in this
 * browser and reach the account at sign-up. Plain forms over server actions,
 * so every step works without script; the time zone step uses script only to
 * propose the device's own zone for confirmation.
 */
export default async function WelcomePage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ locale }, query] = await Promise.all([params, searchParams]);
  const step = readStep(query.step);
  const next = typeof query.next === 'string' ? query.next : undefined;
  const search = typeof query.q === 'string' ? query.q : '';
  const cookie = await sessionCookieHeader();
  const me = await fetchMe(cookie);
  const signedIn = me !== null;

  let current: Current;
  let firstRunPending = true;
  if (signedIn) {
    const [own, following] = await Promise.all([fetchOwnProfile(cookie), fetchFollowing(cookie)]);
    const viewing = own.ok ? own.data.viewing_territory : null;
    firstRunPending = own.ok ? own.data.first_run.state === 'pending' : true;
    current = {
      language: me.preferred_language,
      territory: viewing !== null && viewing.state === 'chosen' ? viewing.territory.code : '',
      timezone: me.timezone,
      favourites: new Set(
        (following ?? [])
          .filter((f) => f.entity_type === 'team' && f.favourite)
          .map((f) => f.entity_id),
      ),
    };
  } else {
    const guest = await readGuestChoices();
    current = {
      language: guest.language ?? locale,
      territory: guest.territory ?? '',
      timezone: guest.timezone ?? null,
      favourites: new Set(guest.teams ?? []),
    };
  }

  const save = saveFirstRunStepAction.bind(null, locale, step, next);
  const finish = finishFirstRunAction.bind(null, locale, next);
  const index = STEPS.indexOf(step);
  const following = STEPS[index + 1];

  return (
    <main className="mx-auto flex max-w-xl flex-col gap-6 p-8">
      <h1 className="border-s-4 border-s-accent ps-4 text-2xl font-semibold">
        <Translated locale={locale} message="firstRun.title" />
      </h1>
      <p>
        <Translated locale={locale} message="firstRun.intro" />
      </p>
      {!signedIn && (
        <p className="text-sm text-muted" data-testid="first-run-guest">
          <Translated locale={locale} message="firstRun.guestNote" />
        </p>
      )}

      <nav
        aria-label={attribute(isLocale(locale) ? locale : DEFAULT_LOCALE, 'firstRun.steps').text}
      >
        <ol className="flex flex-wrap gap-x-4 gap-y-1 text-sm" data-testid="first-run-steps">
          {STEPS.map((s) => (
            <li key={s}>
              {s === step ? (
                <span aria-current="step" className="font-semibold underline">
                  <Translated locale={locale} message={STEP_KEY[s]} />
                </span>
              ) : (
                <Link href={stepHref(locale, s, next)} className="text-muted">
                  <Translated locale={locale} message={STEP_KEY[s]} />
                </Link>
              )}
            </li>
          ))}
        </ol>
      </nav>

      <section aria-labelledby="first-run-question" className="flex flex-col gap-4">
        {step === 'language' && (
          <LanguageStep locale={locale} current={current.language} save={save} />
        )}
        {step === 'territory' && (
          <TerritoryStep locale={locale} current={current.territory} save={save} />
        )}
        {step === 'timezone' && (
          <TimeZoneStep
            locale={locale}
            current={current.timezone}
            // Propose the device's zone to a guest with none, and to a member whose
            // flow is pending (registration defaulted to UTC for everyone).
            propose={current.timezone === null || (signedIn && firstRunPending)}
            save={save}
          />
        )}
        {step === 'teams' && (
          <TeamsStep
            locale={locale}
            chosen={current.favourites}
            search={search}
            next={next}
            save={save}
          />
        )}
      </section>

      <div className="flex flex-wrap items-center gap-4 text-sm">
        {following !== undefined ? (
          <Link
            href={stepHref(locale, following, next)}
            className="underline"
            data-testid="first-run-skip"
          >
            <Translated locale={locale} message="firstRun.skip" />
          </Link>
        ) : null}
        <form action={finish} className="contents">
          <Button type="submit" variant="ghost" size="md" data-testid="first-run-finish">
            <Translated
              locale={locale}
              message={following === undefined ? 'firstRun.skipAndFinish' : 'firstRun.later'}
            />
          </Button>
        </form>
      </div>
    </main>
  );
}

type Save = (formData: FormData) => Promise<void>;

function Question({ locale, message: key }: { locale: string; message: MessageKey }) {
  return (
    <h2 id="first-run-question" className="text-xl font-semibold">
      <Translated locale={locale} message={key} />
    </h2>
  );
}

function SaveButton({ locale }: { locale: string }) {
  return (
    <Button
      type="submit"
      variant="primary"
      size="md"
      className="self-start"
      data-testid="first-run-save"
    >
      <Translated locale={locale} message="firstRun.save" />
    </Button>
  );
}

async function LanguageStep({
  locale,
  current,
  save,
}: {
  locale: string;
  current: string;
  save: Save;
}) {
  // Finished and not held back (T-306, T-1163, D-155).
  const offered = offeredLocales(await offeredNow());
  return (
    <>
      <Question locale={locale} message="firstRun.language.question" />
      {offered.length < 2 ? (
        // One language is not a choice (T-306): say so rather than show a one-item list.
        <p data-testid="first-run-one-language">
          <Translated locale={locale} message="firstRun.language.onlyOne" />
        </p>
      ) : (
        <form action={save} className="flex flex-col gap-3">
          <fieldset className="flex flex-col gap-2">
            <legend className="sr-only">
              <Translated locale={locale} message="firstRun.step.language" />
            </legend>
            {offered.map((l) => (
              <label key={l} className="flex items-center gap-2" lang={l}>
                <input type="radio" name="language" value={l} defaultChecked={l === current} />
                {message(l, `language.name.${l}` as MessageKey).text}
              </label>
            ))}
          </fieldset>
          <SaveButton locale={locale} />
        </form>
      )}
    </>
  );
}

async function TerritoryStep({
  locale,
  current,
  save,
}: {
  locale: string;
  current: string;
  save: Save;
}) {
  const territories = await fetchTerritories();
  const resolved = isLocale(locale) ? locale : DEFAULT_LOCALE;
  return (
    <>
      <Question locale={locale} message="firstRun.territory.question" />
      <p className="text-sm text-muted">
        <Translated locale={locale} message="firstRun.territory.hint" />
      </p>
      {territories === null ? (
        <Notice tone="danger" data-testid="first-run-territory-unreachable">
          <Translated locale={locale} message="firstRun.territory.unreachable" />
        </Notice>
      ) : (
        <form action={save} className="flex flex-col gap-3">
          <Select
            label={<Translated locale={locale} message="firstRun.step.territory" />}
            id="first-run-territory"
            name="code"
            defaultValue={current}
          >
            {territoryOptions(
              locale,
              territories,
              message(resolved, 'firstRun.territory.notChosen').text,
            ).map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
          <SaveButton locale={locale} />
        </form>
      )}
    </>
  );
}

function TimeZoneStep({
  locale,
  current,
  propose,
  save,
}: {
  locale: string;
  current: string | null;
  propose: boolean;
  save: Save;
}) {
  const zones = ['UTC', ...Intl.supportedValuesOf('timeZone')];
  return (
    <>
      <Question locale={locale} message="firstRun.timezone.question" />
      <form action={save} className="flex flex-col gap-3">
        <TimeZoneField
          zones={zones}
          initial={current ?? 'UTC'}
          propose={propose}
          label={<Translated locale={locale} message="firstRun.step.timezone" />}
          browserNote={<Translated locale={locale} message="firstRun.timezone.browser" />}
          confirmNote={<Translated locale={locale} message="firstRun.timezone.confirm" />}
        />
        <SaveButton locale={locale} />
      </form>
    </>
  );
}

async function TeamsStep({
  locale,
  chosen,
  search,
  next,
  save,
}: {
  locale: string;
  chosen: Set<string>;
  search: string;
  next: string | undefined;
  save: Save;
}) {
  const teams = await fetchTeams();
  const resolved = isLocale(locale) ? locale : DEFAULT_LOCALE;
  const listed: TeamSummary[] = teams === null ? [] : teamMatches(teams, search, chosen);
  const placeholder = attribute(resolved, 'firstRun.teams.search');

  return (
    <>
      <Question locale={locale} message="firstRun.teams.question" />
      <p className="text-sm text-muted">
        <Translated locale={locale} message="firstRun.teams.hint" />
      </p>
      {teams === null ? (
        <Notice tone="danger" data-testid="first-run-teams-unreachable">
          <Translated locale={locale} message="firstRun.teams.unreachable" />
        </Notice>
      ) : (
        <>
          <form method="get" className="flex flex-wrap items-end gap-2" role="search">
            <input type="hidden" name="step" value="teams" />
            {next !== undefined && <input type="hidden" name="next" value={next} />}
            <label htmlFor="first-run-search" className="sr-only">
              <Translated locale={locale} message="firstRun.teams.search" />
            </label>
            <input
              id="first-run-search"
              type="search"
              name="q"
              defaultValue={search}
              placeholder={placeholder.text}
              lang={placeholder.lang}
              className={controlClasses('md', 'flex-1')}
            />
            <Button type="submit" size="md">
              <Translated locale={locale} message="firstRun.teams.searchButton" />
            </Button>
          </form>

          {listed.length === 0 ? (
            <p role="status" data-testid="first-run-teams-none">
              <Translated locale={locale} message="firstRun.teams.none" />
            </p>
          ) : (
            <form action={save} className="flex flex-col gap-3">
              <fieldset className="flex flex-col gap-1" data-testid="first-run-teams">
                <legend className="sr-only">
                  <Translated locale={locale} message="firstRun.step.teams" />
                </legend>
                {listed.map((team) => (
                  <label key={team.id} className="flex items-center gap-2">
                    <input type="hidden" name="shown" value={team.id} />
                    {chosen.has(team.id) && <input type="hidden" name="was" value={team.id} />}
                    <input
                      type="checkbox"
                      name="team"
                      value={team.id}
                      defaultChecked={chosen.has(team.id)}
                    />
                    {team.name}
                  </label>
                ))}
              </fieldset>
              <SaveButton locale={locale} />
            </form>
          )}
        </>
      )}
    </>
  );
}
