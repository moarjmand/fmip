import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  CONSOLE_FLOW_INPUTS,
  CONSOLE_FLOW_LIMITS,
  CONSOLE_FLOW_OUTPUTS,
  CONSOLE_FLOW_READERS,
  CONSOLE_FLOW_TRIGGERS,
  type ConsoleAgent,
  type ConsoleAgentFlow,
  type ConsoleRequestDetail,
  type ConsoleRequestEvent,
  type ConsoleRequestImage,
  type ConsoleSnapshot,
} from '@fmip/contracts';
import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CALENDAR, CALENDAR_PUSH } from './calendar.fixture';
import { MODEL_LAB, MODEL_REPORT } from './model-report.fixture';
import { PROVIDERS } from './providers.fixture';

/**
 * The console is Persian only (T-1725, D-352), and each agent page draws how
 * the agent works. Every console page is rendered on fixtures whose free
 * text is Persian, while the English the API and the publisher really send
 * (access areas, memory labels, audit actions, command outcomes, who
 * decided, an agent's English description) goes through as it does in
 * production; a Latin word outside `dir="ltr"` that is not a technical term
 * fails the scan.
 */

const fixtures = vi.hoisted(() => ({ snapshot: null as unknown, invitationOk: true }));

vi.mock('next/headers', () => ({
  cookies: async () => ({ get: () => undefined, set: () => undefined }),
  headers: async () => new Headers(),
}));
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND');
  },
  redirect: () => {
    throw new Error('NEXT_REDIRECT');
  },
}));
vi.mock('@/app/console/console-link', () => ({
  ConsoleLink: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock('@/lib/console-actions', () => {
  const action = async () => ({ error: null, done: null });
  return {
    signIn: action,
    signOut: async () => undefined,
    acceptInvitation: action,
    queueCommand: action,
    postMessage: action,
    addCard: action,
    moveCard: async () => undefined,
    archiveCard: async () => undefined,
    createRequest: action,
    editRequest: action,
    requestAction: action,
    decideRequest: action,
    removeRequestImage: action,
    captionRequestImage: action,
    refreshRequests: async () => undefined,
    saveEvent: action,
    deleteEvent: action,
    registerReminderDevice: async () => ({ ok: true, error: null }),
    removeReminderDevice: async () => ({ ok: true }),
    testReminder: async () => null,
  };
});
vi.mock('@/lib/console-api', () => {
  const ok = <T,>(data: T) =>
    Promise.resolve({ ok: true as const, status: 200, data, setCookie: null });
  return {
    consoleMe: () => ok({ id: 'u1', username: 'maryam', display_name: 'مریم' }),
    consoleSnapshot: () => ok({ snapshot: fixtures.snapshot, loaded_at: '2026-11-03T05:00:00Z' }),
    // T-1729, T-1752: the model page, on the API's real answer of 2026-11-06.
    consoleModel: () => ok(MODEL_REPORT),
    consoleCommands: () =>
      ok({
        commands: [
          {
            id: 'c1',
            kind: 'agent.pause',
            target: 'data-auditor',
            payload: {},
            status: 'done',
            requested_by: 'maryam',
            requested_at: '2026-11-02T08:00:00Z',
            finished_at: '2026-11-02T09:00:00Z',
            outcome: 'Paused: the daily run skips it.',
          },
          {
            id: 'c2',
            kind: 'agent.model',
            target: 'data-auditor',
            payload: { model: 'opus' },
            status: 'done',
            requested_by: 'maryam',
            requested_at: '2026-11-02T08:00:00Z',
            finished_at: null,
            outcome: 'Runs on opus from its next run.',
          },
        ],
      }),
    consoleBoard: () =>
      ok({
        cards: [
          {
            id: 'k1',
            title: 'کارت آزمایشی',
            body: 'شرح کارت',
            column: 'next',
            position: 0,
            labels: ['بازاریابی'],
            assignee: 'مریم',
            due_on: null,
            updated_by: 'maryam',
            updated_at: '2026-11-02T08:00:00Z',
          },
        ],
      }),
    consoleAudit: () =>
      ok({
        entries: [
          {
            actor: 'maryam',
            action: 'console.sign_in',
            target: 'u1',
            reason: 'signed in',
            at: '2026-11-02T08:00:00Z',
          },
          {
            actor: 'maryam',
            action: 'command.agent_pause',
            target: 'data-auditor',
            reason: 'برای آزمون',
            at: '2026-11-02T08:00:00Z',
          },
          {
            actor: 'maryam',
            action: 'board.card_archived',
            target: 'k1',
            reason: 'card archived',
            at: '2026-11-02T08:00:00Z',
          },
          {
            actor: 'maryam',
            action: 'chat.message_posted',
            target: 'data-auditor',
            reason: 'message to the agent',
            at: '2026-11-02T08:00:00Z',
          },
        ],
      }),
    consoleConversation: () =>
      ok({
        agent: 'data-auditor',
        has_older: true,
        messages: [
          {
            id: 'm1',
            agent: 'data-auditor',
            author_kind: 'person',
            author: 'مریم',
            body: 'امروز چه پیدا کردی؟',
            created_at: '2026-11-02T08:00:00Z',
            status: 'answered',
            reply_to: null,
            failure: null,
          },
          {
            id: 'm2',
            agent: 'data-auditor',
            author_kind: 'agent',
            author: 'data-auditor',
            body: 'سه یافته‌ی جزئی.',
            created_at: '2026-11-02T08:10:00Z',
            status: null,
            reply_to: 'm1',
            failure: null,
          },
        ],
      }),
    // Teammate requests (T-1728): one of every state, with the English the
    // API really sends (statuses, kinds, choices) and Persian free text.
    consoleRequests: () =>
      ok({
        requests: REQUESTS,
        counts: REQUEST_COUNTS,
        filers: [{ username: 'maryam', display_name: 'مریم', count: 2 }],
      }),
    consoleRequestCounts: () => ok(REQUEST_COUNTS),
    // T-1788: the calendar and the subscriptions, Persian free text.
    consoleCalendar: () => ok(CALENDAR),
    consoleCalendarPush: () => ok(CALENDAR_PUSH),
    consoleInvitation: () =>
      fixtures.invitationOk
        ? ok({ display_name: 'مریم', expires_at: '2026-11-05T08:00:00Z' })
        : Promise.resolve({ ok: false as const, status: 404, error: null, setCookie: null }),
  };
});

// --- Fixtures ----------------------------------------------------------------

const REQUEST_EVENTS: ConsoleRequestEvent[] = [
  {
    id: 'e0',
    kind: 'image_added',
    actor_kind: 'person',
    actor: 'مریم',
    from_status: 'new',
    to_status: 'new',
    note: 'نمای جدول',
    at: '2026-11-03T07:59:00Z',
  },
  {
    id: 'e1',
    kind: 'created',
    actor_kind: 'person',
    actor: 'مریم',
    from_status: null,
    to_status: 'new',
    note: null,
    at: '2026-11-03T08:00:00Z',
  },
  {
    id: 'e2',
    kind: 'edited',
    actor_kind: 'person',
    actor: 'مریم',
    from_status: 'new',
    to_status: 'new',
    note: null,
    at: '2026-11-03T08:01:00Z',
  },
  {
    id: 'e3',
    kind: 'execute_requested',
    actor_kind: 'person',
    actor: 'مریم',
    from_status: 'new',
    to_status: 'new',
    note: null,
    at: '2026-11-03T08:02:00Z',
  },
  {
    id: 'e4',
    kind: 'result',
    actor_kind: 'agent',
    actor: null,
    from_status: 'new',
    to_status: 'in_progress',
    note: 'شروع شد',
    at: '2026-11-03T08:03:00Z',
  },
  {
    id: 'e5',
    kind: 'asked',
    actor_kind: 'agent',
    actor: null,
    from_status: 'in_progress',
    to_status: 'waiting_decision',
    note: 'کدام؟',
    at: '2026-11-03T08:04:00Z',
  },
  {
    id: 'e6',
    kind: 'decided',
    actor_kind: 'person',
    actor: 'علی',
    from_status: 'waiting_decision',
    to_status: 'decided',
    note: 'other: نیمی از آن',
    at: '2026-11-03T08:05:00Z',
  },
  {
    id: 'e7',
    kind: 'execute_withdrawn',
    actor_kind: 'person',
    actor: 'مریم',
    from_status: 'decided',
    to_status: 'decided',
    note: null,
    at: '2026-11-03T08:06:00Z',
  },
  {
    id: 'e8',
    kind: 'cancelled',
    actor_kind: 'person',
    actor: 'مریم',
    from_status: 'decided',
    to_status: 'cancelled',
    note: null,
    at: '2026-11-03T08:07:00Z',
  },
  {
    id: 'e9',
    kind: 'reopened',
    actor_kind: 'person',
    actor: 'مریم',
    from_status: 'cancelled',
    to_status: 'new',
    note: null,
    at: '2026-11-03T08:08:00Z',
  },
];

const REQUEST_IMAGE: ConsoleRequestImage = {
  id: 'i1',
  position: 1,
  caption: 'نمای جدول روی گوشی',
  content_type: 'image/webp',
  byte_size: 120_000,
  width: 1170,
  height: 2400,
  sha256: 'a'.repeat(64),
  thumb_width: 234,
  thumb_height: 480,
  uploaded_by: 'مریم',
  created_at: '2026-11-03T08:01:00Z',
};

const requestFixture = (overrides: Partial<ConsoleRequestDetail>): ConsoleRequestDetail => ({
  id: 'r1',
  title: 'جدول لیگ',
  body: 'جزئیات درخواست',
  status: 'new',
  priority: 'normal',
  created_by: 'مریم',
  created_by_username: 'maryam',
  created_at: '2026-11-03T08:00:00Z',
  updated_at: '2026-11-03T08:00:00Z',
  result: null,
  result_at: null,
  decision_question: null,
  decision_asked_at: null,
  decision_choice: null,
  decision_text: null,
  decision_by: null,
  decided_at: null,
  execute_requested_at: null,
  images: [],
  events: REQUEST_EVENTS,
  ...overrides,
});

const REQUESTS: ConsoleRequestDetail[] = [
  requestFixture({ id: 'r1', priority: 'high', execute_requested_at: '2026-11-03T08:02:00Z' }),
  requestFixture({
    id: 'r2',
    status: 'in_progress',
    result: 'شاخه باز شد',
    result_at: '2026-11-03T09:00:00Z',
    // T-1731: pictures, with a Persian caption and without one.
    images: [REQUEST_IMAGE, { ...REQUEST_IMAGE, id: 'i2', position: 2, caption: null }],
  }),
  requestFixture({
    id: 'r3',
    status: 'waiting_decision',
    decision_question: 'کدام؟',
    decision_asked_at: '2026-11-03T09:00:00Z',
  }),
  requestFixture({
    id: 'r4',
    status: 'decided',
    decision_question: 'کدام؟',
    decision_asked_at: '2026-11-03T09:00:00Z',
    decision_choice: 'approve',
    decision_text: 'موافقم',
    decision_by: 'علی',
    decided_at: '2026-11-03T10:00:00Z',
  }),
  requestFixture({
    id: 'r5',
    status: 'done',
    result: 'انجام شد',
    result_at: '2026-11-03T11:00:00Z',
  }),
  requestFixture({
    id: 'r6',
    status: 'cancelled',
    decision_question: 'کدام؟',
    decision_asked_at: '2026-11-03T09:00:00Z',
  }),
];

const REQUEST_COUNTS = {
  all: 6,
  open: 4,
  by_status: { new: 1, in_progress: 1, waiting_decision: 1, decided: 1, done: 1, cancelled: 1 },
};

const FULL_FLOW: ConsoleAgentFlow = {
  triggers: CONSOLE_FLOW_TRIGGERS.map((kind) => ({
    kind,
    detail: kind === 'schedule' ? 'daily' : null,
  })),
  inputs: CONSOLE_FLOW_INPUTS.map((kind) => ({
    kind,
    detail:
      kind === 'team-reports'
        ? 'marketing-manager, seo-search'
        : kind === 'skill'
          ? '.claude/skills/data-audit/SKILL.md'
          : kind === 'production-db'
            ? 'data-audit/run.sh'
            : null,
  })),
  steps: [
    { text: 'Run the invariants', fa: 'اجرای بررسی‌های ثابت داده (invariants)' },
    { text: 'Triage', fa: 'دسته‌بندی و اولویت‌بندی آنچه پیدا شد' },
    { text: 'Spot-check the live site', fa: 'سنجش نمونه‌ای سایت زنده' },
  ],
  limits: CONSOLE_FLOW_LIMITS.map((kind) => ({ kind, detail: null })),
  outputs: CONSOLE_FLOW_OUTPUTS.map((kind) => ({
    kind,
    detail:
      kind === 'report'
        ? 'E:/FMIP/data-audit/reports/'
        : kind === 'findings'
          ? 'E:/FMIP/ops/findings/ · aud-'
          : null,
  })),
  readers: CONSOLE_FLOW_READERS.map((kind) => ({
    kind,
    detail: kind === 'agent' ? 'chief-of-staff' : null,
  })),
};

const agent = (overrides: Partial<ConsoleAgent> = {}): ConsoleAgent => ({
  name: 'data-auditor',
  description: 'Audits the correctness of production data. Never changes data.',
  model: 'sonnet',
  tools: ['Read', 'Bash', 'mcp__Claude_Browser__navigate'],
  access: [
    { area: 'Reads the repository and the ops files', level: 'read', tools: ['Read'] },
    {
      area: 'Runs commands: scripts, git, and the server over ssh (read-only by the charter)',
      level: 'write',
      tools: ['Bash'],
    },
    {
      area: 'Opens the live site in the built-in browser',
      level: 'read',
      tools: ['browser.navigate'],
    },
  ],
  skills: ['data-audit'],
  schedule: 'daily',
  paused: false,
  workflow: {
    inputs: ['The project rules and the charter', 'Reads the repository and the ops files'],
    steps: ['Run the invariants', 'Triage'],
    outputs: ['Findings in E:/FMIP/ops/findings/', 'Reports in E:/FMIP/data-audit/reports/'],
  },
  flow: FULL_FLOW,
  memory: {
    sources: [
      { kind: 'instructions', label: 'Its instructions', path: '.claude/agents/data-auditor.md' },
      { kind: 'project', label: 'The project rules', path: 'CLAUDE.md' },
      { kind: 'charter', label: 'The team charter', path: '.claude/skills/team-charter/SKILL.md' },
      { kind: 'skill', label: 'Skill: data-audit', path: '.claude/skills/data-audit/SKILL.md' },
      { kind: 'history', label: 'Its past findings', path: 'E:/FMIP/ops/findings/' },
      { kind: 'history', label: 'Its past reports', path: 'E:/FMIP/data-audit/reports/' },
      { kind: 'memory', label: 'Its own memory', path: '.claude/agent-memory/data-auditor/' },
    ],
    entries: [
      {
        path: '.claude/agent-memory/data-auditor/baselines.md',
        updated_at: '2026-11-02T08:00:00Z',
        text: 'خط پایه‌ها',
      },
    ],
  },
  runs: [{ at: '2026-11-02T08:00:00.000Z', status: 'ok', findings: 2, duration_seconds: null }],
  ...overrides,
});

const SNAPSHOT: ConsoleSnapshot = {
  schema: 1,
  generated_at: '2026-11-03T05:00:00Z',
  agents: [
    agent(),
    agent({ name: 'chief-of-staff', flow: undefined, schedule: 'daily', paused: true }),
  ],
  findings: [
    {
      id: 'aud-2026-11-02-01',
      agent: 'data-auditor',
      severity: 'major',
      status: 'open',
      title: 'جدول لیگ ناقص است',
      opened_at: '2026-11-02',
      detail: 'شاهد',
      related: null,
    },
    {
      id: 'sec-2026-11-02-01',
      agent: 'security',
      severity: 'critical',
      status: 'open',
      title: 'سرآیند گم شده',
      opened_at: '2026-11-02',
      detail: null,
      related: null,
    },
  ],
  reports: [
    {
      agent: 'data-auditor',
      date: '2026-11-02',
      title: 'گزارش روزانه',
      path: 'data-audit/reports/2026-11-02.md',
      text: 'متن گزارش',
    },
    {
      agent: 'security',
      date: '2026-11-01',
      title: 'گزارش امنیت',
      path: 'ops/reports/security/2026-11-01.md',
      text: '',
    },
  ],
  brief: { date: '2026-11-03', text: 'خلاصه‌ی امروز' },
  decisions: [
    {
      id: 'd-2026-11-02-01',
      title: 'کانال تازه باز شود؟',
      status: 'open',
      summary: 'زمینه',
      options: [
        { key: 'a', label: 'بله' },
        { key: 'b', label: 'نه' },
      ],
      answer: null,
      decided_by: null,
      decided_at: null,
    },
    {
      id: 'd-2026-11-01-01',
      title: 'رنگ تازه',
      status: 'decided',
      summary: '',
      options: [],
      answer: 'بله',
      decided_by: 'the decision desk',
      decided_at: '2026-11-01',
    },
    {
      id: 'D-350',
      title: 'گفتگو با هر عامل',
      status: 'decided',
      summary: '',
      options: [],
      answer: null,
      decided_by: 'maintainer',
      decided_at: '2026-11-02',
    },
  ],
  // T-1752: the lab's ledger, a slice of the real file, so its Persian is scanned too.
  model_lab: MODEL_LAB,
  // T-1830: the data providers' comparison, the publisher's fixture after its check.
  providers: PROVIDERS,
};

// --- The scan ------------------------------------------------------------------

/**
 * Technical terms a Persian reader expects in English (D-352). Identifiers
 * (agent ids, `T-`/`D-` ids, paths, file names, dotted or dashed names) pass
 * by their shape, and anything inside `dir="ltr"` is data or code.
 */
const TECHNICAL_TERMS = new Set([
  'Stadiomind',
  'Claude',
  'PR',
  'PRs',
  'CI',
  'API',
  'URL',
  'SQL',
  'ssh',
  'git',
  'diff',
  'merge',
  'deploy',
  'commit',
  'production',
  'snapshot',
  'sitemap',
  'robots',
  'canonical',
  'hreflang',
  'blueprint',
  'invariants',
  'build',
  'cache',
  'design',
  'system',
  'Design',
  'Artifact',
  'GitHub',
  'Google',
  'Telegram',
  'Instagram',
  'X',
  'RTL',
  'XSS',
  'UK',
  'GDPR',
  'log',
  'loss',
  'Brier',
  'calibration',
  'shadow',
  'Elo',
  'RPS',
  'xG',
  'Club',
  'Wilson',
  'APPROVE',
  'CHANGES',
  'REQUESTED',
  'haiku',
  'sonnet',
  'opus',
  'inherit',
  'en',
  'fa',
  'D-xxx',
  'YYYY-MM-DD',
  // T-1830: data providers and their plans are named in English in the research's Persian text.
  'API-Football',
  'Sportmonks',
  'Sportradar',
  'Starter',
  'Growth',
  'Advanced',
  'Ultra',
  'Enterprise',
  'PayPal',
  'SLA',
  'KYC',
]);

const isTechnical = (word: string) =>
  TECHNICAL_TERMS.has(word) ||
  /^[A-Z]{1,3}-\d+$/.test(word) || // T-1725, D-352
  /^[a-z0-9]+(?:[-_.][a-z0-9]+)+$/.test(word) || // data-auditor, agent.pause, aud-2026
  /^[a-z]{2,4}-$/.test(word) || // a finding prefix: aud-
  /[/:]/.test(word) || // a path or a URL
  /^[\w-]+\.(md|sh|sql|json|jsonl|ts|tsx)$/i.test(word); // CLAUDE.md, ops-check.sh

const VOID = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'source',
  'track',
  'wbr',
]);
const decode = (s: string) =>
  s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCharCode(Number(n)));

