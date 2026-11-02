import type { Metadata } from 'next';
import { CONSOLE_BOARD_COLUMNS, type ConsoleBoardColumn } from '@fmip/contracts';
import { addCard, archiveCard, moveCard } from '@/lib/console-actions';
import { consoleBoard } from '@/lib/console-api';
import { ConsoleForm } from '../../console-form';
import { Badge, Card, fa, inputClass, when } from '../../ui';

export const metadata: Metadata = { title: 'تابلوی پروژه' };

const COLUMN_WORDS: Record<ConsoleBoardColumn, string> = {
  backlog: 'ایده‌ها',
  next: 'برای انجام',
  doing: 'در دست انجام',
  review: 'منتظر',
  done: 'انجام شد',
};

/** The done column shows its newest cards only; the rest stay in the table. */
const DONE_SHOWN = 30;

/** The project board, moved here from its claude.ai page (T-1698, T-1700, D-340). */
export default async function ConsoleBoardPage() {
  const result = await consoleBoard();
  const cards = result.ok ? result.data.cards : [];

  return (
    <>
      <div className="flex gap-3 overflow-x-auto pb-2" data-testid="board">
        {CONSOLE_BOARD_COLUMNS.map((column) => {
          const all = cards.filter((card) => card.column === column);
          const mine =
            column === 'done'
              ? [...all]
                  .sort((x, y) => y.updated_at.localeCompare(x.updated_at))
                  .slice(0, DONE_SHOWN)
              : all;
          return (
            <section
              key={column}
              className="flex w-72 shrink-0 flex-col gap-2 rounded-card bg-surface-raised p-3"
            >
              <h2 className="text-sm font-bold">
                {COLUMN_WORDS[column]} <span className="text-caption">· {fa(all.length)}</span>
              </h2>
              <ul className="flex flex-col gap-2">
                {mine.map((card) => (
                  <li key={card.id} className="rounded-tile border border-default bg-surface p-3">
                    <p className="text-sm font-bold text-fg" dir="auto">
                      {card.title}
                    </p>
                    {card.body !== '' && (
                      <details>
                        <summary className="cursor-pointer text-xs text-muted">شرح</summary>
                        <p className="mt-1 whitespace-pre-wrap text-xs text-muted" dir="auto">
                          {card.body}
                        </p>
                      </details>
                    )}
                    <div className="mt-2 flex flex-wrap gap-1">
                      {card.labels.map((label) => (
                        <Badge key={label}>{label}</Badge>
                      ))}
                      {card.assignee !== null && (
                        <Badge tone="border-accent text-fg">{card.assignee}</Badge>
                      )}
                    </div>
                    <p className="mt-2 text-[0.625rem] text-caption">
                      <span dir="ltr">{card.updated_by ?? ''}</span> · {when(card.updated_at)}
                    </p>
                    <div className="mt-2 flex items-center gap-2">
                      <form action={moveCard} className="flex flex-1 gap-1">
                        <input type="hidden" name="id" value={card.id} />
                        <select
                          name="column"
                          defaultValue={card.column}
                          aria-label="ستون"
                          className="min-h-9 flex-1 rounded-control border border-strong bg-canvas px-2 text-xs"
                        >
                          {CONSOLE_BOARD_COLUMNS.map((c) => (
                            <option key={c} value={c}>
                              {COLUMN_WORDS[c]}
                            </option>
                          ))}
                        </select>
                        <button
                          type="submit"
                          className="min-h-9 rounded-control border border-strong px-2 text-xs"
                        >
                          ببر
                        </button>
                      </form>
                      <form action={archiveCard}>
                        <input type="hidden" name="id" value={card.id} />
                        <button
                          type="submit"
                          className="min-h-9 rounded-control px-2 text-xs text-muted hover:text-danger"
                        >
                          بایگانی
                        </button>
                      </form>
                    </div>
                  </li>
                ))}
              </ul>
              {all.length > mine.length && (
                <p className="text-xs text-caption">
                  و {fa(all.length - mine.length)} کارت قدیمی‌تر
                </p>
              )}
            </section>
          );
        })}
      </div>

      <Card title="کارت تازه">
        <ConsoleForm action={addCard} submit="اضافه کن" className="grid gap-3 md:grid-cols-2">
          <input name="title" required maxLength={200} placeholder="عنوان" className={inputClass} />
          <select name="column" defaultValue="backlog" aria-label="ستون" className={inputClass}>
            {CONSOLE_BOARD_COLUMNS.map((c) => (
              <option key={c} value={c}>
                {COLUMN_WORDS[c]}
              </option>
            ))}
          </select>
          <textarea
            name="body"
            rows={3}
            placeholder="شرح (اختیاری)"
            className={`${inputClass} py-2 md:col-span-2`}
          />
          <input name="labels" placeholder="برچسب‌ها، با ویرگول" className={inputClass} />
        </ConsoleForm>
      </Card>
    </>
  );
}
