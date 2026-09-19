import { Controller, Get, Module } from '@nestjs/common';
import type { IntelligenceHealth } from '@fmip/contracts';
import { AnthropicModel } from './internal/anthropic-model';
import { ChatCompletionsModel } from './internal/chat-completions-model';
import {
  AbsentIntelligence,
  type Intelligence,
  LANGUAGE_MODEL,
  settingsFromEnv,
} from './intelligence.port';
import { IntelligenceService } from './intelligence.service';

/**
 * `GET /health/intelligence` (T-401): whether this deployment has a language
 * model to drive. `absent: true` is the normal state of a new deployment and
 * is reported as a fact, not hidden behind `status: ok`.
 */
@Controller()
export class IntelligenceHealthController {
  constructor(private readonly intelligence: IntelligenceService) {}

  @Get('health/intelligence')
  health(): IntelligenceHealth {
    return this.intelligence.describe();
  }
}

/**
 * The intelligence boundary (Phase 5, D-070): one port, a provider behind it
 * chosen at deployment. Imports nothing, so any module of this phase can
 * import it without a cycle; the settings are read from the environment once,
 * and a name this build cannot drive -- or can drive but has no key for --
 * stops the process at boot.
 */
@Module({
  controllers: [IntelligenceHealthController],
  providers: [
    IntelligenceService,
    {
      provide: LANGUAGE_MODEL,
      useFactory: (): Intelligence => {
        const settings = settingsFromEnv();
        if (settings === null) return new AbsentIntelligence();
        if (settings.provider === 'anthropic')
          return { model: AnthropicModel.fromSettings(settings) };
        return { model: ChatCompletionsModel.fromSettings(settings) };
      },
    },
  ],
  exports: [IntelligenceService],
})
export class IntelligenceModule {}
