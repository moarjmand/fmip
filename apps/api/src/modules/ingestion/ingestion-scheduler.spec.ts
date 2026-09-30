import { describe, expect, it, vi } from 'vitest';
import type { ForecastTriggersService } from '../forecast/forecast-triggers.service';
import type { FailureCountsService } from '../failure-counts/failure-counts.service';
import type { IngestionJobsService } from './ingestion-jobs.service';
import { FORECAST_JOB, IngestionSchedulerService } from './ingestion-scheduler.service';

function scheduler() {
  const report = { considered: 3, computed: { early: 2 }, indexes: 4, skipped: {} };
  const jobs = { run: vi.fn().mockResolvedValue({ job: 'fixtures' }) };
  const forecasts = { runDue: vi.fn().mockResolvedValue(report) };
  const service = new IngestionSchedulerService(
    jobs as unknown as IngestionJobsService,
    forecasts as unknown as ForecastTriggersService,
    {} as FailureCountsService,
  );
  return { service, jobs, forecasts, report };
}

describe('IngestionSchedulerService.dispatch', () => {
  it('sends the forecast tick to the forecast triggers, not to the ingestion jobs', async () => {
    const { service, jobs, forecasts, report } = scheduler();
    await expect(service.dispatch(FORECAST_JOB)).resolves.toEqual(report);
    expect(forecasts.runDue).toHaveBeenCalledOnce();
    expect(jobs.run).not.toHaveBeenCalled();
  });

  it('sends an ingestion job to the ingestion jobs', async () => {
    const { service, jobs, forecasts } = scheduler();
    await service.dispatch('fixtures');
    expect(jobs.run).toHaveBeenCalledWith('fixtures');
    expect(forecasts.runDue).not.toHaveBeenCalled();
  });

  it('refuses a name it does not know rather than succeeding silently', async () => {
    const { service, jobs, forecasts } = scheduler();
    await expect(service.dispatch('nothing-by-this-name')).rejects.toThrow(/unknown scheduled job/);
    expect(jobs.run).not.toHaveBeenCalled();
    expect(forecasts.runDue).not.toHaveBeenCalled();
  });
});
