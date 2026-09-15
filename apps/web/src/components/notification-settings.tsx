'use client';

import { useActionState } from 'react';
import type { NotificationKind, NotificationSettings } from '@fmip/contracts';
import { NOTIFICATION_HOURLY_CAP } from '@fmip/contracts';
import { setNotificationPreferenceAction, setQuietHoursAction } from '@/lib/notification-actions';

/**
 * Choosing what arrives, and when (blueprint 12.2, T-273).
 *
 * **Every kind is listed, including the ones already on.** A settings page that
 * showed only what a member had changed would get emptier the more they agreed
 * with it, and they would have nowhere to go to turn something off.
 *
 * **The defaults are not restated here.** The API sends the value in force and
 * whether it is the member's own; this renders that. A second copy of the
 * defaults in the browser is the copy that goes stale, and the one a member is
 * looking at.
 */

/** A sentence per kind, so a member is choosing about a thing and not a slug. */
const KIND_LABEL: Record<NotificationKind, string> = {
  prediction_settled: 'When a prediction of mine is settled',
  rating_changed: 'When my Performance Rating changes',
  career_points_awarded: 'When I earn Career Points',
  friend_request: 'When somebody sends me a friend request',
  friend_accepted: 'When somebody accepts my friend request',
  message_received: 'When somebody sends me a message',
  mentioned: 'When somebody mentions me',
  group_invite: 'When somebody invites me to a group',
  group_join_request: 'When somebody asks to join a group I run',
  moderation_decision: 'When a moderation decision is made about my account',
  contributor_granted: 'When I am approved as a contributor',
  contributor_grant_changed: 'When my contributor approval changes',
  panel_reaction: 'When somebody reacts to something I posted',
};

function KindRow({
  locale,
  kind,
  inProduct,
  chosen,
}: {
  locale: string;
  kind: NotificationKind;
  inProduct: boolean;
  chosen: boolean;
}) {
  const [state, formAction, pending] = useActionState(
    setNotificationPreferenceAction.bind(null, locale, kind, !inProduct),
    null,
  );
  const cap = NOTIFICATION_HOURLY_CAP[kind];

  return (
    <li className="flex flex-wrap items-center justify-between gap-2 border-b border-current/10 py-2">
      <span className="flex flex-col">
        <span className="text-sm">{KIND_LABEL[kind]}</span>
        <span className="text-xs opacity-60">
          {/* Said out loud, because "Default" and "your choice that happens to
              match the default" behave differently the day a default changes. */}
          {chosen ? 'Your choice' : 'Default'}
          {cap !== undefined && ` · at most ${String(cap)} an hour`}
        </span>
      </span>
      <form action={formAction}>
        <button
          type="submit"
          disabled={pending}
          // The state is in the label and in `aria-pressed`, not only in a
          // border: a border does not reach a screen reader.
          aria-pressed={inProduct}
          data-testid={`notification-kind-${kind}`}
          className={`rounded border px-3 py-1 text-sm disabled:opacity-50 ${
            inProduct ? 'border-current' : 'border-current/30'
          }`}
        >
          {inProduct ? 'On' : 'Off'}
        </button>
        {state !== null && !state.ok && (
          <span role="status" className="ms-2 text-xs text-red-800">
            {state.message}
          </span>
        )}
      </form>
    </li>
  );
}

export function NotificationSettingsForm({
  locale,
  settings,
}: {
  locale: string;
  settings: NotificationSettings;
}) {
  const [quietState, quietAction, quietPending] = useActionState(
    setQuietHoursAction.bind(null, locale),
    null,
  );

  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">What arrives</h2>
        <ul className="flex flex-col" data-testid="notification-kinds">
          {settings.preferences.map((preference) => (
            <KindRow
              key={preference.kind}
              locale={locale}
              kind={preference.kind}
              inProduct={preference.in_product}
              chosen={preference.chosen}
            />
          ))}
        </ul>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">Quiet hours</h2>
        <p className="text-sm opacity-70" data-testid="quiet-hours-explainer">
          Nothing is thrown away. A notification that arrives during your quiet hours waits until
          they end, and says so. Times are on your own clock ({settings.timezone}).
        </p>
        <form action={quietAction} className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-sm">
            <span>From</span>
            <input
              type="time"
              name="starts_at"
              defaultValue={settings.quiet_hours?.starts_at ?? ''}
              className="rounded border border-current/30 bg-transparent p-1"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span>Until</span>
            <input
              type="time"
              name="ends_at"
              defaultValue={settings.quiet_hours?.ends_at ?? ''}
              className="rounded border border-current/30 bg-transparent p-1"
            />
          </label>
          <button
            type="submit"
            disabled={quietPending}
            data-testid="quiet-hours-save"
            className="rounded border border-current/30 px-3 py-1 text-sm disabled:opacity-50"
          >
            Save
          </button>
          {/* Cleared by submitting both fields empty, rather than by a second
              button that would be a second thing to explain. */}
          <span className="text-xs opacity-60">Leave both empty to clear them.</span>
        </form>
        {quietState !== null && (
          <p
            role="status"
            data-testid="quiet-hours-result"
            className={quietState.ok ? 'text-sm' : 'text-sm text-red-800'}
          >
            {quietState.message}
          </p>
        )}
      </section>
    </div>
  );
}
