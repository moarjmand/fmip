# Product blueprint

> **Source.** Converted from `m1.docx`, the original product definition supplied
> to the project. Preserved as written.
>
> **Authority.** This document defines *intended product behaviour* and is the
> reference for questions about what a feature should do.
>
> It is **not** authoritative on engineering: its sections 14 (technical
> architecture) and 15 (data model) were written without software engineering
> input and are superseded by `docs/00-decisions.md` and
> `docs/02-architecture.md`. Where they conflict, those documents win.
>
> **Scope.** Its section 17 requires every workstream at launch. This was
> reviewed and rejected — see decision D-001. Current scope lives in
> `docs/01-roadmap.md`.

---

# Contents

Product definition

1. Product principles
2. Website structure and navigation
3. News and editorial content
4. Live scores and the match centre
5. Competition, team and player pages
6. The complete prediction ecosystem
7. Accounts, profiles and identity
8. Friends, groups and private chat
9. Prediction rating and reputation system
10. Exclusive groups, public match chat and community analysis
11. Watch and highlights
12. Personalisation and notifications
13. Eight-language product
14. Technical product architecture
15. Core data model
16. Administration and control centre
17. Required launch scope
18. Essential user journeys
19. Launch acceptance requirements

Final product statement

Headings remain searchable in Word and other compatible readers.

# Product definition

A multilingual football platform that combines live scores, match intelligence, news, team and player data, transparent model forecasts, the founder's match analysis, community predictions, user reputation, friendships, private groups and controlled public football discussion in one connected product.

The website is built around the match. News, statistics, predictions, conversations, viewing information, teams, competitions and players all connect to a canonical match page. A user should be able to move from a score to the confirmed line-up, from a player to his seasonal statistics, from a news story to the relevant fixture, and from a prediction to a discussion with friends without leaving the platform.

The complete product is delivered as one scope with no reduced public version. Engineering workstreams may run in parallel, but every capability defined as **required at launch** in this blueprint must be operational before the website is released publicly.

## Core product promise

- **One football identity:** each match, team, player, manager and competition has one connected page and internal identity.
- **One match journey:** before the game, during the game and after the game are handled on the same match-centre page.
- **Three distinct predictions:** the statistical model, the founder's analysis and the community forecast are always labelled and displayed separately.
- **A real football network:** registered users can predict, build a reputation, add friends, create groups and discuss matches.
- **Eight complete languages:** navigation, data labels, editorial content, notifications and account experiences work in all eight languages, including right-to-left Arabic.
- **Transparent quality:** freshness, coverage and prediction confidence are shown rather than hidden.

# 1. Product principles

## 1.1 Match-centre first

Every major function should lead into, explain or extend a football match. The match centre is the main conversion point for following a team, submitting a prediction, joining a conversation, reading analysis, viewing line-ups and finding where to watch.

## 1.2 Fast and reliable

Live scores, match incidents and line-ups must update quickly and display the last successful update. A stale status must never appear as if it is current. Performance and data accuracy take priority over decorative effects.

## 1.3 Connected data

Articles, predictions, comments, teams, players, competitions, broadcasters and match events must reference the correct internal entities. Team names alone must never be used as identifiers because names, spellings and translations can change.

## 1.4 Explainable predictions

The website must explain why its model favours a team and what changed after line-ups, injuries or other information arrived. Percentages must represent uncertainty, not certainty.

## 1.5 Reputation must be earned

User status is based on settled predictions over a meaningful sample, not follower count, posting frequency or popularity. High-rated privileges require both prediction performance and a clean conduct record.

## 1.6 Social features must remain football-focused

Friends, groups and chat exist to discuss football. Match-linked conversations should be easier to discover than generic social posts. Spam, impersonation and abusive behaviour must be reportable and manageable from the administration system.

# 2. Website structure and navigation

## 2.1 Primary navigation

