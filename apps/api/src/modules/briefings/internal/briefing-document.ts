import type { BriefingDay, BriefingDigest, FeedItem, FollowingFeed } from '@fmip/contracts';

/**
 * The feed's span as a digest (T-430): the items the feed already ranked,
 * grouped by the day they are about, each by id. It is what a briefing is
 * written from and what the page shows under the prose -- and on a
 * deployment with no model it is the briefing, honest as it is.
 */
export function documentOf(feed: FollowingFeed): BriefingDigest {
  const byDay = new Map<string, FeedItem[]>();
  for (const item of feed.items) {
    const date = item.at.slice(0, 10);
    const day = byDay.get(date);
    if (day === undefined) byDay.set(date, [item]);
    else day.push(item);
  }
  const days: BriefingDay[] = [...byDay.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, items]) => ({ date, items }));
  return {
    since: feed.showing.since,
    until: feed.showing.until,
    followed: feed.showing.followed,
    days,
  };
}

export type Grounding = { ok: true } | { ok: false; reason: string };

/**
 * The gate (T-431): every paragraph of the prose must point at something
 * in the digest -- a team, a competition, a headline, a member who posted
 * -- and every number in it must be a number the digest holds (a score, a
 * confidence, a count, a day). A paragraph that points at nothing is the
 * one that reads more into the feed than it carries.
 */
export function checkBriefing(text: string, digest: BriefingDigest): Grounding {
  const anchors = new Set<string>();
  const numbers = new Set<string>();
  const add = (value: string | null | undefined) => {
    if (value !== null && value !== undefined && value.trim().length >= 3) {
      anchors.add(value.trim().toLowerCase());
    }
  };
  const addNumber = (value: number | null | undefined) => {
    if (value !== null && value !== undefined && Number.isFinite(value)) numbers.add(String(value));
  };
  for (let n = 0; n <= 5; n += 1) numbers.add(String(n));
  for (const day of digest.days) {
    numbers.add(String(Number(day.date.slice(8, 10))));
    numbers.add(day.date.slice(0, 4));
    for (const item of day.items) {
      switch (item.kind) {
        case 'fixture':
          add(item.home.name);
          add(item.away.name);
          add(item.competition.name);
          if (item.score !== null) {
            addNumber(item.score.home);
            addNumber(item.score.away);
          }
          break;
        case 'story':
          add(item.headline);
          add(item.source_name);
          break;
        case 'founder_analysis':
          add(item.home.name);
          add(item.away.name);
          addNumber(Math.round(item.confidence * 100));
          addNumber(item.confidence);
          break;
        case 'panel_post':
          add(item.home.name);
          add(item.away.name);
          add(item.author.display_name);
          add(item.author.username);
          break;
      }
      for (const signal of item.because) {
        if (signal.kind === 'discussed') addNumber(signal.participants);
      }
    }
  }

  const paragraphs = text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter((p) => p !== '');
  if (paragraphs.length === 0) return { ok: false, reason: 'the briefing is empty' };
  const names = [...anchors];
  for (const paragraph of paragraphs) {
    const lower = paragraph.toLowerCase();
    if (!names.some((name) => lower.includes(name))) {
      return {
        ok: false,
        reason: `a paragraph points at nothing in the feed: ${paragraph.slice(0, 60)}`,
      };
    }
  }
  const withoutNames = names.reduce((rest, name) => stripName(rest, name), text);
  for (const match of withoutNames.matchAll(/\d+(?:[.,]\d+)?/g)) {
    const raw = match[0].replace(',', '.');
    if (!numbers.has(raw) && !numbers.has(String(Number(raw)))) {
      return { ok: false, reason: `number not in the feed: ${match[0]}` };
    }
  }
  return { ok: true };
}

/** Every occurrence of a name, case-insensitively, replaced by a space -- without a regular expression, so a name is never a pattern. */
function stripName(text: string, name: string): string {
  const lower = text.toLowerCase();
  const needle = name.toLowerCase();
  let out = '';
  let from = 0;
  for (;;) {
    const at = lower.indexOf(needle, from);
    if (at === -1) return out + text.slice(from);
    out += `${text.slice(from, at)} `;
    from = at + needle.length;
  }
}
