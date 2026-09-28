import type { NotificationKind, NotificationSettings } from '@fmip/contracts';
import { KindRow } from '@/components/notification-settings';
import { Translated } from '@/components/translated';
import type { MessageKey } from '@/i18n/messages';
import { FRIEND_ALERT_KINDS, type SectionedKind } from '@/lib/notification-sections';

/**
 * A section of Settings → Notifications for a few kinds, worded through the
 * catalogues (T-832): a heading, a line saying what the kinds are, and one
 * switch per kind with the value the API says is in force -- never a copy of
 * the defaults. A kind the API did not send (an administrator's kind shown
 * to a member) is left out rather than shown with a guessed value (rule 3).
 *
 * A server component, so the catalogue stays on the server; the switches are
 * the client rows the rest of the page uses.
 */
export function KindSection<K extends NotificationKind>({
  locale,
  settings,
  kinds,
  labels,
  heading,
  intro,
  testId,
}: {
  locale: string;
  settings: NotificationSettings;
  kinds: readonly K[];
  labels: Record<K, MessageKey>;
  heading: MessageKey;
  intro: MessageKey;
  testId: string;
}) {
  const byKind = new Map(settings.preferences.map((p) => [p.kind, p]));
  const offered = kinds.flatMap((kind) => {
    const preference = byKind.get(kind);
    return preference === undefined ? [] : [{ kind, preference }];
  });
  if (offered.length === 0) return null;
  return (
    <section className="flex flex-col gap-2" data-testid={testId}>
      <h2 className="text-lg font-semibold">
        <Translated locale={locale} message={heading} />
      </h2>
      <p className="text-sm text-muted">
        <Translated locale={locale} message={intro} />
      </p>
      <ul className="flex flex-col">
        {offered.map(({ kind, preference }) => (
          <KindRow
            key={kind}
            locale={locale}
            kind={kind}
            label={<Translated locale={locale} message={labels[kind]} />}
            inProduct={preference.in_product}
            chosen={preference.chosen}
          />
        ))}
      </ul>
    </section>
  );
}

/** Every sectioned kind's label, keyed by the union so a kind added without words does not compile. */
export const SECTION_LABEL: Record<SectionedKind, MessageKey> = {
  friend_predicted: 'notifications.friends.predicted',
};

/** Friends' predictions (blueprint 8.1, T-832, D-100): opt-in, and never the pick. */
export function FriendAlertSettings({
  locale,
  settings,
}: {
  locale: string;
  settings: NotificationSettings;
}) {
  return (
    <KindSection
      locale={locale}
      settings={settings}
      kinds={FRIEND_ALERT_KINDS}
      labels={SECTION_LABEL}
      heading="notifications.friends.heading"
      intro="notifications.friends.intro"
      testId="friend-alerts"
    />
  );
}
