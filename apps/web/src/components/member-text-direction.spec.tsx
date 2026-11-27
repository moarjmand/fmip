import { readFileSync, readdirSync } from 'node:fs';
import { join, sep } from 'node:path';
import type { Message } from '@fmip/contracts';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { EN, interpolate, t } from '@/i18n/messages';
import { fill } from '@/lib/words';
import { MessageRow } from './conversation';
import { MemberHandle, MemberName } from './member-name';

/**
 * Members' words keep their own direction, and handles keep their `@` in
 * front (T-1975, rule 7).
 *
 * - What a member wrote as a block (a message, a post, a bio, an explanation,
 *   a report's details) carries `dir="auto"`: a Persian message on an English
 *   page, or an English one on a Persian page, is aligned and punctuated as it
 *   was written. Inside a line it is a `<bdi>`.
 * - A handle is `<bdi dir="ltr">@name</bdi>` (or `MemberHandle`), and in a
 *   catalogue sentence `@{name}` is filled as one left-to-right isolate, so a
 *   Persian page shows `@ali_fan`, never `ali_fan@`.
 */

const WEB = join(__dirname, '..');
const LRI = '⁦';
const FSI = '⁨';
const PDI = '⁩';

const message = (body: string, over: Partial<Message> = {}): Message => ({
  id: 'm1',
  seq: 1,
  author: 'sara_goal',
  body,
  reply_to_id: null,
  created_at: '2026-11-27T12:00:00.000Z',
  removed: null,
  card: null,
  reactions: [],
  mentions: [],
  pinned: false,
  ...over,
});

const row = (locale: string, body: string, over: Partial<Message> = {}) =>
  renderToStaticMarkup(
    <MessageRow message={message(body, over)} locale={locale} timeZone="UTC" isMine={false} />,
  );

describe('a message in a conversation', () => {
  it('a Persian message on the English page takes its direction from its words', () => {
    const html = row('en', 'سلام، بازی خوبی بود.');
    expect(html).toMatch(/<p class="[^"]*" dir="auto">سلام، بازی خوبی بود\.<\/p>/);
  });

  it('an English message on the Persian page does too', () => {
    const html = row('fa', 'Great game, wasn’t it?');
    expect(html).toMatch(/<p class="[^"]*" dir="auto">Great game, wasn’t it\?<\/p>/);
  });

  it('keeps the group’s language beside the direction', () => {
    const html = renderToStaticMarkup(
      <MessageRow message={message('سلام')} locale="en" timeZone="UTC" isMine={false} lang="fa" />,
    );
    expect(html).toContain('lang="fa" dir="auto">سلام</p>');
  });

  it('shows the author’s handle left to right on the Persian page', () => {
    const html = row('fa', 'سلام');
    expect(html).toContain('<bdi dir="ltr">@sara_goal</bdi>');
    expect(html).not.toMatch(/>@sara_goal<\/span>/);
  });

  it('isolates each mentioned handle inside the sentence', () => {
    const html = row('fa', 'سلام @ali_fan', { mentions: ['ali_fan', 'neda_kop'] });
    expect(html).toContain(`${FSI}@ali_fan${PDI}`);
    expect(html).toContain(`${FSI}@neda_kop${PDI}`);
  });

  it('isolates a moderator’s reason inside the removal sentence', () => {
    const html = row('en', 'x', {
      body: null,
      removed: { at: '2026-11-27T12:00:00.000Z', by: 'moderator', reason: 'توهین' },
    });
    expect(html).toContain(`${FSI}توهین${PDI}`);
  });
});

describe('a member’s name and handle', () => {
  it('a handle is a left-to-right isolate inside a span that keeps the page’s direction', () => {
    expect(renderToStaticMarkup(<MemberHandle username="ali_fan" className="ms-2" />)).toBe(
      '<span class="ms-2"><bdi dir="ltr">@ali_fan</bdi></span>',
    );
  });

  it('a name with no display name falls back to the handle, isolated left to right', () => {
    expect(renderToStaticMarkup(<MemberName locale="fa" member={{ username: 'ali_fan' }} />)).toBe(
      '<span><bdi dir="ltr">@ali_fan</bdi></span>',
    );
  });

  it('a display name is isolated in its own direction, linked or not', () => {
    expect(
      renderToStaticMarkup(
        <MemberName locale="fa" member={{ username: 'ali_fan', display_name: 'Ali' }} />,
      ),
    ).toBe('<span><bdi>Ali</bdi></span>');
    expect(
      renderToStaticMarkup(
        <MemberName locale="en" member={{ username: 'sara', display_name: 'سارا' }} link />,
      ),
    ).toContain('<bdi>سارا</bdi></a>');
  });

  it('a deleted member has no handle', () => {
    expect(renderToStaticMarkup(<MemberHandle username="deleted_0123456789ab" />)).toBe('');
  });
});

