import type { Metadata } from 'next';
import { consoleSocial } from '@/lib/console-api';
import { SocialTab } from '../../social';
import { Card } from '../../ui';

export const metadata: Metadata = { title: 'شبکه‌های اجتماعی' };

/**
 * «شبکه‌های اجتماعی» (T-1836, D-427): the social posts' queue and controls,
 * one read of `GET /console/social`. When the API cannot be read, the page
 * says so rather than drawing an empty queue that looks real (rule 3).
 */
export default async function ConsoleSocialPage() {
  const result = await consoleSocial();
  if (!result.ok) {
    return (
      <Card title="شبکه‌های اجتماعی">
        <p role="alert" className="text-sm text-danger">
          وضعیت پست‌ها اکنون خوانده نمی‌شود؛ کمی بعد صفحه را دوباره باز کنید.
        </p>
      </Card>
    );
  }
  return <SocialTab view={result.data} />;
}
