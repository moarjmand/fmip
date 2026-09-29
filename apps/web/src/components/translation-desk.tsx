'use client';

import { useActionState } from 'react';
import type {
  TranslationCheckResult,
  TranslationDesk as Desk,
  TranslationField,
  TranslationMemoryEntry,
} from '@fmip/contracts';
import { directionOf } from '@/i18n/locales';
import {
  reviewTranslationAction,
  writeTranslationAction,
  type DeskState,
} from '@/lib/translation-actions';
import { Button, Card, FormStatus, Notice, TextArea } from '@/components/ui';

/**
 * The translator's desk for one article (T-1013): the publisher's words, the
 * glossary terms they use, the write form and the review form over T-304's
 * API, with each automatic check (T-1012) beside the field it concerns.
 *
 * **Nothing here writes a word in another language.** The write form starts
 * from the newest translation of this article -- the translator's own words,
 * or empty -- and the glossary terms are shown beside it to read, never
 * inserted (D-066, D-130). Who may review is the API's rule (never the
 * author); the page only says so instead of offering a button that would be
 * refused.
 */

const FIELD_LABELS: Record<TranslationField, string> = {
  headline: 'Headline',
  summary: 'Summary',
  byline: 'Byline',
};

const OUTCOME_WORDS = {
  pass: ['passes', 'text-success'],
  fail: ['fails', 'text-danger'],
  not_checked: ['not checked', 'text-muted'],
} as const;

/** The checks on one field, each in words: the colour is never the only signal. */
export function FieldChecks({
  field,
  results,
}: {
  field: TranslationField;
  results: TranslationCheckResult[];
}) {
  const mine = results.filter((result) => result.field === field);
  if (mine.length === 0) return null;
  return (
    <ul className="flex flex-col gap-1 text-xs" data-testid={`desk-checks-${field}`}>
      {mine.map((result) => {
        const [word, tone] = OUTCOME_WORDS[result.outcome];
        return (
          <li key={result.check} data-testid={`desk-check-${field}-${result.check}`}>
            <span className={`font-medium ${tone}`}>
              {result.check} {word}
            </span>
            {result.outcome !== 'pass' && <span className="ms-2">{result.detail}</span>}
          </li>
        );
      })}
    </ul>
  );
}

const fieldId = (field: TranslationField) => `desk-field-${field}`;

/**
 * Put a remembered translation into its field, because the translator chose
 * it (T-1014, D-130). The only way words from memory reach the form: nothing
 * is copied on load, and the translator edits or saves it like their own.
 */
function copyInto(field: TranslationField, text: string) {
  const control = document.getElementById(fieldId(field));
  if (control instanceof HTMLTextAreaElement) {
    control.value = text;
    control.focus();
  }
}

