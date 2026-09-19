import { Module } from '@nestjs/common';
import { IntelligenceModule } from '../intelligence/intelligence.module';
import { SearchModule } from '../search/search.module';
import { AskController } from './ask.controller';
import { AskService } from './ask.service';

/**
 * Natural-language search (E42): the search module's public service behind
 * a reading the intelligence port may or may not be able to give. Nothing
 * imports it; the search page calls `/ask` and gets the search's own rows
 * either way.
 */
@Module({
  imports: [SearchModule, IntelligenceModule],
  controllers: [AskController],
  providers: [AskService],
})
export class AskModule {}
