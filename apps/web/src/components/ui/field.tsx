import { useId } from 'react';
import type {
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from 'react';
import { cx } from './cx';

/**
 * The form fields (T-603). Each one is a label, a control, and the two things
 * a control may need to say about itself: a hint (what to put here) and an
 * error (what was wrong with what was sent). Both are tied to the control with
 * `aria-describedby`, and an error also sets `aria-invalid`, so a screen
 * reader hears them on focus rather than having to find them.
 *
 * The edge is `border-strong` (3:1 or better in both themes, D-090): a field's
 * boundary must be seen, unlike a card's hairline. Server-component safe;
 * `useId` is the one hook, and it works on the server.
 */

export type FieldSize = 'sm' | 'md';

const CONTROL: Record<FieldSize, string> = {
  sm: 'rounded border border-strong bg-transparent px-2 py-1 text-sm text-start',
  md: 'rounded border border-strong bg-transparent px-3 py-2 text-start',
};

/** The class list of a bare control, for a field whose label lives elsewhere (a score box in a sentence). */
export function controlClasses(size: FieldSize = 'md', className?: string): string {
  return cx(CONTROL[size], className);
}

interface FieldFrame {
  label: ReactNode;
  /** The label is still there for a screen reader; the layout around the field says it visibly. */
  hideLabel?: boolean;
  hint?: ReactNode;
  /** The server's word on this field. Its presence marks the control invalid. */
  error?: ReactNode;
  size?: FieldSize;
  /** On the wrapper: where the field sits in its form (`grow`, `self-start`). */
  className?: string;
  /** On the control itself: its width (`w-24`, `min-w-0 grow`). */
  controlClassName?: string;
}

function present(node: ReactNode): boolean {
  return node !== undefined && node !== null && node !== false && node !== '';
}

/** The ids and attributes that tie a control to its hint and error. */
function useDescription(
  givenId: string | undefined,
  hint: ReactNode,
  error: ReactNode,
  describedBy: string | undefined,
) {
  const generated = useId();
  const id = givenId ?? `field${generated.replace(/:/g, '')}`;
  const hintId = present(hint) ? `${id}-hint` : undefined;
  const errorId = present(error) ? `${id}-error` : undefined;
  const ids = [describedBy, hintId, errorId].filter((part) => part !== undefined).join(' ');
  return {
    id,
    hintId,
    errorId,
    control: {
      id,
      'aria-describedby': ids === '' ? undefined : ids,
      'aria-invalid': errorId !== undefined ? (true as const) : undefined,
    },
  };
}

function Messages({
  hint,
  hintId,
  error,
  errorId,
}: {
  hint: ReactNode;
  hintId: string | undefined;
  error: ReactNode;
  errorId: string | undefined;
}) {
  return (
    <>
      {hintId !== undefined && (
        <p id={hintId} className="text-sm text-muted">
          {hint}
        </p>
      )}
      {errorId !== undefined && (
        <p id={errorId} className="text-sm text-danger">
          {error}
        </p>
      )}
    </>
  );
}

function Label({
  htmlFor,
  hidden,
  children,
}: {
  htmlFor: string;
  hidden?: boolean;
  children: ReactNode;
}) {
  return (
    <label htmlFor={htmlFor} className={hidden === true ? 'sr-only' : 'text-sm font-medium'}>
      {children}
    </label>
  );
}

export type TextFieldProps = FieldFrame &
  Omit<InputHTMLAttributes<HTMLInputElement>, 'size' | 'className' | 'type'> & {
    type?: 'text' | 'email' | 'password' | 'url' | 'search' | 'number' | 'time' | 'date' | 'tel';
  };

export function TextField({
  label,
  hideLabel,
  hint,
  error,
  size = 'md',
  className,
  controlClassName,
  id: givenId,
  type = 'text',
  'aria-describedby': describedBy,
  ...rest
}: TextFieldProps) {
  const { id, hintId, errorId, control } = useDescription(givenId, hint, error, describedBy);
  return (
    <div className={cx('flex flex-col gap-1', className)}>
      <Label htmlFor={id} hidden={hideLabel}>
        {label}
      </Label>
      <input
        type={type}
        className={controlClasses(size, controlClassName)}
        {...control}
        {...rest}
      />
      <Messages hint={hint} hintId={hintId} error={error} errorId={errorId} />
    </div>
  );
}

export type TextAreaProps = FieldFrame &
  Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'className'>;

export function TextArea({
  label,
  hideLabel,
  hint,
  error,
  size = 'md',
  className,
  controlClassName,
  id: givenId,
  'aria-describedby': describedBy,
  ...rest
}: TextAreaProps) {
  const { id, hintId, errorId, control } = useDescription(givenId, hint, error, describedBy);
  return (
    <div className={cx('flex flex-col gap-1', className)}>
      <Label htmlFor={id} hidden={hideLabel}>
        {label}
      </Label>
      <textarea className={controlClasses(size, controlClassName)} {...control} {...rest} />
      <Messages hint={hint} hintId={hintId} error={error} errorId={errorId} />
    </div>
  );
}

export type SelectProps = FieldFrame &
  Omit<SelectHTMLAttributes<HTMLSelectElement>, 'className' | 'size'>;

export function Select({
  label,
  hideLabel,
  hint,
  error,
  size = 'md',
  className,
  controlClassName,
  id: givenId,
  'aria-describedby': describedBy,
  children,
  ...rest
}: SelectProps) {
  const { id, hintId, errorId, control } = useDescription(givenId, hint, error, describedBy);
  return (
    <div className={cx('flex flex-col gap-1', className)}>
      <Label htmlFor={id} hidden={hideLabel}>
        {label}
      </Label>
      <select className={controlClasses(size, controlClassName)} {...control} {...rest}>
        {children}
      </select>
      <Messages hint={hint} hintId={hintId} error={error} errorId={errorId} />
    </div>
  );
}

export type ChoiceProps = Omit<FieldFrame, 'hideLabel' | 'size'> &
  Omit<InputHTMLAttributes<HTMLInputElement>, 'className' | 'type' | 'size'>;

function Choice({
  type,
  label,
  hint,
  error,
  className,
  controlClassName,
  id: givenId,
  'aria-describedby': describedBy,
  ...rest
}: ChoiceProps & { type: 'checkbox' | 'radio' }) {
  const { id, hintId, errorId, control } = useDescription(givenId, hint, error, describedBy);
  return (
    <div className={cx('flex flex-col gap-1', className)}>
      <label htmlFor={id} className="flex items-center gap-2">
        <input type={type} className={cx('size-4', controlClassName)} {...control} {...rest} />
        <span>{label}</span>
      </label>
      <Messages hint={hint} hintId={hintId} error={error} errorId={errorId} />
    </div>
  );
}

/** A checkbox with its label beside it, the box first in reading order. */
export function Checkbox(props: ChoiceProps) {
  return <Choice type="checkbox" {...props} />;
}

/** One option of a radio group; the group's question is the caller's <fieldset> and <legend>. */
export function Radio(props: ChoiceProps) {
  return <Choice type="radio" {...props} />;
}
