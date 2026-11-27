import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MAX_REPORT_DETAIL, REPORT_REASONS } from '@fmip/contracts';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/report-actions', () => ({
  reportMemberAction: async () => null,
  appealSanctionAction: async () => null,
}));
vi.mock('@/lib/friend-actions', () => ({
  acceptFriendRequestAction: async () => null,
  blockAction: async () => null,
  sendFriendRequestAction: async () => null,
  unblockAction: async () => null,
  unfriendAction: async () => null,
  withdrawFriendRequestAction: async () => null,
}));

const { FriendControls } = await import('./friend-controls');
const { ReportMember } = await import('./report-member');

/**
 * «گزارش» / "Report" (T-1973): beside Block on a member's profile and on each
 * row of /friends, and on somebody else's message in a conversation; never for
 * a guest, never on the member's own profile.
 */

/** Every `id` in the markup, and every id a label or a description points at. */
function ids(html: string): { defined: string[]; referenced: string[] } {
  const defined = [...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1] ?? '');
  const referenced = [
    ...[...html.matchAll(/\sfor="([^"]+)"/g)].map((m) => m[1] ?? ''),
    ...[...html.matchAll(/\saria-describedby="([^"]+)"/g)].flatMap((m) => (m[1] ?? '').split(' ')),
  ];
  return { defined, referenced };
}

describe('the report on a profile', () => {
  it('is not drawn for a signed-out visitor, nor on the member’s own profile', () => {
    expect(renderToStaticMarkup(<FriendControls locale="en" username="ali" status={null} />)).toBe(
      '',
    );
    expect(renderToStaticMarkup(<FriendControls locale="en" username="ali" status="self" />)).toBe(
      '',
    );
  });

  it('sits beside Block in every state another member can be in', () => {
    for (const status of [
      'none',
      'request_sent',
      'request_received',
      'friends',
      'blocked',
      'unavailable',
    ] as const) {
      const html = renderToStaticMarkup(
        <FriendControls locale="en" username="ali" status={status} />,
      );
      expect(html, status).toContain('data-testid="report-member"');
      expect(html, status).toMatch(/data-testid="report-member-open"[^>]*>(<span[^>]*>)?Report</);
    }
  });

  it('is a small form: the API’s reasons, an optional note within its limit, a submit', () => {
    const html = renderToStaticMarkup(<ReportMember locale="en" username="ali" />);

    // Folded until asked for, and it opens without JavaScript.
    expect(html).toMatch(/^<details[^>]*data-testid="report-member"/);
    expect(html).not.toMatch(/<details[^>]*\sopen[=\s>]/);

    const options = [...html.matchAll(/<option value="([a-z_]*)"/g)].map((m) => m[1]);
    expect(options).toEqual(['', ...REPORT_REASONS]);
    expect(html).toMatch(/<select[^>]*name="reason"[^>]*required/);
    expect(html).toContain('Spam: unwanted messages, advertising or links');
    expect(html).toContain('Something else');

    expect(html).toMatch(
      new RegExp(`<textarea[^>]*name="detail"[^>]*maxlength="${MAX_REPORT_DETAIL}"`, 'i'),
    );
    expect(html).not.toMatch(/<textarea[^>]*required/);
    expect(html).toContain('Up to 2,000 characters.');
    expect(html).toContain('Send report');
    expect(html).toContain('A person reads every report and records a decision');
    // What the member types keeps its own direction.
    expect(html).toMatch(/<textarea[^>]*dir="auto"/);
  });

  it('never widens a phone: every flex box on the way can shrink, and the select fills its column', () => {
    // The screenshot pass of 2026-11-27: the longest reason kept the select
    // 382 px wide and the profile 440 px at 375. The e2e journey measures the
    // page (social.spec.ts); this holds the classes that make it fit.
    const html = renderToStaticMarkup(<FriendControls locale="en" username="ali" status="none" />);
    expect(html).toMatch(
      /^<div class="flex min-w-0 max-w-full flex-wrap[^"]*" data-testid="friend-controls"/,
    );
    expect(html).toMatch(/<details class="min-w-0 max-w-full open:basis-full"/);
    const select = (/<select class="([^"]*)"[^>]*name="reason"/.exec(html)?.[1] ?? '').split(' ');
    expect(select).toEqual(expect.arrayContaining(['w-full', 'max-w-full']));
    for (const page of [
      join(__dirname, '..', 'app', '[locale]', 'u', '[username]', 'page.tsx'),
      join(__dirname, '..', 'app', '[locale]', 'friends', 'page.tsx'),
    ]) {
      expect(readFileSync(page, 'utf8')).toMatch(
        /<div className="flex min-w-0 max-w-full flex-wrap items-start gap-4">\s*<FriendControls/,
      );
    }
    // The same size as Add friend and Block beside it.
    expect(html).toMatch(/data-testid="report-member-open"/);
    expect(html).not.toMatch(/<summary class="[^"]*min-h-touch/);
  });

  it('gives every row of /friends its own ids, so each label and hint names its own field', () => {
    // /friends draws FriendControls once per member (T-1973 review, D-041).
    const html = renderToStaticMarkup(
      <ul>
        <li>
          <FriendControls locale="en" username="ali" status="friends" />
        </li>
        <li>
          <FriendControls locale="en" username="sara" status="request_received" />
        </li>
        <li>
          <ReportMember locale="en" username="reza" fromMessage />
        </li>
      </ul>,
    );
    const { defined, referenced } = ids(html);

    expect(html.match(/<select[^>]*name="reason"/g)).toHaveLength(3);
    expect(defined.length).toBeGreaterThanOrEqual(9);
    expect(new Set(defined).size).toBe(defined.length);
    for (const target of referenced) expect(defined, target).toContain(target);
    expect(html).not.toMatch(/\sid="report-/);
  });

  it('is written in Persian for a Persian reader', () => {
    const html = renderToStaticMarkup(<ReportMember locale="fa" username="ali" />);
    expect(html).toContain('گزارش');
    expect(html).toContain('ارسال گزارش');
    expect(html).toContain('جعل هویت');
    expect(html).not.toContain('lang="en"');
  });
});

describe('the report on a message', () => {
  it('reports the author, says the message is not attached, and is the small control', () => {
    const html = renderToStaticMarkup(<ReportMember locale="en" username="ali" fromMessage />);
    expect(html).toContain('data-testid="report-message"');
    expect(html).toContain('data-testid="report-message-open"');
    // The handle is isolated left to right, so Persian keeps the @ before the name.
    expect(html).toContain('This reports \u2066@ali\u2069, who wrote this message.');
    expect(html).toContain('The message itself is not attached');
    expect(html).toMatch(new RegExp(`<textarea[^>]*maxlength="${MAX_REPORT_DETAIL}"`, 'i'));
  });

  it('is offered on somebody else’s message only, never on a deleted member’s, and sends no message id', () => {
    const page = readFileSync(
      join(__dirname, '..', 'app', '[locale]', 'messages', '[id]', 'page.tsx'),
      'utf8',
    );
    expect(page).toMatch(
      /message\.author !== me\.username && !isDeletedMember\(message\.author\) && \(\s*<ReportMember locale=\{locale\} username=\{message\.author\} fromMessage \/>/,
    );
    const actions = readFileSync(join(__dirname, '..', 'lib', 'report-actions.ts'), 'utf8');
    expect(actions).not.toMatch(/messageId|conversationId/);
  });
});
