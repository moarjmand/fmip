import type { Metadata } from 'next';
import Link from '@/components/ui/link';
import { redirect } from 'next/navigation';
import { CompetitionOrderAdmin } from '@/components/competition-order-admin';
import { fetchAdminCompetitions, fetchMe } from '@/lib/api';
import { pageMetadata } from '@/lib/seo';
import { sessionCookieHeader } from '@/lib/session';
import { Notice } from '@/components/ui';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  return pageMetadata({
    locale,
    path: '/admin/competitions',
    title: 'Competition order',
    description: 'Where each competition sits on the scores page and the homepage.',
    index: false,
  });
}

/**
 * The competitions' order (T-1162, D-154), administrators only, over the
 * audited API. The role is the API's to check; a 403 is said rather than
 * shown as an empty list.
 */
/**
 * The languages whose site has an order of its own (T-1391, D-207): the
 * English site, for readers abroad. Every other language reads the default.
 */
const ORDER_LANGUAGES = [{ locale: 'en', label: 'English site (/en)' }] as const;

export default async function CompetitionOrderPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ order?: string | string[] }>;
}) {
  const { locale } = await params;
  const { order } = await searchParams;
  const orderLocale = ORDER_LANGUAGES.find((l) => l.locale === order)?.locale ?? null;
  const cookie = await sessionCookieHeader();
  const me = await fetchMe(cookie);
  if (me === null) redirect(`/${locale}/login?next=/${locale}/admin/competitions`);

  const result = await fetchAdminCompetitions(cookie, orderLocale);
  const tab = (active: boolean) =>
    `rounded-control border px-3 py-1.5 ${active ? 'border-fg font-semibold' : 'border-default text-muted'}`;

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-6 p-8">
      <p className="text-sm">
        <Link href={`/${locale}/admin`} className="underline">
          ← Admin
        </Link>
      </p>
      <h1 className="text-2xl font-semibold">Competition order</h1>
      <p className="text-sm text-muted">
        After a member&rsquo;s own favourites, the scores page and the homepage list competitions by
        the place stated here, 1 first; a competition with no place comes after every stated one, by
        country and name. Two competitions may share a place.
      </p>
      <nav aria-label="Which order" className="flex flex-wrap gap-2 text-sm">
        <Link
          href={`/${locale}/admin/competitions`}
          aria-current={orderLocale === null ? 'page' : undefined}
          className={tab(orderLocale === null)}
          data-testid="competition-order-default"
        >
          Default (Persian and every language without its own)
        </Link>
        {ORDER_LANGUAGES.map((l) => (
          <Link
            key={l.locale}
            href={`/${locale}/admin/competitions?order=${l.locale}`}
            aria-current={orderLocale === l.locale ? 'page' : undefined}
            className={tab(orderLocale === l.locale)}
            data-testid={`competition-order-${l.locale}`}
          >
            {l.label}
          </Link>
        ))}
      </nav>
      {orderLocale !== null && (
        <p className="text-sm text-muted">
          This site&rsquo;s own order. Once any competition has a place here, readers of this site
          get this order and every competition without a place comes after; with none, they get the
          default.
        </p>
      )}

      {result.ok || result.status !== 403 ? (
        <CompetitionOrderAdmin
          locale={locale}
          orderLocale={orderLocale}
          competitions={result.ok ? result.data.competitions : []}
          reachable={result.ok}
        />
      ) : (
        <Notice tone="warning" data-testid="competition-order-forbidden">
          Setting the competitions&rsquo; order needs the administrator role.
        </Notice>
      )}
    </main>
  );
}
