import { type ConsoleMessage, type ConsoleMessageStatus } from '@fmip/contracts';
import { Badge, agentTitle, when } from './ui';

/**
 * The chat with an agent (T-1722, D-350), drawn on the server: no model
 * answers here. A message waits until the maintainer's computer takes it,
 * runs the agent and posts the reply, so each person's message says where it
 * is, and a failed one says why.
 */

export const MESSAGE_STATUS_WORDS: Record<ConsoleMessageStatus, string> = {
  // On demand since 2026-11-04 (T-1733): no fixed delay is promised.
  queued: 'در صف — هر وقت نگهدارنده پاسخ‌ها را اجرا کند جواب می‌آید',
  answering: 'رایانه آن را برداشته؛ عامل در حال نوشتن جواب است',
  answered: 'جواب داده شد',
  failed: 'جوابی نیامد',
};

const STATUS_TONE: Record<ConsoleMessageStatus, string> = {
  queued: 'border-default text-muted',
  answering: 'border-brand text-brand',
  answered: 'border-success text-success',
  failed: 'border-danger text-danger',
};

function MessageBubble({ message }: { message: ConsoleMessage }) {
  const fromAgent = message.author_kind === 'agent';
  return (
    <li
      className={`flex flex-col gap-1 ${fromAgent ? 'items-end' : 'items-start'}`}
      data-author={message.author_kind}
    >
      <div
        className={`max-w-full rounded-card border p-3 md:max-w-measure ${
          fromAgent ? 'border-brand bg-canvas' : 'border-default bg-surface'
        }`}
      >
        <div className="mb-1 flex flex-wrap items-center gap-2 text-xs text-caption">
          <span className="font-bold text-fg" dir="auto">
            {fromAgent ? agentTitle(message.author) : message.author}
          </span>
          <span>{when(message.created_at)}</span>
        </div>
        <p className="whitespace-pre-wrap break-words text-sm text-fg" dir="auto">
          {message.body}
        </p>
      </div>
      {message.status !== null && message.status !== 'answered' && (
        <div className="flex flex-col gap-1">
          <Badge tone={STATUS_TONE[message.status]}>{MESSAGE_STATUS_WORDS[message.status]}</Badge>
          {message.status === 'failed' && message.failure !== null && (
            <span className="text-xs text-danger" dir="auto">
              {message.failure}
            </span>
          )}
        </div>
      )}
    </li>
  );
}

/** The conversation, oldest first, the newest at the end. */
export function ChatThread({ messages }: { messages: ConsoleMessage[] }) {
  if (messages.length === 0) {
    return (
      <p className="text-sm text-muted">
        هنوز پیامی نیامده. سؤال بپرسید یا کاری پیشنهاد کنید؛ عامل جواب می‌دهد، ولی روی سرور کاری
        انجام نمی‌دهد.
      </p>
    );
  }
  return (
    <ol className="flex flex-col gap-3" aria-label="گفتگو">
      {messages.map((message) => (
        <MessageBubble key={message.id} message={message} />
      ))}
    </ol>
  );
}
