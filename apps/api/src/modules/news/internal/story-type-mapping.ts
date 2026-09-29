import type { StoryType } from '@fmip/contracts';

/**
 * One publisher category that means one story type (T-1002, D-123).
 *
 * `host` is the source's feed host (`new URL(feed_url).host`, which the URL
 * parser lower-cases) and `category` the string exactly as the feed carries
 * it -- same case, same spelling, same language. `recorded` names a file in
 * `../_recorded/` holding a real item from that feed that carries the string;
 * `story-type-mapping.spec.ts` reads every entry's recording and fails when
 * the item does not carry the string exactly, so an entry cannot be added
 * from memory or by analogy.
 */
export interface CategoryMapping {
  host: string;
  category: string;
  type: StoryType;
  recorded: string;
}

/**
 * The committed mapping. **Empty until a carried source's recorded item
 * justifies an entry.** Which publishers are carried is the maintainer's
 * (N-8, D-061) and is not in the repository; an entry for a feed nobody
 * carries would be a claim about somebody else's words with nothing behind
 * it. Adding one: record an item from the carried feed into `../_recorded/`,
 * add the entry, and the spec holds the two together.
 *
 * There is no similarity, keyword, prefix, case-folding or language-model
 * rule anywhere on this path (N-1): a string not listed here gives no type.
 */
export const STORY_TYPE_MAPPING: readonly CategoryMapping[] = [];

/** The provider token for the mapping, so a spec can script one for its own feed host. */
export const CATEGORY_MAPPING = Symbol('CATEGORY_MAPPING');

/** The feed host a mapping entry is keyed by; `null` for a URL that does not parse. */
export function feedHost(feedUrl: string): string | null {
  try {
    return new URL(feedUrl).host;
  } catch {
    return null;
  }
}

/**
 * The type an item's categories give under the mapping, and the category
 * that gave it. `null` when no category is mapped for this feed, and `null`
 * too when the item's mapped categories name two different types: choosing
 * one would be a guess (D-123).
 */
export function mappedType(
  feedUrl: string,
  categories: readonly string[],
  mapping: readonly CategoryMapping[] = STORY_TYPE_MAPPING,
): { type: StoryType; category: string } | null {
  const host = feedHost(feedUrl);
  if (host === null) return null;
  let found: { type: StoryType; category: string } | null = null;
  for (const category of categories) {
    const entry = mapping.find((m) => m.host === host && m.category === category);
    if (entry === undefined) continue;
    if (found === null) found = { type: entry.type, category };
    else if (found.type !== entry.type) return null;
  }
  return found;
}