- **Scores** – live matches, today's matches, the next five days, calendar and favourites.
- **News** – latest, trending, debate and following, with country, competition and team filters.
- **Competitions** – tables, groups, brackets, fixtures, results, statistics and leaders.
- **Predictions** – model forecasts, founder analysis, community consensus and prediction leaderboards.
- **Community** – friends, groups, private chats, invitations, public match discussions and community analysis.
- **Watch** – official viewing choices and official highlight destinations based on location.
- **Following** – saved teams, players, competitions, matches, articles and alerts.
- **Profile** – prediction history, rating, achievements, friends, groups, contributions and settings.

## 2.2 Global controls

- Search across teams, players, competitions, matches, articles and users.
- Language, territory and timezone selection.
- Sign in, registration and account recovery.
- Notification centre and unread counters.
- Accessibility preferences, including text scaling, contrast and reduced motion.
- Quick access to followed teams and live matches.

## 2.3 Homepage

The homepage should adapt to the user while retaining a clear global view. It contains:

- Live and upcoming matches, with favourites first.
- Lead football stories and breaking-news alerts.
- Latest, trending and debate news sections.
- Important-match model forecasts and founder analysis.
- Friends' recent predictions and active private-group discussions.
- Public match discussions from approved high-rated contributors.
- Tables and key statistics for followed competitions.
- Official viewing and highlight information for relevant matches.

Guests see globally popular content and are encouraged to select a language, territory and favourite teams. Signed-in users see a personalised version based on their explicit choices.

# 3. News and editorial content

## 3.1 News sections

- **Latest:** reverse chronological football news with a basic quality gate.
- **Trending:** stories gaining qualified views, saves, shares and discussion over a recent time window.
- **Debate:** major disputes, tactical arguments, transfers, refereeing decisions and opinion-led stories selected by editors or supported by genuine discussion signals.
- **Following:** stories related to teams, players, competitions and national teams selected by the user.

## 3.2 Filters and coverage

Users can filter by country, competition, club, national team, player, story type, language and date. Full news coverage is required for the most popular leagues, continental competitions and national teams. Other competitions receive major or important stories plus structured match content.

Story types include breaking news, transfers, injuries, suspensions, tactical analysis, match previews, match reports, interviews, opinion, data analysis and explainers.

## 3.3 Article requirements

Every article page must include:

- Headline, summary, body, author and publication time.
- Last-updated time and visible corrections where relevant.
- Links to the related match, teams, players and competition.
- Language and translation status.
- Related articles grouped around the same event.
- Save, share and follow controls.
- Relevant model forecast, founder analysis or community forecast when the article concerns a specific match.

Duplicate reports about the same event should be grouped into a story cluster. The platform should promote the strongest original article and show genuine updates rather than fill the feed with repeated versions of the same story.

# 4. Live scores and the match centre

## 4.1 Scores list

The scores area covers every fixture made available to the platform for the selected date range. Users can browse the previous day, today, the next five days and any date through a calendar.

Required filters include live, favourites, country, competition, stage, men's football, women's football, senior, youth and timezone. Matches are grouped by country and competition, while favourite teams and major fixtures can be pinned above the standard list.

Each match card shows:

- Teams, score, status and live clock.
- Competition, stage, aggregate score and leg where relevant.
- Red-card state and important live incidents.
- Venue and kick-off time in the user's timezone.
- Model forecast summary and community prediction totals where available.
- Viewing availability indicator.

## 4.2 Complete match-centre layout

- **Match header:** teams, crests, score, status, venue, referee, competition, stage, aggregate, kick-off and last data update.
- **Live timeline:** goals, assists, cards, substitutions, VAR decisions, penalties and other important incidents.
- **Statistics:** possession, shots, shots on target, expected goals where available, corners, passes, cards, goalkeeper actions and relevant advanced metrics.
- **Line-ups:** predicted line-ups with source time, followed by confirmed line-ups. After confirmation, show changes from the predicted selection.
- **Player access:** clicking any player opens his profile, current match statistics and seasonal statistics.
- **Availability:** injuries, suspensions, doubts, expected returns and data freshness.
- **Recent form:** the last five competitive matches for each team, with opponent and home/away context. Friendly matches can be viewed separately.
- **Head-to-head:** recent meetings, scorelines and venue context.
- **Competition context:** relevant table, group or bracket position, competition-only form and qualification implications.
- **Key players:** recent minutes, role, form, season output and expected availability.
- **Model forecast:** home-win, draw and away-win probabilities, projected score ranges, confidence and key explanatory factors.
- **Founder's analysis:** the founder's written prediction and football analysis for selected important or popular fixtures.
- **Community forecast:** registered-user predictions, rating-weighted consensus and comparison with the model.
- **Discussion:** friends' activity, relevant private-group threads and the controlled public match chat.
- **Watch and highlights:** official viewing choices before the match and official highlight options after it.
- **Related news:** current, entity-linked stories relevant to the match.

