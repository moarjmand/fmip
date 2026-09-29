import type { Metadata } from 'next';
import Link from 'next/link';
import { PRIVACY_VISIBILITIES } from '@fmip/contracts';
import { ActionForm, type FieldOption } from '@/components/action-form';
import { AppearanceSwitch } from '@/components/appearance-switch';
import { FollowingSection } from '@/components/following-section';
import { ThemeSwitch } from '@/components/theme-switch';
import { Translated } from '@/components/translated';
import {
  fetchCompetitions,
  fetchFollowing,
  fetchOwnProfile,
  fetchTeams,
  fetchTerritories,
} from '@/lib/api';
import { territoryOptions, territoryValue } from '@/lib/territory';
import {
  deleteAccountAction,
  setTerritoryAction,
  updatePrivacyAction,
  updateProfileAction,
} from '@/lib/auth-actions';
import { DEFAULT_LOCALE, isLocale } from '@/i18n/locales';
import { interpolate, t } from '@/i18n/messages';
import { sessionCookieHeader } from '@/lib/session';
import type { Appearance } from '@/lib/appearance';
import type { ThemePreference } from '@/lib/theme';
import { readAppearance, readTheme } from '@/lib/theme-cookie';
import { Button, Notice, TextField } from '@/components/ui';
import { type DataExportRefusal, REFUSAL_MESSAGES, refusalFromQuery } from '@/lib/data-export';

// A member's own page: never indexed.
export const metadata: Metadata = {
  title: 'Settings · FMIP',
  robots: { index: false, follow: false },
};
export const dynamic = 'force-dynamic';

const VISIBILITY_LABELS: Record<(typeof PRIVACY_VISIBILITIES)[number], string> = {
  public: 'Public: anyone',
  friends: 'Friends only (friendships arrive in a later release; until then, only you)',
  private: 'Private: only you',
};

const visibilityOptions: FieldOption[] = PRIVACY_VISIBILITIES.map((value) => ({
  value,
  label: VISIBILITY_LABELS[value],
}));

