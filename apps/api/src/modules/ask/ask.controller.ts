import { BadRequestException, Controller, Get, Query } from '@nestjs/common';
import type { ApiError, AskResponse } from '@fmip/contracts';
import { AskService } from './ask.service';

const MIN_LENGTH = 2;
const MAX_LENGTH = 200;

/** `GET /ask?q=` (T-421): a question, read by the model when there is one, answered by the search. Public. */
@Controller()
export class AskController {
  constructor(private readonly ask: AskService) {}

  @Get('ask')
  async find(@Query('q') q: unknown): Promise<AskResponse> {
    const question = typeof q === 'string' ? q.trim() : '';
    if (question.length < MIN_LENGTH || question.length > MAX_LENGTH) {
      throw new BadRequestException({
        error: 'validation',
        message: `q must be between ${MIN_LENGTH} and ${MAX_LENGTH} characters.`,
      } satisfies ApiError);
    }
    return this.ask.ask(question);
  }
}
