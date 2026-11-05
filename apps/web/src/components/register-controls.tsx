'use client';

import { useEffect, useRef, useState } from 'react';
import { buttonClasses } from '@/components/ui';

/**
 * The register form's two controls with state (T-1737, D-358). They live
 * here, not in `ActionForm`, which every form on the site shares: the match
 * centre's and the matches page's bundles are budgeted (D-356) and should not
 * pay for a control only the register page draws. The page hands each to the
 * form as a node (`Field.after`, `Field.summary`); each finds its field in
 * the document around it. Without script the password stays masked and the
 * line says the zone the server drew; the form is sent the same.
 */

/** `TextField` draws the input, then the control's box, on one line: the input before a control. */
function inputBefore(control: HTMLElement | null): HTMLInputElement | null {
  const before = control?.parentElement?.previousElementSibling;
  return before instanceof HTMLInputElement ? before : null;
}

/**
 * Shows what was typed in the password field beside it, and hides it again.
 * `field` is the field's own label, said after the word for a screen reader
 * ("Show Password").
 *
 * The press changes the input's type and nothing else; the word on the button
 * is read back from the input. React puts the type back to `password` when it
 * redraws the field (an error under it after a refused submit), and the
 * button must then say Show again, not Hide over a masked field.
 */
export function PasswordReveal({
  show,
  hide,
  field,
}: {
  show: string;
  hide: string;
  field: string;
}) {
  const [shown, setShown] = useState(false);
  const button = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const input = inputBefore(button.current);
    if (input === null) return undefined;
    const observer = new MutationObserver(() => setShown(input.type === 'text'));
    observer.observe(input, { attributes: true, attributeFilter: ['type'] });
    return () => observer.disconnect();
  }, []);

  return (
    <button
      ref={button}
      type="button"
      className={buttonClasses({ size: 'md', className: 'shrink-0' })}
      data-testid="password-reveal"
      onClick={(event) => {
        const input = inputBefore(event.currentTarget);
        if (input !== null) input.type = input.type === 'password' ? 'text' : 'password';
      }}
    >
      {shown ? hide : show}
      <span className="sr-only"> {field}</span>
    </button>
  );
}

/**
 * The time-zone line: "Time zone: Asia/Tehran · Change". It says the zone the
 * list under it holds, whoever chose it: the server (`initial`), this device
 * (`DeviceTimeZone`, which announces its choice as a `change`) or the reader.
 *
 * After a refused submit React puts every field of the form back to what the
 * server drew, this list included, so a reader who fixed a typo would
 * register in UTC while the line still named their zone. The list is put
 * back to what was chosen instead.
 */
export function ZoneLine({
  before,
  after,
  change,
  initial,
}: {
  /** The sentence around the zone: "Time zone: " and what follows it, if anything. */
  before: string;
  after: string;
  /** The word that opens the list. */
  change: string;
  initial: string;
}) {
  const [zone, setZone] = useState(initial);
  const line = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const list = line.current?.closest('details')?.querySelector('select');
    if (list === null || list === undefined) return undefined;
    let chosen = list.value;
    const onChange = () => {
      chosen = list.value;
      setZone(chosen);
    };
    // The fields are put back after the event, so the list is restored after that.
    const onReset = () => {
      setTimeout(() => {
        if (list.value !== chosen) list.value = chosen;
      });
    };
    const form = list.form;
    list.addEventListener('change', onChange);
    form?.addEventListener('reset', onReset);
    return () => {
      list.removeEventListener('change', onChange);
      form?.removeEventListener('reset', onReset);
    };
  }, []);

  return (
    <>
      <span ref={line}>
        {before}
        <bdi dir="ltr" data-testid="timezone-value">
          {zone}
        </bdi>
        {after}
      </span>
      <span aria-hidden="true">·</span>
      <span className="text-accent underline">{change}</span>
    </>
  );
}
