'use client';

import { useEffect } from 'react';

/**
 * Sets one cookie once the page it is on has been shown (T-1163): how a
 * notice meant to be read once is not shown again. The server reads the
 * cookie and leaves the notice out, so there is no flash of it on a later
 * page. Readable by script on purpose; it holds no secret, only what was seen.
 */
export function RememberCookie({ name, value }: { name: string; value: string }) {
  useEffect(() => {
    const oneYear = 60 * 60 * 24 * 365;
    document.cookie = `${name}=${encodeURIComponent(value)}; path=/; max-age=${oneYear}; samesite=lax`;
  }, [name, value]);
  return null;
}
