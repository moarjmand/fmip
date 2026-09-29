'use client';

import { useActionState } from 'react';
import Link from 'next/link';
import {
  HOMEPAGE_FEATURE_MAX_HOURS,
  HOMEPAGE_FEATURE_MIN_HOURS,
  type HomepageFeatureRecord,
} from '@fmip/contracts';
import { clearFeatureAction, featureMatchAction } from '@/lib/homepage-feature-actions';
import { Button, Card, FormStatus, Notice, TextArea, TextField } from '@/components/ui';

/**
 * Featured matches on the homepage (T-1161, D-153): an editor features a
 * match for a window with a note readers see, and may clear it early with a
 * reason. The homepage lists them first after a member's own favourites.
 * Unrelated to a match's public discussion (the panels page, T-613).
 */

function FeatureForm({ locale }: { locale: string }) {
  const [state, formAction, pending] = useActionState(featureMatchAction.bind(null, locale), null);
  return (
    <form action={formAction} className="flex flex-col gap-2">
      <TextField label="The match page's address, or the match id" name="match" required />
      <TextArea
        label="Why it is featured (readers see this beside the match)"
        name="note"
        rows={2}
        required
        maxLength={300}
      />
      <TextField
        label="For how many hours"
        name="hours"
        type="number"
        min={HOMEPAGE_FEATURE_MIN_HOURS}
        max={HOMEPAGE_FEATURE_MAX_HOURS}
        step={1}
        defaultValue={24}
        required
        hint={`From ${HOMEPAGE_FEATURE_MIN_HOURS} to ${HOMEPAGE_FEATURE_MAX_HOURS} (two weeks). It ends by itself.`}
      />
      <Button
        type="submit"
        pending={pending}
        pendingLabel="Recording…"
        data-testid="feature-match"
        className="self-start"
      >
        Feature on the homepage
      </Button>
      {state !== null && <FormStatus ok={state.ok}>{state.message}</FormStatus>}
    </form>
  );
}

function ClearForm({ locale, fixtureId }: { locale: string; fixtureId: string }) {
  const [state, formAction, pending] = useActionState(
    clearFeatureAction.bind(null, locale, fixtureId),
    null,
  );
  return (
    <form action={formAction} className="flex flex-col gap-1">
      <TextArea
        label="Why, for clearing it"
        hideLabel
        name="reason"
        rows={2}
        required
        placeholder="Say why. This is recorded."
      />
      <Button
        type="submit"
        pending={pending}
        pendingLabel="Recording…"
        data-testid={`feature-clear-${fixtureId}`}
        className="self-start"
      >
        Clear now
      </Button>
      {state !== null && <FormStatus ok={state.ok}>{state.message}</FormStatus>}
    </form>
  );
}

function When({ iso }: { iso: string }) {
  return <time dateTime={iso}>{iso.slice(0, 16).replace('T', ' ')} UTC</time>;
}

export function HomepageFeaturesAdmin({
  locale,
  features,
  reachable,
}: {
  locale: string;
  features: HomepageFeatureRecord[];
  reachable: boolean;
}) {
  if (!reachable) {
    return (
      <Notice tone="danger" data-testid="homepage-features-unreachable">
        The homepage&rsquo;s features cannot be shown right now.
      </Notice>
    );
  }
  const live = features.filter((feature) => feature.state === 'live');
  const past = features.filter((feature) => feature.state !== 'live');

  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">Feature a match</h2>
        <FeatureForm locale={locale} />
      </section>

      <section className="flex flex-col gap-2" data-testid="homepage-features-live">
        <h2 className="text-lg font-semibold">Featured now</h2>
        {live.length === 0 ? (
          <p className="text-sm text-muted">
            Nothing is featured; the homepage lists matches in the reader&rsquo;s own order.
          </p>
        ) : (
          <ul className="flex flex-col gap-4">
            {live.map((feature) => (
              <Card as="li" key={feature.fixture_id} className="text-sm">
                <p>
                  <Link
                    href={`/${locale}/match/${feature.fixture_id}`}
                    className="font-medium underline"
                  >
                    <bdi>{feature.home}</bdi> – <bdi>{feature.away}</bdi>
                  </Link>
                  <span className="ms-2 text-muted">
                    kick-off <When iso={feature.kickoff_at} />, until <When iso={feature.ends_at} />
                  </span>
                </p>
                <p className="text-muted">
                  Featured by {feature.featured_by}: {feature.note}
                </p>
                <ClearForm locale={locale} fixtureId={feature.fixture_id} />
              </Card>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-2" data-testid="homepage-features-past">
        <h2 className="text-lg font-semibold">Ended</h2>
        {past.length === 0 ? (
          <p className="text-sm text-muted">None yet.</p>
        ) : (
          <ul className="flex flex-col gap-2 text-sm">
            {past.map((feature) => (
              <li key={`${feature.fixture_id}-${feature.featured_at}`}>
                <Link href={`/${locale}/match/${feature.fixture_id}`} className="underline">
                  <bdi>{feature.home}</bdi> – <bdi>{feature.away}</bdi>
                </Link>
                <span className="ms-2 text-muted">
                  {feature.state === 'cleared'
                    ? `cleared by ${feature.cleared_by ?? 'unknown'}: ${feature.cleared_reason ?? ''}`
                    : 'its window ran out'}{' '}
                  (featured by {feature.featured_by}: {feature.note})
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
