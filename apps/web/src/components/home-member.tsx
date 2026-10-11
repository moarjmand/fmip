import Link from 'next/link';
import {
  isDeletedMember,
  type ConversationSummary,
  type FriendPrediction,
  type PanelLatest,
  type PredictionOutcome,
  type RatingTier,
  type ScoreCard,
} from '@fmip/contracts';
import { MemberName } from '@/components/member-name';
import { MessageText } from '@/components/message-text';
import { ScorePair } from '@/components/score';
import { Translated } from '@/components/translated';
import { formatNumber, intlLocale } from '@/i18n/format';
import { DEFAULT_LOCALE, isLocale, type Locale } from '@/i18n/locales';
import { type Message, type MessageKey, interpolate, message, plural } from '@/i18n/messages';
import { conversationTitle } from '@/lib/conversation-title';
import { formatKickoff } from '@/lib/scores';
import { memberName } from '@/lib/member-name';

/**
 * The homepage's member sections and today's panels (blueprint 2.3, T-942,
 * D-115). Server components over answers the page fetched once per section.
 *
 * **Three products, three sections.** A friend's call is a member's own
 * prediction and is labelled so; it never sits beside, averages with or
 * borrows a label from the model's forecast or the community consensus above
 * it (rule 6). A panel post is a contributor's opinion, signed with their
 * standing.
 *
 * **A section with nothing in it says so once**, and one that could not be
 * loaded says that instead (rule 3). The page renders the member sections for
 * a member only; a guest is not told they are empty.
 *
 * Every word goes through the catalogue (T-1302), and every figure through the
 * locale's own digits.
 */

/** The page's locale as the catalogue knows it; an unknown one reads as the default. */
const localeOf = (locale: string): Locale => (isLocale(locale) ? locale : DEFAULT_LOCALE);

/** A sentence with its `{placeholders}` filled, keeping where its words came from. */
function filled(lang: Locale, key: MessageKey, values: Record<string, string>): Message {
  const said = message(lang, key);
  return { ...said, text: interpolate(said.text, values) };
}

const OUTCOME: Record<PredictionOutcome, (lang: Locale, p: FriendPrediction) => string> = {
  home: (lang, p) =>
    filled(lang, 'home.friends.toWin', { team: p.fixture.home.short_name ?? p.fixture.home.name })
      .text,
  draw: (lang) => message(lang, 'home.friends.draw').text,
  away: (lang, p) =>
    filled(lang, 'home.friends.toWin', { team: p.fixture.away.short_name ?? p.fixture.away.name })
      .text,
};

const TIER_LABEL: Record<RatingTier, MessageKey> = {
  bronze: 'home.tier.bronze',
  silver: 'home.tier.silver',
  gold: 'home.tier.gold',
  platinum: 'home.tier.platinum',
  elite: 'home.tier.elite',
};

/** The stored settlement, repeated as it stands (D-063); never recomputed here. */
function verdict(p: FriendPrediction): MessageKey | null {
  const s = p.settlement;
  if (s === null) return null;
  if (s.status === 'void') return 'home.friends.void';
  return s.outcome_correct === true ? 'home.friends.right' : 'home.friends.wrong';
}

/** A rating in the locale's digits, ungrouped as it always was: "1523", never "1,523". */
const digits = (lang: Locale, value: number): string =>
  new Intl.NumberFormat(intlLocale(lang), { useGrouping: false }).format(value);

const excerpt = (text: string, max = 140): string =>
  text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;

