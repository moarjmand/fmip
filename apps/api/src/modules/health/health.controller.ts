import { Controller, Get } from '@nestjs/common';
import type { HealthReport } from '@fmip/contracts';
import { HealthService } from './health.service';

@Controller('health')
export class HealthController {
  constructor(private readonly health: HealthService) {}

  @Get()
  get(): HealthReport {
    return this.health.report();
  }
}
