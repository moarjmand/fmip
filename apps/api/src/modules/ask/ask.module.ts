import { Module } from '@nestjs/common';
import { IdentityModule } from '../identity/identity.module';
import { IntelligenceModule } from '../intelligence/intelligence.module';
import { RateLimitsModule } from '../rate-limits/rate-limits.module';
import { SearchModule } from '../search/search.module';
import { AskController } from './ask.controller';
import { AskService } from './ask.service';

/**
 * Natural-language search (E42): the search module's public service behind
 * a reading the intelligence port may or may not be able to give. Nothing
 * imports it; the search page calls `/ask` and gets the search's own rows
 * either way. Identity and rate limits are here for the ceilings on the
 * model's questions (T-838): a member per account, a guest per address.
 */
@Module({
  imports: [SearchModule, IntelligenceModule, IdentityModule, RateLimitsModule],
  controllers: [AskController],
  providers: [AskService],
})
export class AskModule {}
