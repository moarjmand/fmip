/**
 * The part of robots.txt a feed fetcher has to honour (T-142, D-061:
 * "fetching obeys robots.txt and each feed's stated terms").
 *
 * A group is a run of `User-agent:` lines followed by rules. The group for
 * our own agent wins over the `*` group when both exist, as the standard
 * says; the longest matching rule wins inside a group, so an `Allow:` can
 * open a path a shorter `Disallow:` closed. Anything else in the file --
 * `Sitemap:`, `Crawl-delay:`, comments -- is ignored rather than guessed at.
 *
 * A missing or unreadable robots.txt allows everything: that is what the
 * standard says, and refusing a publisher's feed because their web server
 * misplaced a text file would be inventing a rule they did not set.
 */
export const NEWS_USER_AGENT = 'fmip-news';

interface Group {
  agents: string[];
  rules: { allow: boolean; path: string }[];
}

function parse(text: string): Group[] {
  const groups: Group[] = [];
  let current: Group | null = null;
  let lastWasAgent = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').trim();
    if (line === '') continue;
    const colon = line.indexOf(':');
    if (colon < 0) continue;
    const field = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();
    if (field === 'user-agent') {
      if (current === null || !lastWasAgent) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (current === null) continue;
    if (field === 'disallow' || field === 'allow') {
      current.rules.push({ allow: field === 'allow', path: value });
    }
  }
  return groups;
}

/** Whether `path` may be fetched by `agent`, according to `robotsTxt`. */
export function robotsAllows(robotsTxt: string, path: string, agent = NEWS_USER_AGENT): boolean {
  const groups = parse(robotsTxt);
  const ours = groups.find((g) =>
    g.agents.some((a) => a !== '*' && agent.toLowerCase().includes(a)),
  );
  const group = ours ?? groups.find((g) => g.agents.includes('*'));
  if (group === undefined) return true;
  let verdict = true;
  let longest = -1;
  for (const rule of group.rules) {
    // An empty Disallow means "nothing is disallowed" and matches no path.
    if (rule.path === '') continue;
    if (path.startsWith(rule.path) && rule.path.length > longest) {
      longest = rule.path.length;
      verdict = rule.allow;
    }
  }
  return verdict;
}
