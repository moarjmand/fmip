import { describe, expect, it } from 'vitest';
import { OTHER_CODE_RULES, otherCodeOf } from './other-code';

/**
 * Items about another code of football (T-1400, D-215). Every title and
 * description below is one GNews brought to production's English news page
 * (stored 2026-10-10..11, or answered to a read-only check on 2026-10-12),
 * descriptions abridged with "..."; the few written for the spec say so.
 */
describe('otherCodeOf', () => {
  it.each([
    [
      'Bills rule out Ed Oliver, Joshua Palmer, wait on WR DJ Moore',
      'Bills wide receiver DJ Moore returned to practice in a noncontact jersey ...',
      'american_football',
    ],
    [
      'Kaneland racks up 487 yards of offense, 59-14 victory at Ottawa',
      'Kaneland football tallied 487 yards ... while Pirates QB Sully McConnaughhay set a pair of new team passing records.',
      'american_football',
    ],
    [
      'Falcons EDGE ruled out vs. Ravens in Week 5',
      "Falcons downgrade EDGE Za'Darius Smith for Sunday Night Football game vs. Ravens",
      'american_football',
    ],
    [
      'Baltimore Ravens defeat Atlanta Falcons 30-23 in overtime on Sunday Night Football',
      'The Baltimore Ravens rallied ... overcoming the absence of star quarterback Lamar Jackson',
      'american_football',
    ],
    ['Most Underrated College Football Teams in Week 6 AP Poll', null, 'american_football'],
    [
      'Dallas-area Texas high school football players to watch in Week 8',
      'Southlake Carroll QB Hudson Tomcheck will suit up this week',
      'american_football',
    ],
    [
      'UCLA Bruins upset Oregon Ducks to stay unbeaten and change the Big Ten championship picture',
      null,
      'american_football',
    ],
    [
      'Nemo Rangers v Carrigaline streaming and TV information for Cork Senior Football Championship semi',
      null,
      'gaelic_games',
    ],
    ['All-Ireland winner O’Connor announces Mayo retirement', null, 'gaelic_games'],
    ['England name Rugby League World Cup squad', null, 'rugby_league'],
    // T-1619 (D-290): rugby union, from Yahoo Sports' soccer feed on 2026-10-26.
    [
      'Ireland prop Furlong cited over alleged groin grab',
      "Ireland prop Tadhg Furlong is cited over an alleged groin grab in Leinster's United Rugby Championship win over Munster on Saturday.",
      'rugby_union',
    ],
    ['Wales fly-half ruled out of the Six Nations opener', null, 'rugby_union'],
    // T-1411 (D-217): the stored items that named no other code before.
    [
      'Iowa Hawkeyes football is now 5-1 and can dream a little',
      "The Hawkeyes' 41-24 pasting of Washington reminded the Register's Chad Leistikow ...",
      'american_football',
    ],
    [
      'How to watch Florida football vs South Carolina today, TV channel, streaming',
      null,
      'american_football',
    ],
    ['Takeaways from Iowa State football’s loss to No. 8 BYU', null, 'american_football'],
    ['Grading Penn State football after White Out record loss to USC', null, 'american_football'],
    ['20 Notes To Remember From FSU Football’s 44', null, 'american_football'],
    [
      'Live updates: Kalen DeBoer speaks after Alabama’s Georgia loss',
      'Alabama football lost 20-17 against Georgia.',
      'american_football',
    ],
    ['Tennessee vs. Arkansas: 3 Speed Threats the Vols Must Contain', null, 'american_football'],
    [
      'Adam Carriker’s Gut Reaction to a Heartbreaking Husker Loss to the Hoosiers',
      null,
      'american_football',
    ],
    ['Marshfield High football defeats Silver Lake', null, 'american_football'],
    [
      'Staten Island HS sports notebook: Tots girls’ swimmers continue to roll; Farrell, Curtis JV football post wins',
      null,
      'american_football',
    ],
    [
      'Georgia Tech scores in final minute, Duke misses late FG in Jackets win',
      null,
      'american_football',
    ],
  ])('%s -> %s', (headline, summary, code) => {
    expect(otherCodeOf(headline, summary)).toBe(code);
  });

  it.each([
    // Association football, in UK and in American words.
    [
      'Jamie Carragher fumes Man City ‘kidding’ football after Haaland hails ‘mental battle’ Anfield win',
      null,
    ],
    ['St. Louis ties MLS record with win over Galaxy', 'Carlo Holse had a hat trick'],
    [
      'Football truth clear for Dan Friedkin as key reason for Everton sale decision identified',
      null,
    ],
    // A high-school round-up that says soccer stays, whatever else it lists.
    ['Top Performances of the Week in Bucks County soccer, field hockey, golf', null],
    ['Stream St. Ignatius vs. Dublin Jerome OHSAA boys soccer on NFHS today', null],
    // Words both codes use are not markers (the first and third stood on
    // production; the others are written for the spec).
    ['Premier League panel backs controversial Elliot Anderson handball decision', null],
    ['Rice leads the league for interceptions as Arsenal go top', null],
    [
      'Premier League predictions & Jones Knows’ best bets: Coventry to give Newcastle stern test on MNF',
      null,
    ],
    ['Fantasy Premier League: the best captain picks for Gameweek 8', null],
    // An acronym in capitals only: "sec" and "td" in words do not count.
    ['Haaland scores 8 secs into the second half', null],
    // A rugby ball is not rugby: stored from three feeds on 2026-10-19.
    [
      'Brentford contact police after rugby ball kicked into stadium from high-rise flat during Liverpool match',
      null,
    ],
    ['Rugby Town hold Coventry Sphinx in the FA Vase', null],
    // T-1411: a college's name is a marker only directly before "football",
    // and the places that are also national teams or clubs' cities are not
    // colleges here (the first stood on production, the others are written
    // for the spec).
    ['Wales football star’s brother quits at 22 in crushing news after diagnosis', null],
    ['Georgia football team stun Spain in Tbilisi', null],
    ['Miami football fans pack the stadium for Messi’s farewell', null],
    ['Indian football keeps finding hope at the U-17 World Cup', null],
    ['Florida is the best place to watch the World Cup', null],
    ['Arsenal hand a debut to their prep academy graduate', null],
    ['A high football lands on the bar as Wolves hold Spurs', null],
  ])('%s is association football', (headline, summary) => {
    expect(otherCodeOf(headline, summary)).toBeNull();
  });

  it('compiles every rule', () => {
    for (const rule of OTHER_CODE_RULES) {
      expect(() => new RegExp(rule.pattern)).not.toThrow();
    }
  });
});
