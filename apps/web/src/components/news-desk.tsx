import Link from 'next/link';
import {
  STORY_TYPES,
  type BreakingRecord,
  type DebateRecord,
  type NewsStoryCard,
  type StoryType,
} from '@fmip/contracts';
import { ActionForm } from '@/components/action-form';
import { StoryTypeTag } from '@/components/story-type';
import { clearBreakingAction, markBreakingAction } from '@/lib/breaking-actions';
import { clearDebateAction, selectDebateAction } from '@/lib/debate-actions';
import { DESK_EVENT_LABEL, type DeskEvent } from '@/lib/news-desk';
import { labelStoryTypeAction } from '@/lib/story-type-actions';
import { Button, Card, Notice, TextField } from '@/components/ui';

/**
 * The editor's news desk (T-1009): debates, story types and breaking on one
 * page, over the audited APIs of T-143, T-1001 and T-1004. Every action
 * takes the note or the reason its API asks for, and the chosen story shows
 * its record of decisions (rule 10). The desk adds no API of its own.
 */

export interface DeskSelection {
  card: NewsStoryCard;
  /** The story's selection on the debate page now, if any. */
  debate: DebateRecord | null;
  history: DeskEvent[];
  /** Whether the type's earlier labels could be read (the audit log is administrators' only). */
  typeHistory: 'shown' | 'administrators_only';
}

function deskHref(locale: string, storyId: string): string {
  return `/${locale}/admin/news?story=${storyId}`;
}

function When({ at }: { at: string }) {
  return <time dateTime={at}>{at.slice(0, 16).replace('T', ' ')} UTC</time>;
}

