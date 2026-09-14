import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { ConversationHeader, MessageRow } from '@/components/conversation';
import {
  Composer,
  ConversationExits,
  PinMessage,
  Reactions,
  RemoveMessage,
} from '@/components/conversation-controls';
import { fetchConversation, fetchConversationSearch, fetchMe } from '@/lib/api';
import { markReadAction } from '@/lib/conversation-actions';
import { pageMetadata } from '@/lib/seo';
import { sessionCookieHeader } from '@/lib/session';

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  return pageMetadata({ locale, path: '/messages', title: 'A conversation · FMIP' });
}

function first(value: string | string[] | undefined): string {
  return Array.isArray(value) ? (value[0] ?? '') : (value ?? '');
}

/**
 * One conversation (blueprint 8.3, T-224).
 *
 * **Correct without a socket.** Sending re-renders the page from the store,
 * which is exactly what a reconnecting client will do when T-230 adds the
 * transport — the page asks for a range of sequence numbers, and the sequence
 * is the store's (T-220).
 *
 * Reading the page is what moves the read position. That means "read" here
 * means "opened", and the product does not claim more than that: a script
 * watching the viewport would let it claim that somebody read a particular
 * message, which is a thing no page actually knows.
 */
export default async function ConversationPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ locale, id }, query] = await Promise.all([params, searchParams]);
  const cookie = await sessionCookieHeader();
  const me = await fetchMe(cookie);
  if (me === null) redirect(`/${locale}/login`);

  const before = first(query.before);
  const term = first(query.q).trim();
  const result = await fetchConversation(
    id,
    before === '' ? '' : `before=${encodeURIComponent(before)}`,
    cookie,
  );

  if (!result.ok) {
    // 404 covers "no such conversation" and "you are not in it", which is the
    // API's answer and not something this page second-guesses.
    if (result.status === 404) notFound();
    return (
      <main className="mx-auto flex max-w-3xl flex-col gap-4 p-8">
        <h1 className="text-2xl font-semibold">A conversation</h1>
        <p role="alert" data-testid="conversation-unreachable">
          This conversation cannot be shown right now.
        </p>
      </main>
    );
  }

  const page = result.data;
  const found = term === '' ? null : await fetchConversationSearch(id, term, cookie);

  // Opening it is what marks it read, up to what this page actually showed.
  if (before === '' && term === '' && page.latest_seq > 0) {
    await markReadAction(id, page.latest_seq);
  }

  const shown = found !== null && found.ok ? found.data.messages : page.messages;

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-6 p-8">
      <ConversationHeader conversation={page.conversation} me={me.username} locale={locale} />

      <Link href={`/${locale}/messages`} className="text-sm underline">
        All conversations
      </Link>

      <form action={`/${locale}/messages/${id}`} className="flex items-center gap-2">
        <label htmlFor="conversation-search" className="sr-only">
          Search this conversation
        </label>
        <input
          id="conversation-search"
          name="q"
          type="search"
          defaultValue={term}
          placeholder="Search this conversation"
          className="rounded border border-current/30 bg-transparent px-3 py-1 text-sm text-start"
          data-testid="conversation-search"
        />
        <button type="submit" className="text-sm underline">
          Search
        </button>
        {term !== '' && (
          <Link href={`/${locale}/messages/${id}`} className="text-sm underline">
            Clear
          </Link>
        )}
      </form>

      {term !== '' && (
        <p className="text-sm opacity-70" data-testid="conversation-search-note">
          {found !== null && found.ok
            ? `${found.data.messages.length} message${found.data.messages.length === 1 ? '' : 's'} matching “${term}”${found.data.more ? ', and more' : ''}.`
            : 'The search is unreachable right now.'}
        </p>
      )}

      {page.pinned.length > 0 && (
        // Always here, whatever page is being read: a pin nobody can find once
        // the conversation has scrolled past it is not a pin (T-225).
        <section className="flex flex-col gap-2" data-testid="conversation-pinned">
          <h2 className="text-lg font-semibold">Pinned</h2>
          <ul className="flex flex-col gap-3">
            {page.pinned.map((message) => (
              <MessageRow
                key={message.id}
                message={message}
                locale={locale}
                timeZone={me.timezone}
                isMine={message.author === me.username}
              />
            ))}
          </ul>
        </section>
      )}

      {term === '' && page.has_earlier && (
        <Link
          href={`/${locale}/messages/${id}?before=${page.messages[0]?.seq ?? 1}`}
          className="text-sm underline"
          data-testid="conversation-earlier"
        >
          Earlier messages
        </Link>
      )}

      {shown.length === 0 ? (
        <p className="text-sm opacity-70" data-testid="conversation-empty">
          {term === '' ? 'Nothing has been said yet.' : 'Nothing matches that here.'}
        </p>
      ) : (
        <ul className="flex flex-col gap-4" data-testid="conversation-messages">
          {shown.map((message) => (
            <div key={message.id} className="flex flex-col gap-1">
              <MessageRow
                message={message}
                locale={locale}
                timeZone={me.timezone}
                isMine={message.author === me.username}
              />
              {message.removed === null && (
                <div className="flex flex-wrap items-center gap-3">
                  <Reactions
                    locale={locale}
                    conversationId={id}
                    messageId={message.id}
                    reactions={message.reactions}
                  />
                  <PinMessage
                    locale={locale}
                    conversationId={id}
                    messageId={message.id}
                    pinned={message.pinned}
                  />
                  {message.author === me.username && (
                    <RemoveMessage locale={locale} conversationId={id} messageId={message.id} />
                  )}
                </div>
              )}
            </div>
          ))}
        </ul>
      )}

      <Composer
        locale={locale}
        conversationId={id}
        disabled={
          page.conversation.left
            ? 'You have left this conversation. You can still read it.'
            : undefined
        }
      />

      <ConversationExits
        locale={locale}
        conversationId={id}
        muted={page.conversation.muted}
        left={page.conversation.left}
      />
    </main>
  );
}
