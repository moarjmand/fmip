import type { Metadata } from 'next';
import { ActionForm } from '@/components/action-form';
import { forgotPasswordAction } from '@/lib/auth-actions';

export const metadata: Metadata = { title: 'Forgot password · FMIP' };

export default function ForgotPasswordPage() {
  return (
    <main className="mx-auto flex max-w-md flex-col gap-6 p-8">
      <h1 className="text-2xl font-semibold">Forgot your password?</h1>
      <p className="text-sm">
        Enter the e-mail address of your account. If it is known, a one-time reset link will be sent
        to it.
      </p>
      <ActionForm
        action={forgotPasswordAction}
        fields={[
          { name: 'email', label: 'E-mail', type: 'email', required: true, autoComplete: 'email' },
        ]}
        submitLabel="Send reset link"
        testId="forgot-password-form"
      />
    </main>
  );
}
