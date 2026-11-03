'use client';

/**
 * A console page that failed to render (T-1725, D-352): the header stays,
 * the content says so in Persian and offers to try again. The error itself
 * is not shown: in production it is a digest, and the server log has it.
 */
export default function ConsoleError({
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return (
    <section role="alert" className="rounded-card border border-default bg-surface p-4 md:p-5">
      <h1 className="text-base font-bold text-fg">این صفحه باز نشد</h1>
      <p className="mt-2 text-sm text-muted">
        شاید ارتباط با سرور یک لحظه قطع شده است. دوباره امتحان کنید.
      </p>
      <button
        type="button"
        onClick={() => retry()}
        className="mt-4 min-h-touch rounded-control bg-brand px-4 text-sm font-bold text-on-brand"
      >
        دوباره امتحان کن
      </button>
    </section>
  );
}