## 4.3 Coverage states

Not every competition has the same depth of statistics, line-ups, injuries or advanced data. Each competition and season therefore has a coverage profile. The interface displays only supported modules and uses clear labels such as **available**, **limited**, **not supplied** or **data delayed**. Empty boxes and invented values must never be used to imply coverage.

# 5. Competition, team and player pages

## 5.1 Competition page

- Competition overview and season selector.
- League table, group tables or knockout bracket.
- Full fixtures, results and calendar.
- Top goalscorers, assists, clean sheets and other statistical leaders.
- Team and player statistics with minimum-minute filters.
- Current form, historic seasons and competition news.
- Links to every participating team, player and match centre.

## 5.2 Team page

- Overview, manager, stadium and current competitions.
- Next match, previous match and full fixture/result list.
- Table or group context for each competition.
- Squad by position, shirt number, availability and minutes played.
- Team statistics split by competition, season and home/away.
- News, match analysis and prediction record.
- Follower count and community activity connected to the team.

## 5.3 Player page

- Player identity, current team, position, role, shirt number and preferred foot where available.
- Season and competition selectors.
- Appearances, starts, minutes, goals, assists, cards and goalkeeper statistics where relevant.
- Advanced statistics according to coverage.
- Recent-match log, current availability and related news.
- Comparison with other players using the same position and competition.

Every player name shown in a line-up, event, squad, statistical table or article must link to the correct player profile.

# 6. The complete prediction ecosystem

The platform contains three separate prediction products. They must never be blended into one unexplained figure.

## 6.1 Statistical model forecast

The automated model publishes home-win, draw and away-win probabilities. It also displays an explanatory **Power Index from 0 to 100** for each team. The Power Index helps users understand team strength; it is not created by adding arbitrary fixed points.

Initial Power Index components are:

- Underlying team strength: 35%.
- Recent opponent-adjusted performance: 20%.
- Expected or confirmed line-up quality: 20%.
- Venue effect: 10%.
- Rest, travel and schedule: 5%.
- Competition context: 5%.
- Managerial and team stability: 5%.

The calculation should use historical performance to validate or adjust these weights. The public display explains the leading factors, data completeness and the time of calculation.

## 6.2 Match probability model

The outcome forecast uses a time-weighted football score model based on team attack strength, defence strength, home effect, expected goals and relevant match context. It produces a matrix of possible scorelines and converts that matrix into:

- Probability of a home win.
- Probability of a draw.
- Probability of an away win.
- Most likely scorelines.
- Expected home and away goals.

The three outcome probabilities must always total 100% after rounding. A draw is predicted because its probability is strongest or materially competitive, not because two team scores fall within an arbitrary points range.

## 6.3 Model inputs

- Long-term team strength and current attack/defence ratings.
- Recent competitive form, weighted by recency and opponent quality.
- Expected and confirmed line-up strength.
- Injuries and suspensions measured against replacement quality.
- Home advantage learned by competition and team.
- Rest days, travel and fixture congestion.
- Competition format and match state, including knockout legs.
- Manager changes and team stability where they improve prediction quality.
- Data completeness and freshness.

Head-to-head results can be shown to users, but should influence the model only if historical testing proves that they add value after current team strength is considered.

## 6.4 Forecast versions

The system stores separate, permanent forecasts before each match:

- Early pre-match forecast using current availability.
- Updated forecast when predicted line-ups or new availability information arrive.
- Final pre-match forecast when official line-ups are confirmed.
- Post-match evaluation showing the result and model performance.

