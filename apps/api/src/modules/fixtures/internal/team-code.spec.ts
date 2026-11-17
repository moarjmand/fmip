import { describe, expect, it } from 'vitest';
import { teamCodeSql } from './team-code';

// The rows themselves are checked against Postgres in scores.http.spec.ts
// (France and Türkiye with no code of their own read FRA and TUR).
describe('teamCodeSql (T-1858)', () => {
  it("keeps the team's own code first", () => {
    expect(teamCodeSql('th')).toMatch(/^COALESCE\(th\.code,/);
  });

  it("reads the country's FIFA code through the team's country id, for a national team only", () => {
    const sql = teamCodeSql('ta');
    expect(sql).toContain('tc.id = ta.country_id');
    expect(sql).toContain("ta.kind = 'national'");
    // Never a name (rule 1).
    expect(sql).not.toMatch(/\bname\b/);
  });

  it('takes only a table alias', () => {
    expect(() => teamCodeSql('th; DROP TABLE team')).toThrow(/not a table alias/);
    expect(() => teamCodeSql('Th')).toThrow(/not a table alias/);
  });
});
