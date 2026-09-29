'use client';

import { useActionState } from 'react';
import {
  NEWS_SOURCE_KINDS,
  NEWS_SOURCE_RIGHTS,
  type NewsFeedPreview,
  type NewsSourceRecord,
  type RobotsVerdict,
} from '@fmip/contracts';
import { ActionForm, type Field } from '@/components/action-form';
import {
  addNewsSourceAction,
  dropNewsSourceAction,
  editNewsSourceAction,
  previewNewsFeedAction,
} from '@/lib/news-source-actions';
import { Button, Card, FormStatus, Notice, TextField } from '@/components/ui';

/**
 * News sources in the console (T-1015): read a feed once -- its robots.txt,
 * then the feed -- and see what it would yield before adding it; edit a
 * source, a new address read again; drop one with a reason. Every write
 * takes a reason and is audited (rule 10). Which publishers to carry, and
 * what their terms grant, are the maintainer's (N-8, D-061): this page
 * records the choice and makes none.
 */

const RIGHTS_LABEL: Record<(typeof NEWS_SOURCE_RIGHTS)[number], string> = {
  headline: 'Headline only',
  summary: "Headline and the publisher's summary",
};

const ROBOTS_LABEL: Record<RobotsVerdict, string> = {
  allowed: 'robots.txt allows the feed.',
  absent: 'No robots.txt (it answered {status}), which allows everything.',
  disallowed: 'robots.txt disallows the feed for our reader, so it was not fetched.',
  unreachable: 'robots.txt could not be asked, so the feed was not fetched.',
};

function origin(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return '';
  }
}

function sourceFields(defaults: {
  name: string;
  homepage_url: string;
  feed_url: string;
  kind: string;
  rights: string;
  language: string;
  feedHidden: boolean;
}): Field[] {
  return [
    { name: 'name', label: 'Name', required: true, defaultValue: defaults.name, maxLength: 200 },
    {
      name: 'homepage_url',
      label: 'Homepage',
      type: 'url',
      required: true,
      defaultValue: defaults.homepage_url,
    },
    defaults.feedHidden
      ? { name: 'feed_url', label: 'Feed address', type: 'hidden', defaultValue: defaults.feed_url }
      : {
          name: 'feed_url',
          label: 'Feed address',
          type: 'url',
          required: true,
          defaultValue: defaults.feed_url,
          hint: 'A new address is read again, after its robots.txt, before it is saved.',
        },
    {
      name: 'kind',
      label: 'Kind',
      type: 'select',
      defaultValue: defaults.kind,
      options: NEWS_SOURCE_KINDS.map((kind) => ({ value: kind, label: kind.toUpperCase() })),
    },
    {
      name: 'rights',
      label: 'What their terms grant (D-061)',
      type: 'select',
      defaultValue: defaults.rights,
      options: NEWS_SOURCE_RIGHTS.map((rights) => ({ value: rights, label: RIGHTS_LABEL[rights] })),
    },
    {
      name: 'language',
      label: 'Language they write in',
      required: true,
      defaultValue: defaults.language,
      hint: 'A language tag, such as en or pt-BR.',
      maxLength: 35,
    },
    { name: 'reason', label: 'Why', type: 'textarea', required: true, maxLength: 500 },
  ];
}

