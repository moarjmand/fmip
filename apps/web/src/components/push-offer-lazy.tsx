'use client';

import { type ComponentProps, type ComponentType, useEffect, useState } from 'react';
import type { PushOffer } from '@/components/push-offer';

type Props = ComponentProps<typeof PushOffer>;

/**
 * The push offer, fetched only where a follow has just happened (T-1429): it
 * draws nothing until the browser has been asked what it can do, so its code
 * stays out of the page's first load and arrives after hydration. A plain
 * `import()` rather than `next/dynamic`, whose loader would itself have
 * joined the first load.
 */
export function PushOfferLazy(props: Props) {
  const [Offer, setOffer] = useState<ComponentType<Props> | null>(null);
  useEffect(() => {
    let live = true;
    import('@/components/push-offer')
      .then((m) => {
        if (live) setOffer(() => m.PushOffer);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);
  return Offer === null ? null : <Offer {...props} />;
}
