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

  it('puts the primary on the green, with the text colour made for it', () => {
    const html = renderToStaticMarkup(
      <Button type="submit" variant="primary" size="md">
        Send
      </Button>,
    );
    expect(html).toContain('type="submit"');
    expect(html).toContain('bg-accent font-medium text-on-accent');
    expect(html).toContain('px-4 py-2');
    expect(html).not.toContain('border-strong');
  });

  it('draws a danger action in the danger token and a ghost one as a link', () => {
    expect(buttonClasses({ variant: 'danger' })).toContain('border-danger text-danger');
    const ghost = buttonClasses({ variant: 'ghost', size: 'sm' });
    expect(ghost).toContain('underline');
    expect(ghost).toContain('text-sm');
    expect(ghost).not.toMatch(/\bpx-|\bborder\b|\brounded\b/);
  });

  it('turns the edge to the accent when a toggle is on, and only then', () => {
    expect(buttonClasses({ selected: true })).toContain('border-accent');
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
    expect(html).toContain('bg-accent');
  });
});
