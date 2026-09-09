export default async function HomePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-4 p-8">
      <h1 className="text-2xl font-semibold">FMIP</h1>
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
