import { Injectable } from '@nestjs/common';
import type { ModelUpsetResponse } from '@fmip/contracts';
import { PostgresUpsetStore } from './internal/upset-store';
import { type UpsetDay, upsetResponse } from './internal/upset';

// The module's public surface. Other modules import from this file only.
export { parseUpsetQuery, type ParsedUpsetQuery, type UpsetDay } from './internal/upset';

/**
 * The statistical model's biggest miss of a day (T-1507, D-265): the
 * finished match whose result its last pre-kick-off forecast rated least
 * likely, among competitions with full coverage. Read-only.
 */
@Injectable()
export class ModelUpsetService {
  constructor(private readonly store: PostgresUpsetStore) {}

  async forDay(day: UpsetDay): Promise<ModelUpsetResponse> {
    return upsetResponse(day, await this.store.day(day));
  }
}
