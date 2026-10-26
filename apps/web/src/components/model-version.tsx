import { Fragment } from 'react';

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
  return <AtApart text={version} />;
}

/** Several versions, "a@1.0.0, b@2.0.0", each drawn as `ModelVersion` (T-1580). */
export function ModelVersions({ versions }: { versions: readonly string[] }) {
  return (
    <>
      {versions.map((version, i) => (
        <Fragment key={version}>
          {i > 0 && ', '}
          <ModelVersion version={version} />
        </Fragment>
      ))}
    </>
  );
}

/**
 * Any text that may carry a version -- a receipt joined into one line --
 * with every `@` set apart the same way (T-1580). Text without one is
 * written as it is.
 */
export function AtApart({ text }: { text: string }) {
  const parts = text.split('@');
  if (parts.length === 1) return <>{text}</>;
  return (
    <>
      {parts.map((part, i) => (
        <Fragment key={i}>
          {i > 0 && <span>@</span>}
          {part}
        </Fragment>
      ))}
    </>
  );
}
