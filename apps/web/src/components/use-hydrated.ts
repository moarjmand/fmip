'use client';

import { useSyncExternalStore } from 'react';

const subscribeNothing = (): (() => void) => () => {};

/**
 * False on the server and while the page hydrates, true from the render right
 * after: React reads the server snapshot while hydrating and the client one
 * once it has. For what only the browser may print -- an age on the browser's
 * clock -- so the server's markup and the first browser render agree.
 */
export function useHydrated(): boolean {
  return useSyncExternalStore(
    subscribeNothing,
    () => true,
    () => false,
  );
}