The match centre shows what changed between versions. For example, it may explain that a team's win probability fell after a key starter was excluded from the confirmed line-up.

## 6.5 Founder's match analysis

The founder has a dedicated editorial area for important and popular fixtures. Each entry is written and signed personally and is displayed separately from the automated model and community forecast.

Each founder analysis can contain:

- Predicted result and optional predicted score.
- Main reasoning and tactical view.
- Expected line-up impact.
- Key players and important individual battles.
- Recent form and competition context.
- Confidence level.
- Publication time and any clearly recorded update before kick-off.

Founder analysis appears on the Predictions page, the relevant match centre, the homepage for selected matches and the related team/competition feeds.

## 6.6 Registered-user predictions

Only signed-in users may submit predictions. Browsing scores, news and public discussions can remain available to guests, but a verified account is mandatory for entering a prediction and building a rating.

For each eligible match, a member submits:

- Home win, draw or away win.
- Optional exact score.
- Confidence from one to five.
- Up to three structured reason tags such as form, line-up, home advantage, injuries, tactics, fatigue or competition importance.
- Optional short explanation, subject to the account's posting permissions.

Predictions lock at kick-off. The final submitted version, timestamp and settled result remain visible in the member's history. A postponed or abandoned match is void until a valid settlement rule is applied.

Community consensus must show both the simple crowd distribution and a rating-weighted distribution. The website must not disguise community opinion as the statistical model.

# 7. Accounts, profiles and identity

## 7.1 Account creation

Registration requires a unique username, display name, verified email or approved sign-in method, password or secure identity provider, country/territory, preferred language, timezone and acceptance of the platform rules. The user can then select favourite teams, competitions, players and national teams.

## 7.2 Profile page

Every account has a football profile containing:

- Username, display name, avatar, short biography and favourite teams.
- Current prediction rating, rating tier and whether it is provisional.
- Total predictions, correct outcomes, exact scores, accuracy and recent form.
- Career points, achievements, streaks and earned privileges.
- Friends count, group memberships and community-analysis contributions.
- Recent public prediction activity according to privacy settings.
- Account status, badges and any approved contributor designation.

Users control whether their profile and prediction history are public, friends-only or private, except that predictions used in public leaderboards must display the chosen public username.

## 7.3 Account roles

| **Role** | **Core permissions** |
| --- | --- |
| Guest | Read public scores, news, statistics, viewing information and approved public discussion |
| Registered member | Predict, earn ratings, add friends, create/join groups, use private chat and react to permitted content |
| High-rated member | Become eligible for exclusive groups, additional perks and public-match contributor access |
| Approved community analyst | Draft signed match analysis for editorial approval and contribute to selected public discussions |
| Founder/editor | Publish founder analysis, manage featured matches, invite members and approve community analysis |
| Moderator/administrator | Manage reports, chat access, user sanctions, thresholds, content, matches and platform settings |

# 8. Friends, groups and private chat

## 8.1 Friends

Registered users can search for other members, send or cancel friend requests, accept or decline requests, remove friends and block users. The account must show pending requests and mutual friends according to privacy settings.

Friends can:

- View one another's predictions when permitted.
- Compare prediction records and ratings.
- Share matches, articles and player pages into a chat.
- Start a direct conversation.
- Invite one another to private groups.
- Receive optional notifications when a friend predicts an important match.

## 8.2 User-created groups

Any registered member in good standing can create a football group. A group contains:

- Name, image, description, preferred language and optional favourite club or competition.
- Public, discoverable-private or invite-only visibility.
- Owner, administrators, moderators and members.
- Group chat and match-specific discussion threads.
- Shared fixtures, articles, polls and prediction comparisons.
- Internal group leaderboard and member activity.
- Invite links, direct invitations, join requests and member removal controls.

Group owners can set membership rules, appoint moderators, pin messages, remove content and restrict who can invite new members.

## 8.3 Direct and group chat

The chat system supports one-to-one conversations, group conversations and match-linked threads. Required capabilities include:

