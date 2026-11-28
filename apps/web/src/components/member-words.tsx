import type { HTMLAttributes, ReactNode } from 'react';

/**
 * What a member wrote, in its own direction, with every `@handle` in it kept
 * left to right (T-1975, rule 7).
 *
 * `dir="auto"` is not enough: it takes the direction from the first strong
 * letter, so a Persian message that opens with `@sara_goal` or with `VAR`
 * would be laid out left to right on a Persian page. The direction is chosen
 * here from the words instead (`writtenDirection`), and each handle is its own
 * `<bdi dir="ltr">`, so it reads `@sara_goal` inside a Persian sentence.
 *
 * Plain data and plain functions, no catalogue: client components use it too.
 */

/** A handle as the API recognises a mention (`conversations.service.ts`). */
const HANDLE = /(@[a-z0-9_]{3,20})/gi;
const LINK = /\b(?:https?:\/\/|www\.)\S+/gi;
/** A letter of a right-to-left script. */
const RTL_LETTER =
  /[\p{Script=Arabic}\p{Script=Hebrew}\p{Script=Syriac}\p{Script=Thaana}\p{Script=Nko}]/u;
const LETTER = /\p{L}/u;

/**
 * The direction of a member's words: right to left when at least three words
 * in ten are in a right-to-left script, left to right when there are words
 * and fewer are; `undefined` when there are no words at all (figures, emoji),
 * so the element keeps the page's direction.
 *
 * Handles and links are left out of the count: `@sara_goal ممنون` is a
 * Persian sentence. Counting words, not the first letter, keeps
 * `VAR امروز افتضاح بود!` right to left and `I said سلام to him` left to right.
 */
export function writtenDirection(text: string): 'rtl' | 'ltr' | undefined {
  let rtl = 0;
  let ltr = 0;
  for (const word of text.replace(LINK, ' ').replace(HANDLE, ' ').split(/\s+/)) {
    let right = 0;
    let letters = 0;
    for (const char of word) {
      if (!LETTER.test(char)) continue;
      letters += 1;
      if (RTL_LETTER.test(char)) right += 1;
    }
    if (letters === 0) continue;
    if (right * 2 >= letters) rtl += 1;
    else ltr += 1;
  }
  if (rtl + ltr === 0) return undefined;
  return rtl * 10 >= (rtl + ltr) * 3 ? 'rtl' : 'ltr';
}

/**
 * A member's words inside a built string: a right-to-left (`U+2067`) or
 * left-to-right (`U+2066`) isolate by `writtenDirection`, first-strong
 * (`U+2068`) when it cannot tell, closed by `U+2069`.
 */
export function wordsIsolate(text: string): string {
  const dir = writtenDirection(text);
  const open = dir === 'rtl' ? '\u2067' : dir === 'ltr' ? '\u2066' : '\u2068';
  return `${open}${text}\u2069`;
}

/**
 * A link, or a handle outside one: each kept whole, left to right. A link is
 * matched first, so `https://youtube.com/@varzesh3` is one isolate rather than
 * a link cut around a handle; trailing punctuation (`،`, `.`, `)`) stays out.
 */
const LEFT_TO_RIGHT = /(\b(?:https?:\/\/|www\.)\S+?(?=[.,!?;:،؛)\]]*(?:\s|$))|@[a-z0-9_]{3,20})/gi;

/** The words with each link and each `@handle` in a left-to-right isolate. */
export function withHandles(text: string): ReactNode[] {
  return text
    .split(LEFT_TO_RIGHT)
    .map((part, index) =>
      index % 2 === 1 ? (
        <bdi key={index} dir="ltr">
          {part}
        </bdi>
      ) : (
        part
      ),
    )
    .filter((part) => part !== '');
}

type Tag = 'p' | 'span' | 'bdi' | 'legend';

/**
 * A block or a run of a member's words: the element (`p` unless `as` says
 * otherwise) carries the words' own direction, and the handles in it are
 * isolated. Everything else (class, `lang`, test id) passes through.
 */
export function MemberWords({
  text,
  as = 'p',
  ...rest
}: { text: string; as?: Tag } & Omit<HTMLAttributes<HTMLElement>, 'dir' | 'children'>) {
  const Element = as;
  return (
    <Element {...rest} dir={writtenDirection(text)}>
      {withHandles(text)}
    </Element>
  );
}
