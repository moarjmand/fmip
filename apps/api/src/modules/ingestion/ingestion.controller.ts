import { Controller, Get } from '@nestjs/common';
import type { IngestionHealth } from '@fmip/contracts';
import { IngestRunsService } from './ingest-runs.service';

/**
 * `GET /health/ingestion` (T-071): the newest ingest runs, the last failure
 * and the failure count of the last day, read from `ingest_run` — so an
 * ingest failure is visible without SSH. Public and read-only; `GET /health`
 * itself stays liveness-only.
 */
@Controller('health')
export class IngestionController {
  constructor(private readonly runs: IngestRunsService) {}

  @Get('ingestion')
  ingestion(): Promise<IngestionHealth> {
    return this.runs.ingestionHealth(new Date());
  }
}