function History({
  selection,
  typeNames,
}: {
  selection: DeskSelection;
  typeNames: Record<StoryType, string>;
}) {
  return (
    <section className="flex flex-col gap-2" data-testid="desk-history">
      <h3 className="font-semibold">Record of decisions</h3>
      {selection.typeHistory === 'administrators_only' && (
        <p className="text-sm text-muted" data-testid="desk-type-history-hidden">
          Earlier types are in the audit log, which only administrators can read; the current type
          and whose word it is are shown above.
        </p>
      )}
      {selection.history.length === 0 ? (
        <p className="text-sm text-muted" data-testid="desk-history-empty">
          No editor has decided anything about this story yet.
        </p>
      ) : (
        <ol className="flex flex-col gap-2 text-sm">
          {selection.history.map((event, index) => (
            <li
              key={`${event.kind}-${event.at}-${String(index)}`}
              data-testid="desk-history-event"
              data-kind={event.kind}
            >
              <span className="font-medium">{DESK_EVENT_LABEL[event.kind]}</span>
              {event.type !== undefined && (
                <span>
                  {': '}
                  {event.type.previous === null ? 'none' : typeNames[event.type.previous]} →{' '}
                  {typeNames[event.type.next]}
                </span>
              )}
              <span className="ms-2 text-muted">
                <When at={event.at} />
                {event.by !== null && ` by ${event.by}`}
              </span>
              {event.words !== null && (
                <span className="block ps-4" dir="auto">
                  {event.words}
                </span>
              )}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function StoryPanel({
  locale,
  selection,
  typeNames,
}: {
  locale: string;
  selection: DeskSelection;
  typeNames: Record<StoryType, string>;
}) {
  const { card, debate } = selection;
  const current = card.type.data?.type;
  return (
    <Card heading="The chosen story" data-testid="desk-story">
      <p>
        <a href={card.url} className="font-medium underline" lang={card.language} dir="auto">
          {card.headline}
        </a>
        <span className="ms-2 text-sm text-muted">{card.source.name}</span>
      </p>
      <StoryTypeTag locale={locale} type={card.type} sayNone />

      <div className="grid gap-6 md:grid-cols-3">
        <section className="flex flex-col gap-2" data-testid="desk-type">
          <h3 className="font-semibold">Type</h3>
          <ActionForm
            action={labelStoryTypeAction.bind(null, locale, card.story_id)}
            fields={[
              {
                name: 'type',
                label: 'Type',
                type: 'select',
                required: true,
                defaultValue: current ?? '',
                options: [
                  { value: '', label: 'Choose a type' },
                  ...STORY_TYPES.map((type) => ({ value: type, label: typeNames[type] })),
                ],
              },
              { name: 'reason', label: 'Why', type: 'textarea', required: true, maxLength: 2000 },
            ]}
            submitLabel="Give this type"
            testId="desk-type-form"
          />
        </section>

        <section className="flex flex-col gap-2" data-testid="desk-breaking">
          <h3 className="font-semibold">Breaking</h3>
          {card.breaking === null ? (
            <ActionForm
              action={markBreakingAction.bind(null, locale, card.story_id)}
              fields={[
                {
                  name: 'note',
                  label: 'Note readers see on the homepage',
                  type: 'textarea',
                  required: true,
                  maxLength: 500,
                },
              ]}
              submitLabel="Mark breaking"
              testId="desk-breaking-mark"
            />
          ) : (
            <>
              <p className="text-sm" dir="auto">
                Marked until <When at={card.breaking.ends_at} />: {card.breaking.note}
              </p>
              <ActionForm
                action={clearBreakingAction.bind(null, locale, card.story_id)}
                fields={[
                  {
                    name: 'reason',
                    label: 'Why',
                    type: 'textarea',
                    required: true,
                    maxLength: 500,
                  },
                ]}
                submitLabel="Clear the mark"
                testId="desk-breaking-clear"
              />
            </>
          )}
        </section>

        <section className="flex flex-col gap-2" data-testid="desk-debate">
          <h3 className="font-semibold">Debate</h3>
          {debate === null ? (
            <ActionForm
              action={selectDebateAction.bind(null, locale, card.story_id)}
              fields={[
                {
                  name: 'note',
                  label: 'Note readers see beside the story',
                  type: 'textarea',
                  required: true,
                  maxLength: 2000,
                },
              ]}
              submitLabel="Put on the debate page"
              testId="desk-debate-select"
            />
          ) : (
            <>
              <p className="text-sm" dir="auto">
                On the debate page since <When at={debate.selected_at} />: {debate.note}
              </p>
              <ActionForm
                action={clearDebateAction.bind(null, locale, card.story_id)}
                fields={[
                  {
                    name: 'reason',
                    label: 'Why',
                    type: 'textarea',
                    required: true,
                    maxLength: 2000,
                  },
                ]}
                submitLabel="Take it off"
                testId="desk-debate-clear"
              />
            </>
          )}
        </section>
      </div>

      <History selection={selection} typeNames={typeNames} />
    </Card>
  );
}

export function NewsDesk({
  locale,
  typeNames,
  stories,
  openDebates,
  liveMarks,
  selection,
  asked,
}: {
  locale: string;
  typeNames: Record<StoryType, string>;
  /** The latest stories, or `null` when they could not be read. */
  stories: NewsStoryCard[] | null;
  openDebates: DebateRecord[];
  liveMarks: BreakingRecord[];
  selection: DeskSelection | null;
  /** The story asked for by `?story=`, when it could not be found. */
  asked: string | null;
}) {
  const onDebate = new Set(openDebates.map((d) => d.story_id));
  return (
    <div className="flex flex-col gap-8">
      <form method="get" className="flex flex-wrap items-end gap-2" data-testid="desk-open">
        <TextField
          label="A story's address or id"
          name="story"
          defaultValue={selection?.card.story_id ?? asked ?? ''}
          className="grow"
        />
        <Button type="submit">Open on the desk</Button>
      </form>

      {asked !== null && selection === null && (
        <Notice tone="warning" data-testid="desk-no-story">
          No story has that id.
        </Notice>
      )}
      {selection !== null && (
        <StoryPanel locale={locale} selection={selection} typeNames={typeNames} />
      )}

      <Card heading="Breaking now" data-testid="desk-live-marks">
        {liveMarks.length === 0 ? (
          <p className="text-sm text-muted">
            No story is marked breaking; the homepage has no strip.
          </p>
        ) : (
          <ul className="flex flex-col gap-2 text-sm">
            {liveMarks.map((mark) => (
              <li key={mark.story_id}>
                <Link href={deskHref(locale, mark.story_id)} className="underline" dir="auto">
                  {mark.headline ?? 'A story with no headline'}
                </Link>
                <span className="ms-2 text-muted">
                  by {mark.marked_by}, until <When at={mark.ends_at} />
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card heading="On the debate page" data-testid="desk-open-debates">
        {openDebates.length === 0 ? (
          <p className="text-sm text-muted">No story is on the debate page.</p>
        ) : (
          <ul className="flex flex-col gap-2 text-sm">
            {openDebates.map((debate) => (
              <li key={debate.story_id}>
                <Link href={deskHref(locale, debate.story_id)} className="underline" dir="auto">
                  {debate.headline ?? 'A story with no headline'}
                </Link>
                <span className="ms-2 text-muted">by {debate.selected_by}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card heading="Latest stories" data-testid="desk-latest">
        {stories === null ? (
          <Notice tone="danger" data-testid="desk-latest-unreachable">
            The latest stories cannot be shown right now.
          </Notice>
        ) : stories.length === 0 ? (
          <p className="text-sm text-muted">No story has been read from the feeds yet.</p>
        ) : (
          <ul className="flex flex-col gap-3 text-sm">
            {stories.map((card) => (
              <li key={card.story_id} data-testid="desk-story-item">
                <Link
                  href={deskHref(locale, card.story_id)}
                  className="font-medium underline"
                  lang={card.language}
                  dir="auto"
                >
                  {card.headline}
                </Link>
                <span className="ms-2 text-muted">
                  {card.source.name}
                  {card.breaking !== null && ' · breaking'}
                  {onDebate.has(card.story_id) && ' · on the debate page'}
                  {card.type.data !== null && ` · ${typeNames[card.type.data.type]}`}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
