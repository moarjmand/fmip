/**
 * A model version as text (T-1465): `dixon-coles-elo@0.6.0`.
 *
 * The `@` is an element of its own, so no address can be read in the
 * server's HTML (`dixon-coles-elo<span>@</span>0.6.0`). Written as one string, the
 * version reads as an e-mail address to Cloudflare's Email Obfuscation,
 * which rewrote it into a `/cdn-cgi/l/email-protection` link and added its
 * decoding script to the page -- five times on the homepage. Readers see the
 * same characters either way; copying it gives the same text.
 */
export function ModelVersion({ version }: { version: string }) {
  const at = version.indexOf('@');
  if (at === -1) return <>{version}</>;
  return (
    <>
      {version.slice(0, at)}
      <span>@</span>
      {version.slice(at + 1)}
    </>
  );
}
