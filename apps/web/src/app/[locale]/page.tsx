export default async function HomePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-4 p-8">
      {/*
        The accent bar is deliberately asymmetric and deliberately logical:
        `border-s` and `ps` sit on the inline start, so they move to the right
        edge under `dir="rtl"`. The Playwright check in tests/e2e asserts exactly
        that, which makes this element the canary for a physical-property
        regression that slipped past lint.
      */}
      <h1 className="border-s-4 border-s-current ps-4 text-2xl font-semibold" data-testid="title">
        FMIP
      </h1>
      <p>
        Football Match Intelligence Platform. Nothing is built here yet — the scores page arrives in
        T-031.
      </p>
      <p className="text-sm opacity-70">
        Locale: <code>{locale}</code>
      </p>
    </main>
  );
}
