/**
 * How every channel post is cut into messages (T-525, shared since T-1430):
 * at competition boundaries, each message under the channel's ceiling and
 * opening with the post's own header, so a message read alone still says
 * whose figures it carries. Pure.
 */

/** Telegram's ceiling for one message, and a sane one for any channel. */
export const MAX_MESSAGE_LENGTH = 4096;

export const GAP = '\n\n';

/** A competition's title and its entries (matches, or figures), in order. */
export interface PostSection {
  title: string;
  blocks: string[];
}

/**
 * The sections as messages of at most `limit` characters, each opened by
 * `header(part, total)`. Messages break between sections; a section is cut
 * between its entries only when it alone is longer than a message, and its
 * next part carries its title again. `header` must not grow with `part` and
 * `total` beyond what `header(999, 999)` measures.
 */
export function packMessages(
  sections: PostSection[],
  header: (part: number, total: number) => string,
  limit = MAX_MESSAGE_LENGTH,
): string[] {
  // Room for the widest header the post could need, so the counter added
  // after packing can never push a message over the limit.
  const budget = limit - header(999, 999).length - GAP.length;

  const bodies: string[][] = [];
  let current: string[] = [];
  const length = (blocks: string[]): number => blocks.join(GAP).length;
  const flush = (): void => {
    if (current.length > 0) bodies.push(current);
    current = [];
  };

  for (const section of sections) {
    const whole = [section.title, ...section.blocks].join(GAP);
    if (length([...current, whole]) <= budget) {
      current.push(whole);
      continue;
    }
    flush();
    if (whole.length <= budget) {
      current.push(whole);
      continue;
    }
    // One section longer than a message: cut between its entries.
    let piece: string[] = [section.title];
    for (const block of section.blocks) {
      if (piece.length > 1 && length([...piece, block]) > budget) {
        bodies.push([piece.join(GAP)]);
        piece = [`${section.title} (continued)`];
      }
      piece.push(block);
    }
    current.push(piece.join(GAP));
  }
  flush();

  return bodies.map((blocks, i) => `${header(i + 1, bodies.length)}${GAP}${blocks.join(GAP)}`);
}
