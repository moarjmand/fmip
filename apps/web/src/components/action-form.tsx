'use client';

import { useActionState } from 'react';
import type { ActionState } from '@/lib/auth-actions';

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
}

/**
 * One form component for every account form. Field errors come from the
 * API's `ApiError.fields` through the server action, so a rule lives in one
 * place; the form only shows what it was told. Logical utilities throughout
 * (rule 7): `text-start`, `ps-*`, never `text-left` or `pl-*`.
 */
export function ActionForm({ action, fields, submitLabel, testId }: Props) {
  const [state, formAction, pending] = useActionState(action, null);
  const fieldErrors = state !== null && !state.ok ? (state.fields ?? {}) : {};

  return (
    <form action={formAction} className="flex flex-col gap-4" data-testid={testId} noValidate>
      {state !== null && (
        <p
          role="status"
          className={`rounded border px-3 py-2 text-sm ${
            state.ok ? 'border-green-700/40 text-green-800' : 'border-red-700/40 text-red-800'
          }`}
        >
          {state.ok ? (state.message ?? 'Done.') : state.message}
        </p>
      )}

      {fields.map((field) => {
        const id = `field-${field.name}`;
        const error = fieldErrors[field.name];
        const describedBy = error ? `${id}-error` : field.hint ? `${id}-hint` : undefined;
        const common = {
          id,
          name: field.name,
          required: field.required,
          'aria-invalid': error ? true : undefined,
          'aria-describedby': describedBy,
          className:
            'rounded border border-current/30 bg-transparent px-3 py-2 text-start focus:outline-2',
        };

        if (field.type === 'hidden') {
          return (
            <input key={field.name} type="hidden" name={field.name} value={field.defaultValue} />
          );
        }

        return (
          <div key={field.name} className="flex flex-col gap-1">
            {field.type === 'checkbox' ? (
              <label className="flex items-center gap-2">
                <input
                  {...common}
                  type="checkbox"
                  defaultChecked={field.defaultChecked}
                  className="size-4"
                />
                <span>{field.label}</span>
              </label>
            ) : (
              <>
                <label htmlFor={id} className="text-sm font-medium">
                  {field.label}
                </label>
                {field.type === 'textarea' ? (
                  <textarea
                    {...common}
                    rows={4}
                    defaultValue={field.defaultValue}
                    maxLength={field.maxLength}
                  />
                ) : field.type === 'select' ? (
                  <select {...common} defaultValue={field.defaultValue}>
                    {(field.options ?? []).map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    {...common}
                    type={field.type ?? 'text'}
                    defaultValue={field.defaultValue}
                    autoComplete={field.autoComplete}
                    maxLength={field.maxLength}
                  />
                )}
              </>
            )}
            {error ? (
              <p id={`${id}-error`} className="text-sm text-red-800">
                {error}
              </p>
            ) : field.hint ? (
              <p id={`${id}-hint`} className="text-sm opacity-70">
                {field.hint}
              </p>
            ) : null}
          </div>
        );
      })}

      <button
        type="submit"
        disabled={pending}
        className="self-start rounded bg-current px-4 py-2 font-medium text-white disabled:opacity-50 dark:text-black"
      >
        {pending ? 'Working…' : submitLabel}
      </button>
    </form>
  );
}
