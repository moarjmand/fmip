'use client';

import { useActionState } from 'react';
import { COMPETITION_ORDER_MAX, type AdminCompetition } from '@fmip/contracts';
import { setCompetitionOrderAction } from '@/lib/competition-order-actions';
import { Button, Card, FormStatus, Notice, TextField } from '@/components/ui';

/**
 * The competitions' order (T-1162, D-154): where each competition sits on the
 * scores page and the homepage after a member's favourites, in the order
 * readers meet them now. Each change takes a reason and is recorded, as
 * `catalog.mjs --set-order` records it; an empty place clears it.
 */

function OrderForm({ locale, competition }: { locale: string; competition: AdminCompetition }) {
  const [state, formAction, pending] = useActionState(
    setCompetitionOrderAction.bind(null, locale, competition.id),
    null,
  );
  const fields = state !== null && !state.ok ? state.fields : undefined;
  return (
    <form action={formAction} className="flex flex-wrap items-end gap-2">
      <TextField
        label="Place"
        name="order"
        type="number"
        min={1}
        max={COMPETITION_ORDER_MAX}
        step={1}
        size="sm"
        defaultValue={competition.display_order ?? ''}
        hint="1 first; empty clears it"
        error={fields?.order}
        className="w-32"
      />
      <TextField
        label="Why"
        name="reason"
        size="sm"
        required
        placeholder="Say why. This is recorded."
        error={fields?.reason}
        className="min-w-48 flex-1"
      />
      <Button
        type="submit"
        size="sm"
        pending={pending}
        pendingLabel="Recording…"
        data-testid={`competition-order-${competition.id}`}
      >
        Set
      </Button>
      {state !== null && (
        <FormStatus ok={state.ok} className="w-full">
          {state.message}
        </FormStatus>
      )}
    </form>
  );
}

export function CompetitionOrderAdmin({
  locale,
  competitions,
  reachable,
}: {
  locale: string;
  competitions: AdminCompetition[];
  reachable: boolean;
}) {
  if (!reachable) {
    return (
      <Notice tone="danger" data-testid="competition-order-unreachable">
        The competitions cannot be shown right now.
      </Notice>
    );
  }
  if (competitions.length === 0) {
    return (
      <p className="text-sm text-muted" data-testid="competition-order-empty">
        No competition is in the catalogue yet.
      </p>
    );
  }
  return (
    <ol className="flex flex-col gap-3" data-testid="competition-order">
      {competitions.map((competition) => (
        <Card as="li" key={competition.id} className="flex flex-col gap-2 text-sm">
          <p>
            <span className="font-medium">
              <bdi>{competition.name}</bdi>
            </span>
            <span className="ms-2 text-muted">
              {competition.country ?? 'International'}
              {' · '}
              {competition.display_order === null
                ? 'no stated place'
                : `place ${competition.display_order}`}
              {competition.is_active ? '' : ' · not carried'}
            </span>
          </p>
          <OrderForm locale={locale} competition={competition} />
        </Card>
      ))}
    </ol>
  );
}
