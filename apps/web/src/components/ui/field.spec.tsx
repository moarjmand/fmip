import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Checkbox, Radio, Select, TextArea, TextField, controlClasses } from './field';

/**
 * The fields (T-603): a label tied to its control, and a hint and an error a
 * screen reader hears on focus because the control names them.
 */

function attr(html: string, tag: string, name: string): string | undefined {
  const element = new RegExp(`<${tag}\\b[^>]*>`).exec(html)?.[0] ?? '';
  return new RegExp(`\\s${name}="([^"]*)"`).exec(element)?.[1];
}

describe('TextField', () => {
  it('labels its control by id', () => {
    const html = renderToStaticMarkup(<TextField label="Username" id="f-user" name="username" />);
    expect(html).toContain('<label for="f-user" class="text-sm font-medium">Username</label>');
    expect(attr(html, 'input', 'id')).toBe('f-user');
    expect(attr(html, 'input', 'type')).toBe('text');
    expect(attr(html, 'input', 'aria-describedby')).toBeUndefined();
    expect(attr(html, 'input', 'aria-invalid')).toBeUndefined();
  });

  it('makes up an id when none is given, and still ties the label to it', () => {
    const html = renderToStaticMarkup(<TextField label="Question" name="question" />);
    const id = attr(html, 'input', 'id');
    expect(id).toMatch(/^field/);
    expect(attr(html, 'label', 'for')).toBe(id);
  });

  it('names its hint and its error, and is invalid only with an error', () => {
    const html = renderToStaticMarkup(
      <TextField label="Email" id="f-mail" hint="We never show it." error="Not an address." />,
    );
    expect(attr(html, 'input', 'aria-describedby')).toBe('f-mail-hint f-mail-error');
    expect(attr(html, 'input', 'aria-invalid')).toBe('true');
    expect(html).toContain('<p id="f-mail-hint" class="text-sm text-muted">We never show it.</p>');
    expect(html).toContain('<p id="f-mail-error" class="text-sm text-danger">Not an address.</p>');

    const hinted = renderToStaticMarkup(<TextField label="Email" id="f-mail" hint="Optional." />);
    expect(attr(hinted, 'input', 'aria-describedby')).toBe('f-mail-hint');
    expect(attr(hinted, 'input', 'aria-invalid')).toBeUndefined();
  });

  it('keeps a description the caller already had', () => {
    const html = renderToStaticMarkup(
      <TextField label="Days" id="f-days" aria-describedby="rules" error="Too many." />,
    );
    expect(attr(html, 'input', 'aria-describedby')).toBe('rules f-days-error');
  });

  it('hides the label visually, never from a screen reader', () => {
    const html = renderToStaticMarkup(<TextField label="Search" id="q" hideLabel />);
    expect(html).toContain('<label for="q" class="sr-only">Search</label>');
  });

  it('draws the field edge in the strong border token, with logical alignment', () => {
    const html = renderToStaticMarkup(
      <TextField label="Days" id="d" size="sm" controlClassName="w-24" />,
    );
    const cls = attr(html, 'input', 'class') ?? '';
    expect(cls).toContain('border-strong');
    expect(cls).toContain('text-start');
    expect(cls).toContain('w-24');
    expect(cls).toContain('text-sm');
    expect(controlClasses()).toContain('px-3 py-2');
  });
});

describe('TextArea and Select', () => {
  it('wire the same way as a text field', () => {
    const area = renderToStaticMarkup(
      <TextArea label="Why" id="why" name="reason" required error="Say why." />,
    );
    expect(attr(area, 'textarea', 'aria-describedby')).toBe('why-error');
    expect(attr(area, 'textarea', 'aria-invalid')).toBe('true');
    expect(area).toContain('name="reason"');
    expect(area).toContain('required=""');

    const select = renderToStaticMarkup(
      <Select label="Scope" id="scope" name="scope" hint="What it restricts.">
        <option value="a">A</option>
      </Select>,
    );
    expect(attr(select, 'select', 'aria-describedby')).toBe('scope-hint');
    expect(select).toContain('<option value="a">A</option>');
  });
});

describe('Checkbox and Radio', () => {
  it('put the box first and the words beside it, inside one label', () => {
    const box = renderToStaticMarkup(<Checkbox label="Permanent" id="perm" name="permanent" />);
    expect(box).toMatch(
      /<label for="perm"[^>]*><input type="checkbox"[^>]*><span>Permanent<\/span><\/label>/,
    );

    const radio = renderToStaticMarkup(
      <Radio label="Draw" id="o-draw" name="outcome" value="draw" error="Pick one." />,
    );
    expect(attr(radio, 'input', 'type')).toBe('radio');
    expect(radio).toContain('name="outcome" value="draw"');
    expect(attr(radio, 'input', 'aria-describedby')).toBe('o-draw-error');
  });
});