/** The visible text and the read-out attributes of rendered markup, outside left-to-right parts. */
function persianText(html: string): string[] {
  const out: string[] = [];
  const stack: boolean[] = [];
  const pattern =
    /<!--[\s\S]*?-->|<(\/?)([a-zA-Z][\w:-]*)((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)>|([^<]+)/g;
  // React's inline form-replay script is code, not text.
  const visible = html.replace(/<(script|style)\b[\s\S]*?<\/\1>/g, '');
  for (const m of visible.matchAll(pattern)) {
    const ltrHere = stack.at(-1) ?? false;
    if (m[5] !== undefined) {
      if (!ltrHere) out.push(decode(m[5]));
      continue;
    }
    if (m[2] === undefined) continue;
    if (m[1] === '/') {
      stack.pop();
      continue;
    }
    const attrs = m[3] ?? '';
    const ltr = ltrHere || /\s(dir|direction)="ltr"/.test(attrs);
    if (!ltr) {
      for (const a of attrs.matchAll(/\s(placeholder|aria-label|title|alt)="([^"]*)"/g))
        out.push(decode(a[2]!));
    }
    if (m[4] !== '/' && !VOID.has(m[2].toLowerCase())) stack.push(ltr);
  }
  return out;
}

/** Latin words in Persian text that are not technical terms. */
function englishWords(html: string): string[] {
  const words: string[] = [];
  for (const text of persianText(html)) {
    for (const m of text.matchAll(/[A-Za-z0-9][\w.:/*<>+-]*[\w/-]|[A-Za-z]/g)) {
      const word = m[0].replace(/[.:]+$/, '');
      if (/[A-Za-z]/.test(word) && !isTechnical(word)) words.push(word);
    }
  }
  return words;
}

// --- The pages -----------------------------------------------------------------

const params = <T,>(value: T) => Promise.resolve(value);

async function render(node: ReactNode | Promise<ReactNode>): Promise<string> {
  return renderToStaticMarkup(<>{await node}</>);
}

beforeEach(() => {
  fixtures.snapshot = SNAPSHOT;
  fixtures.invitationOk = true;
});

describe('the Persian-only scan', () => {
  it('finds English UI words and lets technical terms and left-to-right data through', () => {
    expect(englishWords('<p>Something went wrong</p>')).toEqual(['Something', 'went', 'wrong']);
    expect(englishWords('<p>هر PR تازه، data-auditor و T-1725 در CLAUDE.md</p>')).toEqual([]);
    expect(englishWords('<p>مسیر <span dir="ltr">Read, Grep <b>Bash</b></span> ادامه</p>')).toEqual(
      [],
    );
    expect(englishWords('<input placeholder="Your name"/><p>نام</p>')).toEqual(['Your', 'name']);
    expect(
      englishWords('<svg><text direction="ltr">E:/FMIP/ops/x.md Bash</text><text>Run</text></svg>'),
    ).toEqual(['Run']);
  });

  const pages: [string, () => Promise<string>][] = [
    ['the overview', async () => render((await import('./(app)/page')).default())],
    [
      'an agent',
      async () =>
        render(
          (await import('./(app)/agents/[name]/page')).default({
            params: params({ name: 'data-auditor' }),
          }),
        ),
    ],
    [
      'an agent from an older snapshot',
      async () =>
        render(
          (await import('./(app)/agents/[name]/page')).default({
            params: params({ name: 'chief-of-staff' }),
          }),
        ),
    ],
    [
      'the chat',
      async () =>
        render(
          (await import('./(app)/agents/[name]/chat/page')).default({
            params: params({ name: 'data-auditor' }),
            searchParams: params({ before: 'm1' }),
          }),
        ),
    ],
    [
      'the findings',
      async () =>
        render(
          (await import('./(app)/findings/page')).default({
            searchParams: params({ status: 'all' }),
          }),
        ),
    ],
    [
      'the reports',
      async () =>
        render(
          (await import('./(app)/reports/page')).default({
            searchParams: params({ path: 'ops/reports/security/2026-11-01.md' }),
          }),
        ),
    ],
    ['the decisions', async () => render((await import('./(app)/decisions/page')).default())],
    ['the board', async () => render((await import('./(app)/board/page')).default())],
    [
      'the teammate requests',
      async () =>
        render((await import('./(app)/requests/page')).default({ searchParams: params({}) })),
    ],
    [
      'the teammate requests filtered',
      async () =>
        render(
          (await import('./(app)/requests/page')).default({
            searchParams: params({ status: 'waiting_decision' }),
          }),
        ),
    ],
    ['the audit trail', async () => render((await import('./(app)/audit/page')).default())],
    [
      'the calendar',
      async () =>
        render((await import('./(app)/calendar/page')).default({ searchParams: params({}) })),
    ],
    [
      'the calendar week with an event open',
      async () =>
        render(
          (await import('./(app)/calendar/page')).default({
            searchParams: params({ view: 'week', event: '22222222-2222-4222-8222-222222222222' }),
          }),
        ),
    ],
    [
      'the calendar list, Gregorian, with a renewal being added',
      async () =>
        render(
          (await import('./(app)/calendar/page')).default({
            searchParams: params({ view: 'agenda', cal: 'g', new: '2026-11-21', sub: 'data-feed' }),
          }),
        ),
    ],
    [
      'the subscriptions',
      async () => render((await import('./(app)/calendar/subscriptions/page')).default()),
    ],
    ['the forecast model', async () => render((await import('./(app)/model/page')).default())],
    [
      'the data providers',
      async () =>
        render((await import('./(app)/providers/page')).default({ searchParams: params({}) })),
    ],
    [
      'the header',
      async () => render((await import('./(app)/layout')).default({ children: <p>بدنه</p> })),
    ],
    ['sign-in', async () => render((await import('./(open)/login/page')).default())],
    [
      'the invitation',
      async () =>
        render(
          (await import('./(open)/invite/[token]/page')).default({
            params: params({ token: 't' }),
          }),
        ),
    ],
    ['a page that is not there', async () => render((await import('./not-found')).default())],
    [
      'a page that failed',
      async () =>
        render(
          (await import('./(app)/error')).default({
            error: new Error('boom'),
            retry: () => undefined,
          }),
        ),
    ],
  ];

  it.each(pages)('renders %s in Persian only', async (_, page) => {
    const html = await page();
    expect(html.length).toBeGreaterThan(100);
    expect(englishWords(html)).toEqual([]);
  });

  it('renders an empty console, an expired invitation and a missing agent in Persian', async () => {
    fixtures.snapshot = null;
    expect(englishWords(await render((await import('./(app)/page')).default()))).toEqual([]);
    fixtures.invitationOk = false;
    const expired = await render(
      (await import('./(open)/invite/[token]/page')).default({ params: params({ token: 't' }) }),
    );
    expect(expired).toContain('این دعوت دیگر باز نیست');
    expect(englishWords(expired)).toEqual([]);
    await expect(
      (await import('./(app)/agents/[name]/page')).default({ params: params({ name: 'nobody' }) }),
    ).rejects.toThrow('NEXT_NOT_FOUND');
  });

  it("translates what reaches the console in English, and never shows an agent's English description", async () => {
    const agentPage = await render(
      (await import('./(app)/agents/[name]/page')).default({
        params: params({ name: 'data-auditor' }),
      }),
    );
    expect(agentPage).not.toContain('Audits the correctness');
    expect(agentPage).toContain('متوقف شد: اجرای روزانه از آن می‌گذرد.');
    expect(agentPage).toContain('از اجرای بعدی با opus کار می‌کند.');
    expect(agentPage).toContain('توقف');
    const audit = await render((await import('./(app)/audit/page')).default());
    expect(audit).toContain('وارد شد');
    expect(audit).toContain('بایگانی کارت');
    const decisions = await render((await import('./(app)/decisions/page')).default());
    expect(decisions).toContain('میز تصمیم');
    expect(decisions).toContain('نگهدارنده');
  });

  it('gives every page a Persian title', async () => {
    for (const path of [
      './(app)/audit/page',
      './(app)/board/page',
      './(app)/calendar/page',
      './(app)/calendar/subscriptions/page',
      './(app)/decisions/page',
      './(app)/findings/page',
      './(app)/model/page',
      './(app)/providers/page',
      './(app)/reports/page',
      './(app)/requests/page',
      './(open)/login/page',
      './(open)/invite/[token]/page',
    ]) {
      const { metadata } = (await import(path)) as { metadata: { title: string } };
      expect(englishWords(`<p>${metadata.title}</p>`), path).toEqual([]);
    }
  });

  it('keeps the document Persian and right to left', () => {
    const layout = readFileSync(join(__dirname, 'layout.tsx'), 'utf8');
    expect(layout).toContain('<html lang="fa" dir="rtl">');
  });
});

describe('the agents', () => {
  it('gives every agent of the team a Persian title and description', async () => {
    const { AGENT_DESCRIPTIONS, AGENT_TITLES } = await import('./ui');
    const team = readdirSync(join(__dirname, '..', '..', '..', '..', '..', '.claude', 'agents'))
      .filter((name) => name.endsWith('.md'))
      .map((name) => name.replace(/\.md$/, ''));
    expect(team.length).toBeGreaterThanOrEqual(16);
    for (const name of team) {
      expect(AGENT_TITLES[name], name).toBeDefined();
      expect(AGENT_DESCRIPTIONS[name], name).toBeDefined();
      expect(
        englishWords(`<p>${AGENT_TITLES[name]} ${AGENT_DESCRIPTIONS[name]}</p>`),
        name,
      ).toEqual([]);
    }
  });
});

describe('the schematic', () => {
  it('words every kind of box in Persian', async () => {
    const words = await import('./schematic');
    for (const table of [
      words.TRIGGER_WORDS,
      words.INPUT_WORDS,
      words.LIMIT_WORDS,
      words.OUTPUT_WORDS,
      words.READER_WORDS,
      words.SECTION_WORDS,
    ]) {
      for (const [kind, label] of Object.entries(table)) {
        expect(englishWords(`<p>${label}</p>`), kind).toEqual([]);
      }
    }
  });

  it('draws each section, right to left, in both layouts, with a legend', async () => {
    const { AgentSchematic } = await import('./schematic');
    const html = renderToStaticMarkup(<AgentSchematic agent={agent()} />);
    expect(html.match(/<svg/g)).toHaveLength(2);
    expect(html).toContain('data-layout="wide"');
    expect(html).toContain('data-layout="narrow"');
    for (const section of [
      'triggers',
      'inputs',
      'method',
      'limits',
      'outputs',
      'readers',
      'legend',
    ]) {
      expect(html.match(new RegExp(`data-section="${section}"`, 'g')), section).toHaveLength(2);
    }
    expect(html).toContain('direction="rtl"');
    expect(html).toContain('role="img"');
    expect(html).toContain('چطور بازرس داده کار می‌کند');
    expect(html).toContain('هر روز، در اجرای روزانه');
    expect(html).toContain('مدل: sonnet');
    expect(html).toContain('سنجش نمونه‌ای سایت زنده');
    expect(html).toContain('مدیر دفتر'); // a reader, by its Persian title
    expect(html).toContain('مدیر بازاریابی'); // team-reports, as titles
    expect(html).toContain('>۳<'); // step numbers in Persian digits
    // Paths stay left to right.
    expect(html).toMatch(/direction="ltr"[^>]*>⁦data-audit\/run\.sh⁩</);
    // The site's tokens, never a written colour (T-602).
    expect(html).not.toMatch(/#[0-9a-f]{3,6}\b|rgb\(/i);
    expect(englishWords(html)).toEqual([]);
  });

  it('stacks the narrow drawing top to bottom and lays the wide one out in columns', async () => {
    const { AgentSchematic } = await import('./schematic');
    const html = renderToStaticMarkup(<AgentSchematic agent={agent()} />);
    const [wide, narrow] = [...html.matchAll(/<svg viewBox="0 0 (\d+) (\d+)"/g)].map((m) => [
      Number(m[1]),
      Number(m[2]),
    ]);
    expect(wide![0]).toBeGreaterThan(900);
    expect(narrow![0]).toBeLessThanOrEqual(360);
    expect(narrow![1]).toBeGreaterThan(wide![1]!);
    expect(html).toContain('class="hidden sm:block"');
    expect(html).toContain('class="sm:hidden"');
  });

  it("draws an older snapshot's agent from what it has, in Persian", async () => {
    const { AgentSchematic, flowFor } = await import('./schematic');
    const old = agent({ flow: undefined });
    const flow = flowFor(old);
    expect(flow.triggers.map((t) => t.kind)).toEqual(['schedule', 'run-now', 'chat']);
    expect(flow.inputs.map((i) => i.kind)).toEqual([
      'rules',
      'skill',
      'memory',
      'repository',
      'live-site',
    ]);
    expect(flow.outputs).toEqual([
      { kind: 'report', detail: 'E:/FMIP/data-audit/reports/' },
      { kind: 'findings', detail: 'E:/FMIP/ops/findings/' },
    ]);
    // Its steps are its skill's English headings: they wait for the next snapshot.
    expect(flow.steps).toEqual([]);
    const html = renderToStaticMarkup(<AgentSchematic agent={old} />);
    expect(html).toContain('گام‌ها با به‌روزرسانی بعدی رایانه دیده می‌شوند.');
    expect(englishWords(html)).toEqual([]);
  });

  it('drops a box of a kind it does not know rather than show it', async () => {
    const { flowFor } = await import('./schematic');
    const odd = agent({
      flow: {
        ...FULL_FLOW,
        inputs: [
          { kind: 'telepathy' as never, detail: null },
          { kind: 'web', detail: null },
        ],
      },
    });
    expect(flowFor(odd).inputs).toEqual([{ kind: 'web', detail: null }]);
  });
});
