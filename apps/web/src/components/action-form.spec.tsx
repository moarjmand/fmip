import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ActionForm } from './action-form';
import { PasswordReveal, ZoneLine } from './register-controls';

const action = async () => null;
const fields = [
  { name: 'territory', label: 'Territory', type: 'text' as const, required: true, hint: 'IR' },
  { name: 'note', label: 'Note', type: 'text' as const, required: true },
];

/**
 * Two forms on one page naming the same field (T-1363): the match page's
 * desk has three `territory` fields and the Watch console two `note` fields.
 * Every id on the page is unique and every label points at its own input.
 */
describe('ActionForm ids', () => {
  it('gives each form its own field ids, so labels never point at another form', () => {
    const html = renderToStaticMarkup(
      <>
        <ActionForm action={action} fields={fields} submitLabel="Declare" />
        <ActionForm action={action} fields={fields} submitLabel="Set default" />
      </>,
    );
    const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
    expect(ids.length).toBeGreaterThanOrEqual(4);
    expect(new Set(ids).size).toBe(ids.length);
    const targets = [...html.matchAll(/\sfor="([^"]+)"/g)].map((m) => m[1]);
    expect(targets).toHaveLength(4);
    for (const target of targets) expect(ids).toContain(target);
  });
});

/** The opening tag of the first element matching a tag name and an attribute. */
const open = (html: string, element: string, attribute: string): string =>
  new RegExp(`<${element}[^>]*${attribute}[^>]*>`).exec(html)?.[0] ?? '';

/**
 * What the register form asks of the shared form (T-1737, D-358): Latin
 * values that stay left-to-right on a right-to-left page, a place for a
 * control beside an input (the password's show/hide), a select folded under
 * one line, a checkbox row a thumb can hit with a link in its label, a button
 * as wide as a phone, a line under it. The two controls with state are the
 * register page's own (`register-controls.tsx`); the form only places them.
 */
