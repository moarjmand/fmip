import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { NotificationKind } from '@fmip/contracts';
import { NOTIFICATION_HOURLY_CAP } from '@fmip/contracts';
import { ClientMessagesProvider } from '@/components/client-messages';
import { EditorialSettings, FriendAlertSettings } from '@/components/kind-section';
import { MatchAlertSettings } from '@/components/match-alert-settings';
import { NotificationSettingsForm } from '@/components/notification-settings';
import { PushToggle } from '@/components/push-toggle';
import { Translated } from '@/components/translated';
import { DEFAULT_LOCALE, type Locale, isLocale } from '@/i18n/locales';
import { type Message, plural, resolveMessages, t } from '@/i18n/messages';
import {
  fetchCompetitions,
  fetchMe,
  fetchNotificationSettings,
  fetchPushState,
  fetchTeams,
} from '@/lib/api';
import {
  KIND_ROW_KEYS,
  NOTIFICATION_SETTINGS_KEYS,
  PUSH_TOGGLE_KEYS,
} from '@/lib/notification-messages';
import { pageMetadata } from '@/lib/seo';
import { sessionCookieHeader } from '@/lib/session';
import { Notice } from '@/components/ui';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const resolved: Locale = isLocale(locale) ? locale : DEFAULT_LOCALE;
  return pageMetadata({
    locale,
    path: '/settings/notifications',
    title: t(resolved, 'notificationsPage.settingsTitle'),
    description: t(resolved, 'notificationsPage.settingsDescription'),
    index: false,
  });
}

/**
 * What arrives, and when (blueprint 12.2, T-273).
 *
 * The form, the switches and the push toggle are client components, so their
 * words are resolved here for the reader's locale and handed down (T-1040,
 * T-1305): as props where this page draws the component, and through
 * `ClientMessagesProvider` for a kind's switch, which the server sections
 * draw too. The hourly caps are plurals, resolved here per kind.
 */
export default async function NotificationSettingsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const resolved: Locale = isLocale(locale) ? locale : DEFAULT_LOCALE;
  const cookie = await sessionCookieHeader();
  const me = await fetchMe(cookie);
  if (me === null) redirect(`/${locale}/login?next=/${locale}/settings/notifications`);

  const [result, teams, competitions, push] = await Promise.all([
    fetchNotificationSettings(cookie),
    fetchTeams(),
    fetchCompetitions(),
    fetchPushState(cookie),
  ]);
  const caps = Object.fromEntries(
    (Object.entries(NOTIFICATION_HOURLY_CAP) as [NotificationKind, number][]).map(([kind, cap]) => [
      kind,
      plural(resolved, 'alerts.cap', cap),
    ]),
  ) as Partial<Record<NotificationKind, Message>>;

  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-6 p-8">
      <p className="text-sm">
        <Link href={`/${locale}/notifications`} className="underline">
          <Translated locale={locale} message="notificationsPage.back" />
        </Link>
      </p>
      <h1 className="text-2xl font-semibold">
        <Translated locale={locale} message="notificationsPage.settingsHeading" />
      </h1>

      <section className="flex flex-col gap-2" data-testid="push-section">
        <h2 className="text-lg font-semibold">
          <Translated locale={locale} message="notificationsPage.onThisDevice" />
        </h2>
        {push.ok ? (
          <PushToggle
            locale={locale}
            push={push.data}
            messages={resolveMessages(resolved, PUSH_TOGGLE_KEYS)}
            devices={
              push.data.state === 'configured' && push.data.devices > 0
                ? plural(resolved, 'alerts.push.devices', push.data.devices)
                : null
            }
          />
        ) : (
          <p className="text-sm text-muted" data-testid="push-unreachable">
            <Translated locale={locale} message="notificationsPage.pushUnreadable" />
          </p>
        )}
      </section>

      {result.ok ? (
        <ClientMessagesProvider messages={resolveMessages(resolved, KIND_ROW_KEYS)}>
          <NotificationSettingsForm
            locale={locale}
            messages={resolveMessages(resolved, NOTIFICATION_SETTINGS_KEYS)}
            caps={caps}
            settings={result.data}
            teams={teams}
            competitions={competitions}
            matchAlerts={<MatchAlertSettings locale={locale} settings={result.data} />}
            sections={
              <>
                <FriendAlertSettings locale={locale} settings={result.data} />
                <EditorialSettings locale={locale} settings={result.data} />
              </>
            }
          />
        </ClientMessagesProvider>
      ) : (
        // Stated, not a blank page. A form that silently showed the defaults
        // would let a member "change" something that was never saved, and they
        // would find out weeks later by not being told something.
        <Notice tone="danger" data-testid="settings-unreachable">
          <Translated locale={locale} message="notificationsPage.settingsUnreachable" />
        </Notice>
      )}
    </main>
  );
}
