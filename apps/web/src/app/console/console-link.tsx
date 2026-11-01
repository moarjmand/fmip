import type { ComponentProps } from 'react';
import Link from '@/components/ui/link';
import { consoleUrl } from '@/lib/console-base';

/** The site's link with a console path put under the request's base (D-341). */
export async function ConsoleLink({ href, ...rest }: ComponentProps<typeof Link>) {
  return <Link href={typeof href === 'string' ? await consoleUrl(href) : href} {...rest} />;
}
