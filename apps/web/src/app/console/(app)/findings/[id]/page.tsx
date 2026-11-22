import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { ConsoleLink as Link } from '@/app/console/console-link';
import { consoleHeartbeat, consoleMe, consoleSnapshot } from '@/lib/console-api';
import { FindingTriage, TriageBar } from '../../../finding-triage';
import { FindingMeta, findingHref, triageView } from '../../../findings';
import { GROUP_WORDS, findingParts, similarFindings, titleWithheld } from '../../../triage';
import { Badge, Card, FindingTitle, STATUS_WORDS, SeverityBadge, when } from '../../../ui';

export const metadata: Metadata = { title: 'یافته' };

/** One part of the finding as the agent wrote it (English or Persian, its own direction), or that it was not supplied. */
function Part({ title, text }: { title: string; text: string }) {
  return (
    <section>
      <h2 className="text-sm font-bold text-fg">{title}</h2>
      {text === '' ? (
        <p className="mt-1 text-sm text-caption">در این هم‌گام‌سازی نیامده است.</p>
      ) : (
        <p dir="auto" className="mt-1 whitespace-pre-wrap break-words text-sm text-muted">
          {text}
        </p>
      )}
    </section>
  );
}

const Step = ({ children }: { children: ReactNode }) => (
  <li className="border-s-2 border-default ps-3 text-sm text-muted">{children}</li>
);

/**
 * A finding's own page (T-1908, D-456): what the agent saw, the likely cause
 * and the proposal, what is known of its history, its triage (a bar fixed to
 * the bottom of a phone's window while there is something to decide or to
 * wait for) and the findings on the same subject. All of it is the last
 * snapshot's; the page says where the snapshot carries less than the
 * computer holds.
 */
export default async function ConsoleFindingPage({ params }: { params: Promise<{ id: string }> }) {
  const raw = (await params).id;
  let id = raw;
  try {
    id = decodeURIComponent(raw);
  } catch {
    id = raw;
  }
  const [result, heartbeat, me] = await Promise.all([
    consoleSnapshot(),
    consoleHeartbeat(),
    consoleMe(),
  ]);
  const all = result.ok ? (result.data.snapshot?.findings ?? []) : [];
  const finding = all.find((f) => f.id === id);
  const back = (
    <Link
      href="/findings"
      className="inline-flex min-h-9 items-center text-sm font-semibold text-accent underline underline-offset-4"
    >
      بازگشت به یافته‌ها
    </Link>
  );
  if (finding === undefined)
    return (
      <Card title="این یافته پیدا نشد">
        <p className="text-sm text-muted">
          {result.ok
            ? 'یافته‌ای با این شناسه در آخرین هم‌گام‌سازی نیست؛ شاید شناسه درست نیست یا هنوز از رایانه نرسیده است.'
            : 'یافته‌ها خوانده نشدند؛ کمی بعد دوباره امتحان کنید.'}
        </p>
        {back}
      </Card>
    );

  const view = triageView(finding, {
    heartbeat: heartbeat.ok ? heartbeat.data : null,
    me: me.ok ? me.data : null,
    now: new Date(),
  });
  const withheld = titleWithheld(finding);
  const parts = findingParts(finding.detail);
  const similar = similarFindings(finding, all);
  // Something to decide or to wait for: on a phone the triage stays in reach at the bottom.
  const fixed = view.pending !== null || view.group === 'needs' || view.group === 'snoozed';

  return (
    <div className={`flex flex-col gap-5 ${fixed ? 'pb-[var(--triage-bar,18rem)] md:pb-0' : ''}`}>
      <nav aria-label="مسیر">{back}</nav>
      <Card>
        <FindingMeta finding={finding} />
        <h1 className="mt-2 text-lg font-bold text-fg">
          <FindingTitle finding={finding} />
        </h1>
        <p className="mt-1 text-xs text-caption">گروه: {GROUP_WORDS[view.group]}</p>
      </Card>

      <div className="grid gap-5 md:grid-cols-3 md:items-start">
        <div className="flex flex-col gap-5 md:col-span-2">
          <Card>
            {finding.detail === null ? (
              <p className="text-sm text-muted">
                عنوان، شواهد و پیشنهاد این یافته‌ی امنیتی در کنسول نمایش داده نمی‌شود. تصمیم با
                شناسه‌ی یافته ثبت می‌شود.
              </p>
            ) : (
              <div className="flex flex-col gap-4">
                <Part title="شواهد" text={parts.evidence} />
                <Part title="علت احتمالی" text={parts.cause} />
                <Part title="پیشنهاد" text={parts.proposal} />
              </div>
            )}
          </Card>

          <Card title="تاریخچه">
            <ol className="flex flex-col gap-3">
              <Step>نخستین بار دیده شد: {when(finding.opened_at, false)}</Step>
              {view.group !== 'needs' && (
                <Step>
                  آخرین وضعیت: {STATUS_WORDS[finding.status] ?? finding.status}
                  {finding.until != null && <> · تا {when(finding.until, false)}</>}
                  {view.by !== null && (
                    <>
                      {' '}
                      · از{' '}
                      <bdi dir="ltr" className="font-mono">
                        {view.by}
                      </bdi>
                    </>
                  )}
                  {parts.triage !== '' && (
                    <span
                      dir="ltr"
                      className="mt-1 block break-words text-start text-xs text-caption"
                    >
                      {parts.triage}
                    </span>
                  )}
                </Step>
              )}
              {view.task !== null && (
                <Step>
                  ردیف کار:{' '}
                  <bdi dir="ltr" className="font-mono">
                    {view.task}
                  </bdi>
                </Step>
              )}
              {view.pending !== null && <Step>دستور در انتظار رایانه: {view.pending.asked}</Step>}
            </ol>
            <p className="mt-3 text-xs text-caption">
              هم‌گام‌سازی فقط آخرین وضعیت هر یافته را می‌آورد؛ تاریخچه‌ی خط‌به‌خط آن روی رایانه است.
            </p>
          </Card>
        </div>

        <div className="flex flex-col gap-5">
          <TriageBar fixed={fixed} labelledBy="triage-title">
            <h2 id="triage-title" className="mb-2 text-base font-bold text-fg">
              تصمیم
            </h2>
            {view.group === 'closed' && view.pending === null ? (
              <p className="text-sm text-muted">
                این یافته بسته است ({STATUS_WORDS[finding.status] ?? finding.status}) و تصمیمی
                نمی‌خواهد.
              </p>
            ) : (
              <FindingTriage view={view} labelledBy="triage-title" />
            )}
          </TriageBar>

          <Card title="شبیه‌ها">
            {similar.length === 0 ? (
              <p className="text-sm text-muted">
                {withheld
                  ? 'عنوان این یافته در کنسول نمایش داده نمی‌شود، پس شبیه‌هایش را فقط از روی پیوندها می‌شود گفت؛ پیوندی نیست.'
                  : 'یافته‌ی دیگری درباره‌ی همین موضوع در آخرین هم‌گام‌سازی نیست.'}
              </p>
            ) : (
              <ul className="flex flex-col gap-3">
                {similar.map((other) => (
                  <li key={other.id} className="flex flex-col gap-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <SeverityBadge severity={other.severity} />
                      <Badge>{STATUS_WORDS[other.status] ?? other.status}</Badge>
                      <span className="text-xs text-caption" dir="ltr">
                        {other.id}
                      </span>
                    </div>
                    <Link
                      href={findingHref(other.id)}
                      className="inline-flex min-h-9 items-center text-sm text-fg hover:underline"
                    >
                      <FindingTitle finding={other} />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
