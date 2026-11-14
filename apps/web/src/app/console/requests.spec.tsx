import type { ConsoleRequestDetail, ConsoleRequestEvent } from '@fmip/contracts';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/console-actions', () => {
  const action = async () => ({ error: null, done: null });
  return {
    createRequest: action,
    editRequest: action,
    requestAction: action,
    decideRequest: action,
    removeRequestImage: action,
    captionRequestImage: action,
    refreshRequests: async () => undefined,
  };
});

const { RequestCard, REQUEST_STATUS_WORDS, decisionNote, eventWords } = await import('./requests');

/**
 * Teammate requests (T-1728, D-354): every state of a card, drawn on the
 * server. The result box, the decision panel and the actions follow the
 * status; Claude's lines are signed as Claude; a request's text is never
 * markup; sides are logical only (rule 7).
 */

const event = (overrides: Partial<ConsoleRequestEvent>): ConsoleRequestEvent => ({
  id: `e-${Math.random()}`,
  kind: 'created',
  actor_kind: 'person',
  actor: 'مصطفی',
  from_status: null,
  to_status: 'new',
  note: null,
  at: '2026-11-03T08:00:00.000Z',
  ...overrides,
});

const request = (overrides: Partial<ConsoleRequestDetail> = {}): ConsoleRequestDetail => ({
  id: '0f8fad5b-d9cb-469f-a165-70867728950e',
  title: 'جدول لیگ آمریکا دو کنفرانس شود',
  body: 'هم‌تیمی گفت\nشرق و غرب جدا',
  status: 'new',
  priority: 'normal',
  created_by: 'مصطفی',
  created_by_username: 'mostafa',
  created_at: '2026-11-03T08:00:00.000Z',
  updated_at: '2026-11-03T08:00:00.000Z',
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
  events: [event({})],
  ...overrides,
});

const render = (r: ConsoleRequestDetail) => renderToStaticMarkup(<RequestCard request={r} />);

