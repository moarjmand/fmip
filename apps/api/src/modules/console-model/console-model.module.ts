import { Module } from '@nestjs/common';
import { AgentsConsoleModule } from '../agents-console/agents-console.module';
import { ForecastModule } from '../forecast/forecast.module';
import { ConsoleModelController } from './console-model.controller';

/**
 * The agents console's forecast-model page (T-1729, D-355), apart from the
 * console's own module so that the console's command-line tool, which
 * imports that module, does not need the model service. Owns no table: the
 * session is the console's public `ConsoleSessions`, the figures the forecast
 * module's public `EvaluationService` and `ForecastService`.
 */
@Module({
  imports: [AgentsConsoleModule, ForecastModule],
  controllers: [ConsoleModelController],
})
export class ConsoleModelModule {}
