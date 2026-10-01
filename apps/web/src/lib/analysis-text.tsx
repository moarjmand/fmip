import type { CommunityAnalysisWorkspace } from '@fmip/contracts';
import type { AnalysisEditorWords } from '@/components/analysis-editor';
import { Translated } from '@/components/translated';
import type { Locale } from '@/i18n/locales';
import { type MessageKey, interpolate, message, t } from '@/i18n/messages';
import { OUTCOME_KEY, plainNumber, rawStamp, richMessage } from './prediction-text';

/**
 * The analyst's editor's words, resolved on the server in the reader's
 * language (T-1307), because the editor is a client component and the
 * catalogues never reach the browser (T-1040).
 */

/** Keyed by the contract's union, so a state added without words does not compile. */
const STATE_KEY: Record<CommunityAnalysisWorkspace['state'], MessageKey> = {
  draft: 'analysis.state.draft',
  submitted: 'analysis.state.submitted',
  approved: 'analysis.state.approved',
  changes_requested: 'analysis.state.changesRequested',
  rejected: 'analysis.state.rejected',
  published: 'analysis.state.published',
};

const DECISION_KEY: Record<string, MessageKey> = {
  approved: 'analysis.decision.approved',
  changes_requested: 'analysis.decision.changesRequested',
  rejected: 'analysis.decision.rejected',
};

/** A sentence with values filled, keeping whether it is English standing in. */
function filled(locale: Locale, key: MessageKey, params: Record<string, string>) {
  return richMessage({ ...message(locale, key), text: interpolate(t(locale, key), params) }, {});
}

export function analysisEditorWords(
  locale: Locale,
  workspace: CommunityAnalysisWorkspace | null,
): AnalysisEditorWords {
  const says = (key: MessageKey) => <Translated locale={locale} message={key} />;
  const states = Object.fromEntries(
    Object.entries(STATE_KEY).map(([state, key]) => [state, says(key)]),
  ) as AnalysisEditorWords['states'];

  const attempts: AnalysisEditorWords['attempts'] = {};
  for (const submission of workspace?.submissions ?? []) {
    const review = submission.review;
    const decisionKey = review === null ? undefined : DECISION_KEY[review.decision];
    attempts[submission.id] = {
      title: filled(locale, 'analysis.editor.attempt', {
        attempt: plainNumber(locale, submission.attempt),
      }),
      at: rawStamp(locale, submission.submitted_at),
      decided:
        review === null
          ? null
          : filled(locale, 'analysis.editor.decidedBy', {
              decision: decisionKey === undefined ? review.decision : t(locale, decisionKey),
              reviewer: review.reviewer,
            }),
    };
  }

  const versions: AnalysisEditorWords['versions'] = {};
  for (const version of workspace?.versions ?? []) {
    versions[version.id] = {
      title: filled(locale, 'analysis.editor.version', {
        version: plainNumber(locale, version.version_number),
      }),
      at: rawStamp(locale, version.published_at),
    };
  }

  return {
    states,
    attempts,
    versions,
    waiting: says('analysis.state.submitted'),
    call: says('predictions.form.call'),
    outcomes: {
      home: t(locale, OUTCOME_KEY.home),
      draw: t(locale, OUTCOME_KEY.draw),
      away: t(locale, OUTCOME_KEY.away),
    },
    homeGoals: says('analysis.editor.homeGoals'),
    awayGoals: says('analysis.editor.awayGoals'),
    confidence: says('analysis.editor.confidence'),
    reasoning: says('analysis.editor.reasoning'),
    reasoningHint: says('analysis.editor.reasoningHint'),
    lineup: says('analysis.editor.lineup'),
    keyPlayers: says('analysis.editor.keyPlayers'),
    form: says('analysis.editor.form'),
    saving: says('analysis.editor.saving'),
    save: says('analysis.editor.save'),
    sending: says('analysis.editor.sending'),
    submit: says('analysis.editor.submit'),
    history: says('analysis.editor.history'),
    published: says('analysis.editor.published'),
    saved: says('analysis.action.saved'),
    sent: says('analysis.action.sent'),
  };
}
