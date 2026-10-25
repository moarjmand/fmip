import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Button, ButtonLink, buttonClasses } from './button';

/** The buttons (T-603): one look per variant and size, and a pending state that cannot be pressed twice. */

describe('Button', () => {
  it('is a secondary, small, non-submitting button unless told otherwise', () => {
    const html = renderToStaticMarkup(<Button>Save</Button>);
    expect(html).toContain('type="button"');
    expect(html).toContain('border border-strong');
    expect(html).toContain('px-3 py-1 text-sm');
    expect(html).toContain('disabled:opacity-50');
    expect(html).not.toContain('disabled=""');
    expect(html).toContain('>Save</button>');
  });

  it('puts the primary on the bright saffron, with ink on it (T-1493)', () => {
    const html = renderToStaticMarkup(
      <Button type="submit" variant="primary" size="md">
        Send
      </Button>,
    );
    expect(html).toContain('type="submit"');
    expect(html).toContain('bg-brand font-extrabold text-on-brand');
    expect(html).toContain('px-4 py-2');
    expect(html).not.toContain('border-strong');
  });

  it('draws the Stadiomind control: the 8px radius, and a 44px target at the reader’s size', () => {
    // T-1388, D-206: `md` is what a reader presses on a phone; the dense
    // sizes stay for rows of admin actions, where 24px is the floor (target.ts).
    expect(buttonClasses({ size: 'md' })).toContain('min-h-touch');
    expect(buttonClasses({ size: 'sm' })).not.toContain('min-h-touch');
    for (const size of ['xs', 'sm', 'md'] as const) {
      expect(buttonClasses({ size })).toMatch(/\brounded-control\b/);
    }
    // The hovered primary darkens the fill, never fades it.
    expect(buttonClasses({ variant: 'primary' })).toContain('hover:brightness-95');
    expect(buttonClasses({ variant: 'primary' })).not.toMatch(/hover:opacity/);
  });

  it('draws a danger action in the danger token and a ghost one as a link', () => {
    expect(buttonClasses({ variant: 'danger' })).toContain('border-danger text-danger');
    const ghost = buttonClasses({ variant: 'ghost', size: 'sm' });
    expect(ghost).toContain('underline');
    expect(ghost).toContain('text-sm');
    expect(ghost).not.toMatch(/\bpx-|\bborder\b|\brounded\b/);
  });

  it('gives a chosen toggle the saffron edge and tint, and only then', () => {
    expect(buttonClasses({ selected: true })).toContain('border-2 border-accent bg-brand/14');
    expect(buttonClasses({ selected: true })).not.toContain('border-strong');
    expect(buttonClasses({ selected: false })).toContain('border-strong');
  });

  it('is disabled and busy while pending, and says so when given the words', () => {
    const html = renderToStaticMarkup(
      <Button pending pendingLabel="Working…">
        Join
      </Button>,
    );
    expect(html).toContain('disabled=""');
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('Working…');
    expect(html).not.toContain('Join');
    // Without words for the wait, the label stays and only the state changes.
    const quiet = renderToStaticMarkup(<Button pending>Join</Button>);
    expect(quiet).toContain('Join');
    expect(quiet).toContain('disabled=""');
  });

  it('says a choice is on or off in aria-pressed, and only for a choice', () => {
    expect(renderToStaticMarkup(<Button selected>Arsenal</Button>)).toContain(
      'aria-pressed="true"',
    );
    expect(renderToStaticMarkup(<Button selected={false}>Draw</Button>)).toContain(
      'aria-pressed="false"',
    );
    expect(renderToStaticMarkup(<Button>Save</Button>)).not.toContain('aria-pressed');
  });

  it('passes through what a test or a screen reader needs', () => {
    const html = renderToStaticMarkup(
      <Button data-testid="x-save" aria-pressed={true} className="self-start">
        On
      </Button>,
    );
    expect(html).toContain('data-testid="x-save"');
    expect(html).toContain('aria-pressed="true"');
    expect(html).toMatch(/class="[^"]*self-start/);
  });
});

describe('ButtonLink', () => {
  it('is a link with a button’s look', () => {
    const html = renderToStaticMarkup(
      <ButtonLink href="/en/welcome" variant="primary">
        Start
      </ButtonLink>,
    );
    expect(html).toMatch(/^<a /);
    expect(html).toContain('href="/en/welcome"');
    expect(html).toContain('bg-brand');
    // A link is navigation, never a pressed choice.
    expect(html).not.toContain('aria-pressed');
  });
});
