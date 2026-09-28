import type { MatchAlertKind, NotificationSettings } from '@fmip/contracts';
import { MATCH_ALERT_KINDS } from '@fmip/contracts';
import { KindRow } from '@/components/notification-settings';
import { Translated } from '@/components/translated';
import type { MessageKey } from '@/i18n/messages';

/**
 * The match-alert switches (blueprint 12.2, T-831, D-098): one per kind, in
 * the order a match happens, worded through the catalogues.
 *
 * **The values are the API's, not a copy of the defaults.** Each switch shows
 * what is in force and whether it is the member's own, exactly like the
 * general list; the defaults (kick-off, goals and full-time on; red cards and
 * half-time off) live in the contract and D-098.
 *
 * **Per-team and per-competition are the mutes.** A member silences one team
 * or one competition under "What stays quiet", and every match alert at once
 * with the `match` category there. A per-team, per-kind switch (goals for
 * one team, not another) is deferred: the preference is per member per kind,
 * and a second table read on every alert is not justified yet (D-098).
 *
 * A server component, so the catalogue stays on the server; the switches
 * themselves are the client rows the rest of the page uses.
 */
const LABEL: Record<MatchAlertKind, MessageKey> = {
  match_kickoff: 'notifications.match.kickoff',
  match_goal: 'notifications.match.goal',
  match_red_card: 'notifications.match.redCard',
  match_half_time: 'notifications.match.halfTime',
  match_full_time: 'notifications.match.fullTime',
};

export function MatchAlertSettings({
  locale,
  settings,
}: {
  locale: string;
  settings: NotificationSettings;
}) {
  const byKind = new Map(settings.preferences.map((p) => [p.kind, p]));
  return (
    <section className="flex flex-col gap-2" data-testid="match-alerts">
      <h2 className="text-lg font-semibold">
        <Translated locale={locale} message="notifications.match.heading" />
      </h2>
      <p className="text-sm text-muted">
        <Translated locale={locale} message="notifications.match.intro" />
      </p>
      <ul className="flex flex-col" data-testid="match-alert-kinds">
        {MATCH_ALERT_KINDS.map((kind) => {
          const preference = byKind.get(kind);
          // A kind the API did not send is left out rather than shown with a
          // guessed value: a switch must say what is in force (rule 3).
          if (preference === undefined) return null;
          return (
            <KindRow
              key={kind}
              locale={locale}
              kind={kind}
              label={<Translated locale={locale} message={LABEL[kind]} />}
              inProduct={preference.in_product}
              chosen={preference.chosen}
            />
          );
        })}
      </ul>
      <p className="text-xs text-muted">
        <Translated locale={locale} message="notifications.match.quiet" />
      </p>
    </section>
  );
}