export default async function SettingsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await params;
  const exportRefusal = refusalFromQuery((await searchParams).export);
  const cookie = await sessionCookieHeader();
  // A guest (no session, or one the API no longer knows) has no account to
  // set, but the appearance is this browser's and theirs to choose (blueprint
  // 2.2 global controls, T-621, D-092) -- with or without the API.
  const result = cookie === undefined ? null : await fetchOwnProfile(cookie);

  if (result === null || !result.ok) {
    if (result === null || result.status === 401) {
      const [theme, appearance] = await Promise.all([readTheme(), readAppearance()]);
      return (
        <main className="mx-auto flex max-w-md flex-col gap-10 p-8">
          <h1 className="text-2xl font-semibold">
            <Translated locale={locale} message="nav.settings" />
          </h1>
          <p className="text-sm text-muted" data-testid="settings-guest">
            <Translated locale={locale} message="appearance.guest" />{' '}
            <Link href={`/${locale}/login`} className="underline">
              <Translated locale={locale} message="nav.signIn" />
            </Link>
          </p>
          <AppearanceSection locale={locale} theme={theme} appearance={appearance} />
        </main>
      );
    }
    return (
      <main className="mx-auto flex max-w-md flex-col gap-4 p-8">
        <h1 className="text-2xl font-semibold">Settings</h1>
        <Notice tone="danger">The service is unreachable right now.</Notice>
      </main>
    );
  }

  const { profile, account, privacy, viewing_territory } = result.data;
  const [following, teams, competitions, territories, theme, appearance] = await Promise.all([
    fetchFollowing(cookie),
    fetchTeams(),
    fetchCompetitions(),
    fetchTerritories(),
    readTheme(),
    readAppearance(),
  ]);

  return (
    <main className="mx-auto flex max-w-md flex-col gap-10 p-8">
      <section className="flex flex-col gap-4">
        <h1 className="text-2xl font-semibold">Profile</h1>
        <p className="text-sm text-muted">
          Signed in as @{account.username} ({account.email}
          {account.email_verified ? ', verified' : ', not yet verified'}).
        </p>
        <ActionForm
          action={updateProfileAction.bind(null, locale)}
          fields={[
            {
              name: 'display_name',
              label: 'Display name',
              required: true,
              defaultValue: profile.display_name,
              maxLength: 50,
            },
            {
              name: 'bio',
              label: 'Short biography',
              type: 'textarea',
              defaultValue: profile.bio ?? '',
              maxLength: 500,
              hint: 'Up to 500 characters.',
            },
            {
              name: 'avatar_url',
              label: 'Avatar URL',
              type: 'url',
              defaultValue: profile.avatar_url ?? '',
              hint: 'An http(s) link to an image. Leave empty for none.',
            },
          ]}
          submitLabel="Save profile"
          testId="profile-form"
        />
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="text-xl font-semibold">Privacy</h2>
        <p className="text-sm text-muted">
          Your username and display name are always public, because leaderboards show them.
        </p>
        <ActionForm
          action={updatePrivacyAction.bind(null, locale)}
          fields={[
            {
              name: 'profile_visibility',
              label: 'Who can see your profile',
              type: 'select',
              options: visibilityOptions,
              defaultValue: privacy.profile_visibility,
            },
            {
              name: 'prediction_history_visibility',
              label: 'Who can see your prediction history',
              type: 'select',
              options: visibilityOptions,
              defaultValue: privacy.prediction_history_visibility,
            },
          ]}
          submitLabel="Save privacy settings"
          testId="privacy-form"
        />
      </section>

      <AppearanceSection locale={locale} theme={theme} appearance={appearance} />

      <section id="territory" className="flex flex-col gap-4" data-testid="territory-section">
        <h2 className="text-xl font-semibold">Viewing territory</h2>
        {/* T-312: chosen here and only here; nothing guesses it from an address (blueprint 11). */}
        <p className="text-sm text-muted" data-testid="territory-state">
          {viewing_territory.state === 'chosen'
            ? `Viewing options are shown for ${viewing_territory.territory.name}.`
            : 'You have not chosen a territory yet. Where a match can be watched depends on it, so you will be asked rather than guessed at.'}
        </p>
        {territories === null ? (
          <Notice tone="danger">The territory list could not be loaded right now.</Notice>
        ) : (
          <ActionForm
            action={setTerritoryAction.bind(null, locale)}
            fields={[
              {
                name: 'code',
                label: 'Where you watch from',
                type: 'select',
                options: territoryOptions(locale, territories, 'Not chosen'),
                defaultValue: territoryValue(viewing_territory),
                hint: 'Rights are sold by country, so this is the country you are in, not the team you support.',
              },
            ]}
            submitLabel="Save viewing territory"
            testId="territory-form"
          />
        )}
      </section>

      {following === null || teams === null || competitions === null ? (
        <Notice tone="danger">Following could not be loaded right now.</Notice>
      ) : (
        <FollowingSection
          locale={locale}
          following={following}
          teams={teams}
          competitions={competitions}
        />
      )}

      <DataExportSection locale={locale} refusal={exportRefusal} />

      <DeleteAccountSection locale={locale} username={account.username} />
    </main>
  );
}

/**
 * Settings -> Download my data (T-846, D-158). A plain form, so the browser
 * saves the file the route handler answers with; the password is the only
 * field, checked by the API. A refusal comes back as `?export=` and is said
 * here, on the password field when it was the password.
 */
