import type { ConsoleFinding, ConsoleMessage } from '@fmip/contracts';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import {
  consoleHref,
  consolePathOf,
  consoleRoute,
  hostName,
  isConsoleHost,
} from '@/lib/console-host';
import { ChatThread, MESSAGE_STATUS_WORDS } from './chat';
import { FindingRow, RunsBars, freshness } from './ui';

vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => undefined }) }));
const { parseConsoleSetCookie } = await import('@/lib/console-api');

/**
 * The agents console's web side (T-1698, D-340): served on its own host
 * only, its cookie read back from the API's, and an open security finding
 * shown without its detail.
 */

const HOST = 'agents.traveltohormuz.ir';

describe('the console host', () => {
  it('compares host names without port or case', () => {
    expect(hostName('Agents.TravelToHormuz.ir:443')).toBe(HOST);
    expect(hostName('[::1]:3000')).toBe('[::1]');
    expect(isConsoleHost('agents.traveltohormuz.ir', HOST)).toBe(true);
    expect(isConsoleHost('traveltohormuz.ir', HOST)).toBe(false);
    expect(isConsoleHost(HOST, undefined)).toBe(false);
    expect(isConsoleHost(HOST, '')).toBe(false);
  });

  it('serves every path of its host from the console, and hides the console everywhere else', () => {
    expect(consoleRoute(HOST, '/', HOST)).toEqual({
      kind: 'console',
      pathname: '/console',
      base: '',
    });
    expect(consoleRoute(HOST, '/agents/data-auditor', HOST)).toEqual({
      kind: 'console',
      pathname: '/console/agents/data-auditor',
      base: '',
    });
    expect(consoleRoute(HOST, '/console/board', HOST)).toEqual({
      kind: 'console',
      pathname: '/console/board',
      base: '',
    });
    expect(consoleRoute('traveltohormuz.ir', '/console', HOST)).toEqual({ kind: 'hidden' });
    expect(consoleRoute('traveltohormuz.ir', '/console/login', HOST)).toEqual({ kind: 'hidden' });
    expect(consoleRoute('traveltohormuz.ir', '/en/scores', HOST)).toEqual({ kind: 'site' });
    expect(consoleRoute('traveltohormuz.ir', '/consoles', HOST)).toEqual({ kind: 'site' });
    expect(consoleRoute('traveltohormuz.ir', '/console', undefined)).toEqual({ kind: 'hidden' });
  });

  it('serves the console under CONSOLE_PATH on the site host, with its base (D-341)', () => {
    const SITE = 'traveltohormuz.ir';
    expect(consoleRoute(SITE, '/agents', HOST, '/agents')).toEqual({
      kind: 'console',
      pathname: '/console',
      base: '/agents',
    });
    expect(consoleRoute(SITE, '/agents/', HOST, '/agents')).toMatchObject({ pathname: '/console' });
    expect(consoleRoute(SITE, '/agents/agents/security', HOST, '/agents')).toEqual({
      kind: 'console',
      pathname: '/console/agents/security',
      base: '/agents',
    });
    expect(consoleRoute(SITE, '/agentsx', HOST, '/agents')).toEqual({ kind: 'site' });
    expect(consoleRoute(SITE, '/agents', HOST, '')).toEqual({ kind: 'site' });
    expect(consoleRoute(SITE, '/console/login', HOST, '/agents')).toEqual({ kind: 'hidden' });
    // The console's own host keeps an empty base.
    expect(consoleRoute(HOST, '/agents/security', HOST, '/agents')).toMatchObject({ base: '' });
    expect(consolePathOf('/agents/')).toBe('/agents');
    expect(consolePathOf('agents')).toBe('');
    expect(consolePathOf('/console')).toBe('');
    expect(consolePathOf('/a/b')).toBe('');
    expect(consoleHref('', '/board')).toBe('/board');
    expect(consoleHref('/agents', '/')).toBe('/agents');
    expect(consoleHref('/agents', '/findings?status=open')).toBe('/agents/findings?status=open');
  });
});

