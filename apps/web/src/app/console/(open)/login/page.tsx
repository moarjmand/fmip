import type { Metadata } from 'next';
import { signIn } from '@/lib/console-actions';
import { ConsoleForm } from '../../console-form';
import { inputClass } from '../../ui';

export const metadata: Metadata = { title: 'ورود' };

/** Signing in to the console (T-1696, D-340): the console's own name and password. */
export default function ConsoleSignInPage() {
  return (
    <main className="page-frame flex min-h-dvh items-center justify-center py-10">
      <div className="w-full max-w-sm rounded-card border border-default bg-surface p-6">
        <h1 className="text-lg font-bold">ورود به کنسول عامل‌ها</h1>
        <p className="mt-1 mb-5 text-sm text-muted">حساب کنسول جدا از حساب سایت است.</p>
        <ConsoleForm action={signIn} submit="ورود">
          <label className="flex flex-col gap-1 text-sm">
            نام کاربری
            <input
              name="username"
              autoComplete="username"
              required
              dir="ltr"
              className={inputClass}
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            رمز
            <input
              name="password"
              type="password"
              autoComplete="current-password"
              required
              dir="ltr"
              className={inputClass}
            />
          </label>
        </ConsoleForm>
      </div>
    </main>
  );
}
