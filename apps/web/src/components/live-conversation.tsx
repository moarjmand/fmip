'use client';

import { CHAT_SOCKET_PATH, type ChatServerFrame } from '@fmip/contracts';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

/**
 * The chat page's socket (T-237).
 *
 * **It renders no message.** When something happens it asks the page to render
 * itself again, and the server does what it already does — resolve the cards,
 * the reactions, the mentions and the pins, and lay the conversation out once.
 * A client that rendered arriving messages itself would be a second way a
 * message can look, and the two would disagree the first time either changed.
 * That is also why nothing here holds a copy of the conversation: there is no
 * client-side state to fall out of step with the store.
 *
 * **The page does not depend on it.** Everything on the conversation page works
 * over ordinary requests (T-221 to T-226). This adds immediacy and takes
 * nothing away: with no JavaScript, a broken socket or a deployment that has no
 * Redis, the page is exactly what it was — and says so, rather than looking
 * live while it is not (rule 4).
 */

/** Collapse a burst — three messages in a second is one render, not three. */
const REFRESH_MS = 400;
const FIRST_RETRY_MS = 1_000;
const MAX_RETRY_MS = 15_000;

type Liveness = 'connecting' | 'live' | 'offline';

function socketUrl(): string {
  // Same origin in every real deployment: the edge routes this one path to the
  // API (T-234), so the session cookie is sent and no CORS exists anywhere.
  // The variable is for development, where the web app and the API are two
  // ports and nothing sits in front of them.
  const configured = process.env.NEXT_PUBLIC_CHAT_SOCKET_URL;
  if (configured !== undefined && configured !== '') return configured;
  const scheme = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${scheme}//${window.location.host}${CHAT_SOCKET_PATH}`;
}

export function LiveConversation({
  conversationId,
  latestSeq,
}: {
  conversationId: string;
  /** What the server rendered. The socket asks for everything after it. */
  latestSeq: number;
}) {
  const router = useRouter();
  const [state, setState] = useState<Liveness>('connecting');
  const seq = useRef(latestSeq);

  // Kept in a ref rather than a dependency: a refresh changes this, and a
  // dependency would tear the socket down and build it again every time one
  // message arrived.
  useEffect(() => {
    seq.current = latestSeq;
  }, [latestSeq]);

  useEffect(() => {
    let socket: WebSocket | null = null;
    let refresh: ReturnType<typeof setTimeout> | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;
    let wait = FIRST_RETRY_MS;
    let stopped = false;
    // Set while the tab is hidden, acted on when it comes back. Opening the
    // page is what marks it read (T-224), so refreshing a tab nobody is looking
    // at would have the product claim a message was read by an empty room.
    let deferred = false;

    const refreshSoon = (): void => {
      if (document.visibilityState !== 'visible') {
        deferred = true;
        return;
      }
      if (refresh !== null) return;
      refresh = setTimeout(() => {
        refresh = null;
        router.refresh();
      }, REFRESH_MS);
    };

    const onVisible = (): void => {
      if (document.visibilityState === 'visible' && deferred) {
        deferred = false;
        refreshSoon();
      }
    };

    const open = (): void => {
      if (stopped) return;
      const next = new WebSocket(socketUrl());
      socket = next;

      next.onopen = () => {
        wait = FIRST_RETRY_MS;
        setState('live');
        // `after_seq` is what closes the gap a disconnection opened (T-235).
        next.send(
          JSON.stringify({
            type: 'subscribe',
            conversation_id: conversationId,
            after_seq: seq.current,
          }),
        );
      };

      next.onmessage = (event: MessageEvent<string>) => {
        let frame: ChatServerFrame;
        try {
          frame = JSON.parse(event.data) as ChatServerFrame;
        } catch {
          return;
        }
        if (frame.type === 'event') refreshSoon();
        // Something happened while the socket was down. What it was does not
        // matter here; that there is something is enough to go and re-read.
        else if (frame.type === 'catch_up' && frame.messages.length > 0) refreshSoon();
        else if (frame.type === 'dropped' || frame.type === 'refused') setState('offline');
      };

      next.onerror = () => setState('offline');
      next.onclose = () => {
        socket = null;
        if (stopped) return;
        setState('offline');
        retry = setTimeout(open, wait);
        wait = Math.min(wait * 2, MAX_RETRY_MS);
      };
    };

    document.addEventListener('visibilitychange', onVisible);
    open();

    return () => {
      stopped = true;
      document.removeEventListener('visibilitychange', onVisible);
      if (refresh !== null) clearTimeout(refresh);
      if (retry !== null) clearTimeout(retry);
      socket?.close();
    };
  }, [conversationId, router]);

  return (
    <p
      className="text-sm opacity-70"
      data-testid="conversation-live"
      data-state={state}
      // Polite, because a connection changing is never more important than
      // what is being said.
      aria-live="polite"
    >
      {state === 'live'
        ? 'New messages appear here as they are sent.'
        : state === 'connecting'
          ? 'Connecting…'
          : 'Not live right now. Reload to see anything new.'}
    </p>
  );
}
