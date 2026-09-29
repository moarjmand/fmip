'use client';

import { createContext, useContext } from 'react';
import type { Message, MessageKey } from '@/i18n/messages';

/**
 * The words a client component may need, resolved on the server (T-1040).
 *
 * The catalogues never reach the browser: `i18n/messages.ts` imports all
 * eight, and a client bundle that imported it would ship every language to
 * every reader. The locale layout resolves the handful of keys listed in
 * `ERROR_PAGE_KEYS` for the viewer's locale (`resolveMessages`) and puts
 * them here, so a client component that has no server parent to pass it a
 * prop -- an error boundary, a not-found page -- still renders the reader's
 * language, with the English standing in and marked where there is no
 * translation, exactly as `Translated` does on the server.
 *
 * A key belongs in the list only when a client component renders it and no
 * server component can hand it down as a prop. Everything else stays a prop.
 */
export type ClientMessages = Partial<Record<MessageKey, Message>>;

const ClientMessagesContext = createContext<ClientMessages | null>(null);

export function ClientMessagesProvider({
  messages,
  children,
}: {
  messages: ClientMessages;
  children: React.ReactNode;
}) {
  return (
    <ClientMessagesContext.Provider value={messages}>{children}</ClientMessagesContext.Provider>
  );
}

/**
 * The resolved messages for `keys`, from the nearest provider, or `null` when
 * there is none or it lacks one of them. `null` rather than a guess: without
 * the server's answer the client cannot know whether a locale has a
 * translation, and rendering English as though it knew would be the silent
 * fallback the policy forbids. The caller decides what to do instead.
 */
export function useClientMessages<K extends MessageKey>(
  keys: readonly K[],
): Record<K, Message> | null {
  const messages = useContext(ClientMessagesContext);
  if (messages === null) return null;
  const picked: Partial<Record<K, Message>> = {};
  for (const key of keys) {
    const found = messages[key];
    if (found === undefined) return null;
    picked[key] = found;
  }
  return picked as Record<K, Message>;
}
