'use client';

import Link from 'next/link';
import { useActionState } from 'react';
import { VIEWING_ACCESS, type Broadcaster, type ViewingUpcomingFixture } from '@fmip/contracts';
import type { ActionState } from '@/lib/auth-actions';
import { bulkListAction } from '@/lib/viewing-console-actions';
import {
  ACCESS_LABEL,
  consoleTime,
  listingBadge,
  matchContext,
  matchLabel,
  preChecked,
} from '@/lib/viewing-console';
import { Button, FormStatus, Select, TextField } from '@/components/ui';

/**
 * The upcoming matches as one form (T-1361): a box per match, then the
 * service, the access and the page, and "List selected". The table lives
 * inside the form so the boxes are its fields; a listing's removal is its
 * own form, so it is rendered after this one (HTML has no nested forms) and
 * the table links to it. A covered match with nothing listed starts ticked;
 * an uncovered one cannot be ticked, because the API refuses the whole
 * request for it.
 */
export function ViewingBulkForm({
  locale,
  territory,
  fixtures,
  broadcasters,
}: {
  locale: string;
  territory: string;
  fixtures: ViewingUpcomingFixture[];
  broadcasters: Broadcaster[];
}) {
  const [state, formAction, pending] = useActionState(
    bulkListAction.bind(null, locale, territory),
    null,
  );
  const fields = state !== null && !state.ok ? (state.fields ?? {}) : {};

  return (
    <form action={formAction} className="flex flex-col gap-4" data-testid="viewing-bulk-form">
      <div className="overflow-x-auto">
        <table className="w-full text-start text-sm" data-testid="viewing-upcoming">
          <thead>
            <tr className="border-b text-muted">
              <th className="p-2 text-start font-medium">
                <span className="sr-only">Select</span>
              </th>
              <th className="p-2 text-start font-medium">Kickoff</th>
              <th className="p-2 text-start font-medium">Match</th>
              <th className="p-2 text-start font-medium">Status</th>
              <th className="p-2 text-start font-medium">Covered</th>
              <th className="p-2 text-start font-medium">Listings in {territory}</th>
            </tr>
          </thead>
          <tbody>
            {fixtures.map((fixture) => {
              const context = matchContext(fixture);
              return (
                <tr key={fixture.id} className="border-b align-top">
                  <td className="p-2">
                    <input
                      type="checkbox"
                      name="fixture_ids"
                      value={fixture.id}
                      defaultChecked={preChecked(fixture)}
                      disabled={!fixture.covered}
                      aria-label={`Select ${matchLabel(fixture)}`}
                      className="size-4"
                      data-testid={`bulk-pick-${fixture.id}`}
                    />
                  </td>
                  <td className="p-2 whitespace-nowrap">
                    <time dateTime={fixture.kickoff_at}>{consoleTime(fixture.kickoff_at)}</time>
                  </td>
                  <td className="p-2">
                    <Link href={`/${locale}/match/${fixture.id}`} className="underline">
                      <bdi>{matchLabel(fixture)}</bdi>
                    </Link>
                    {context !== '' && <span className="block text-muted">{context}</span>}
                  </td>
                  <td className="p-2">{fixture.status}</td>
                  <td className="p-2">{fixture.covered ? 'yes' : 'no'}</td>
                  <td className="p-2">
                    {fixture.options.length === 0 ? (
                      <span className="text-muted">none</span>
                    ) : (
                      <ul className="flex flex-col gap-1">
                        {fixture.options.map((option) => (
                          <li key={option.id} data-testid={`listing-${option.id}`}>
                            <bdi>{option.broadcaster.name}</bdi> · {ACCESS_LABEL[option.access]}
                            {listingBadge(option) === 'default' && (
                              <span
                                className="ms-2 rounded border px-1 text-xs"
                                data-testid="listing-default-badge"
                              >
                                default
                              </span>
                            )}{' '}
                            <a href={`#remove-${option.id}`} className="text-muted underline">
                              remove…
                            </a>
                          </li>
                        ))}
                      </ul>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {broadcasters.length === 0 ? (
        <p className="text-sm text-muted" data-testid="bulk-no-broadcasters">
          Add a broadcaster before listing matches.
        </p>
      ) : (
        <div className="flex flex-wrap items-end gap-3">
          <Select
            label="Service"
            name="broadcaster_id"
            size="sm"
            error={fields.broadcaster_id}
            id="bulk-broadcaster"
          >
            {broadcasters.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </Select>
          <Select label="Access" name="access" size="sm" error={fields.access} id="bulk-access">
            {VIEWING_ACCESS.map((access) => (
              <option key={access} value={access}>
                {ACCESS_LABEL[access]}
              </option>
            ))}
          </Select>
          <TextField
            label="Official page"
            name="url"
            type="url"
            size="sm"
            required
            error={fields.url}
            id="bulk-url"
            className="min-w-64 flex-1"
          />
          <Button
            type="submit"
            size="sm"
            variant="primary"
            pending={pending}
            pendingLabel="Listing…"
            data-testid="bulk-submit"
          >
            List selected
          </Button>
        </div>
      )}
      {state !== null && (
        <FormStatus ok={state.ok} boxed>
          {state.message}
        </FormStatus>
      )}
    </form>
  );
}

/**
 * A removal with its reason (a listing, a default): one field, its own id
 * per form, so a page of them keeps each label tied to its own box.
 */
export function ViewingReasonForm({
  action,
  submitLabel,
  testId,
}: {
  action: (state: ActionState, formData: FormData) => Promise<ActionState>;
  submitLabel: string;
  testId: string;
}) {
  const [state, formAction, pending] = useActionState(action, null);
  const error = state !== null && !state.ok ? state.fields?.reason : undefined;
  return (
    <form action={formAction} className="flex flex-wrap items-end gap-2" data-testid={testId}>
      <TextField
        label="Why"
        name="reason"
        size="sm"
        required
        placeholder="Say why. This is recorded."
        error={error}
        className="min-w-48 flex-1"
      />
      <Button type="submit" size="sm" variant="danger" pending={pending} pendingLabel="Removing…">
        {submitLabel}
      </Button>
      {state !== null && (
        <FormStatus ok={state.ok} className="w-full">
          {state.message}
        </FormStatus>
      )}
    </form>
  );
}
