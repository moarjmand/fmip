'use client';

import { type ReactNode, useActionState } from 'react';
import type {
  MatchAlertKind,
  NotificationCategory,
  NotificationKind,
  NotificationMute,
  NotificationPreference,
  NotificationSettings,
} from '@fmip/contracts';
import {
  NOTIFICATION_CATEGORIES,
  NOTIFICATION_HOURLY_CAP,
  isMatchAlertKind,
} from '@fmip/contracts';
import {
  muteAction,
  setNotificationPreferenceAction,
  setQuietHoursAction,
  unmuteAction,
} from '@/lib/notification-actions';
import { Button, FormStatus, Select, TextField } from '@/components/ui';

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

/**
 * A sentence per kind, so a member is choosing about a thing and not a slug.
 * The match alerts are not here: they have a section of their own, worded
 * through the catalogues (`match-alert-settings.tsx`, T-831).
 */
const KIND_LABEL: Record<Exclude<NotificationKind, MatchAlertKind>, string> = {
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
  // Offered to administrators only; the API leaves it out for everyone else (T-802).
  system_alert: 'When the watchdog raises or clears a system alert (at any hour)',
};

/** The kinds this list offers: every one but the match alerts, which have their own section. */
function isListedHere(
  preference: NotificationPreference,
): preference is NotificationPreference & { kind: Exclude<NotificationKind, MatchAlertKind> } {
  return !isMatchAlertKind(preference.kind);
}

/** The categories a member can silence as one (T-331), named in words. */
const CATEGORY_LABEL: Record<NotificationCategory, string> = {
  football: 'Football: my predictions, my rating and my points',
  social: 'Social: friends, messages, mentions, groups and reactions',
  account: 'My account: moderation and contributor decisions',
  match: 'Match alerts: kick-off, goals, red cards, half-time and full-time',
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
      className="flex flex-wrap items-center justify-between gap-2 border-b border-default py-2"
      data-testid="notification-mute"
      data-scope={mute.scope}
    >
      <span className="flex flex-col">
        <span className="text-sm">{name}</span>
        <span className="text-xs text-muted">
          {mute.scope === 'team' && 'Team: nothing about its matches'}
          {mute.scope === 'competition' && 'Competition: nothing about its matches'}
          {mute.scope === 'category' && 'Category: nothing of these kinds'}
        </span>
      </span>
      <form action={formAction}>
        <Button type="submit" pending={pending}>
          Unmute
        </Button>
        {state !== null && !state.ok && (
          <FormStatus ok={false} as="span" size="xs" className="ms-2">
            {state.message}
          </FormStatus>
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
      <Select label={label} id={id} name="target" size="sm">
        <option value="">Choose…</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </Select>
      <Button type="submit" pending={pending}>
        Silence
      </Button>
      {state !== null && (
        <FormStatus ok={state.ok} as="span" size="xs">
          {state.ok ? (state.message ?? 'Done.') : state.message}
        </FormStatus>
      )}
    </form>
  );
}

/** One kind's switch. Exported for the match-alert section, which words its own labels (T-831). */
export function KindRow({
  locale,
  kind,
  label,
  inProduct,
  chosen,
}: {
  locale: string;
  kind: NotificationKind;
  label: ReactNode;
  inProduct: boolean;
  chosen: boolean;
}) {
  const [state, formAction, pending] = useActionState(
    setNotificationPreferenceAction.bind(null, locale, kind, !inProduct),
    null,
  );
  const cap = NOTIFICATION_HOURLY_CAP[kind];

  return (
    <li className="flex flex-wrap items-center justify-between gap-2 border-b border-default py-2">
      <span className="flex flex-col">
        <span className="text-sm">{label}</span>
        <span className="text-xs text-muted">
          {/* Said out loud, because "Default" and "your choice that happens to
              match the default" behave differently the day a default changes. */}
          {chosen ? 'Your choice' : 'Default'}
          {cap !== undefined && ` · at most ${String(cap)} an hour`}
        </span>
      </span>
      <form action={formAction}>
        <Button
          type="submit"
          pending={pending}
          // The state is in the label and in `aria-pressed`, not only in a
          // border: a border does not reach a screen reader.
          aria-pressed={inProduct}
          selected={inProduct}
          data-testid={`notification-kind-${kind}`}
        >
          {inProduct ? 'On' : 'Off'}
        </Button>
        {state !== null && !state.ok && (
          <FormStatus ok={false} as="span" size="xs" className="ms-2">
            {state.message}
          </FormStatus>
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
  matchAlerts,
}: {
  locale: string;
  settings: NotificationSettings;
  /** The match-alert section, rendered on the server with its catalogue words (T-831). */
  matchAlerts?: ReactNode;
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
          {settings.preferences.filter(isListedHere).map((preference) => (
            <KindRow
              key={preference.kind}
              locale={locale}
              kind={preference.kind}
              label={KIND_LABEL[preference.kind]}
              inProduct={preference.in_product}
              chosen={preference.chosen}
            />
          ))}
        </ul>
      </section>

      {matchAlerts}

      <section className="flex flex-col gap-3" data-testid="notification-mutes">
        <h2 className="text-lg font-semibold">What stays quiet</h2>
        <p className="text-sm text-muted">
          Silence one team without silencing football. A silenced team or competition stops what is
          about its matches and nothing else; a silenced category stops every kind in it. The
          switches above are untouched.
        </p>
        {settings.mutes.length === 0 ? (
          <p className="text-sm text-muted" data-testid="no-mutes">
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
          <p role="status" className="text-sm text-muted">
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
          <p role="status" className="text-sm text-muted">
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
        <p className="text-sm text-muted" data-testid="quiet-hours-explainer">
          Nothing is thrown away. A notification that arrives during your quiet hours waits until
          they end, and says so. Times are on your own clock ({settings.timezone}).
        </p>
        <form action={quietAction} className="flex flex-wrap items-end gap-3">
          <TextField
            label="From"
            type="time"
            name="starts_at"
            size="sm"
            defaultValue={settings.quiet_hours?.starts_at ?? ''}
          />
          <TextField
            label="Until"
            type="time"
            name="ends_at"
            size="sm"
            defaultValue={settings.quiet_hours?.ends_at ?? ''}
          />
          <Button type="submit" pending={quietPending} data-testid="quiet-hours-save">
            Save
          </Button>
          {/* Cleared by submitting both fields empty, rather than by a second
              button that would be a second thing to explain. */}
          <span className="text-xs text-muted">Leave both empty to clear them.</span>
        </form>
        {quietState !== null && (
          <FormStatus ok={quietState.ok} data-testid="quiet-hours-result">
            {quietState.message}
          </FormStatus>
        )}
      </section>
    </div>
  );
}
