import { ConsoleLink as Link } from '@/app/console/console-link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { CONSOLE_CHAT_EVERY_MINUTES, CONSOLE_MESSAGE_MAX } from '@fmip/contracts';
import { postMessage } from '@/lib/console-actions';
import { consoleConversation, consoleSnapshot } from '@/lib/console-api';
import { ChatThread } from '../../../../chat';
import { ConsoleForm } from '../../../../console-form';
import { Card, agentTitle, fa, inputClass } from '../../../../ui';

type Props = {
  params: Promise<{ name: string }>;
  searchParams: Promise<{ before?: string | string[] }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  return { title: `گفتگو با ${agentTitle((await params).name)}` };
}

/**
 * The chat with one agent (T-1722, D-350): the conversation, newest last,
 * and a box to write in. The page draws on the server; the reply comes from
 * the maintainer's computer, so the page says how long it takes.
 */
export default async function ConsoleAgentChatPage({ params, searchParams }: Props) {
  const { name } = await params;
  const raw = (await searchParams).before;
  const before = typeof raw === 'string' && raw !== '' ? raw : undefined;
  const [snapshotResult, conversationResult] = await Promise.all([
    consoleSnapshot(),
    consoleConversation(name, before),
  ]);
  const snapshot = snapshotResult.ok ? snapshotResult.data.snapshot : null;
  const agent = snapshot?.agents.find((a) => a.name === name);
  if (snapshot === null || agent === undefined) notFound();
  const conversation = conversationResult.ok ? conversationResult.data : null;
  const first = conversation?.messages[0];

  return (
    <>
      <div className="flex flex-col gap-2">
        <Link href={`/agents/${encodeURIComponent(name)}`} className="text-sm text-brand">
          → {agentTitle(name)}
        </Link>
        <h1 className="text-xl font-bold">گفتگو با {agentTitle(name)}</h1>
        <p className="max-w-measure text-sm text-muted">
          رایانه‌ی نگهدارنده هر {fa(CONSOLE_CHAT_EVERY_MINUTES)} دقیقه پیام‌های تازه را برمی‌دارد،
          عامل را با همین گفتگو اجرا می‌کند و جوابش را اینجا می‌گذارد. عامل سؤال جواب می‌دهد و کار
          پیشنهاد می‌کند، ولی طبق منشور تیم روی سرور کاری انجام نمی‌دهد؛ پیام شما دستوری فراتر از
          منشور به او نمی‌دهد.
        </p>
      </div>

      <Card
        title="گفتگو"
        action={
          <Link href={`/agents/${encodeURIComponent(name)}/chat`} className="text-sm text-brand">
            تازه کن
          </Link>
        }
      >
        {conversation === null ? (
          <p className="text-sm text-danger" role="alert">
            گفتگو خوانده نشد. کمی بعد دوباره امتحان کنید.
          </p>
        ) : (
          <>
            {conversation.has_older && first !== undefined && (
              <Link
                href={`/agents/${encodeURIComponent(name)}/chat?before=${encodeURIComponent(first.id)}`}
                className="mb-3 inline-block text-sm text-brand"
              >
                پیام‌های قدیمی‌تر
              </Link>
            )}
            <ChatThread messages={conversation.messages} />
            {before !== undefined && (
              <Link
                href={`/agents/${encodeURIComponent(name)}/chat`}
                className="mt-3 inline-block text-sm text-brand"
              >
                تازه‌ترین پیام‌ها
              </Link>
            )}
          </>
        )}
      </Card>

      <Card title="پیام تازه">
        <ConsoleForm action={postMessage} submit="بفرست">
          <input type="hidden" name="agent" value={agent.name} />
          <textarea
            name="body"
            required
            rows={5}
            maxLength={CONSOLE_MESSAGE_MAX}
            dir="auto"
            aria-label="پیام"
            placeholder={`پیام به ${agentTitle(name)} (تا ${fa(CONSOLE_MESSAGE_MAX)} نویسه)`}
            className={`${inputClass} py-2`}
          />
        </ConsoleForm>
      </Card>
    </>
  );
}
