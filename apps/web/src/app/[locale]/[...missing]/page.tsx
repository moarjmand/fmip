import { notFound } from 'next/navigation';

/**
 * Any path under a locale that no page answers (T-809). Without this, an
 * unknown path matches no route and Next renders its own 404 outside the
 * locale layout -- a document with no `lang` and no `dir`. Matching it here
 * and calling `notFound()` puts it through `[locale]/not-found.tsx` instead,
 * still with the 404 status. Every real route is more specific, so it wins.
 */
export default function MissingPage(): never {
  notFound();
}
