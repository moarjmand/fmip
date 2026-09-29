import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { HomepageFeaturesAdmin } from '@/components/homepage-features-admin';
import { fetchHomepageFeatures, fetchMe } from '@/lib/api';
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
    path: '/admin/homepage',
    title: 'Homepage features',
    description: 'Which matches the homepage lists first.',
    index: false,
  });
}

/**
 * Featured matches on the homepage (T-1161, D-153), over the audited API. The
 * role is the API's to check; a 403 is said rather than shown as an empty list.
 */
export default async function HomepageFeaturesPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const cookie = await sessionCookieHeader();
  const me = await fetchMe(cookie);
  if (me === null) redirect(`/${locale}/login?next=/${locale}/admin/homepage`);

  const result = await fetchHomepageFeatures(cookie);

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-6 p-8">
      <p className="text-sm">
        <Link href={`/${locale}/admin`} className="underline">
          ← Admin
        </Link>
      </p>
      <h1 className="text-2xl font-semibold">Homepage features</h1>

      {result.ok || result.status !== 403 ? (
        <HomepageFeaturesAdmin
          locale={locale}
          features={result.ok ? result.data.features : []}
          reachable={result.ok}
        />
      ) : (
        <Notice tone="warning" data-testid="homepage-features-forbidden">
          Featuring a match on the homepage needs the editor or administrator role.
        </Notice>
      )}
    </main>
  );
}
