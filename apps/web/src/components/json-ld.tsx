import type { JsonLd as JsonLdData } from '@/lib/seo';

/**
 * One `<script type="application/ld+json">` per structured-data object
 * (T-039). Rendered on the server, so the markup is in the HTML without
 * JavaScript. `<` is escaped so a name can never close the script early.
 */
export function JsonLd({ data }: { data: JsonLdData | JsonLdData[] }) {
  const items = Array.isArray(data) ? data : [data];
  return (
    <>
      {items.map((item, index) => (
        <script
          key={index}
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(item).replace(/</g, '\\u003c') }}
        />
      ))}
    </>
  );
}
