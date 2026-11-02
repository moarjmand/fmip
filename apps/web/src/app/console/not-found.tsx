import { ConsoleLink as Link } from '@/app/console/console-link';

/**
 * A console page that is not there (T-1725, D-352): an agent the snapshot
 * does not have, or a path the console does not know. Persian, inside the
 * console's own root layout, instead of the framework's English page.
 */
export default function ConsoleNotFound() {
  return (
    <main className="page-frame flex min-h-dvh items-center justify-center py-10">
      <div className="w-full max-w-sm rounded-card border border-default bg-surface p-6">
        <h1 className="text-lg font-bold">این صفحه در کنسول نیست</h1>
        <p className="mt-2 text-sm text-muted">
          شاید نشانی اشتباه است، یا عاملی با این نام هنوز در داده‌ی رسیده از رایانه نیست.
        </p>
        <Link href="/" className="mt-4 inline-block text-sm text-brand">
          بازگشت به نمای کلی
        </Link>
      </div>
    </main>
  );
}