/** Translation memory for one field: exact matches, each with its people. */
export function FieldMemory({
  field,
  language,
  entries,
}: {
  field: TranslationField;
  language: string;
  entries: TranslationMemoryEntry[];
}) {
  const mine = entries.filter((entry) => entry.field === field);
  if (mine.length === 0) return null;
  const direction = directionOf(language);
  return (
    <div className="flex flex-col gap-1 text-xs" data-testid={`desk-memory-${field}`}>
      <p className="font-medium">
        Translation memory: the same {field} reviewed before. Copy one only if it fits.
      </p>
      <ul className="flex flex-col gap-2">
        {mine.map((entry) => (
          <li
            key={`${entry.article_id}-${entry.version_number}`}
            className="flex flex-col gap-1"
            data-testid="desk-memory-entry"
          >
            <span lang={language} dir={direction} className="text-sm">
              {entry.text}
            </span>
            <span className="text-muted">
              Written by {entry.written_by.username}, reviewed by {entry.reviewed_by.username},{' '}
              <time dateTime={entry.reviewed_at}>{entry.reviewed_at.slice(0, 10)}</time>
            </span>
            {entry.correction !== null && (
              // Shown beside it, never instead of it: the reader sees both
              // and chooses, and a correction still under review says so.
              <span data-testid="desk-memory-correction">
                <span className="font-medium">
                  Corrected in version {entry.correction.version_number} by{' '}
                  {entry.correction.written_by.username}
                  {entry.correction.review_state === 'translated' ? ' (not yet reviewed)' : ''}:
                </span>{' '}
                {entry.correction.text === null ? (
                  <span className="text-muted">the {field} was removed</span>
                ) : (
                  <span lang={language} dir={direction}>
                    {entry.correction.text}
                  </span>
                )}
              </span>
            )}
            <span className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="secondary"
                onClick={() => copyInto(field, entry.text)}
                data-testid="desk-memory-copy"
              >
                Copy into the {field}
              </Button>
              {entry.correction?.text != null && (
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => copyInto(field, entry.correction!.text!)}
                  data-testid="desk-memory-copy-correction"
                >
                  Copy the correction
                </Button>
              )}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function SourceText({ desk }: { desk: Desk }) {
  const { source } = desk;
  return (
    <Card heading="The publisher's words" data-testid="desk-source">
      <p className="text-xs text-muted">
        {source.name} · {source.language} · version {source.version_number} ·{' '}
        {source.rights === 'headline' ? 'headline only' : `grants the ${source.rights}`} ·{' '}
        <a href={source.url} className="underline" rel="noopener noreferrer" target="_blank">
          the original
        </a>
      </p>
      <dl className="flex flex-col gap-2 text-sm" lang={source.language} dir="auto">
        {(['headline', 'summary', 'byline'] as const).map((field) =>
          source[field] === null ? null : (
            <div key={field}>
              <dt className="text-xs text-muted" lang="en" dir="ltr">
                {FIELD_LABELS[field]}
              </dt>
              <dd data-testid={`desk-source-${field}`}>{source[field]}</dd>
            </div>
          ),
        )}
      </dl>
    </Card>
  );
}

function GlossaryTerms({ desk }: { desk: Desk }) {
  return (
    <Card heading="Glossary terms in the source" data-testid="desk-glossary">
      {desk.glossary.length === 0 ? (
        <p className="text-sm text-muted" data-testid="desk-glossary-empty">
          The source uses no glossary term.
        </p>
      ) : (
        <ul className="flex flex-col gap-1 text-sm">
          {desk.glossary.map((hit) => (
            <li key={hit.key} data-testid="desk-glossary-term">
              <span lang="en" dir="ltr">
                {hit.source}
              </span>
              {': '}
              {hit.text === '' ? (
                // Said, not left blank: an empty target is nobody having
                // written it yet, and the translator decides the word.
                <span className="text-muted">not written yet</span>
              ) : (
                <span lang={desk.language} dir={directionOf(desk.language)}>
                  {hit.text}
                </span>
              )}
              {hit.locked && (
                <span className="ms-2 text-xs text-muted">locked: the translation must use it</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function WriteForm({ locale, desk }: { locale: string; desk: Desk }) {
  const [state, formAction, pending] = useActionState<DeskState, FormData>(
    writeTranslationAction.bind(null, locale, desk.article_id, desk.language),
    null,
  );
  const direction = directionOf(desk.language);
  return (
    <Card
      heading={desk.translation === null ? 'Write the translation' : 'Write a new version'}
      data-testid="desk-write"
    >
      {desk.source.rights === 'headline' && (
        <p className="text-xs text-muted" data-testid="desk-headline-only">
          This source grants the headline only, so a translation carries the headline only.
        </p>
      )}
      <form action={formAction} className="flex flex-col gap-4">
        {desk.fields.map((field) => (
          <div key={field} className="flex flex-col gap-1">
            <TextArea
              label={`${FIELD_LABELS[field]} (${desk.language})`}
              id={fieldId(field)}
              name={field}
              rows={field === 'summary' ? 4 : 2}
              required={field === 'headline'}
              lang={desk.language}
              dir={direction}
              defaultValue={desk.translation?.[field] ?? ''}
              error={state !== null && !state.ok ? state.fields?.[field] : undefined}
              data-testid={`desk-field-${field}`}
            />
            <FieldChecks field={field} results={desk.checks} />
            <FieldMemory field={field} language={desk.language} entries={desk.memory} />
          </div>
        ))}
        <Button
          type="submit"
          pending={pending}
          pendingLabel="Saving…"
          className="self-start"
          data-testid="desk-write-submit"
        >
          Save as a new version
        </Button>
        {state !== null && (
          <FormStatus ok={state.ok} data-testid="desk-write-result">
            {state.message}
          </FormStatus>
        )}
      </form>
    </Card>
  );
}

function ReviewForm({ locale, desk }: { locale: string; desk: Desk }) {
  const [state, formAction, pending] = useActionState<DeskState, FormData>(
    reviewTranslationAction.bind(null, locale, desk.article_id, desk.language),
    null,
  );
  const translation = desk.translation;
  if (translation === null) return null;
  if (translation.review_state === 'reviewed') {
    return (
      <Notice tone="success" data-testid="desk-reviewed">
        Version {translation.version_number}, written by {translation.written_by.username}, was
        reviewed by {translation.reviewed_by?.username ?? 'a second speaker'}.
      </Notice>
    );
  }
  if (desk.viewer_is_author) {
    return (
      <Notice data-testid="desk-review-author">
        You wrote version {translation.version_number}. A second fluent speaker reviews it; the
        author never does.
      </Notice>
    );
  }
  const failing = desk.checks.filter((result) => result.outcome === 'fail');
  return (
    <Card heading={`Review version ${translation.version_number}`} data-testid="desk-review">
      <p className="text-sm">
        Written by <span className="font-medium">{translation.written_by.username}</span>.
      </p>
      <form action={formAction} className="flex flex-col gap-4">
        {failing.length > 0 && (
          <div className="flex flex-col gap-3" data-testid="desk-review-failures">
            <p className="text-sm">
              These checks fail. Ask for a new version, or say why each one is right anyway: the
              reason is recorded with your name.
            </p>
            {failing.map((result) => (
              <TextArea
                key={`${result.field}.${result.check}`}
                label={`${FIELD_LABELS[result.field]}: the ${result.check} check fails. Why is it right anyway?`}
                hint={result.detail}
                name={`reason:${result.field}.${result.check}`}
                dir="auto"
                rows={2}
                data-testid={`desk-reason-${result.field}-${result.check}`}
              />
            ))}
          </div>
        )}
        <Button
          type="submit"
          pending={pending}
          pendingLabel="Recording…"
          className="self-start"
          data-testid="desk-review-submit"
        >
          Approve as reviewed
        </Button>
        {state !== null && (
          <FormStatus ok={state.ok} data-testid="desk-review-result">
            {state.message}
          </FormStatus>
        )}
      </form>
    </Card>
  );
}

export function TranslationDesk({ locale, desk }: { locale: string; desk: Desk }) {
  return (
    <div className="flex flex-col gap-6" data-testid="translation-desk">
      <SourceText desk={desk} />
      <GlossaryTerms desk={desk} />
      <WriteForm locale={locale} desk={desk} />
      <ReviewForm locale={locale} desk={desk} />
    </div>
  );
}
