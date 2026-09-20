import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { AudiencesAdmin } from '@/components/audiences-admin';
import { CampaignsAdmin } from '@/components/campaigns-admin';
import { fetchAudiences, fetchCampaigns } from '@/lib/api';
import { pageMetadata } from '@/lib/seo';
import { sessionCookieHeader } from '@/lib/session';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  return pageMetadata({
    locale,
    path: '/admin/campaigns',
    title: 'Campaigns',
    description: 'Audiences and the messages sent to them.',
    index: false,
  });
}

/**
 * Campaigns for administrators (T-332, D-075). The API decides who is one;
 * a member without the role is not told the page exists. Everything shown
 * is what the API answered, and every write carries a reason.
 */
export default async function AdminCampaignsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const cookie = await sessionCookieHeader();
  const [audiences, campaigns] = await Promise.all([
    fetchAudiences(cookie),
    fetchCampaigns(cookie),
  ]);
  if (!audiences.ok) {
    if (audiences.status === 401) redirect(`/${locale}/login?next=/${locale}/admin/campaigns`);
    if (audiences.status === 403) notFound();
    return (
      <main className="mx-auto flex max-w-3xl flex-col gap-4 p-8">
        <h1 className="text-2xl font-semibold">Campaigns</h1>
        <p role="alert" data-testid="campaigns-unreachable">
          Campaigns cannot be shown right now.
        </p>
      </main>
    );
  }
  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-8 p-8">
      <p className="text-sm">
        <Link href={`/${locale}/admin`} className="underline">
          ← Administration
        </Link>
      </p>
      <h1 className="text-2xl font-semibold">Campaigns</h1>
      <AudiencesAdmin locale={locale} audiences={audiences.data.audiences} />
      <CampaignsAdmin
        locale={locale}
        audiences={audiences.data.audiences}
        campaigns={campaigns.ok ? campaigns.data.campaigns : []}
      />
      {!campaigns.ok && (
        <p role="alert" data-testid="campaign-list-unreachable">
          The campaign list could not be read right now.
        </p>
      )}
    </main>
  );
}