export function FeedPreview({ preview }: { preview: NewsFeedPreview }) {
  const robots = ROBOTS_LABEL[preview.robots.verdict].replace(
    '{status}',
    String(preview.robots.status ?? '?'),
  );
  return (
    <div className="flex flex-col gap-2 text-sm" data-testid="feed-preview">
      <p data-testid="feed-preview-robots" data-verdict={preview.robots.verdict}>
        {robots}
      </p>
      {preview.feed !== null && !preview.feed.ok && (
        <Notice tone="danger" data-testid="feed-preview-failed">
          The feed could not be read: {preview.feed.error}
        </Notice>
      )}
      {preview.feed?.ok === true && (
        <>
          <p data-testid="feed-preview-summary">
            {preview.feed.kind.toUpperCase()}
            {preview.feed.title !== null && <> · {preview.feed.title}</>}
            {' · '}
            {preview.feed.language ?? 'no language declared'} · {preview.feed.items} item
            {preview.feed.items === 1 ? '' : 's'}
            {preview.feed.skipped > 0 &&
              `, ${String(preview.feed.skipped)} skipped (no headline or link)`}
          </p>
          {preview.feed.sample.length === 0 ? (
            <p className="text-muted">The feed carries no items now.</p>
          ) : (
            <ul className="flex flex-col gap-2 ps-3">
              {preview.feed.sample.map((item) => (
                <li key={item.url} data-testid="feed-preview-item">
                  <a
                    href={item.url}
                    className="font-medium underline"
                    dir="auto"
                    lang={item.language ?? undefined}
                  >
                    {item.headline}
                  </a>
                  <span className="ms-2 text-muted">{item.published_at ?? 'no time given'}</span>
                  {item.summary !== null && (
                    <span className="block text-muted" dir="auto">
                      {item.summary}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}

function AddSource({ locale }: { locale: string }) {
  const [state, action, pending] = useActionState(previewNewsFeedAction, null);
  const preview = state?.ok === true ? state.preview : null;
  const addable =
    preview !== null &&
    (preview.robots.verdict === 'allowed' || preview.robots.verdict === 'absent') &&
    preview.feed?.ok === true;
  return (
    <Card heading="Add a source" data-testid="news-source-add">
      <p className="text-sm text-muted">
        Which publishers to carry, and what their terms grant, is the maintainer&apos;s decision
        (N-8, D-061). The feed is read once, after its robots.txt, before anything is saved.
      </p>
      <form
        action={action}
        className="flex flex-wrap items-end gap-2"
        data-testid="feed-preview-form"
      >
        <TextField
          label="Feed address"
          name="feed_url"
          type="url"
          required
          className="grow"
          error={state?.ok === false ? state.fields?.feed_url : undefined}
        />
        <Button type="submit" pending={pending} pendingLabel="Reading…">
          Read the feed
        </Button>
      </form>
      {state?.ok === false && <FormStatus ok={false}>{state.message}</FormStatus>}
      {preview !== null && <FeedPreview preview={preview} />}
      {addable && preview.feed?.ok === true && (
        <ActionForm
          key={preview.checked_at}
          action={addNewsSourceAction.bind(null, locale)}
          fields={sourceFields({
            name: preview.feed.title ?? '',
            homepage_url: origin(preview.feed_url),
            feed_url: preview.feed_url,
            kind: preview.feed.kind,
            rights: 'headline',
            language: preview.feed.language ?? '',
            feedHidden: true,
          })}
          submitLabel="Add this source"
          testId="news-source-add-form"
        />
      )}
    </Card>
  );
}

function Source({ locale, source }: { locale: string; source: NewsSourceRecord }) {
  const dropped = source.dropped_at !== null;
  return (
    <Card as="li" data-testid="news-source" data-dropped={dropped ? 'true' : 'false'}>
      <p>
        <span className="font-semibold">{source.name}</span>
        <span className="ms-2 text-sm text-muted">
          {source.kind} ·{' '}
          {source.rights === 'full_text' ? 'Full text' : RIGHTS_LABEL[source.rights]} ·{' '}
          {source.language}
        </span>
      </p>
      <p className="text-sm">
        <a href={source.homepage_url} className="underline">
          {source.homepage_url}
        </a>
        {source.feed_url !== null && (
          <>
            {' · feed '}
            <span className="break-all">{source.feed_url}</span>
          </>
        )}
      </p>
      <p className="text-sm text-muted" data-testid="news-source-fetch">
        {source.last_fetch === null
          ? 'Never read.'
          : `Last read ${source.last_fetch.started_at}: ${source.last_fetch.status}, ${String(source.last_fetch.items_written)} of ${String(source.last_fetch.items_seen)} items written${source.last_fetch.error !== null ? ` (${source.last_fetch.error})` : ''}.`}
      </p>
      {dropped ? (
        <p className="text-sm" data-testid="news-source-dropped">
          Dropped {source.dropped_at}: {source.dropped_reason}
        </p>
      ) : (
        <>
          {source.kind !== 'licensed' && (
            <details>
              <summary className="cursor-pointer text-sm underline">Edit</summary>
              <ActionForm
                action={editNewsSourceAction.bind(null, locale, source.id)}
                fields={sourceFields({
                  name: source.name,
                  homepage_url: source.homepage_url,
                  feed_url: source.feed_url ?? '',
                  kind: source.kind,
                  rights: source.rights,
                  language: source.language,
                  feedHidden: false,
                })}
                submitLabel="Save"
                testId={`news-source-edit-${source.id}`}
              />
            </details>
          )}
          <details>
            <summary className="cursor-pointer text-sm underline">Drop</summary>
            <ActionForm
              action={dropNewsSourceAction.bind(null, locale, source.id)}
              fields={[
                {
                  name: 'reason',
                  label: 'Why (a publisher who asks to be dropped is dropped)',
                  type: 'textarea',
                  required: true,
                  maxLength: 500,
                },
              ]}
              submitLabel="Drop this source"
              testId={`news-source-drop-${source.id}`}
            />
          </details>
        </>
      )}
    </Card>
  );
}

export function NewsSourcesAdmin({
  locale,
  sources,
}: {
  locale: string;
  sources: NewsSourceRecord[];
}) {
  const carried = sources.filter((s) => s.dropped_at === null);
  const dropped = sources.filter((s) => s.dropped_at !== null);
  return (
    <div className="flex flex-col gap-8">
      <AddSource locale={locale} />
      <section className="flex flex-col gap-3" data-testid="news-sources-carried">
        <h2 className="text-lg font-semibold">Carried</h2>
        {carried.length === 0 ? (
          <p className="text-sm text-muted">No source is carried, so the product shows no news.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {carried.map((source) => (
              <Source key={source.id} locale={locale} source={source} />
            ))}
          </ul>
        )}
      </section>
      {dropped.length > 0 && (
        <section className="flex flex-col gap-3" data-testid="news-sources-dropped">
          <h2 className="text-lg font-semibold">Dropped</h2>
          <ul className="flex flex-col gap-3">
            {dropped.map((source) => (
              <Source key={source.id} locale={locale} source={source} />
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
