'use client';

import { useEffect, useRef } from 'react';
import { markFollowIntent } from '@/lib/push-offer';

/**
 * Inside a follow form: as the form submits, leave the mark the next render's
 * push offer takes (T-1429). It reads the form's own fields, so it fits a
 * fixed button and a picker alike. Without JavaScript the form still posts;
 * it just leaves no mark, and nothing is offered. It lives apart from the
 * offer so a page that only follows ships this, not the offer (D-221).
 */
export function FollowIntentMark() {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const form = ref.current?.closest('form');
    if (!form) return;
    const onSubmit = () => {
      const data = new FormData(form);
      let store: Storage | null = null;
      try {
        store = window.sessionStorage;
      } catch {
        store = null;
      }
      markFollowIntent(
        store,
        String(data.get('entity_type') ?? ''),
        String(data.get('entity_id') ?? ''),
        Date.now(),
      );
    };
    form.addEventListener('submit', onSubmit);
    return () => form.removeEventListener('submit', onSubmit);
  }, []);
  return <span ref={ref} hidden data-testid="push-offer-intent" />;
}
