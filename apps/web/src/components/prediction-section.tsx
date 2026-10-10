import {
  MAX_REASON_TAGS,
  PREDICTION_REASON_TAGS,
  type AuthUser,
  type MatchHeader,
  type Prediction,
  type PredictionReasonTag,
} from '@fmip/contracts';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { PredictionForm, type PredictionFormWords } from '@/components/prediction-form';
import { Translated } from '@/components/translated';
import { ScorePair } from '@/components/score';
import { type Locale } from '@/i18n/locales';
import { attribute, interpolate, message, t } from '@/i18n/messages';
import { canonicalUrl } from '@/lib/seo';
import { isLocked } from '@/lib/prediction-form';
import {
  REASON_TAG_KEY,
  asLocale,
  confidenceText,
  listText,
  matchTitle,
  plainNumber,
  richMessage,
  scoreText,
  utcStamp,
} from '@/lib/prediction-text';
import { submitPredictionAction } from '@/lib/prediction-actions';

/**
 * "Your prediction" on the match centre (T-050). Guests are told to sign in;
 * a member with an unverified e-mail is told to verify; after kick-off the
 * final version is shown read-only with its time (blueprint 6.6). The
 * community distribution and settlement arrive with E5's later tasks.
 */
export function PredictionSection({
  locale,
  fixture,
  me,
  current,
}: {
  locale: string;
  fixture: MatchHeader;
  me: AuthUser | null;
  current: Prediction | null;
}) {
  const l = asLocale(locale);
  const locked = current?.locked ?? isLocked(fixture.kickoff_at);

  return (
    <section className="flex flex-col gap-2" data-testid="prediction">
      <h2 className="text-lg font-semibold">
        <Translated locale={l} message="predictions.section.title" />
        <span className="ms-2 text-xs font-normal uppercase text-muted">
          <Translated
            locale={l}
            message={locked ? 'predictions.section.locked' : 'predictions.section.open'}
          />
        </span>
      </h2>

      {me === null ? (
        <p className="text-sm" data-testid="prediction-guest">
          {richMessage(message(l, 'predictions.section.guest'), {
            signIn: (
              <Link href={`/${locale}/login`} className="underline">
                <Translated locale={l} message="predictions.section.signIn" />
              </Link>
            ),
          })}
        </p>
      ) : locked ? (
        current === null ? (
          <p className="text-sm text-muted" data-testid="prediction-none">
            <Translated locale={l} message="predictions.section.none" />
          </p>
        ) : (
          <Final
            locale={l}
            prediction={current}
            home={fixture.home.name}
            away={fixture.away.name}
          />
        )
      ) : (
        <>
          {!me.email_verified && (
            <p className="text-sm" role="status">
              <Translated locale={l} message="predictions.section.verify" />
            </p>
          )}
          <PredictionForm
            action={submitPredictionAction.bind(null, locale, fixture.id)}
            current={current}
            home={fixture.home.name}
            away={fixture.away.name}
            shareUrl={canonicalUrl(locale, `/match/${fixture.id}`)}
            words={formWords(l, fixture.home.name, fixture.away.name, current)}
          />
        </>
      )}
      <p className="text-xs text-muted">
        <Translated locale={l} message="predictions.section.note" />
      </p>
    </section>
  );
}

/** The form's words, resolved here so the catalogues stay on the server (T-1040). */
function formWords(
  locale: Locale,
  home: string,
  away: string,
  current: Prediction | null,
): PredictionFormWords {
  const goals = (team: string): { text: string; lang?: string } => {
    const { text, lang } = attribute(locale, 'predictions.form.goals');
    return { text: interpolate(text, { team }), ...(lang === undefined ? {} : { lang }) };
  };
  const latest = current?.latest ?? null;
  const reasonTags = Object.fromEntries(
    PREDICTION_REASON_TAGS.map((tag) => [
      tag,
      <Translated key={tag} locale={locale} message={REASON_TAG_KEY[tag]} />,
    ]),
  ) as Record<PredictionReasonTag, ReactNode>;
  return {
    call: <Translated locale={locale} message="predictions.form.call" />,
    draw: <Translated locale={locale} message="predictions.outcome.draw" />,
    score: <Translated locale={locale} message="predictions.form.score" />,
    homeGoals: goals(home),
    awayGoals: goals(away),
    confidence: <Translated locale={locale} message="predictions.form.confidence" />,
    confidenceOptions: [1, 2, 3, 4, 5].map((n) => plainNumber(locale, n)),
    reasons: (
      <Translated locale={locale} message="predictions.form.reasons" count={MAX_REASON_TAGS} />
    ),
    reasonTags,
    why: <Translated locale={locale} message="predictions.form.why" />,
    submit: <Translated locale={locale} message="predictions.form.submit" />,
    update: <Translated locale={locale} message="predictions.form.update" />,
    version:
      latest === null
        ? null
        : richMessage(
            {
              ...message(locale, 'predictions.form.version'),
              text: interpolate(t(locale, 'predictions.form.version'), {
                version: plainNumber(locale, latest.version_number),
              }),
            },
            {
              time: (
                <time dateTime={latest.submitted_at}>{utcStamp(locale, latest.submitted_at)}</time>
              ),
            },
          ),
    share: <Translated locale={locale} message="predictions.form.share" />,
    shareTitle: matchTitle(locale, home, away),
    shareMessages: {
      copied: message(locale, 'share.copied'),
      manual: message(locale, 'share.manual'),
    },
  };
}

function Final({
  locale,
  prediction,
  home,
  away,
}: {
  locale: Locale;
  prediction: Prediction;
  home: string;
  away: string;
}) {
  const v = prediction.latest;
  return (
    <div className="flex flex-col gap-1 text-sm" data-testid="prediction-final">
      <p>
        <span className="font-medium">
          {v.outcome === 'home' ? (
            home
          ) : v.outcome === 'away' ? (
            away
          ) : (
            <Translated locale={locale} message="predictions.outcome.draw" />
          )}
        </span>
        {v.score !== null ? (
          <>
            {' · '}
            <ScorePair locale={locale} testId="prediction-score">
              {scoreText(locale, v.score.home, v.score.away)}
            </ScorePair>
          </>
        ) : (
          ''
        )}{' '}
        · {confidenceText(locale, v.confidence)}
      </p>
      {v.reason_tags.length > 0 && (
        <p className="text-xs text-muted">
          {listText(
            locale,
            v.reason_tags.map((tag) => t(locale, REASON_TAG_KEY[tag])),
          )}
        </p>
      )}
      {v.explanation !== null && <p className="text-xs">{v.explanation}</p>}
      <p className="text-xs text-muted">
        {richMessage(
          {
            ...message(locale, 'predictions.section.final'),
            text: interpolate(t(locale, 'predictions.section.final'), {
              version: plainNumber(locale, v.version_number),
              total: plainNumber(locale, prediction.versions.length),
            }),
          },
          {
            time: <time dateTime={v.submitted_at}>{utcStamp(locale, v.submitted_at)}</time>,
          },
        )}
      </p>
    </div>
  );
}
