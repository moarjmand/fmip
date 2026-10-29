import { Injectable } from '@nestjs/common';
import { PostgresFeatureStore } from './internal/feature-store';

/**
 * The homepage module's public surface for other boundaries (T-1641): which
 * matches an editor features now (T-1161, D-153), the same features
 * `GET /featured-matches` lists, so the moments' big one (D-299) ranks a
 * featured match as the homepage's hero does. Read-only.
 */
@Injectable()
export class HomepageFeatureService {
  constructor(private readonly store: PostgresFeatureStore) {}

  /** The fixture ids featured now, newest feature first. */
  async featuredFixtureIds(): Promise<string[]> {
    return (await this.store.live()).map((row) => row.fixture_id);
  }
}
