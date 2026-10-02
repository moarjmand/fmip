'use client';

import { useActionState, useId } from 'react';
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
  label: string;
  type?: 'text' | 'email' | 'password' | 'textarea' | 'select' | 'checkbox' | 'hidden' | 'url';
  options?: FieldOption[];
  defaultValue?: string;
  defaultChecked?: boolean;
  required?: boolean;
  autoComplete?: string;
  hint?: string;
  maxLength?: number;
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
}

/**
 * One form component for every account form. Field errors come from the
 * API's `ApiError.fields` through the server action, so a rule lives in one
 * place; the form only shows what it was told. Logical utilities throughout
 * (rule 7): `text-start`, `ps-*`, never `text-left` or `pl-*`.
 */
export function ActionForm({ action, fields, submitLabel, testId, labels }: Props) {
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
            return <Checkbox key={field.name} {...common} defaultChecked={field.defaultChecked} />;
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
          case 'select':
            return (
              <Select key={field.name} {...common} defaultValue={field.defaultValue}>
                {(field.options ?? []).map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </Select>
            );
          default:
            return (
              <TextField
                key={field.name}
                {...common}
                type={field.type ?? 'text'}
                defaultValue={field.defaultValue}
                autoComplete={field.autoComplete}
                maxLength={field.maxLength}
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
        className="self-start"
      >
        {submitLabel}
      </Button>
    </form>
  );
}