- Real-time text messages.
- Sharing a match, article, team, player or prediction as a structured card.
- Replies, reactions, mentions and pinned messages.
- Message delivery and read state where appropriate.
- Search within a conversation.
- Mute, leave, block and report controls.
- Image or file sharing only if the platform deliberately enables and manages it; it is not required by this blueprint.

Match cards shared in chat remain live. The score and status update without replacing the original discussion context.

# 9. Prediction rating and reputation system

The reputation system needs two separate measurements so that activity is not confused with skill.

## 9.1 Performance Rating

The **Performance Rating** is a 0–100 measure of prediction quality. It is provisional until the user has at least 30 settled predictions and becomes fully eligible for privileges after at least 50 settled predictions.

The initial calculation is:

- 60% result-prediction performance, adjusted for the difficulty of the correct selection.
- 20% exact-score performance.
- 15% consistency across the most recent settled predictions.
- 5% appropriate use of confidence, rewarding confidence when correct and reducing the benefit of repeated overconfidence.

The rating uses a rolling history so it reflects current performance while retaining enough matches to prevent extreme movement. Always choosing the strongest favourite should not be enough to create an elite rating; a difficult correct prediction receives more credit than an obvious one. The exact formula and thresholds must be configurable from the administration system and tested before public release.

## 9.2 Career Points

Career Points measure participation and achievements. Members can earn points for settled predictions, correct outcomes, exact scores, useful streaks and approved analysis. Career Points never replace the Performance Rating and cannot by themselves unlock expert status.

## 9.3 Rating display

Each profile and leaderboard shows:

- Current rating and tier.
- Provisional or established status.
- Number of settled predictions.
- Overall and recent accuracy.
- Exact-score count.
- Rating change over time.
- Performance by competition.
- Highest achieved rating and current streak.

Leaderboards can be global, friends-only, group-based, monthly, seasonal, competition-specific and language-specific. Minimum-prediction filters prevent a member with one lucky result from ranking above established performers.

## 9.4 High-rating privileges

High rating creates eligibility, not an automatic right. The account must also have enough settled predictions, verified contact information and a clean conduct record. The founder or administrators approve access where editorial or public-speaking privileges are involved.

Configurable privileges include:

- Invitation to exclusive groups containing the founder and selected high-performing members.
- Ability to join private prediction events or specialist competition groups.
- Eligibility to contribute to public important-match discussions.
- Ability to submit signed match analysis for editorial review.
- Contributor, expert or elite profile badge.
- Greater profile visibility within leaderboards and community discovery.
- Early access to new community tools or special football events.
- Additional perks later defined by the founder without changing the core rating system.

Privileges can be paused or removed if the rating falls below the configured level for a sustained period or the member breaches community rules.

# 10. Exclusive groups, public match chat and community analysis

## 10.1 Founder exclusive groups

Exclusive groups are invitation-only spaces for the founder, approved high-rated users and selected guests. Groups can be general or focused on a competition, club, tournament or language. The founder and appointed moderators control membership.

These groups can contain:

- Early discussion of important matches.
- Private prediction comparisons.
- Tactical and statistical discussion.
- Invitations to write community analysis.
- Polls, featured questions and member recognition.

## 10.2 Public important-match chat

Selected important or popular matches have a public discussion panel visible to all users. To protect the quality of this area, reading is open but posting is limited to approved high-rated contributors, the founder, editors and moderators.

The public discussion operates before, during and after the match. Each message displays the contributor's username, rating tier and approved status. Messages can be linked to a match incident, player, prediction or statistic. General users can react to permitted messages and follow contributors, but they do not automatically gain posting access.

Public posting eligibility requires:

- A rating above the configured threshold.
- A minimum number of settled predictions.
- A clean recent conduct record.
- Manual approval by the founder, editor or administrator.
- Acceptance of public-contributor rules.

## 10.3 Community-written match analysis

Approved high-rated members can draft analysis for selected fixtures. Submissions use a structured editor containing predicted result, reasoning, key players, tactical view, confidence and supporting statistics. Every submission is tied to the author's profile and prediction history.

The workflow is **draft → submit → editorial review → approve, request changes or reject → publish**. Published community analysis is clearly labelled with the author's name and rating. It remains separate from the founder's analysis and the automated model.

