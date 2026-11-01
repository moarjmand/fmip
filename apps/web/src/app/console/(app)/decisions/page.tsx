import type { Metadata } from 'next';
import { queueCommand } from '@/lib/console-actions';
import { consoleCommands, consoleSnapshot } from '@/lib/console-api';
import { ConsoleForm } from '../../console-form';
import { Badge, Card, STATUS_WORDS, fa, inputClass, when } from '../../ui';

export const metadata: Metadata = { title: 'تصمیم‌ها' };

/**
 * The decision desk inside the console (T-1698, D-340): open questions, each
 * answered with a choice, a note and a reason; then what is already decided,
 * on the desk and in the record (D-xxx).
 */
export default async function ConsoleDecisionsPage() {
  const [snapshotResult, commandsResult] = await Promise.all([
    consoleSnapshot(),
    consoleCommands(),
  ]);
  const decisions = snapshotResult.ok ? (snapshotResult.data.snapshot?.decisions ?? []) : [];
  const answers = (commandsResult.ok ? commandsResult.data.commands : []).filter(
    (c) => c.kind === 'decision.answer',
  );
  const open = decisions.filter((d) => d.status === 'open');
  const decided = decisions.filter((d) => d.status === 'decided');

  return (
    <>
      <Card title={`منتظر تصمیم · ${fa(open.length)}`}>
        {open.length === 0 ? (
          <p className="text-sm text-muted">تصمیم بازی نمانده.</p>
        ) : (
          <ul className="flex flex-col gap-6">
            {open.map((decision) => {
              const pending = answers.find(
                (a) => a.target === decision.id && a.status !== 'failed',
              );
              return (
                <li
                  key={decision.id}
                  id={decision.id}
                  className="border-b border-default pb-6 last:border-b-0 last:pb-0"
                >
                  <h3 className="font-bold text-fg">{decision.title}</h3>
                  {decision.summary !== '' && (
                    <p className="mt-1 text-sm text-muted">{decision.summary}</p>
                  )}
                  {pending !== undefined ? (
                    <p className="mt-3 text-sm text-success">
                      پاسخ {pending.requested_by} ثبت شده ({STATUS_WORDS[pending.status]})؛ در اجرای
                      بعدی اعمال می‌شود.
                    </p>
                  ) : (
                    <div className="mt-3">
                      <ConsoleForm action={queueCommand} submit="ثبت تصمیم">
                        <input type="hidden" name="kind" value="decision.answer" />
                        <input type="hidden" name="target" value={decision.id} />
                        <fieldset className="flex flex-col gap-2">
                          <legend className="sr-only">گزینه‌ها</legend>
                          {decision.options.map((option) => (
                            <label
                              key={option.key}
                              className="flex items-start gap-2 rounded-control border border-default p-3 text-sm has-[:checked]:border-brand"
                            >
                              <input
                                type="radio"
                                name="answer"
                                value={option.key}
                                required
                                className="mt-1"
                              />
                              <span>{option.label}</span>
                            </label>
                          ))}
                        </fieldset>
                        <input
                          name="note"
                          maxLength={500}
                          placeholder="یادداشت (اختیاری)"
                          className={inputClass}
                        />
                        <input
                          name="reason"
                          required
                          maxLength={500}
                          placeholder="چرا؟ (در کارنامه ثبت می‌شود)"
                          className={inputClass}
                        />
                      </ConsoleForm>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <Card title="تصمیم‌های گرفته‌شده">
        <ul className="flex flex-col">
          {decided.map((decision) => (
            <li
              key={decision.id}
              className="flex flex-col gap-1 border-b border-default py-3 last:border-b-0"
            >
              <div className="flex flex-wrap items-center gap-2">
                <Badge>{decision.id.startsWith('D-') ? decision.id : 'میز تصمیم'}</Badge>
                <span className="text-sm font-bold text-fg" dir="auto">
                  {decision.title}
                </span>
              </div>
              <span className="text-xs text-muted" dir="auto">
                {decision.answer !== null ? `پاسخ: ${decision.answer} · ` : ''}
                {decision.decided_by ?? ''}{' '}
                {decision.decided_at !== null ? `· ${when(decision.decided_at, false)}` : ''}
              </span>
            </li>
          ))}
        </ul>
      </Card>
    </>
  );
}
