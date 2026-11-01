import type { Metadata } from 'next';
import { acceptInvitation } from '@/lib/console-actions';
import { consoleInvitation } from '@/lib/console-api';
import { ConsoleForm } from '../../../console-form';
import { inputClass, when } from '../../../ui';

export const metadata: Metadata = { title: 'دعوت', referrer: 'no-referrer' };
export const dynamic = 'force-dynamic';

/** Opening a console account from a one-time invitation (T-1696, D-340). */
export default async function ConsoleInvitationPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const invitation = await consoleInvitation(token);
  return (
    <main className="page-frame flex min-h-dvh items-center justify-center py-10">
      <div className="w-full max-w-sm rounded-card border border-default bg-surface p-6">
        {!invitation.ok ? (
          <>
            <h1 className="text-lg font-bold">این دعوت دیگر باز نیست</h1>
            <p className="mt-2 text-sm text-muted">
              یا استفاده شده یا وقتش گذشته است. دعوت تازه بخواهید.
            </p>
          </>
        ) : (
          <>
            <h1 className="text-lg font-bold">
              ساخت حساب کنسول برای {invitation.data.display_name}
            </h1>
            <p className="mt-1 mb-5 text-sm text-muted">
              این لینک یک‌بار مصرف است و تا {when(invitation.data.expires_at)} باز است.
            </p>
            <ConsoleForm action={acceptInvitation} submit="ساخت حساب و ورود">
              <input type="hidden" name="token" value={token} />
              <label className="flex flex-col gap-1 text-sm">
                نام کاربری (۳ تا ۳۲ حرف کوچک انگلیسی، رقم، نقطه، خط تیره)
                <input
                  name="username"
                  autoComplete="username"
                  required
                  dir="ltr"
                  pattern="[a-z0-9][a-z0-9_.\-]{2,31}"
                  className={inputClass}
                />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                رمز (دست‌کم ۱۰ نویسه)
                <input
                  name="password"
                  type="password"
                  autoComplete="new-password"
                  minLength={10}
                  required
                  dir="ltr"
                  className={inputClass}
                />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                تکرار رمز
                <input
                  name="confirm"
                  type="password"
                  autoComplete="new-password"
                  minLength={10}
                  required
                  dir="ltr"
                  className={inputClass}
                />
              </label>
            </ConsoleForm>
          </>
        )}
      </div>
    </main>
  );
}