## 10.4 Quality and moderation controls

The platform administration area must support message reporting, blocking, temporary chat restrictions, content removal, member suspension, group closure, appeal notes and an audit history. Automated filters can assist with spam and abusive language, but final decisions that affect contributor status must remain reviewable by authorised administrators.

# 11. Watch and highlights

The Watch section shows the official services or channels available for a match in the user's selected territory. Each listing contains the service, access type, territory, local kick-off time and official destination link.

After a match, the same module displays an official highlight video when an approved embed is available. Otherwise it links to the official highlight page. Watch and highlight availability is stored separately for each territory because the correct option can differ between countries.

Viewing information appears on the main Watch page, match centre, team fixture list and personalised Following feed.

# 12. Personalisation and notifications

## 12.1 Following

Users can follow teams, players, competitions, national teams, matches, groups and approved contributors. The Following feed combines relevant news, fixtures, line-up updates, predictions, founder analysis and permitted social activity.

## 12.2 Notifications

Members can control notifications for:

- Kick-off, line-up, goal, red card, half-time and full-time.
- Breaking news, transfers, injuries and suspensions.
- Founder analysis for followed matches or teams.
- Prediction settlement, rating changes and achievement unlocks.
- Friend requests, group invitations, mentions and chat messages.
- Exclusive-group invitation or public-contributor approval.
- Publication or review status of community analysis.

Quiet hours, per-team controls, competition controls and notification-frequency limits are required. Each notification must deep-link to the exact match, article, profile, group or conversation that caused it.

# 13. Eight-language product

The entire public and signed-in experience is available in English, Spanish, French, German, Portuguese, Arabic, Turkish and Italian at launch. This includes navigation, match data labels, account pages, ratings, groups, chat controls, notifications, editorial content and administration labels used by language teams.

## 13.1 Language architecture

- Language-prefixed URLs: /en/, /es/, /fr/, /de/, /pt/, /ar/, /tr/ and /it/.
- One canonical entity for each player, team, competition and match, with localised display names and aliases.
- One canonical article or analysis item with a controlled version for each language.
- Locale-aware dates, times, numbers, plurals and football terminology.
- Full right-to-left layout for Arabic using logical spacing and deliberate score, icon and timeline behaviour.
- Search that recognises common local spellings, transliterations and aliases.
- A shared football glossary and translation memory.

## 13.2 Content workflow

- Create or ingest the source content.
- Lock names, quotes, scorelines, dates and critical football terminology.
- Produce translations for all required languages.
- Check entities, numbers, missing content, links and formatting automatically.
- Review headlines, lead stories, founder analysis, quotations and sensitive claims by a fluent reviewer.
- Publish each approved language version under the same canonical content identity.
- Record corrections and feed approved terminology back into the glossary.

User-generated chat is not automatically presented as a verified translation. Users can select the language of a group or public discussion, and any optional translation must be labelled as automatic.

# 14. Technical product architecture

The architecture connects live football intelligence with identity, predictions, ratings and real-time community services while keeping each service independently testable and observable.

Figure 1. Complete website platform flow.

## 14.1 Recommended stack

| **Layer** | **Recommended implementation** |
| --- | --- |
| Web and PWA | Next.js with TypeScript, server rendering, route-level caching and responsive mobile-first design |
| Design system | Accessible React components, Storybook, shared design tokens and complete RTL states |
| Core API | TypeScript services using NestJS or Fastify with documented OpenAPI contracts |
| Prediction service | Python with FastAPI and established statistical/data libraries |
| Main database | PostgreSQL for users, football entities, predictions, friendships, groups and editorial workflow |
| Live cache and presence | Redis for hot match state, sessions, rate limits, presence and real-time fan-out |
| Search | Multilingual entity, article, group and approved-user search |
| Background work | Managed queues for ingestion, translations, notifications, settlements and moderation jobs |
| Live updates | Server-Sent Events for scores and WebSockets for direct, group and public chat |
| Content management | Localised CMS connected to canonical matches, teams, players and competitions |
| Assets and delivery | Object storage and a global content-delivery network |
| Monitoring | Central logs, error tracking, distributed tracing, freshness monitors and product analytics |

