import { BadRequestException, Controller, Get, Query } from '@nestjs/common';
import type { ApiError, ModelUpsetResponse } from '@fmip/contracts';
import { ModelUpsetService, parseUpsetQuery } from './model-upset.service';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

@Controller()
export class ModelUpsetController {
  constructor(private readonly upsets: ModelUpsetService) {}

  /**
   * The day's finished match whose result the statistical model rated least
   * likely (T-1507, D-265), or `not_supplied` with why. Public.
   * `?date=YYYY-MM-DD&tz=Area/City`, both optional: today in UTC by default.
   */
  @Get('model/upset')
  async upset(@Query() query: unknown): Promise<ModelUpsetResponse> {
    const parsed = parseUpsetQuery(isRecord(query) ? query : {}, new Date());
    if (!parsed.ok) {
      const error: ApiError = {
        error: 'validation',
        message: 'The request is not valid.',
        fields: parsed.fields,
      };
      throw new BadRequestException(error);
    }
    return this.upsets.forDay(parsed.day);
  }
}
