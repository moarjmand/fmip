'use client';

import { useEffect } from 'react';

/**
 * Registers the service worker (T-082) once the page has loaded, so the
 * shell is cached for the next visit and the app can be installed. A browser
 * without service workers simply never calls this.
 */
export function ServiceWorker() {
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {
      // Registration failing (a private window, a blocked origin) leaves the
      // site working as a plain website; nothing to report to the visitor.
    });
  }, []);
  return null;
}