export function FriendPredictionsSection({
  locale,
  timeZone,
  result,
}: {
  locale: string;
  timeZone: string;
  /** `null` when the request failed. */
  result: FriendPrediction[] | null;
}) {
  const lang = localeOf(locale);
  return (
    <section className="flex flex-col gap-2" data-testid="home-friend-predictions">
      <h2 className="text-lg font-semibold">
        <Translated locale={lang} message="home.friends.title" />
      </h2>
      {result === null ? (
        <p className="text-sm text-muted" data-testid="home-friend-predictions-unreachable">
          <Translated locale={lang} message="home.friends.unreachable" />
        </p>
      ) : result.length === 0 ? (
        <p className="text-sm text-muted" data-testid="home-friend-predictions-empty">
          <Translated locale={lang} message="home.friends.empty" />
        </p>
      ) : (
        <>
          <ul className="flex flex-col gap-1">
            {result.map((p) => {
              const said = verdict(p);
              return (
                <li
                  key={`${p.username}:${p.fixture.id}`}
                  className="flex flex-wrap items-baseline gap-x-2 text-sm"
                  data-testid="home-friend-prediction"
                >
                  <MemberName locale={locale} member={p} link className="underline" />
                  <span>
                    <MessageText
                      message={filled(lang, 'home.friends.called', {
                        outcome: OUTCOME[p.version.outcome](lang, p),
                      })}
                    />
                    {p.version.score !== null && (
                      <>
                        {' ('}
                        <ScorePair locale={lang}>
                          {formatNumber(lang, p.version.score.home)}–
                          {formatNumber(lang, p.version.score.away)}
                        </ScorePair>
                        )
                      </>
                    )}
                  </span>
                  <Link href={`/${locale}/match/${p.fixture.id}`} className="underline">
                    <MessageText
                      message={filled(lang, 'home.fixture', {
                        home: p.fixture.home.name,
                        away: p.fixture.away.name,
                      })}
                    />
                  </Link>
                  <span className="text-xs text-muted">
                    {formatKickoff(locale, p.fixture.kickoff_at, timeZone)}
                    {said !== null && (
                      <>
                        {' · '}
                        <Translated locale={lang} message={said} />
                      </>
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
          <p className="text-xs text-muted">
            <Translated locale={lang} message="home.friends.note" />
          </p>
        </>
      )}
    </section>
  );
}

export function GroupDiscussionsSection({
  locale,
  viewer,
  result,
}: {
  locale: string;
  viewer: string;
  result: ConversationSummary[] | null;
}) {
  const lang = localeOf(locale);
  return (
    <section className="flex flex-col gap-2" data-testid="home-group-discussions">
      <h2 className="text-lg font-semibold">
        <Translated locale={lang} message="home.groups.title" />
      </h2>
      {result === null ? (
        <p className="text-sm text-muted" data-testid="home-group-discussions-unreachable">
          <Translated locale={lang} message="home.groups.unreachable" />
        </p>
      ) : result.length === 0 ? (
        <p className="text-sm text-muted" data-testid="home-group-discussions-empty">
          <Translated locale={lang} message="home.groups.empty" />
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {result.map((conversation) => {
            const last = conversation.last_message;
            return (
              <li
                key={conversation.id}
                className="flex flex-col text-sm"
                data-testid="home-group-discussion"
              >
                <Link
                  href={`/${locale}/messages/${conversation.id}`}
                  className="font-medium underline"
                >
                  {conversationTitle(conversation, viewer, locale)}
                </Link>
                <span className="text-muted">
                  <MessageText
                    message={
                      last === null
                        ? message(lang, 'home.groups.nothingYet')
                        : last.removed !== null
                          ? message(lang, 'home.groups.removed')
                          : filled(lang, 'home.groups.last', {
                              name: memberName(locale, { username: last.author }),
                              text: excerpt(last.body ?? message(lang, 'home.groups.card').text),
                            })
                    }
                  />
                  {conversation.unread > 0 && (
                    <>
                      {' · '}
                      <MessageText
                        message={plural(lang, 'home.groups.unread', conversation.unread)}
                      />
                    </>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

export function PanelsSection({
  locale,
  panels,
  cards,
}: {
  locale: string;
  /** `null` when the request failed. Already chosen by `homePanels`. */
  panels: PanelLatest[] | null;
  cards: Map<string, ScoreCard>;
}) {
  const lang = localeOf(locale);
  return (
    <section className="flex flex-col gap-2" data-testid="home-panels">
      <h2 className="text-lg font-semibold">
        <Translated locale={lang} message="home.panels.title" />
      </h2>
      {panels === null ? (
        <p className="text-sm text-muted" data-testid="home-panels-unreachable">
          <Translated locale={lang} message="home.panels.unreachable" />
        </p>
      ) : panels.length === 0 ? (
        <p className="text-sm text-muted" data-testid="home-panels-empty">
          <Translated locale={lang} message="home.panels.empty" />
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {panels.map((panel) => {
            const card = cards.get(panel.fixture_id);
            return (
              <li key={panel.fixture_id} className="flex flex-col gap-1" data-testid="home-panel">
                <Link href={`/${locale}/match/${panel.fixture_id}`} className="underline">
                  <MessageText
                    message={
                      card === undefined
                        ? message(lang, 'home.panels.theMatch')
                        : filled(lang, 'home.fixture', {
                            home: card.home.name,
                            away: card.away.name,
                          })
                    }
                  />
                </Link>
                <ul className="flex flex-col gap-1 ps-3">
                  {panel.posts.map((post) => (
                    <li key={post.id} className="text-sm">
                      <MemberName locale={locale} member={post.author} className="font-medium" />
                      {/* A deleted author keeps the post and loses the name and the standing (D-094). */}
                      {!isDeletedMember(post.author.username) && (
                        <>
                          {' '}
                          <MessageText
                            className="text-xs text-muted"
                            message={filled(
                              lang,
                              post.author.approved
                                ? 'home.panels.standing'
                                : 'home.panels.standingFormer',
                              {
                                standing:
                                  post.author.tier === null || post.author.rating === null
                                    ? message(lang, 'home.panels.notRated').text
                                    : filled(lang, 'home.panels.tierRating', {
                                        tier: message(lang, TIER_LABEL[post.author.tier]).text,
                                        rating: digits(lang, post.author.rating),
                                      }).text,
                              },
                            )}
                          />
                        </>
                      )}
                      : {excerpt(post.body ?? '')}
                    </li>
                  ))}
                </ul>
                {panel.total > panel.posts.length && (
                  <MessageText
                    className="text-xs text-muted"
                    message={plural(lang, 'home.panels.total', panel.total)}
                  />
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