## 14.2 System flow

- Football inputs enter through secure server-side adapters.
- Incoming identities map to the platform's canonical matches, teams, players and competitions.
- Durable football and user data is stored in PostgreSQL; live match state and chat presence use Redis.
- The prediction service consumes timestamped pre-match snapshots and writes permanent forecast versions.
- The content system connects news, founder analysis and approved community analysis to football entities.
- The API composes a page according to competition coverage, language, territory, account permissions and privacy settings.
- Score updates are sent through server-to-client live events; chat uses authenticated two-way connections.
- Prediction settlement updates ratings, leaderboards, achievements and group comparisons.
- Notification workers deliver match, social and reputation events according to each user's settings.
- Monitoring traces every important event from source or user action to the final screen.

## 14.3 Service boundaries

The platform should separate these functional services even if some begin inside the same deployable application:

- Football ingestion and normalisation.
- Match, competition, team and player API.
- News, analysis and translation content.
- Prediction calculation and model evaluation.
- Account, identity and permissions.
- Friends, groups and membership.
- Real-time messaging and presence.
- User predictions, settlement, rating and leaderboards.
- Search and discovery.
- Notifications.
- Administration, moderation and audit records.

The frontend must depend on the platform's internal contracts rather than the response format of any external football feed.

# 15. Core data model

## 15.1 Football and content entities

- Country, territory, language and timezone.
- Competition, season, stage, group, round and table row.
- Team, venue, manager, squad and team-season record.
- Person, player, position, role and player-team spell.
- Fixture, participant, score, period, incident, line-up and statistic.
- Injury, suspension and availability status.
- Article, story cluster, author, translation and correction.
- Viewing availability and highlight destination.
- Model version, input snapshot, forecast and evaluation.
- Founder analysis and approved community analysis.

## 15.2 User and community entities

- User, credential, profile, language and privacy settings.
- Followed entity and notification preference.
- Friendship request, friendship and block relationship.
- Group, membership, invitation, role and group rule.
- Conversation, participant, message, reaction, mention and shared football card.
- Public match discussion, contributor permission and contributor status.
- User prediction, prediction version, settlement and reason tags.
- Performance Rating snapshot, Career Points transaction, achievement and leaderboard entry.
- Community-analysis draft, review decision and published version.
- Report, moderation decision, sanction and appeal note.

All primary records use internal unique identifiers. External IDs and localised names are mappings, not the permanent identity of an entity.

# 16. Administration and control centre

The operations team needs one secure administration area containing:

- Match and competition coverage status.
- Live-data freshness, correction and manual review tools.
- News, translations, founder analysis and community-analysis workflow.
- User search, account status, rating history and privilege controls.
- Configurable rating formula, provisional limits and privilege thresholds.
- Group, public-chat and contributor management.
- Reports, moderation queue, sanctions and audit history.
- Featured matches, homepage ordering and notification campaigns.
- Language and territory settings.
- System health, job failures, API errors and notification delivery.

High-impact actions such as changing a settled prediction, modifying a rating, granting public-contributor access or removing a published analysis must record the administrator, time, reason and previous value.

# 17. Required launch scope

This is a single complete release. Every workstream below is mandatory for public launch and should be built and tested in parallel against shared contracts.

| **Workstream** | **Required launch result** |
| --- | --- |
| Scores and match centre | Live and scheduled fixtures, incidents, line-ups, statistics, form, head-to-head, predictions, discussion and viewing modules |
| Football entities | Complete competition, team and player pages connected across the site |
| News and analysis | Latest, trending, debate and following feeds; founder analysis for selected important matches |
| Model forecast | Versioned Power Index, home/draw/away probabilities, explanations and post-match evaluation |
| Accounts and personalisation | Secure registration, profiles, favourites, privacy settings and notifications |
| Community predictions | Account-only submission, locking, settlement, consensus and complete prediction history |
| Reputation | Performance Rating, Career Points, leaderboards, achievements and configurable privilege rules |
| Social network | Friends, direct chat, user-created groups, group chat and football-content sharing |
| Premium community access | Founder exclusive groups, approved public-match contributors and community-analysis workflow |
| Languages | Complete eight-language interface and content workflow, including Arabic RTL |
| Watch and highlights | Territory-aware official viewing choices and official post-match highlight destinations |
| Search and discovery | Search across football entities, articles, groups and permitted user profiles |
| Administration | Editorial, translation, rating, community, moderation, coverage and system controls |
| Quality | Mobile responsiveness, accessibility, performance, security, monitoring and live-load resilience |

