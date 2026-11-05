'use client';

import { type ReactNode, useActionState, useId } from 'react';
import type { ActionState } from '@/lib/auth-actions';
import type { Message } from '@/i18n/messages';
import { MessageText } from '@/components/message-text';
import { Button, Checkbox, FormStatus, Select, TextArea, TextField } from '@/components/ui';

export interface FieldOption {
  value: string;
  label: string;
}

export interface Field {
  name: string;
  /** Text, or text with a link inside it (the rules checkbox, T-1737). */
  label: ReactNode;
  type?: 'text' | 'email' | 'password' | 'textarea' | 'select' | 'checkbox' | 'hidden' | 'url';
  options?: FieldOption[];
  defaultValue?: string;
  defaultChecked?: boolean;
  required?: boolean;
  autoComplete?: string;
  hint?: string;
  maxLength?: number;
  /** A hint for the browser and a password manager; the API is what decides. */
  minLength?: number;
  /**
   * A value written in Latin letters whatever the page's language -- a
   * username, an e-mail address, a password (T-1737, D-358): the input runs
   * left to right on a right-to-left page, and a phone neither capitalises
   * nor corrects what is typed. The label, hint and error stay in the page's
   * direction.
   */
  latin?: boolean;
  /** Which keyboard a phone opens. */
  inputMode?: 'text' | 'email' | 'numeric' | 'tel' | 'url';
  /** What a phone's Enter key says. */
  enterKeyHint?: 'next' | 'go' | 'done' | 'send';
  /**
   * A control on a text input's own line, after it (the register form's
   * password show/hide, `register-controls.tsx`). The page hands it over, so
   * a form that has none pays nothing for it.
   */
  after?: ReactNode;
  /**
   * A select folded under one line that opens it (the register form's
   * "Time zone: Asia/Tehran · Change"): what the line says. A `<details>`,
   * so the list opens without script.
   */
  summary?: ReactNode;
  /** A checkbox whose whole row is a 44px touch target. */
  touch?: boolean;
}

interface Props {
  /** A server action already bound to everything but `(state, formData)`. */
  action: (state: ActionState, formData: FormData) => Promise<ActionState>;
  fields: Field[];
  submitLabel: string;
  /** Marks the form for tests and for the E2E checks. */
  testId?: string;
  /**
   * "Done." and "Working…" in the reader's language, resolved on the server
   * (T-1306). Without them the form says both in English, as it always has.
   */
  labels?: { done: Message; working: Message };
  /** The submit button fills the form's width on a phone (T-1737). */
  wideSubmit?: boolean;
  /** A line under the submit button, inside the form. */
  footnote?: ReactNode;
}

/**
 * One form component for every account form. Field errors come from the
 * API's `ApiError.fields` through the server action, so a rule lives in one
 * place; the form only shows what it was told. Logical utilities throughout
 * (rule 7): `text-start`, `ps-*`, never `text-left` or `pl-*`.
 *
 * It holds no field state of its own. What one form alone needs (the register
 * form's show/hide and its time-zone line) arrives as a node in `after` or
 * `summary`, so the pages that share this component do not download it
 * (T-1737; the match centre's budget, D-356).
 */
export function ActionForm({
  action,
  fields,
  submitLabel,
  testId,
  labels,
  wideSubmit = false,
  footnote,
}: Props) {
  const [state, formAction, pending] = useActionState(action, null);
  // Two forms on one page may name the same field (the match page's desk, the
  // Watch console): each form's ids are its own, so every label and every
  // aria-describedby points at exactly one element (T-1363).
  const formId = useId();
  const fieldErrors = state !== null && !state.ok ? (state.fields ?? {}) : {};

  return (
    <form action={formAction} className="flex flex-col gap-4" data-testid={testId} noValidate>
      {state !== null && (
        <FormStatus ok={state.ok} boxed>
          {state.ok
            ? (state.message ??
              (labels === undefined ? 'Done.' : <MessageText message={labels.done} />))
            : state.message}
        </FormStatus>
      )}

      {fields.map((field) => {
        const common = {
          id: `${formId}field-${field.name}`,
          name: field.name,
          label: field.label,
          required: field.required,
          hint: field.hint,
          error: fieldErrors[field.name],
        };

        switch (field.type) {
          case 'hidden':
            return (
              <input key={field.name} type="hidden" name={field.name} value={field.defaultValue} />
            );
          case 'checkbox':
            return (
              <Checkbox
                key={field.name}
                {...common}
                defaultChecked={field.defaultChecked}
                labelClassName={field.touch === true ? 'min-h-touch' : undefined}
              />
            );
          case 'textarea':
            return (
              <TextArea
                key={field.name}
                {...common}
                rows={4}
                defaultValue={field.defaultValue}
                maxLength={field.maxLength}
              />
            );
          case 'select': {
            const options = (field.options ?? []).map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ));
            if (field.summary === undefined) {
              return (
                <Select key={field.name} {...common} defaultValue={field.defaultValue}>
                  {options}
                </Select>
              );
            }
            // Folded under its line; open when the server refused its value,
            // so the error is never hidden. The line names the field, so the
            // list's own label is for a screen reader.
            return (
              <details
                key={field.name}
                open={common.error !== undefined ? true : undefined}
                data-testid={`${field.name}-line`}
              >
                <summary className="flex min-h-touch cursor-pointer list-none flex-wrap items-center gap-x-2 text-sm [&::-webkit-details-marker]:hidden">
                  {field.summary}
                </summary>
                <Select {...common} hideLabel className="pt-1" defaultValue={field.defaultValue}>
                  {options}
                </Select>
              </details>
            );
          }
          default:
            return (
              <TextField
                key={field.name}
                {...common}
                type={field.type ?? 'text'}
                defaultValue={field.defaultValue}
                autoComplete={field.autoComplete}
                maxLength={field.maxLength}
                minLength={field.minLength}
                inputMode={field.inputMode}
                enterKeyHint={field.enterKeyHint}
                after={field.after}
                {...(field.latin === true
                  ? { dir: 'ltr', autoCapitalize: 'off', autoCorrect: 'off', spellCheck: false }
                  : {})}
              />
            );
        }
      })}

      <Button
        type="submit"
        variant="primary"
        size="md"
        pending={pending}
        pendingLabel={labels === undefined ? 'Working…' : <MessageText message={labels.working} />}
        className={wideSubmit ? 'w-full sm:w-auto sm:self-start' : 'self-start'}
      >
        {submitLabel}
      </Button>
      {/* In a box of its own: a node a server component hands over may still be
          arriving, and React asks such a node for a key when it sits among
          siblings. */}
      {footnote !== undefined && <div>{footnote}</div>}
    </form>
  );
}
