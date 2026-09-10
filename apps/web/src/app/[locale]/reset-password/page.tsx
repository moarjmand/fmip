import type { Metadata } from 'next';
import Link from 'next/link';
import { ActionForm } from '@/components/action-form';
import { resetPasswordAction } from '@/lib/auth-actions';

export const metadata: Metadata = { title: 'Reset password · FMIP' };

export default async function ResetPasswordPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ token?: string }>;
}) {
  const { locale } = await params;
  const { token } = await searchParams;

  if (token === undefined || token === '') {
    return (
      <main className="mx-auto flex max-w-md flex-col gap-4 p-8">
        <h1 className="text-2xl font-semibold">Reset password</h1>
        <p role="alert">
          This page needs the link from your e-mail.{' '}
          <Link href={`/${locale}/forgot-password`}>Request a new one</Link>.
        </p>
      </main>
    );
  }

  return (
    <main className="mx-auto flex max-w-md flex-col gap-6 p-8">
      <h1 className="text-2xl font-semibold">Choose a new password</h1>
      <p className="text-sm">Every other session of your account will be signed out.</p>
      <ActionForm
        action={resetPasswordAction.bind(null, locale)}
        fields={[
          { name: 'token', type: 'hidden', label: '', defaultValue: token },
          {
            name: 'password',
            label: 'New password',
            type: 'password',
            required: true,
            autoComplete: 'new-password',
            hint: 'At least 10 characters.',
          },
        ]}
        submitLabel="Change password"
        testId="reset-password-form"
      />
    </main>
  );
}