describe('a request card (T-1728)', () => {
  it('draws a new request: the request at the start, an empty result box, its actions', () => {
    const html = render(request());
    expect(html).toContain('data-status="new"');
    expect(html).toContain(REQUEST_STATUS_WORDS.new);
    expect(html).toContain('جدول لیگ آمریکا دو کنفرانس شود');
    expect(html).toContain('هم‌تیمی گفت\nشرق و غرب جدا');
    expect(html).toContain('نتیجه‌ی پیگیری');
    expect(html).toContain('هنوز نتیجه‌ای ثبت نشده');
    expect(html).toContain('اجرا شود');
    expect(html).toContain('لغو');
    expect(html).toContain('ویرایش');
    expect(html).toContain('تاریخچه (۱)');
    expect(html).not.toContain('data-testid="decision-panel"');
    expect(html).not.toContain('بازگشایی');
    // The request comes first in the source, so at the start (right) in right-to-left.
    expect(html.indexOf('جدول لیگ')).toBeLessThan(html.indexOf('data-testid="result-box"'));
    expect(html).toContain('md:grid-cols-');
  });

  it('marks a high-priority request queued to run, and offers to withdraw the mark', () => {
    const html = render(
      request({ priority: 'high', execute_requested_at: '2026-11-03T09:00:00.000Z' }),
    );
    expect(html).toContain('فوری');
    expect(html).toContain('در صف اجرا');
    expect(html).toContain('برداشتن از صف اجرا');
    expect(html).not.toContain('>اجرا شود<');
  });

  it("draws one in progress with Claude's result and its time", () => {
    const html = render(
      request({
        status: 'in_progress',
        result: 'شاخه‌ی t-1800 باز شد.',
        result_at: '2026-11-03T10:00:00.000Z',
        events: [
          event({}),
          event({
            kind: 'result',
            actor_kind: 'agent',
            actor: null,
            from_status: 'new',
            to_status: 'in_progress',
            note: 'شاخه‌ی t-1800 باز شد.',
          }),
        ],
      }),
    );
    expect(html).toContain(REQUEST_STATUS_WORDS.in_progress);
    expect(html).toContain('شاخه‌ی t-1800 باز شد.');
    expect(html).not.toContain('هنوز نتیجه‌ای ثبت نشده');
    expect(html).toContain('Claude');
    expect(html).toContain('نتیجه نوشت؛ وضعیت: در حال انجام');
  });

  it('opens the decision panel with its three answers while the question is open', () => {
    const html = render(
      request({
        status: 'waiting_decision',
        decision_question: 'هر دو جام یا فقط لیگ؟',
        decision_asked_at: '2026-11-03T10:00:00.000Z',
      }),
    );
    expect(html).toContain('data-state="open"');
    expect(html).toContain('منتظر تصمیم هم‌تیمی');
    expect(html).toContain('هر دو جام یا فقط لیگ؟');
    for (const [value, label] of [
      ['approve', 'موافقم'],
      ['reject', 'مخالفم'],
      ['other', 'نظر دیگر'],
    ])
      expect(html).toMatch(
        new RegExp(
          `<button type="submit"(?=[^>]*name="choice")[^>]*value="${value}"[^>]*>${label}<`,
        ),
      );
    expect(html).toContain('name="text"');
    // Not run while the question is open.
    expect(html).not.toContain('>اجرا شود<');
    expect(html).toContain('border-warning');
  });

  it('shows who decided, when and what, and offers to run a decided request', () => {
    const html = render(
      request({
        status: 'decided',
        decision_question: 'هر دو جام یا فقط لیگ؟',
        decision_asked_at: '2026-11-03T10:00:00.000Z',
        decision_choice: 'other',
        decision_text: 'اول لیگ، جام‌ها هفته‌ی بعد.',
        decision_by: 'هم‌تیمی',
        decided_at: '2026-11-03T11:00:00.000Z',
      }),
    );
    expect(html).toContain('data-state="decided"');
    expect(html).toContain('تصمیم هم‌تیمی');
    expect(html).toContain('اول لیگ، جام‌ها هفته‌ی بعد.');
    expect(html).toContain('هم‌تیمی');
    expect(html).not.toContain('name="choice"');
    expect(html).toContain('>اجرا شود<');
  });

  it('closes a done request: no edit or cancel, a reopen instead', () => {
    const html = render(
      request({
        status: 'done',
        result: 'انجام شد در #900.',
        result_at: '2026-11-03T12:00:00.000Z',
      }),
    );
    expect(html).toContain(REQUEST_STATUS_WORDS.done);
    expect(html).toContain('بازگشایی');
    expect(html).not.toContain('>لغو<');
    expect(html).not.toContain('ویرایش');
    expect(html).not.toContain('>اجرا شود<');
  });

  it('keeps a request text as text, and uses logical sides only', () => {
    const html = render(request({ title: '<script>x</script>', body: '<b>no</b>' }));
    expect(html).toContain('&lt;script&gt;x&lt;/script&gt;');
    expect(html).not.toContain('<b>no</b>');
    expect(html).not.toMatch(/\b(ml|mr|pl|pr|left|right)-/);
  });
});

describe('the history', () => {
  it('reads a decision note and words every kind of line', () => {
    expect(decisionNote('other: نیمی از آن')).toEqual({ choice: 'other', text: 'نیمی از آن' });
    expect(decisionNote('approve')).toEqual({ choice: 'approve', text: null });
    expect(decisionNote('nonsense')).toBeNull();
    expect(eventWords(event({ kind: 'decided', note: 'reject' }))).toBe('تصمیم گرفت: مخالف');
    for (const kind of [
      'created',
      'edited',
      'cancelled',
      'reopened',
      'execute_requested',
      'execute_withdrawn',
      'asked',
      'decided',
      'result',
    ] as const)
      expect(eventWords(event({ kind }))).not.toMatch(/[A-Za-z]/);
  });
});