describe('the console cookie', () => {
  it("reads the API's Set-Cookie, and a sign-out", () => {
    expect(
      parseConsoleSetCookie(
        'fmip_console=abc%2Dd; Path=/; HttpOnly; SameSite=Strict; Max-Age=43200',
      ),
    ).toEqual({
      value: 'abc-d',
      maxAge: 43200,
    });
    expect(parseConsoleSetCookie('fmip_console=; Path=/; Max-Age=0')).toEqual({
      value: '',
      maxAge: 0,
    });
    expect(parseConsoleSetCookie('fmip_session=abc; Max-Age=10')).toBeNull();
    expect(parseConsoleSetCookie(null)).toBeNull();
  });
});

describe('the console pieces', () => {
  const finding = (overrides: Partial<ConsoleFinding>): ConsoleFinding => ({
    id: 'sec-1',
    agent: 'security',
    severity: 'major',
    status: 'open',
    title: 'A header is missing',
    opened_at: '2026-11-01',
    detail: null,
    related: null,
    ...overrides,
  });

  it('shows an open security finding by its title, and says its detail stays on the computer', () => {
    const html = renderToStaticMarkup(<FindingRow finding={finding({})} />);
    expect(html).toContain('A header is missing');
    expect(html).toContain('مهم');
    expect(html).toContain('فقط روی رایانه‌ی شماست');
    expect(html).not.toContain('<details');
    const other = renderToStaticMarkup(
      <FindingRow finding={finding({ agent: 'data-auditor', detail: 'the evidence' })} />,
    );
    expect(other).toContain('the evidence');
  });

  it('draws a bar a run, or says there is none', () => {
    expect(renderToStaticMarkup(<RunsBars runs={[]} />)).toContain('هنوز اجرایی');
    const html = renderToStaticMarkup(
      <RunsBars
        runs={[
          { at: '2026-11-01T08:00:00.000Z', status: 'ok', findings: 3, duration_seconds: null },
        ]}
      />,
    );
    expect(html).toContain('۳');
  });

  it('draws a conversation: who wrote what, where a message is, and why one failed (T-1722)', () => {
    const base: ConsoleMessage = {
      id: 'm1',
      agent: 'data-auditor',
      author_kind: 'person',
      author: 'Mostafa',
      body: 'What did you find?\nToday.',
      created_at: '2026-11-02T08:00:00.000Z',
      status: 'answered',
      reply_to: null,
      failure: null,
    };
    const html = renderToStaticMarkup(
      <ChatThread
        messages={[
          base,
          {
            ...base,
            id: 'r1',
            author_kind: 'agent',
            author: 'data-auditor',
            body: 'Three minor findings.',
            status: null,
            reply_to: 'm1',
          },
          { ...base, id: 'm2', body: '<b>not markup</b>', status: 'queued' },
          { ...base, id: 'm3', status: 'answering' },
          { ...base, id: 'm4', status: 'failed', failure: 'The run timed out.' },
        ]}
      />,
    );
    expect(html).toContain('data-author="agent"');
    // The agent signs with its Persian title (T-1725).
    expect(html).toContain('بازرس داده');
    expect(html).toContain('Three minor findings.');
    expect(html).toContain('What did you find?\nToday.');
    expect(html).toContain('&lt;b&gt;not markup&lt;/b&gt;');
    expect(html).toContain(MESSAGE_STATUS_WORDS.queued);
    expect(MESSAGE_STATUS_WORDS.queued).toContain('۱۰ دقیقه');
    expect(html).toContain(MESSAGE_STATUS_WORDS.answering);
    expect(html).toContain(MESSAGE_STATUS_WORDS.failed);
    expect(html).toContain('The run timed out.');
    // An answered message shows its reply, not a badge.
    expect(html).not.toContain(MESSAGE_STATUS_WORDS.answered);
    // Logical sides only (rule 7).
    expect(html).not.toMatch(/\b(ml|mr|pl|pr|left|right)-/);
    expect(renderToStaticMarkup(<ChatThread messages={[]} />)).toContain('هنوز پیامی نیامده');
  });

  it('says when the snapshot is stale (rule 4)', () => {
    const now = new Date('2026-11-02T12:00:00Z');
    expect(freshness(null, now).stale).toBe(true);
    expect(freshness('2026-11-02T05:00:00Z', now).stale).toBe(false);
    expect(freshness('2026-10-31T05:00:00Z', now)).toMatchObject({ stale: true });
    expect(freshness('2026-10-31T05:00:00Z', now).words).toContain('کهنه');
  });
});
