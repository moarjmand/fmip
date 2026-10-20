'use client';

import dynamic from 'next/dynamic';

/**
 * The push offer, loaded only where a follow has just happened (T-1429): it
 * draws nothing until the browser has been asked what it can do, so it is not
 * rendered on the server and its code stays out of the page's first load.
 */
export const PushOfferLazy = dynamic(
  () => import('@/components/push-offer').then((m) => m.PushOffer),
  { ssr: false },
);