describe('ActionForm fields for the account forms', () => {
  it('keeps a Latin value left-to-right and uncorrected, with the phone’s keyboard hints', () => {
    const html = renderToStaticMarkup(
      <ActionForm
        action={action}
        submitLabel="Go"
        fields={[
          {
            name: 'email',
            label: 'Email',
            type: 'email',
            autoComplete: 'email',
            latin: true,
            inputMode: 'email',
            enterKeyHint: 'next',
          },
          { name: 'note', label: 'Note' },
        ]}
      />,
    );
    const email = open(html, 'input', 'name="email"');
    for (const attribute of [
      'type="email"',
      'dir="ltr"',
      'autoCapitalize="off"',
      'autoCorrect="off"',
      'spellCheck="false"',
      'inputMode="email"',
      'enterKeyHint="next"',
      'autoComplete="email"',
    ]) {
      expect(email.toLowerCase(), attribute).toContain(attribute.toLowerCase());
    }
    // A field that did not ask stays in the page's own direction.
    const note = open(html, 'input', 'name="note"');
    expect(note).not.toContain('dir=');
    expect(note.toLowerCase()).not.toContain('autocapitalize');
  });

  it('draws a masked password with a control that names what it shows', () => {
    const html = renderToStaticMarkup(
      <ActionForm
        action={action}
        submitLabel="Go"
        fields={[
          {
            name: 'password',
            label: 'Password',
            type: 'password',
            autoComplete: 'new-password',
            hint: 'At least 10 characters.',
            minLength: 10,
            latin: true,
            after: <PasswordReveal show="Show" hide="Hide" field="Password" />,
          },
        ]}
      />,
    );
    const input = open(html, 'input', 'name="password"');
    expect(input).toContain('type="password"');
    expect(input.toLowerCase()).toContain('minlength="10"');
    expect(input).toContain('dir="ltr"');
    const button = open(html, 'button', 'data-testid="password-reveal"');
    expect(button).toContain('type="button"');
    // The control says which field it shows, and stands in its own box right
    // after the input, which is how it finds it.
    expect(html).toMatch(/>Show<span class="sr-only"> Password<\/span><\/button>/);
    expect(html).toMatch(
      /<input[^>]*name="password"[^>]*\/><div class="flex shrink-0"><button[^>]*data-testid="password-reveal"/,
    );
    const id = /\sid="([^"]+)"/.exec(input)?.[1];
    expect(id).toBeDefined();
    // The length rule is stated, tied to the input.
    expect(html).toContain('At least 10 characters.');
    expect(input).toContain(`aria-describedby="${id}-hint"`);
  });

  it('leaves a password without the control as it was', () => {
    const html = renderToStaticMarkup(
      <ActionForm
        action={action}
        submitLabel="Go"
        fields={[{ name: 'password', label: 'Password', type: 'password' }]}
      />,
    );
    expect(html).not.toContain('-reveal');
    expect(html).not.toContain('flex shrink-0');
    expect(open(html, 'input', 'name="password"')).toContain('type="password"');
  });

  it('folds a select into one line that opens its list without script', () => {
    const html = renderToStaticMarkup(
      <ActionForm
        action={action}
        submitLabel="Go"
        fields={[
          {
            name: 'timezone',
            label: 'Time zone',
            type: 'select',
            defaultValue: 'Asia/Tehran',
            options: ['UTC', 'Asia/Tehran'].map((zone) => ({ value: zone, label: zone })),
            summary: (
              <ZoneLine before="Time zone: " after="" change="Change" initial="Asia/Tehran" />
            ),
          },
        ]}
      />,
    );
    expect(html).toMatch(/<details[^>]*data-testid="timezone-line"/);
    expect(open(html, 'details', 'data-testid="timezone-line"')).not.toContain('open');
    // The zone is Latin whatever the page: isolated and left-to-right.
    expect(html).toMatch(
      /<summary[^>]*><span>Time zone: <bdi dir="ltr" data-testid="timezone-value">Asia\/Tehran<\/bdi><\/span><span aria-hidden="true">·<\/span><span class="text-accent underline">Change<\/span><\/summary>/,
    );
    // The list is still the form's own field, with the default chosen and a label.
    expect(open(html, 'select', 'name="timezone"')).not.toBe('');
    expect(html).toMatch(/<option value="Asia\/Tehran" selected="">/);
    const id = /\sid="([^"]+)"/.exec(open(html, 'select', 'name="timezone"'))?.[1];
    expect(html).toContain(`<label for="${id}" class="sr-only">Time zone</label>`);
  });

  it('gives a checkbox a 44px row and a label that may hold a link', () => {
    const html = renderToStaticMarkup(
      <ActionForm
        action={action}
        submitLabel="Go"
        fields={[
          {
            name: 'accept_rules',
            type: 'checkbox',
            required: true,
            touch: true,
            label: (
              <>
                I accept the <a href="#rules">platform rules</a>
              </>
            ),
          },
        ]}
      />,
    );
    expect(html).toMatch(/<label[^>]*class="[^"]*min-h-touch[^"]*"/);
    expect(html).toContain('I accept the <a href="#rules">platform rules</a>');
    expect(open(html, 'input', 'name="accept_rules"')).toContain('type="checkbox"');
  });

  it('widens the submit button on a phone only when asked, and puts the footnote under it', () => {
    const wide = renderToStaticMarkup(
      <ActionForm
        action={action}
        submitLabel="Create account"
        fields={fields}
        wideSubmit
        footnote={<p data-testid="footnote">What the e-mail is for.</p>}
      />,
    );
    const button = open(wide, 'button', 'type="submit"');
    expect(button).toContain('w-full');
    expect(button).toContain('sm:w-auto');
    expect(wide.indexOf('type="submit"')).toBeLessThan(wide.indexOf('data-testid="footnote"'));
    expect(wide.indexOf('data-testid="footnote"')).toBeLessThan(wide.indexOf('</form>'));

    const plain = renderToStaticMarkup(
      <ActionForm action={action} submitLabel="Save" fields={fields} />,
    );
    expect(open(plain, 'button', 'type="submit"')).not.toContain('w-full');
  });
});