function DataExportSection({
  locale,
  refusal,
}: {
  locale: string;
  refusal: DataExportRefusal | null;
}) {
  const lang = isLocale(locale) ? locale : DEFAULT_LOCALE;
  return (
    <section id="download-data" className="flex flex-col gap-4" data-testid="download-data">
      <h2 className="text-xl font-semibold">
        <Translated locale={locale} message="account.export.heading" />
      </h2>
      <p className="text-sm text-muted">
        <Translated locale={locale} message="account.export.contents" />
      </p>
      <p className="text-sm text-muted">
        <Translated locale={locale} message="account.export.others" />
      </p>
      <p className="text-sm text-muted">
        <Translated locale={locale} message="account.export.once" />
      </p>
      {refusal !== null && refusal !== 'password' ? (
        <Notice tone="danger" data-testid="download-data-refused">
          <Translated locale={locale} message={REFUSAL_MESSAGES[refusal]} />
        </Notice>
      ) : null}
      <form
        method="post"
        action={`/${locale}/settings/data-export`}
        className="flex flex-col gap-3"
        data-testid="download-data-form"
      >
        <TextField
          name="password"
          type="password"
          label={t(lang, 'account.export.password')}
          required
          autoComplete="current-password"
          error={refusal === 'password' ? t(lang, REFUSAL_MESSAGES.password) : undefined}
        />
        <Button type="submit" variant="secondary">
          <Translated locale={locale} message="account.export.submit" />
        </Button>
      </form>
    </section>
  );
}

/**
 * Settings -> Delete my account (T-812, D-094). Last on the page, and the only
 * section that says in full what it will do before it does it: what goes,
 * what stays and why, and that it is final. The password and the username
 * typed again are both checked by the API.
 */
function DeleteAccountSection({ locale, username }: { locale: string; username: string }) {
  const lang = isLocale(locale) ? locale : DEFAULT_LOCALE;
  return (
    <section id="delete-account" className="flex flex-col gap-4" data-testid="delete-account">
      <h2 className="text-xl font-semibold">
        <Translated locale={locale} message="account.delete.heading" />
      </h2>
      <p className="text-sm text-muted">
        <Translated locale={locale} message="account.delete.removed" />
      </p>
      <p className="text-sm text-muted">
        <Translated locale={locale} message="account.delete.kept" />
      </p>
      <p className="text-sm text-muted">
        <Translated locale={locale} message="account.delete.username" />
      </p>
      <Notice tone="danger">
        <Translated locale={locale} message="account.delete.final" />
      </Notice>
      <ActionForm
        action={deleteAccountAction.bind(null, locale)}
        fields={[
          {
            name: 'password',
            label: t(lang, 'account.delete.password'),
            type: 'password',
            required: true,
            autoComplete: 'current-password',
          },
          {
            name: 'confirm',
            label: t(lang, 'account.delete.confirm'),
            required: true,
            autoComplete: 'off',
            hint: interpolate(t(lang, 'account.delete.confirmHint'), { username }),
          },
        ]}
        submitLabel={t(lang, 'account.delete.submit')}
        testId="delete-account-form"
      />
    </section>
  );
}

/**
 * Settings -> Appearance, for a member and a guest alike: the theme (T-602)
 * and text size, contrast and motion (blueprint 2.2, T-621). Every choice is
 * this browser's cookie, rendered on <html> by the layout, and a member's is
 * kept on the account as well.
 */
function AppearanceSection({
  locale,
  theme,
  appearance,
}: {
  locale: string;
  theme: ThemePreference;
  appearance: Appearance;
}) {
  return (
    <section id="appearance" className="flex flex-col gap-4" data-testid="appearance-section">
      <h2 className="text-xl font-semibold">
        <Translated locale={locale} message="theme.heading" />
      </h2>
      {/* T-602: the same switch as the header's, with room to say what "Device" means. */}
      <p className="text-sm text-muted">
        <Translated locale={locale} message="theme.hint" />
      </p>
      <ThemeSwitch locale={locale} current={theme} variant="full" />
      <p className="text-sm text-muted">
        <Translated locale={locale} message="appearance.hint" />
      </p>
      <AppearanceSwitch locale={locale} preference="text_size" current={appearance.text_size} />
      <AppearanceSwitch locale={locale} preference="contrast" current={appearance.contrast} />
      <AppearanceSwitch locale={locale} preference="motion" current={appearance.motion} />
    </section>
  );
}
