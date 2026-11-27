import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MAX_REPORT_DETAIL, REPORT_REASONS } from '@fmip/contracts';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { reportNoteLimit } from '@/lib/report';

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
 * «گزارش» / "Report" (T-1973): beside Block on a member's profile, and on
 * somebody else's message in a conversation; never for a guest, never on the
 * member's own profile.
 */

const MESSAGE = {
  conversationId: '00000000-0000-4000-8000-000000001973',
  messageId: '00000000-0000-4000-8000-000000009731',
};

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
  it('reports the author, names the message, and keeps the note inside the API’s limit', () => {
    const html = renderToStaticMarkup(
      <ReportMember locale="en" username="ali" message={MESSAGE} />,
    );
    expect(html).toContain('data-testid="report-message"');
    expect(html).toContain(`id="report-${MESSAGE.messageId}-reason"`);
    expect(html).toContain('This reports @ali, who wrote this message');

    const limit = reportNoteLimit(MESSAGE);
    expect(limit).toBeLessThan(MAX_REPORT_DETAIL);
    expect(html).toMatch(new RegExp(`<textarea[^>]*maxlength="${limit}"`, 'i'));
  });

  it('is offered on somebody else’s message only, and never on a deleted member’s', () => {
    const page = readFileSync(
      join(__dirname, '..', 'app', '[locale]', 'messages', '[id]', 'page.tsx'),
      'utf8',
    );
    expect(page).toMatch(
      /message\.author !== me\.username && !isDeletedMember\(message\.author\) && \(\s*<ReportMember/,
    );
    expect(page).toMatch(/message=\{\{ conversationId: id, messageId: message\.id \}\}/);
  });
});