describe('a handle inside a catalogue sentence', () => {
  it('reads @ali_fan in the Persian Settings line', () => {
    const line = interpolate(t('fa', 'settingsPage.signedInVerified'), {
      username: 'ali_fan',
      email: 'ali@example.com',
    });
    expect(line).toContain(`${LRI}@ali_fan${PDI}`);
    expect(line.startsWith('با حساب')).toBe(true);
  });

  it('is isolated in every sentence that has one, in English and Persian, server and client', () => {
    const keys = (Object.keys(EN) as (keyof typeof EN)[]).filter(
      (key) => typeof EN[key] === 'string' && (EN[key] as string).includes('@{username}'),
    );
    expect(keys.length).toBeGreaterThan(10);
    for (const key of keys) {
      for (const locale of ['en', 'fa'] as const) {
        const template = t(locale, key as Parameters<typeof t>[1]);
        for (const line of [
          interpolate(template, { username: 'ali_fan' }),
          fill(template, { username: 'ali_fan' }),
        ]) {
          expect(line, `${locale} ${key}`).toContain(`${LRI}@ali_fan${PDI}`);
          expect(line.replaceAll(`${LRI}@ali_fan${PDI}`, ''), key).not.toContain('ali_fan');
        }
      }
    }
  });

  it('leaves other placeholders, and an unknown one, as they were', () => {
    expect(interpolate('{a} and {b}', { a: 'x' })).toBe('x and {b}');
    expect(interpolate('@{who} said', {})).toBe('@{who} said');
    expect(fill('{a}@{b}', { a: 'x', b: 'y' })).toBe(`x${LRI}@y${PDI}`);
  });
});

/** Every web `.tsx` outside the specs and the agents console. */
function webSources(): { path: string; text: string }[] {
  return (readdirSync(WEB, { recursive: true }) as string[])
    .map((path) => path.split(sep).join('/'))
    .filter((path) => path.endsWith('.tsx') && !path.endsWith('.spec.tsx'))
    .filter((path) => !path.startsWith('app/console/'))
    .map((path) => ({ path, text: readFileSync(join(WEB, path), 'utf8') }));
}

describe('the source', () => {
  it('prints every inline handle inside <bdi dir="ltr">', () => {
    const loose = webSources()
      .map(({ path, text }) => ({
        path,
        all: (text.match(/@\{/g) ?? []).length,
        isolated: (text.match(/<bdi dir="ltr"[^>]*>\s*@\{/g) ?? []).length,
      }))
      .filter(({ all, isolated }) => all !== isolated)
      .map(({ path }) => path);
    expect(loose).toEqual([]);
  });

  /**
   * Where a member's words are rendered, and the expression that renders them.
   * The element that holds each one must be a `<bdi>` or carry `dir="auto"`.
   */
  const WRITTEN: [file: string, expression: string][] = [
    ['components/conversation.tsx', 'message.body'],
    ['components/match-panel.tsx', 'post.body'],
    ['components/home-member.tsx', "excerpt(post.body ?? '')"],
    ['app/[locale]/following/page.tsx', 'item.excerpt'],
    ['components/pick-control.tsx', 'v.explanation'],
    ['components/community-analysis-panel.tsx', 'current.reasoning'],
    ['components/analysis-queue.tsx', 'submission.reasoning'],
    ['components/founder-analysis.tsx', 'current.reasoning'],
    ['components/founder-analysis.tsx', 'version.reasoning'],
    ['app/[locale]/founder/[fixtureId]/page.tsx', 'version.reasoning'],
    ['app/[locale]/u/[username]/page.tsx', 'profile.bio'],
    ['app/[locale]/groups/page.tsx', 'group.description'],
    ['app/[locale]/groups/[slug]/page.tsx', 'group.description'],
    ['app/[locale]/groups/[slug]/page.tsx', 'group.rules.body'],
    ['app/[locale]/groups/[slug]/page.tsx', 'request.note'],
    ['app/[locale]/group-invite/[token]/page.tsx', 'group.description'],
    ['app/[locale]/group-invite/[token]/page.tsx', 'rules.body'],
    ['components/group-polls.tsx', 'poll.question'],
    ['components/group-polls.tsx', 'option.label'],
    ['components/group-moderation.tsx', 'note.body'],
    ['components/member-appeals.tsx', 'appeal.body'],
    ['components/moderation-queue.tsx', 'report.detail'],
    ['components/member-moderation-history.tsx', 'report.detail'],
    ['app/[locale]/admin/moderation/groups/[slug]/page.tsx', 'result.data.description'],
    ['app/[locale]/admin/moderation/groups/[slug]/page.tsx', 'report.detail'],
  ];

  for (const [file, expression] of WRITTEN) {
    it(`${file}: {${expression}} keeps its own direction`, () => {
      const text = readFileSync(join(WEB, file), 'utf8');
      const needle = `{${expression}}`;
      let at = text.indexOf(needle);
      expect(at, `${needle} is not in ${file}`).toBeGreaterThan(-1);
      while (at !== -1) {
        const tag = text.slice(text.lastIndexOf('<', at), at);
        expect(tag, `${file} ${needle}`).toMatch(/^<bdi\b|\bdir="auto"/);
        at = text.indexOf(needle, at + needle.length);
      }
    });
  }
});
