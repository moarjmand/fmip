import { readFileSync, readdirSync } from 'node:fs';
import { join, sep } from 'node:path';
import type { Message } from '@fmip/contracts';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { EN, TRANSLATION_FILES, interpolate, t, withoutIsolates } from '@/i18n/messages';
import { fill } from '@/lib/words';
import { MessageRow } from './conversation';
import { MemberHandle, MemberName } from './member-name';
import { MemberWords, wordsIsolate, writtenDirection } from './member-words';

/**
 * Members' words keep their own direction, and handles keep their `@` in
 * front (T-1975, rule 7).
 *
 * - What a member wrote (a message, a post, a bio, an explanation, a report's
 *   details) goes through `MemberWords`: the element carries the direction of
 *   the words themselves (`writtenDirection`), not of the first letter, so a
 *   Persian message that opens with `@sara_goal` or `VAR` stays right to left,
 *   and every `@handle` in it is a `<bdi dir="ltr">`.
 * - A handle is `<bdi dir="ltr">@name</bdi>` (or `MemberHandle`), and in a
 *   catalogue sentence `@{username}` is filled as one left-to-right isolate, so
 *   a Persian page shows `@ali_fan`, never `ali_fan@`.
 */

const RLI = String.fromCodePoint(0x2067);

const WEB = join(__dirname, '..');
const LRI = '\u2066';
const FSI = '\u2068';
const PDI = '\u2069';

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

/** The message body's paragraph, as rendered. */
const body = (html: string) =>
  /<p class="whitespace-pre-line text-sm"[^>]*>.*?<\/p>/.exec(html)?.[0];

describe('a message in a conversation', () => {
  for (const locale of ['en', 'fa']) {
    it(`a Persian message is right to left on /${locale}`, () => {
      expect(body(row(locale, 'سلام، بازی خوبی بود.'))).toBe(
        '<p class="whitespace-pre-line text-sm" dir="rtl">سلام، بازی خوبی بود.</p>',
      );
    });

    it(`an English message is left to right on /${locale}`, () => {
      expect(body(row(locale, 'Great game, wasn’t it?'))).toBe(
        '<p class="whitespace-pre-line text-sm" dir="ltr">Great game, wasn’t it?</p>',
      );
    });

    it(`a Persian message that opens with a handle stays right to left on /${locale}`, () => {
      expect(body(row(locale, '@sara_goal ممنون، کجایی؟'))).toBe(
        '<p class="whitespace-pre-line text-sm" dir="rtl"><bdi dir="ltr">@sara_goal</bdi> ممنون، کجایی؟</p>',
      );
    });

    it(`a Persian message that opens with a Latin word stays right to left on /${locale}`, () => {
      expect(body(row(locale, 'VAR امروز افتضاح بود!'))).toBe(
        '<p class="whitespace-pre-line text-sm" dir="rtl">VAR امروز افتضاح بود!</p>',
      );
    });

    it(`a handle in the middle of a Persian sentence keeps its @ in front on /${locale}`, () => {
      expect(body(row(locale, 'سلام @ali_fan، فردا می‌آیی؟'))).toBe(
        '<p class="whitespace-pre-line text-sm" dir="rtl">سلام <bdi dir="ltr">@ali_fan</bdi>، فردا می‌آیی؟</p>',
      );
    });

    it(`an English message that opens with a handle is left to right on /${locale}`, () => {
      expect(body(row(locale, '@ali_fan what a goal'))).toBe(
        '<p class="whitespace-pre-line text-sm" dir="ltr"><bdi dir="ltr">@ali_fan</bdi> what a goal</p>',
      );
    });
  }

  it('a message with no words keeps the page’s direction', () => {
    expect(body(row('fa', '2-1 !!!'))).toBe('<p class="whitespace-pre-line text-sm">2-1 !!!</p>');
  });

  it('keeps the group’s language beside the direction', () => {
    const html = renderToStaticMarkup(
      <MessageRow message={message('سلام')} locale="en" timeZone="UTC" isMine={false} lang="fa" />,
    );
    expect(html).toContain('lang="fa" dir="rtl">سلام</p>');
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
    expect(html).toContain(`${RLI}توهین${PDI}`);
  });
});

