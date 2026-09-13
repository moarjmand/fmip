import { BadRequestException, Controller, Get, Query } from '@nestjs/common';
import { type ApiError, type ConsensusListResponse, MAX_CONSENSUS_FIXTURES } from '@fmip/contracts';
import { ConsensusService } from './consensus.service';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * `GET /consensus?fixtures=<id>,<id>` (T-136).
 *
 * The community consensus for several fixtures at once, so a page showing a
 * day's matches asks once instead of once per match.
 *
 * **Its own endpoint rather than a combined one.** The obvious shortcut is a
 * single "predictions overview" route returning the model's forecast and the
 * consensus together, and it is the shortcut rule 6 exists to prevent: one
 * payload holding two products is one refactor away from one payload holding a
 * `source` field. Each product answers for itself, and the page composes them.
 */
@Controller('consensus')
export class ConsensusListController {
  constructor(private readonly consensus: ConsensusService) {}

  @Get()
  async list(@Query('fixtures') fixtures?: string): Promise<ConsensusListResponse> {
    return { fixtures: await this.consensus.forFixtures(parseFixtures(fixtures)) };
  }
}

/**
 * The `fixtures` parameter, or a 400 saying exactly what was wrong.
 *
 * A bad id is rejected rather than skipped. Silently dropping it would answer
 * a question nobody asked — a caller with one typo would get a shorter list and
 * no indication which match is missing from it.
 */
export function parseFixtures(raw: string | undefined): string[] {
  const ids = (raw ?? '')
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part !== '');

  if (ids.length > MAX_CONSENSUS_FIXTURES) {
    // `validation` is the existing kind for a malformed request; widening the
    // union for one endpoint's two cases would cost every client a new branch.
    const error: ApiError = {
      error: 'validation',
      message: `Ask about at most ${MAX_CONSENSUS_FIXTURES} fixtures at a time.`,
    };
    throw new BadRequestException(error);
  }
  const bad = ids.find((id) => !UUID.test(id));
  if (bad !== undefined) {
    const error: ApiError = {
      error: 'validation',
      message: `"${bad}" is not a fixture id.`,
    };
    throw new BadRequestException(error);
  }
  // Duplicates collapse: asking twice about one match is one question.
  return [...new Set(ids)];
}
