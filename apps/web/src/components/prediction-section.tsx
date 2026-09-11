import type { AuthUser, MatchHeader, Prediction } from '@fmip/contracts';
import Link from 'next/link';
import { PredictionForm } from '@/components/prediction-form';
import { OUTCOME_LABEL, REASON_TAG_LABEL, isLocked } from '@/lib/prediction-form';
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
  const locked = current?.locked ?? isLocked(fixture.kickoff_at);

  return (
    <section className="flex flex-col gap-2" data-testid="prediction">
      <h2 className="text-lg font-semibold">
        Your prediction
        <span className="ms-2 text-xs font-normal uppercase opacity-60">
          {locked ? 'locked at kick-off' : 'open until kick-off'}
        </span>
      </h2>

      {me === null ? (
        <p className="text-sm" data-testid="prediction-guest">
          <Link href={`/${locale}/login`} className="underline">
            Sign in
          </Link>{' '}
          to predict this match. Predictions need a verified account and lock at kick-off.
        </p>
      ) : locked ? (
        current === null ? (
          <p className="text-sm opacity-70" data-testid="prediction-none">
            You did not predict this match before kick-off.
          </p>
        ) : (
          <Final prediction={current} home={fixture.home.name} away={fixture.away.name} />
        )
      ) : (
        <>
          {!me.email_verified && (
            <p className="text-sm" role="status">
              Verify your e-mail address before predicting; the link is in your inbox.
            </p>
          )}
          <PredictionForm
            action={submitPredictionAction.bind(null, locale, fixture.id)}
            current={current}
            home={fixture.home.name}
            away={fixture.away.name}
          />
        </>
      )}
      <p className="text-xs opacity-60">
        Community distribution and settlement arrive with the predictions release (E5); your
        prediction is never blended with the model forecast (rule 6).
      </p>
    </section>
  );
}

function Final({ prediction, home, away }: { prediction: Prediction; home: string; away: string }) {
  const v = prediction.latest;
  return (
    <div className="flex flex-col gap-1 text-sm" data-testid="prediction-final">
      <p>
        <span className="font-medium">
          {v.outcome === 'home' ? home : v.outcome === 'away' ? away : OUTCOME_LABEL.draw}
        </span>
        {v.score !== null ? ` · ${v.score.home}–${v.score.away}` : ''} · confidence {v.confidence}/5
      </p>
      {v.reason_tags.length > 0 && (
        <p className="text-xs opacity-70">
          {v.reason_tags.map((t) => REASON_TAG_LABEL[t]).join(', ')}
        </p>
      )}
      {v.explanation !== null && <p className="text-xs">{v.explanation}</p>}
      <p className="text-xs opacity-70">
        Final version {v.version_number} of {prediction.versions.length}, submitted{' '}
        <time dateTime={v.submitted_at}>{v.submitted_at.slice(0, 16).replace('T', ' ')}</time> UTC.
        Settlement arrives with T-052.
      </p>
    </div>
  );
}
