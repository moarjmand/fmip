import { MAX_REPORT_DETAIL } from '@fmip/contracts';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The report and the appeal as the web sends them (T-1973). The API spec
 * proves the rules -- the reasons, the lengths, one open report per subject,
 * one appeal per sanction -- and these prove what the forms send and what
 * each answer says.
 */
const apiRequest = vi.fn();
const revalidatePath = vi.fn();
vi.mock('@/lib/api', () => ({ apiRequest: (...args: unknown[]) => apiRequest(...args) }));
vi.mock('@/lib/session', () => ({ sessionCookieHeader: async () => 'fmip_session=abc' }));
vi.mock('next/cache', () => ({ revalidatePath: (...args: unknown[]) => revalidatePath(...args) }));

const { appealSanctionAction, reportMemberAction } = await import('./report-actions');

const SANCTION = '00000000-0000-4000-8000-00000000a1a1';

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.set(name, value);
  return data;
}

const filed = (yes: boolean) => ({ ok: true, status: 200, data: { filed: yes }, setCookie: null });
const appealed = { ok: true, status: 204, data: null, setCookie: null };
const failed = (status: number, message = 'Refused.') => ({
  ok: false,
  status,
  error: { error: status === 409 ? 'conflict' : 'not_found', message },
  setCookie: null,
});

beforeEach(() => {
  apiRequest.mockReset();
  revalidatePath.mockReset();
});

describe('a report', () => {
  it('sends the member, the reason and the note, and says a person will read it', async () => {
    apiRequest.mockResolvedValue(filed(true));
    const state = await reportMemberAction(
      'en',
      'ali',
      null,
      form({ reason: 'abuse', detail: '  He keeps sending threats.  ' }),
    );

    expect(apiRequest).toHaveBeenCalledWith('/reports', {
      method: 'POST',
      cookie: 'fmip_session=abc',
      body: {
        subject_type: 'member',
        subject: 'ali',
        reason: 'abuse',
        detail: 'He keeps sending threats.',
      },
    });
    expect(state).toEqual({
      ok: true,
      message: 'Report sent. A person will read it and record a decision.',
    });
  });

  it('sends no detail when nothing was written', async () => {
    apiRequest.mockResolvedValue(filed(true));
    await reportMemberAction('en', 'ali', null, form({ reason: 'spam', detail: '  ' }));
    expect(apiRequest.mock.calls[0]?.[1]?.body).toMatchObject({ reason: 'spam', detail: null });
  });

  it('says plainly when a report about them is already open, rather than "sent"', async () => {
    apiRequest.mockResolvedValue(filed(false));
    expect(
      await reportMemberAction('en', 'ali', null, form({ reason: 'abuse', detail: 'again' })),
    ).toEqual({
      ok: true,
      message:
        'You have already reported @ali, and a person will read that report. What you wrote now was not added to it.',
    });
    expect(
      await reportMemberAction('fa', 'ali', null, form({ reason: 'abuse', detail: 'again' })),
    ).toEqual({
      ok: true,
      message:
        'شما قبلاً @ali را گزارش کرده‌اید و یک نفر همان گزارش را می‌خواند. آنچه الان نوشتید به آن افزوده نشد.',
    });
  });

  it('asks for a reason and, for "Something else", a few words, before troubling the API', async () => {
    expect(await reportMemberAction('en', 'ali', null, form({ detail: 'x' }))).toEqual({
      ok: false,
      message: 'Choose a reason',
    });
    expect(
      await reportMemberAction('fa', 'ali', null, form({ reason: 'other', detail: ' ' })),
    ).toEqual({
      ok: false,
      message: 'بنویسید چه اتفاقی افتاده است: «مورد دیگر» بدون چند کلمه توضیح قابل بررسی نیست.',
    });
    expect(
      await reportMemberAction(
        'en',
        'ali',
        null,
        form({ reason: 'spam', detail: 'x'.repeat(MAX_REPORT_DETAIL + 1) }),
      ),
    ).toEqual({ ok: false, message: 'The details can be at most 2,000 characters.' });
    expect(apiRequest).not.toHaveBeenCalled();
  });

  it('says plainly when the member is gone, and passes any other refusal through', async () => {
    apiRequest.mockResolvedValueOnce(failed(404));
    expect(await reportMemberAction('en', 'ali', null, form({ reason: 'spam' }))).toEqual({
      ok: false,
      message: 'This account could not be found.',
    });

    apiRequest.mockResolvedValueOnce({
      ok: false,
      status: 429,
      error: { error: 'rate_limited', message: 'Too many reports; try again in a minute.' },
      setCookie: null,
    });
    expect(await reportMemberAction('en', 'ali', null, form({ reason: 'spam' }))).toEqual({
      ok: false,
      message: 'Too many reports; try again in a minute.',
    });
  });
});

describe('an appeal', () => {
  it('sends the text, refreshes Settings, and says a person will read it', async () => {
    apiRequest.mockResolvedValue(appealed);
    const state = await appealSanctionAction(
      'en',
      SANCTION,
      null,
      form({ body: ' I was answering requests. ' }),
    );

    expect(apiRequest).toHaveBeenCalledWith(`/me/sanctions/${SANCTION}/appeal`, {
      method: 'POST',
      cookie: 'fmip_session=abc',
      body: { body: 'I was answering requests.' },
    });
    expect(revalidatePath).toHaveBeenCalledWith('/en/settings');
    expect(state).toEqual({ ok: true, message: 'Appeal sent. A person will read it.' });
  });

  it('is once: a second is told so in the reader’s language', async () => {
    apiRequest.mockResolvedValue(failed(409, 'You have already appealed this restriction.'));
    expect(await appealSanctionAction('fa', SANCTION, null, form({ body: 'again' }))).toEqual({
      ok: false,
      message: 'برای این محدودیت قبلاً درخواست تجدیدنظر داده‌اید.',
    });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('asks for words before sending, and names a sanction that is not theirs', async () => {
    expect(await appealSanctionAction('en', SANCTION, null, form({ body: '   ' }))).toEqual({
      ok: false,
      message: 'Say why you are appealing.',
    });
    expect(apiRequest).not.toHaveBeenCalled();

    apiRequest.mockResolvedValue(failed(404));
    expect(await appealSanctionAction('en', SANCTION, null, form({ body: 'why' }))).toEqual({
      ok: false,
      message: 'This restriction is not on your account.',
    });
  });
});
