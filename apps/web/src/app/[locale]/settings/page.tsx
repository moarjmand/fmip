import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { PRIVACY_VISIBILITIES } from '@fmip/contracts';
import { ActionForm, type FieldOption } from '@/components/action-form';
import { FollowingSection } from '@/components/following-section';
import {
  fetchCompetitions,
  fetchFollowing,
  fetchOwnProfile,
  fetchTeams,
  fetchTerritories,
} from '@/lib/api';
import { territoryOptions, territoryValue } from '@/lib/territory';
import { setTerritoryAction, updatePrivacyAction, updateProfileAction } from '@/lib/auth-actions';
import { sessionCookieHeader } from '@/lib/session';

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

export default async function SettingsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const cookie = await sessionCookieHeader();
  const result = await fetchOwnProfile(cookie);

  if (!result.ok) {
    if (result.status === 401) redirect(`/${locale}/login`);
    return (
      <main className="mx-auto flex max-w-md flex-col gap-4 p-8">
        <h1 className="text-2xl font-semibold">Settings</h1>
        <p role="alert">The service is unreachable right now.</p>
      </main>
    );
  }

  const { profile, account, privacy, viewing_territory } = result.data;
  const [following, teams, competitions, territories] = await Promise.all([
    fetchFollowing(cookie),
    fetchTeams(),
    fetchCompetitions(),
    fetchTerritories(),
  ]);

  return (
    <main className="mx-auto flex max-w-md flex-col gap-10 p-8">
      <section className="flex flex-col gap-4">
        <h1 className="text-2xl font-semibold">Profile</h1>
        <p className="text-sm opacity-70">
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
        <p className="text-sm opacity-70">
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

      <section id="territory" className="flex flex-col gap-4" data-testid="territory-section">
        <h2 className="text-xl font-semibold">Viewing territory</h2>
        {/* T-312: chosen here and only here; nothing guesses it from an address (blueprint 11). */}
        <p className="text-sm opacity-70" data-testid="territory-state">
          {viewing_territory.state === 'chosen'
            ? `Viewing options are shown for ${viewing_territory.territory.name}.`
            : 'You have not chosen a territory yet. Where a match can be watched depends on it, so you will be asked rather than guessed at.'}
        </p>
        {territories === null ? (
          <p role="alert">The territory list could not be loaded right now.</p>
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
        <p role="alert">Following could not be loaded right now.</p>
      ) : (
        <FollowingSection
          locale={locale}
          following={following}
          teams={teams}
          competitions={competitions}
        />
      )}
    </main>
  );
}
