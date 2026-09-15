import { Injectable } from '@nestjs/common';
import type {
  CommunityAnalysesResponse,
  CommunityAnalysisContent,
  CommunityAnalysisState,
  CommunityAnalysisVersion,
  CommunityAnalysisWorkspace,
  CommunityConfidence,
  CommunityOutcome,
  CommunitySubmission,
} from '@fmip/contracts';
import { NotificationsService } from '../notifications/notifications.service';
import {
  PostgresAnalysisStore,
  type ContentRow,
  type SubmissionRow,
  type VersionRow,
} from './internal/analysis-store';

/**
 * The analysis workflow: draft → submit → review → publish (blueprint 10.3,
 * T-261).
 *
 * **Every rule that could be enforced twice is enforced once, in the schema.**
 * Whether the author holds a contributor grant is `PL014`; whether the match has
 * kicked off is `PL002`; whether this submission already has a decision is a
 * primary key. This service turns each refusal into a sentence and adds none of
 * its own — a check here would be a second copy that goes stale between the
 * check and the write.
 *
 * **Approving and publishing are one act.** A reviewer saying yes is saying it
 * may be read, and a decision that recorded an approval and then failed to
 * publish would leave an analyst told yes and a public told nothing.
 */

/** No contributor grant. */
const UNAPPROVED = 'PL014';
/** The match has started. */
const TOO_LATE = 'PL002';
/** Something already exists: a second decision, a second publication. */
const DUPLICATE = '23505';

export type WorkOutcome =
  'ok' | 'not_approved' | 'kicked_off' | 'no_draft' | 'not_found' | 'already_decided';

function codeOf(error: unknown): string {
  return (error as { code?: string }).code ?? '';
}

function contentOf(row: ContentRow): CommunityAnalysisContent {
  return {
    predicted_outcome: row.predicted_outcome as CommunityOutcome,
    predicted_home: row.predicted_home,
    predicted_away: row.predicted_away,
    confidence: row.confidence as CommunityConfidence,
    reasoning: row.reasoning,
    lineup_impact: row.lineup_impact,
    key_players: row.key_players,
    form_and_context: row.form_and_context,
  };
}

function versionOf(row: VersionRow): CommunityAnalysisVersion {
  return {
    ...contentOf(row),
    id: row.id,
    version_number: row.version_number,
    published_at: row.published_at.toISOString(),
  };
}

function submissionOf(row: SubmissionRow): CommunitySubmission {
  return {
    ...contentOf(row),
    id: row.id,
    attempt: row.attempt,
    submitted_at: row.submitted_at.toISOString(),
    review:
      row.decision === null || row.reviewer === null
        ? null
        : {
            decision: row.decision as 'approved' | 'changes_requested' | 'rejected',
            reviewer: row.reviewer,
            reason: row.review_reason ?? '',
            created_at: (row.reviewed_at ?? row.submitted_at).toISOString(),
          },
  };
}

@Injectable()
export class AnalysisService {
  constructor(
    private readonly store: PostgresAnalysisStore,
    private readonly notifications: NotificationsService,
  ) {}

  /** Save the analyst's draft for one match, creating the analysis if it is their first. */
  async saveDraft(
    fixtureId: string,
    authorId: string,
    content: CommunityAnalysisContent,
  ): Promise<WorkOutcome> {
    try {
      const analysisId = await this.store.open(fixtureId, authorId);
      await this.store.saveDraft(analysisId, content as ContentRow);
      return 'ok';
    } catch (error) {
      // The grant trigger, not a check above it: a grant withdrawn between the
      // check and the write would otherwise let one through.
      if (codeOf(error) === UNAPPROVED) return 'not_approved';
      throw error;
    }
  }

  /** The analyst's own view: the draft, every attempt, every decision, every version. */
  async workspace(fixtureId: string, authorId: string): Promise<CommunityAnalysisWorkspace | null> {
    const analysisId = await this.store.mine(fixtureId, authorId);
    if (analysisId === null) return null;
    const [draft, submissions, versions, state] = await Promise.all([
      this.store.draft(analysisId),
      this.store.submissions(analysisId),
      this.store.versions(analysisId),
      this.store.state(analysisId),
    ]);
    return {
      id: analysisId,
      fixture_id: fixtureId,
      state: state as CommunityAnalysisState,
      draft: draft === null ? null : contentOf(draft),
      submissions: submissions.map(submissionOf),
      versions: versions.map(versionOf),
    };
  }

  /** Ask for the draft to be reviewed. */
  async submit(fixtureId: string, authorId: string): Promise<WorkOutcome> {
    const analysisId = await this.store.mine(fixtureId, authorId);
    if (analysisId === null) return 'not_found';
    try {
      const submitted = await this.store.submit(analysisId);
      // Nothing to submit. Said rather than treated as success, because an
      // analyst who pressed submit and was told nothing would assume it went.
      return submitted === null ? 'no_draft' : 'ok';
    } catch (error) {
      const code = codeOf(error);
      if (code === TOO_LATE) return 'kicked_off';
      // An attempt already claimed: the analyst submitted twice, and the second
      // is the one that loses.
      if (code === DUPLICATE) return 'already_decided';
      throw error;
    }
  }

  /** What a reviewer has waiting, oldest first: the longest wait is first. */
  async queue(limit: number): Promise<{ submissions: CommunitySubmission[]; authors: string[] }> {
    const rows = await this.store.queue(limit);
    return {
      submissions: rows.map(submissionOf),
      authors: rows.map((row) => row.author),
    };
  }

  /**
   * Record a decision, publishing when it is an approval.
   *
   * The analyst is told either way (T-271). A "changes requested" that arrived
   * nowhere would be an instruction nobody received, and an approval nobody
   * heard about is a publication its author learns of by accident.
   */
  async decide(
    submissionId: string,
    reviewerId: string,
    decision: 'approved' | 'changes_requested' | 'rejected',
    reason: string,
  ): Promise<WorkOutcome> {
    const submission = await this.store.submission(submissionId);
    if (submission === null) return 'not_found';
    if (submission.decision !== null) return 'already_decided';

    const owner = await this.store.authorOf(submission.analysis_id);
    try {
      await this.store.decide(submissionId, submission.analysis_id, reviewerId, decision, reason);
    } catch (error) {
      const code = codeOf(error);
      if (code === DUPLICATE) return 'already_decided';
      // Publishing after kick-off is refused, and so an approval arriving too
      // late fails as a whole rather than recording a yes nobody can act on.
      if (code === TOO_LATE) return 'kicked_off';
      throw error;
    }

    if (owner !== null) {
      await this.notifications.emit({
        userId: owner.authorId,
        kind: 'contributor_grant_changed',
        subjectType: 'fixture',
        subjectId: owner.fixtureId,
        // Sourceless, like a moderation decision and for the same reason: the
        // decision is the platform's, and naming the reviewer would hand an
        // analyst somebody to argue with. The audit row names them.
        dedupeKey: `analysis_review:${submissionId}`,
      });
    }
    return 'ok';
  }

  /** Everything published on one match, with each author's standing as it is now. */
  async published(fixtureId: string): Promise<CommunityAnalysesResponse> {
    const rows = await this.store.published(fixtureId);
    return {
      generated_at: new Date().toISOString(),
      analyses: rows.map((row) => ({
        id: row.id,
        fixture_id: row.fixture_id,
        author: {
          username: row.username,
          display_name: row.display_name,
          // Null, not zero: an analyst who has settled nothing was not rated
          // badly.
          rating: row.rating === null ? null : Number(row.rating),
          approved: row.approved,
        },
        versions: row.versions.map(versionOf),
      })),
    };
  }
}