describe('the direction of a member’s words', () => {
  it('counts words, leaving handles and links out', () => {
    expect(writtenDirection('Kylian Mbappé گل زد')).toBe('rtl');
    expect(writtenDirection('I said سلام to him')).toBe('ltr');
    expect(writtenDirection('https://example.com/a-long-english-path سلام')).toBe('rtl');
    expect(writtenDirection('@ali_fan @sara_goal')).toBeUndefined();
    expect(writtenDirection('۲-۱')).toBeUndefined();
  });

  it('isolates words inside a built string in their own direction', () => {
    expect(wordsIsolate('VAR امروز')).toBe(`${RLI}VAR امروز${PDI}`);
    expect(wordsIsolate('Spam.')).toBe(`${LRI}Spam.${PDI}`);
    expect(wordsIsolate('!!!')).toBe(`${FSI}!!!${PDI}`);
  });

  it('isolates every handle, and only handles', () => {
    expect(renderToStaticMarkup(<MemberWords as="bdi" text="hi @ali_fan and ali@" />)).toBe(
      '<bdi dir="ltr">hi <bdi dir="ltr">@ali_fan</bdi> and ali@</bdi>',
    );
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

  it('isolates only a username, and leaves an unknown placeholder as it was', () => {
    expect(interpolate('{a} and {b}', { a: 'x' })).toBe('x and {b}');
    expect(interpolate('@{username} said', {})).toBe('@{username} said');
    expect(interpolate('{local}@{domain}', { local: 'a', domain: 'b.c' })).toBe('a@b.c');
    expect(fill('{local}@{domain}', { local: 'a', domain: 'b.c' })).toBe('a@b.c');
    expect(fill('hi @{username}', { username: 'y' })).toBe(`hi ${LRI}@y${PDI}`);
  });

  it('is `@{username}` wherever a catalogue puts `@` before a placeholder', () => {
    const texts = [
      ...Object.values(EN).flatMap((value) =>
        typeof value === 'string' ? [value] : Object.values(value as Record<string, string>),
      ),
      ...Object.values(TRANSLATION_FILES).flatMap((file) =>
        Object.values(file).flatMap((entry) => JSON.stringify(entry)),
      ),
    ];
    const handles = texts.flatMap((text) => text.match(/@\{[a-zA-Z]+\}/g) ?? []);
    expect(handles.length).toBeGreaterThan(0);
    expect(new Set(handles)).toEqual(new Set(['@{username}']));
  });

  it('keeps the isolates out of the compare page’s title', () => {
    const page = readFileSync(join(WEB, 'app/[locale]/u/[username]/compare/page.tsx'), 'utf8');
    expect(page).toContain(
      "withoutIsolates(interpolate(t(lang, 'profile.compare.metaTitle'), { username: name }))",
    );
    expect(withoutIsolates(interpolate('Compare with @{username}', { username: 'ali_fan' }))).toBe(
      'Compare with @ali_fan',
    );
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
   * Where members' words are rendered, and the expression that renders them.
   * Each goes through `<MemberWords text={…}>`, and is never printed bare.
   */
  const WRITTEN: [file: string, expression: string][] = [
    ['components/conversation.tsx', 'message.body'],
    ['components/match-panel.tsx', 'post.body'],
    ['components/home-member.tsx', "excerpt(post.body ?? '')"],
    ['app/[locale]/following/page.tsx', 'item.excerpt'],
    ['components/pick-control.tsx', 'v.explanation'],
    ['components/community-analysis-panel.tsx', 'current.reasoning'],
    ['components/community-analysis-panel.tsx', 'current[field]'],
    ['components/analysis-queue.tsx', 'submission.reasoning'],
    ['components/analysis-queue.tsx', 'submission[field]'],
    ['components/founder-analysis.tsx', 'current.reasoning'],
    ['components/founder-analysis.tsx', 'version.reasoning'],
    ['components/founder-analysis.tsx', 'text'],
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
    it(`${file}: {${expression}} goes through MemberWords`, () => {
      const text = readFileSync(join(WEB, file), 'utf8');
      expect(text, file).toContain(`text={${expression}}`);
      // Every `text={…}` of it sits on a MemberWords, and it is never a bare child.
      let at = text.indexOf(`text={${expression}}`);
      while (at !== -1) {
        expect(text.slice(text.lastIndexOf('<', at), at), file).toMatch(/^<MemberWords\b/);
        at = text.indexOf(`text={${expression}}`, at + 1);
      }
      expect(text, file).not.toMatch(new RegExp(`>\\s*\\{${escapeRegExp(expression)}\\}\\s*<`));
    });
  }

  it('leaves no dir="auto" where MemberWords now decides', () => {
    for (const file of new Set(WRITTEN.map(([file]) => file))) {
      expect(readFileSync(join(WEB, file), 'utf8'), file).not.toContain('dir="auto"');
    }
  });
});

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
