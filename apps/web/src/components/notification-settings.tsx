'use client';

import { useActionState } from 'react';
import type {
  NotificationCategory,
  NotificationKind,
  NotificationMute,
  NotificationSettings,
} from '@fmip/contracts';
import { NOTIFICATION_CATEGORIES, NOTIFICATION_HOURLY_CAP } from '@fmip/contracts';
import {
  muteAction,
  setNotificationPreferenceAction,
  setQuietHoursAction,
  unmuteAction,
} from '@/lib/notification-actions';

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
  briefing: 'When a briefing of mine is written',
  campaign: 'When the platform sends a message to members like me',
};

/** The categories a member can silence as one (T-331), named in words. */
const CATEGORY_LABEL: Record<NotificationCategory, string> = {
  football: 'Football: my predictions, my rating and my points',
  social: 'Social: friends, messages, mentions, groups and reactions',
  account: 'My account: moderation and contributor decisions',
};

function MuteRow({ locale, mute }: { locale: string; mute: NotificationMute }) {
  const [state, formAction, pending] = useActionState(
    unmuteAction.bind(null, locale, mute.scope, mute.target),
    null,
  );
  const name =
    mute.scope === 'category'
      ? CATEGORY_LABEL[mute.target as NotificationCategory]
      : (mute.label ?? mute.target);
  return (
    <li
      className="flex flex-wrap items-center justify-between gap-2 border-b border-current/10 py-2"
      data-testid="notification-mute"
      data-scope={mute.scope}
    >
      <span className="flex flex-col">
        <span className="text-sm">{name}</span>
        <span className="text-xs opacity-60">
          {mute.scope === 'team' && 'Team: nothing about its matches'}
          {mute.scope === 'competition' && 'Competition: nothing about its matches'}
          {mute.scope === 'category' && 'Category: nothing of these kinds'}
        </span>
      </span>
      <form action={formAction}>
        <button
          type="submit"
          disabled={pending}
          className="rounded border border-current/30 px-3 py-1 text-sm disabled:opacity-50"
        >
          Unmute
        </button>
        {state !== null && !state.ok && (
          <span role="status" className="ms-2 text-xs text-red-800 dark:text-red-300">
            {state.message}
          </span>
        )}
      </form>
    </li>
  );
}

function MuteForm({
  locale,
  scope,
  label,
  options,
}: {
  locale: string;
  scope: 'team' | 'competition' | 'category';
  label: string;
  options: { value: string; label: string }[];
}) {
  const [state, formAction, pending] = useActionState(muteAction.bind(null, locale, scope), null);
  const id = `mute-${scope}`;
  return (
    <form
      action={formAction}
      className="flex flex-wrap items-end gap-2"
      data-testid={`mute-${scope}`}
    >
      <label htmlFor={id} className="flex flex-col gap-1 text-sm">
        <span>{label}</span>
        <select id={id} name="target" className="rounded border border-current/30 px-2 py-1">
          <option value="">Choose…</option>
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      <button
        type="submit"
        disabled={pending}
        className="rounded border border-current px-3 py-1 text-sm disabled:opacity-50"
      >
        Silence
      </button>
      {state !== null && (
        <span
          role="status"
          className={`text-xs ${state.ok ? '' : 'text-red-800 dark:text-red-300'}`}
        >
          {state.ok ? (state.message ?? 'Done.') : state.message}
        </span>
      )}
    </form>
  );
}

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
          <span role="status" className="ms-2 text-xs text-red-800 dark:text-red-300">
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
  teams,
  competitions,
}: {
  locale: string;
  settings: NotificationSettings;
  /** What can be silenced; `null` when the list could not be loaded, which the section says. */
  teams: { id: string; name: string }[] | null;
  competitions: { id: string; name: string }[] | null;
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

      <section className="flex flex-col gap-3" data-testid="notification-mutes">
        <h2 className="text-lg font-semibold">What stays quiet</h2>
        <p className="text-sm opacity-70">
          Silence one team without silencing football. A silenced team or competition stops what is
          about its matches and nothing else; a silenced category stops every kind in it. The
          switches above are untouched.
        </p>
        {settings.mutes.length === 0 ? (
          <p className="text-sm opacity-70" data-testid="no-mutes">
            Nothing is silenced.
          </p>
        ) : (
          <ul className="flex flex-col">
            {settings.mutes.map((mute) => (
              <MuteRow key={`${mute.scope}:${mute.target}`} locale={locale} mute={mute} />
            ))}
          </ul>
        )}
        {teams === null ? (
          <p role="status" className="text-sm opacity-70">
            The team list could not be loaded right now.
          </p>
        ) : (
          <MuteForm
            locale={locale}
            scope="team"
            label="Silence a team"
            options={teams.map((t) => ({ value: t.id, label: t.name }))}
          />
        )}
        {competitions === null ? (
          <p role="status" className="text-sm opacity-70">
            The competition list could not be loaded right now.
          </p>
        ) : (
          <MuteForm
            locale={locale}
            scope="competition"
            label="Silence a competition"
            options={competitions.map((c) => ({ value: c.id, label: c.name }))}
          />
        )}
        <MuteForm
          locale={locale}
          scope="category"
          label="Silence a category"
          options={NOTIFICATION_CATEGORIES.map((c) => ({ value: c, label: CATEGORY_LABEL[c] }))}
        />
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
            className={quietState.ok ? 'text-sm' : 'text-sm text-red-800 dark:text-red-300'}
          >
            {quietState.message}
          </p>
        )}
      </section>
    </div>
  );
}