The product is not ready for public launch if any mandatory workstream is represented only by a static mock-up, disconnected page or manual process that cannot handle real users and live football traffic.

# 18. Essential user journeys

## 18.1 New member predicts a match

- The visitor opens an important match centre.
- The visitor selects **Make a prediction** and is required to create or sign in to an account.
- After verification, the member submits the match outcome, optional score, confidence and reason tags.
- The prediction appears in the member's history and in permitted friend/group activity.
- At kick-off, the prediction locks.
- After the result is settled, the rating, career points, achievements and leaderboards update.

## 18.2 Friends discuss a live match

- A member shares a live match card with a friend or group.
- The conversation opens with a live score and match-status card.
- Members compare predictions and discuss line-ups, incidents and statistics.
- Match updates change the card without removing the conversation history.
- Each participant controls notifications, mute, block and report actions.

## 18.3 High-rated member becomes a contributor

- The member reaches the configured rating and minimum settled-prediction requirement.
- The system marks the member as eligible and alerts authorised administrators.
- The founder or administrator reviews performance, conduct and profile information.
- The member is invited to an exclusive group or approved for selected public match chats.
- If approved as a community analyst, the member can submit structured analysis for review.
- Published contributions appear with the member's identity, rating and contributor badge.

## 18.4 User follows a team across the platform

- The user follows a club or national team.
- Its fixtures, scores, stories, founder analysis and relevant discussions enter the Following feed.
- The user chooses line-up, score, news and analysis alerts.
- The user moves directly between the team page, match centre, player profiles, group discussion and viewing information.

# 19. Launch acceptance requirements

## Football experience

- Scores, incidents and line-ups update without a page refresh.
- Every match, team, competition, player, article and prediction link resolves to the correct entity.
- Unsupported statistics are labelled rather than silently blank.
- The match centre functions before, during and after the game.

## Prediction experience

- Model probabilities total 100% and every forecast retains its inputs, time and model version.
- Founder analysis is visibly separate from the model.
- Community predictions require an account, lock correctly and settle consistently.
- Ratings can be reproduced from the stored prediction and settlement record.
- Leaderboards enforce minimum sample sizes and privacy rules.

## Social experience

- Friend requests, blocking, group roles, invitations and membership changes work correctly.
- Direct, group and public-chat messages arrive in real time and retain ordering.
- Only authorised members can post in controlled public match discussions.
- Exclusive-group and community-analyst access can be granted and withdrawn by authorised administrators.
- Reports and moderation actions create an audit record.

## Language and accessibility

- All eight language routes work across public pages and signed-in journeys.
- Arabic pages are fully usable in right-to-left mode.
- Names, scores, dates, numbers and notifications render correctly in each locale.
- Keyboard navigation, focus order, contrast, screen-reader labels and live-score announcements meet the agreed accessibility standard.

## Performance and operations

- Major-match traffic tests pass at the agreed peak load.
- The website identifies delayed data and recovers from temporary feed failures.
- Account, prediction, rating, chat and notification events are observable from the administration system.
- Security tests cover authentication, authorisation, private conversations, group membership, public-post permissions and administrator actions.

# Final product statement

The finished website is not simply a live-score service with a news section. It is a complete football information and community platform. Its main differentiator is the connection between reliable match intelligence and earned user reputation: members predict matches, prove their performance over time, form private football communities and, when their record and conduct justify it, gain access to exclusive groups and public analytical roles.

The statistical model, founder analysis and community forecast remain distinct but complementary. Together with live scores, complete football pages, eight languages, viewing information, friends, groups, chat and transparent ratings, they form one coherent product delivered in a single complete launch scope.

