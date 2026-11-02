# File index

Every file in the repository (2217), grouped by folder, with one line on
what it is, taken from the file’s own header comment. **Generated** by
`node scripts/file-index.mjs` — never edit by hand; rerun it after adding,
moving or re-describing files. For *why* things are where they are and how
they connect, read `docs/03-project-map.md`; for starting on a new account or
machine, `docs/18-handover.md`.

## Folders

- [`(root)`](#root) — 19
- [`.claude`](#claude) — 1
- [`.claude/agents`](#claudeagents) — 12
- [`.claude/hooks`](#claudehooks) — 3
- [`.claude/skills/business-advice`](#claudeskillsbusiness-advice) — 1
- [`.claude/skills/content-watch`](#claudeskillscontent-watch) — 2
- [`.claude/skills/daily-brief`](#claudeskillsdaily-brief) — 1
- [`.claude/skills/data-audit`](#claudeskillsdata-audit) — 5
- [`.claude/skills/fmip-architecture`](#claudeskillsfmip-architecture) — 2
- [`.claude/skills/fmip-design`](#claudeskillsfmip-design) — 1
- [`.claude/skills/fmip-qa`](#claudeskillsfmip-qa) — 1
- [`.claude/skills/fmip-review`](#claudeskillsfmip-review) — 2
- [`.claude/skills/fmip-security`](#claudeskillsfmip-security) — 2
- [`.claude/skills/model-watch`](#claudeskillsmodel-watch) — 2
- [`.claude/skills/ops-check`](#claudeskillsops-check) — 3
- [`.claude/skills/product-strategy`](#claudeskillsproduct-strategy) — 2
- [`.claude/skills/team-charter`](#claudeskillsteam-charter) — 1
- [`.github/workflows`](#githubworkflows) — 2
- [`apps/api`](#appsapi) — 6
- [`apps/api/backtest`](#appsapibacktest) — 22
- [`apps/api/scripts`](#appsapiscripts) — 3
- [`apps/api/src`](#appsapisrc) — 4
- [`apps/api/src/cli`](#appsapisrccli) — 9
- [`apps/api/src/database`](#appsapisrcdatabase) — 3
- [`apps/api/src/modules/activity`](#appsapisrcmodulesactivity) — 4
- [`apps/api/src/modules/activity/internal`](#appsapisrcmodulesactivityinternal) — 2
- [`apps/api/src/modules/admin`](#appsapisrcmodulesadmin) — 7
- [`apps/api/src/modules/admin/internal`](#appsapisrcmodulesadmininternal) — 2
- [`apps/api/src/modules/agents-console`](#appsapisrcmodulesagents-console) — 3
- [`apps/api/src/modules/agents-console/internal`](#appsapisrcmodulesagents-consoleinternal) — 3
- [`apps/api/src/modules/analysis`](#appsapisrcmodulesanalysis) — 5
- [`apps/api/src/modules/analysis/internal`](#appsapisrcmodulesanalysisinternal) — 1
- [`apps/api/src/modules/ask`](#appsapisrcmodulesask) — 5
- [`apps/api/src/modules/briefings`](#appsapisrcmodulesbriefings) — 4
- [`apps/api/src/modules/briefings/internal`](#appsapisrcmodulesbriefingsinternal) — 2
- [`apps/api/src/modules/campaigns`](#appsapisrcmodulescampaigns) — 6
- [`apps/api/src/modules/campaigns/internal`](#appsapisrcmodulescampaignsinternal) — 1
- [`apps/api/src/modules/catalog`](#appsapisrcmodulescatalog) — 28
- [`apps/api/src/modules/catalog/internal`](#appsapisrcmodulescataloginternal) — 16
- [`apps/api/src/modules/channel-post`](#appsapisrcmoduleschannel-post) — 5
- [`apps/api/src/modules/channel-post/internal`](#appsapisrcmoduleschannel-postinternal) — 10
- [`apps/api/src/modules/consensus`](#appsapisrcmodulesconsensus) — 6
- [`apps/api/src/modules/consensus/internal`](#appsapisrcmodulesconsensusinternal) — 2
- [`apps/api/src/modules/conversations`](#appsapisrcmodulesconversations) — 11
- [`apps/api/src/modules/conversations/internal`](#appsapisrcmodulesconversationsinternal) — 2
- [`apps/api/src/modules/data-quality`](#appsapisrcmodulesdata-quality) — 6
- [`apps/api/src/modules/data-quality/internal`](#appsapisrcmodulesdata-qualityinternal) — 3
- [`apps/api/src/modules/delivery`](#appsapisrcmodulesdelivery) — 5
- [`apps/api/src/modules/delivery/internal`](#appsapisrcmodulesdeliveryinternal) — 5
- [`apps/api/src/modules/failure-counts`](#appsapisrcmodulesfailure-counts) — 4
- [`apps/api/src/modules/failure-counts/internal`](#appsapisrcmodulesfailure-countsinternal) — 2
- [`apps/api/src/modules/fixtures`](#appsapisrcmodulesfixtures) — 16
- [`apps/api/src/modules/fixtures/internal`](#appsapisrcmodulesfixturesinternal) — 12
- [`apps/api/src/modules/following-feed`](#appsapisrcmodulesfollowing-feed) — 3
- [`apps/api/src/modules/following-feed/internal`](#appsapisrcmodulesfollowing-feedinternal) — 1
- [`apps/api/src/modules/forecast`](#appsapisrcmodulesforecast) — 32
- [`apps/api/src/modules/forecast/internal`](#appsapisrcmodulesforecastinternal) — 14
- [`apps/api/src/modules/founder`](#appsapisrcmodulesfounder) — 6
- [`apps/api/src/modules/founder/internal`](#appsapisrcmodulesfounderinternal) — 2
- [`apps/api/src/modules/groups`](#appsapisrcmodulesgroups) — 14
- [`apps/api/src/modules/groups/internal`](#appsapisrcmodulesgroupsinternal) — 5
- [`apps/api/src/modules/health`](#appsapisrcmoduleshealth) — 6
- [`apps/api/src/modules/homepage`](#appsapisrcmoduleshomepage) — 4
- [`apps/api/src/modules/homepage/internal`](#appsapisrcmoduleshomepageinternal) — 1
- [`apps/api/src/modules/identity`](#appsapisrcmodulesidentity) — 9
- [`apps/api/src/modules/identity/internal`](#appsapisrcmodulesidentityinternal) — 12
- [`apps/api/src/modules/ingestion`](#appsapisrcmodulesingestion) — 23
- [`apps/api/src/modules/ingestion/internal`](#appsapisrcmodulesingestioninternal) — 68
- [`apps/api/src/modules/intelligence`](#appsapisrcmodulesintelligence) — 4
- [`apps/api/src/modules/intelligence/internal`](#appsapisrcmodulesintelligenceinternal) — 4
- [`apps/api/src/modules/locale-holds`](#appsapisrcmoduleslocale-holds) — 3
- [`apps/api/src/modules/locale-holds/internal`](#appsapisrcmoduleslocale-holdsinternal) — 1
- [`apps/api/src/modules/localised-names`](#appsapisrcmoduleslocalised-names) — 4
- [`apps/api/src/modules/localised-names/internal`](#appsapisrcmoduleslocalised-namesinternal) — 2
- [`apps/api/src/modules/match-alerts`](#appsapisrcmodulesmatch-alerts) — 7
- [`apps/api/src/modules/match-alerts/internal`](#appsapisrcmodulesmatch-alertsinternal) — 3
- [`apps/api/src/modules/media`](#appsapisrcmodulesmedia) — 8
- [`apps/api/src/modules/media/internal`](#appsapisrcmodulesmediainternal) — 4
- [`apps/api/src/modules/model-upset`](#appsapisrcmodulesmodel-upset) — 5
- [`apps/api/src/modules/model-upset/internal`](#appsapisrcmodulesmodel-upsetinternal) — 2
- [`apps/api/src/modules/moderation`](#appsapisrcmodulesmoderation) — 11
- [`apps/api/src/modules/moderation-assist`](#appsapisrcmodulesmoderation-assist) — 4
- [`apps/api/src/modules/moderation-assist/internal`](#appsapisrcmodulesmoderation-assistinternal) — 1
- [`apps/api/src/modules/moderation/internal`](#appsapisrcmodulesmoderationinternal) — 2
- [`apps/api/src/modules/moments`](#appsapisrcmodulesmoments) — 5
- [`apps/api/src/modules/moments/internal`](#appsapisrcmodulesmomentsinternal) — 1
- [`apps/api/src/modules/news`](#appsapisrcmodulesnews) — 44
- [`apps/api/src/modules/news/internal`](#appsapisrcmodulesnewsinternal) — 19
- [`apps/api/src/modules/notifications`](#appsapisrcmodulesnotifications) — 13
- [`apps/api/src/modules/notifications/internal`](#appsapisrcmodulesnotificationsinternal) — 2
- [`apps/api/src/modules/panel`](#appsapisrcmodulespanel) — 13
- [`apps/api/src/modules/panel/internal`](#appsapisrcmodulespanelinternal) — 5
- [`apps/api/src/modules/predictions`](#appsapisrcmodulespredictions) — 17
- [`apps/api/src/modules/predictions/internal`](#appsapisrcmodulespredictionsinternal) — 6
- [`apps/api/src/modules/profile`](#appsapisrcmodulesprofile) — 9
- [`apps/api/src/modules/profile/internal`](#appsapisrcmodulesprofileinternal) — 5
- [`apps/api/src/modules/rate-limits`](#appsapisrcmodulesrate-limits) — 6
- [`apps/api/src/modules/rating-thresholds`](#appsapisrcmodulesrating-thresholds) — 5
- [`apps/api/src/modules/rating-thresholds/internal`](#appsapisrcmodulesrating-thresholdsinternal) — 2
- [`apps/api/src/modules/reputation`](#appsapisrcmodulesreputation) — 31
- [`apps/api/src/modules/reputation/internal`](#appsapisrcmodulesreputationinternal) — 14
- [`apps/api/src/modules/search`](#appsapisrcmodulessearch) — 8
- [`apps/api/src/modules/search/internal`](#appsapisrcmodulessearchinternal) — 5
- [`apps/api/src/modules/social`](#appsapisrcmodulessocial) — 5
- [`apps/api/src/modules/social/internal`](#appsapisrcmodulessocialinternal) — 1
- [`apps/api/src/modules/standings`](#appsapisrcmodulesstandings) — 7
- [`apps/api/src/modules/standings/internal`](#appsapisrcmodulesstandingsinternal) — 2
- [`apps/api/src/modules/summaries`](#appsapisrcmodulessummaries) — 4
- [`apps/api/src/modules/summaries/internal`](#appsapisrcmodulessummariesinternal) — 4
- [`apps/api/src/modules/viewing`](#appsapisrcmodulesviewing) — 17
- [`apps/api/src/modules/viewing/internal`](#appsapisrcmodulesviewinginternal) — 7
- [`apps/api/src/modules/watchdog`](#appsapisrcmoduleswatchdog) — 10
- [`apps/api/src/modules/watchdog/internal`](#appsapisrcmoduleswatchdoginternal) — 7
- [`apps/api/src/observability`](#appsapisrcobservability) — 4
- [`apps/api/src/security`](#appsapisrcsecurity) — 2
- [`apps/api/src/testing`](#appsapisrctesting) — 2
- [`apps/model`](#appsmodel) — 3
- [`apps/model/contract`](#appsmodelcontract) — 3
- [`apps/model/fmip_model`](#appsmodelfmip-model) — 1
- [`apps/model/fmip_model/backtest`](#appsmodelfmip-modelbacktest) — 13
- [`apps/model/fmip_model/inputs`](#appsmodelfmip-modelinputs) — 19
- [`apps/model/fmip_model/model`](#appsmodelfmip-modelmodel) — 8
- [`apps/model/fmip_model/model/candidates`](#appsmodelfmip-modelmodelcandidates) — 2
- [`apps/model/fmip_model/model/published`](#appsmodelfmip-modelmodelpublished) — 1
- [`apps/model/fmip_model/model/retired`](#appsmodelfmip-modelmodelretired) — 1
- [`apps/model/fmip_model/service`](#appsmodelfmip-modelservice) — 6
- [`apps/model/fmip_model/training`](#appsmodelfmip-modeltraining) — 12
- [`apps/model/reports`](#appsmodelreports) — 1
- [`apps/model/reports/dixon-coles-elo-0.1.0`](#appsmodelreportsdixon-coles-elo-010) — 6
- [`apps/model/reports/dixon-coles-elo-0.4.0`](#appsmodelreportsdixon-coles-elo-040) — 2
- [`apps/model/reports/dixon-coles-elo-0.5.0`](#appsmodelreportsdixon-coles-elo-050) — 18
- [`apps/model/reports/dixon-coles-elo-0.6.0`](#appsmodelreportsdixon-coles-elo-060) — 4
- [`apps/model/reports/dixon-coles-elo-0.7.0`](#appsmodelreportsdixon-coles-elo-070) — 3
- [`apps/model/scripts`](#appsmodelscripts) — 1
- [`apps/model/tests`](#appsmodeltests) — 40
- [`apps/model/tests/fixtures`](#appsmodeltestsfixtures) — 1
- [`apps/web`](#appsweb) — 12
- [`apps/web/public`](#appswebpublic) — 1
- [`apps/web/public/icons`](#appswebpublicicons) — 6
- [`apps/web/scripts`](#appswebscripts) — 5
- [`apps/web/scripts/lib`](#appswebscriptslib) — 2
- [`apps/web/src`](#appswebsrc) — 1
- [`apps/web/src/app`](#appswebsrcapp) — 12
- [`apps/web/src/app/[locale]`](#appswebsrcapplocale) — 4
- [`apps/web/src/app/[locale]/[...missing]`](#appswebsrcapplocalemissing) — 1
- [`apps/web/src/app/[locale]/about`](#appswebsrcapplocaleabout) — 8
- [`apps/web/src/app/[locale]/account-deleted`](#appswebsrcapplocaleaccount-deleted) — 1
- [`apps/web/src/app/[locale]/admin`](#appswebsrcapplocaleadmin) — 1
- [`apps/web/src/app/[locale]/admin/activity`](#appswebsrcapplocaleadminactivity) — 1
- [`apps/web/src/app/[locale]/admin/analysis-reviews`](#appswebsrcapplocaleadminanalysis-reviews) — 1
- [`apps/web/src/app/[locale]/admin/campaigns`](#appswebsrcapplocaleadmincampaigns) — 1
- [`apps/web/src/app/[locale]/admin/competitions`](#appswebsrcapplocaleadmincompetitions) — 1
- [`apps/web/src/app/[locale]/admin/contributors`](#appswebsrcapplocaleadmincontributors) — 1
- [`apps/web/src/app/[locale]/admin/data-quality`](#appswebsrcapplocaleadmindata-quality) — 1
- [`apps/web/src/app/[locale]/admin/homepage`](#appswebsrcapplocaleadminhomepage) — 1
- [`apps/web/src/app/[locale]/admin/members/[username]`](#appswebsrcapplocaleadminmembersusername) — 1
- [`apps/web/src/app/[locale]/admin/model-accuracy`](#appswebsrcapplocaleadminmodel-accuracy) — 1
- [`apps/web/src/app/[locale]/admin/model-candidates`](#appswebsrcapplocaleadminmodel-candidates) — 1
- [`apps/web/src/app/[locale]/admin/moderation`](#appswebsrcapplocaleadminmoderation) — 1
- [`apps/web/src/app/[locale]/admin/moderation/[username]`](#appswebsrcapplocaleadminmoderationusername) — 1
- [`apps/web/src/app/[locale]/admin/moderation/groups/[slug]`](#appswebsrcapplocaleadminmoderationgroupsslug) — 1
- [`apps/web/src/app/[locale]/admin/news`](#appswebsrcapplocaleadminnews) — 1
- [`apps/web/src/app/[locale]/admin/news-coverage`](#appswebsrcapplocaleadminnews-coverage) — 1
- [`apps/web/src/app/[locale]/admin/news-sources`](#appswebsrcapplocaleadminnews-sources) — 1
- [`apps/web/src/app/[locale]/admin/panels`](#appswebsrcapplocaleadminpanels) — 1
- [`apps/web/src/app/[locale]/admin/rating-thresholds`](#appswebsrcapplocaleadminrating-thresholds) — 1
- [`apps/web/src/app/[locale]/admin/system`](#appswebsrcapplocaleadminsystem) — 1
- [`apps/web/src/app/[locale]/admin/translations`](#appswebsrcapplocaleadmintranslations) — 1
- [`apps/web/src/app/[locale]/admin/translations/[articleId]/[language]`](#appswebsrcapplocaleadmintranslationsarticleidlanguage) — 1
- [`apps/web/src/app/[locale]/admin/viewing`](#appswebsrcapplocaleadminviewing) — 1
- [`apps/web/src/app/[locale]/analyses/[fixtureId]`](#appswebsrcapplocaleanalysesfixtureid) — 1
- [`apps/web/src/app/[locale]/coach/[id]`](#appswebsrcapplocalecoachid) — 1
- [`apps/web/src/app/[locale]/competition/[id]`](#appswebsrcapplocalecompetitionid) — 5
- [`apps/web/src/app/[locale]/competitions`](#appswebsrcapplocalecompetitions) — 1
- [`apps/web/src/app/[locale]/following`](#appswebsrcapplocalefollowing) — 1
- [`apps/web/src/app/[locale]/following/saved`](#appswebsrcapplocalefollowingsaved) — 1
- [`apps/web/src/app/[locale]/forgot-password`](#appswebsrcapplocaleforgot-password) — 1
- [`apps/web/src/app/[locale]/founder/[fixtureId]`](#appswebsrcapplocalefounderfixtureid) — 1
- [`apps/web/src/app/[locale]/friends`](#appswebsrcapplocalefriends) — 1
- [`apps/web/src/app/[locale]/group-invite/[token]`](#appswebsrcapplocalegroup-invitetoken) — 1
- [`apps/web/src/app/[locale]/groups`](#appswebsrcapplocalegroups) — 1
- [`apps/web/src/app/[locale]/groups/[slug]`](#appswebsrcapplocalegroupsslug) — 1
- [`apps/web/src/app/[locale]/groups/[slug]/history`](#appswebsrcapplocalegroupsslughistory) — 1
- [`apps/web/src/app/[locale]/highlights`](#appswebsrcapplocalehighlights) — 4
- [`apps/web/src/app/[locale]/leaderboard`](#appswebsrcapplocaleleaderboard) — 1
- [`apps/web/src/app/[locale]/login`](#appswebsrcapplocalelogin) — 1
- [`apps/web/src/app/[locale]/match/[id]`](#appswebsrcapplocalematchid) — 3
- [`apps/web/src/app/[locale]/messages`](#appswebsrcapplocalemessages) — 1
- [`apps/web/src/app/[locale]/messages/[id]`](#appswebsrcapplocalemessagesid) — 1
- [`apps/web/src/app/[locale]/model-accuracy`](#appswebsrcapplocalemodel-accuracy) — 1
- [`apps/web/src/app/[locale]/news`](#appswebsrcapplocalenews) — 1
- [`apps/web/src/app/[locale]/news/story/[id]`](#appswebsrcapplocalenewsstoryid) — 2
- [`apps/web/src/app/[locale]/notifications`](#appswebsrcapplocalenotifications) — 1
- [`apps/web/src/app/[locale]/offline`](#appswebsrcapplocaleoffline) — 1
- [`apps/web/src/app/[locale]/player/[id]`](#appswebsrcapplocaleplayerid) — 1
- [`apps/web/src/app/[locale]/player/[id]/compare`](#appswebsrcapplocaleplayeridcompare) — 2
- [`apps/web/src/app/[locale]/predictions`](#appswebsrcapplocalepredictions) — 1
- [`apps/web/src/app/[locale]/register`](#appswebsrcapplocaleregister) — 1
- [`apps/web/src/app/[locale]/reset-password`](#appswebsrcapplocalereset-password) — 1
- [`apps/web/src/app/[locale]/rules`](#appswebsrcapplocalerules) — 1
- [`apps/web/src/app/[locale]/scores`](#appswebsrcapplocalescores) — 4
- [`apps/web/src/app/[locale]/search`](#appswebsrcapplocalesearch) — 1
- [`apps/web/src/app/[locale]/settings`](#appswebsrcapplocalesettings) — 1
- [`apps/web/src/app/[locale]/settings/data-export`](#appswebsrcapplocalesettingsdata-export) — 1
- [`apps/web/src/app/[locale]/settings/notifications`](#appswebsrcapplocalesettingsnotifications) — 1
- [`apps/web/src/app/[locale]/team/[id]`](#appswebsrcapplocaleteamid) — 1
- [`apps/web/src/app/[locale]/u/[username]`](#appswebsrcapplocaleuusername) — 2
- [`apps/web/src/app/[locale]/u/[username]/compare`](#appswebsrcapplocaleuusernamecompare) — 1
- [`apps/web/src/app/[locale]/verify-email`](#appswebsrcapplocaleverify-email) — 1
- [`apps/web/src/app/[locale]/watch`](#appswebsrcapplocalewatch) — 1
- [`apps/web/src/app/[locale]/welcome`](#appswebsrcapplocalewelcome) — 1
- [`apps/web/src/app/api/fixtures/[id]/stream`](#appswebsrcappapifixturesidstream) — 1
- [`apps/web/src/app/api/media/[kind]/[id]/[version]`](#appswebsrcappapimediakindidversion) — 1
- [`apps/web/src/app/api/scores/stream`](#appswebsrcappapiscoresstream) — 1
- [`apps/web/src/app/console`](#appswebsrcappconsole) — 6
- [`apps/web/src/app/console/(app)`](#appswebsrcappconsoleapp) — 2
- [`apps/web/src/app/console/(app)/agents/[name]`](#appswebsrcappconsoleappagentsname) — 1
- [`apps/web/src/app/console/(app)/agents/[name]/chat`](#appswebsrcappconsoleappagentsnamechat) — 1
- [`apps/web/src/app/console/(app)/audit`](#appswebsrcappconsoleappaudit) — 1
- [`apps/web/src/app/console/(app)/board`](#appswebsrcappconsoleappboard) — 1
- [`apps/web/src/app/console/(app)/decisions`](#appswebsrcappconsoleappdecisions) — 1
- [`apps/web/src/app/console/(app)/findings`](#appswebsrcappconsoleappfindings) — 1
- [`apps/web/src/app/console/(app)/reports`](#appswebsrcappconsoleappreports) — 1
- [`apps/web/src/app/console/(open)/invite/[token]`](#appswebsrcappconsoleopeninvitetoken) — 1
- [`apps/web/src/app/console/(open)/login`](#appswebsrcappconsoleopenlogin) — 1
- [`apps/web/src/app/health`](#appswebsrcapphealth) — 2
- [`apps/web/src/components`](#appswebsrccomponents) — 266
- [`apps/web/src/components/ui`](#appswebsrccomponentsui) — 27
- [`apps/web/src/i18n`](#appswebsrci18n) — 9
- [`apps/web/src/i18n/catalogues`](#appswebsrci18ncatalogues) — 9
- [`apps/web/src/lib`](#appswebsrclib) — 208
- [`apps/web/tests/e2e`](#appswebtestse2e) — 24
- [`apps/web/tests/e2e/budgets`](#appswebtestse2ebudgets) — 1
- [`apps/web/tests/e2e/journeys`](#appswebtestse2ejourneys) — 25
- [`apps/web/tests/e2e/visual.spec.ts-snapshots`](#appswebtestse2evisualspects-snapshots) — 32
- [`deploy`](#deploy) — 8
- [`deploy/certs`](#deploycerts) — 1
- [`deploy/preview`](#deploypreview) — 2
- [`docs`](#docs) — 32
- [`docs/research`](#docsresearch) — 2
- [`packages/config`](#packagesconfig) — 4
- [`packages/config/eslint`](#packagesconfigeslint) — 1
- [`packages/config/prettier`](#packagesconfigprettier) — 1
- [`packages/config/tests`](#packagesconfigtests) — 1
- [`packages/config/tsconfig`](#packagesconfigtsconfig) — 4
- [`packages/console-publisher`](#packagesconsole-publisher) — 5
- [`packages/console-publisher/src`](#packagesconsole-publishersrc) — 5
- [`packages/contracts`](#packagescontracts) — 5
- [`packages/contracts/glossary`](#packagescontractsglossary) — 9
- [`packages/contracts/src`](#packagescontractssrc) — 69
- [`packages/contracts/zones`](#packagescontractszones) — 1
- [`packages/db`](#packagesdb) — 6
- [`packages/db/migrations`](#packagesdbmigrations) — 171
- [`packages/db/scripts`](#packagesdbscripts) — 4
- [`packages/db/scripts/data`](#packagesdbscriptsdata) — 1
- [`packages/db/seed`](#packagesdbseed) — 7
- [`packages/db/src`](#packagesdbsrc) — 15
- [`packages/ingestion`](#packagesingestion) — 5
- [`packages/ingestion/bakeoff`](#packagesingestionbakeoff) — 3
- [`packages/ingestion/scripts`](#packagesingestionscripts) — 2
- [`packages/ingestion/scripts/plans`](#packagesingestionscriptsplans) — 4
- [`packages/ingestion/src`](#packagesingestionsrc) — 6
- [`packages/ingestion/src/adapters`](#packagesingestionsrcadapters) — 7
- [`packages/ingestion/src/adapters/_fixtures`](#packagesingestionsrcadapters-fixtures) — 1
- [`packages/ingestion/src/adapters/_fixtures/api-football`](#packagesingestionsrcadapters-fixturesapi-football) — 7
- [`packages/ingestion/src/adapters/_fixtures/api-football-coachs`](#packagesingestionsrcadapters-fixturesapi-football-coachs) — 2
- [`packages/ingestion/src/adapters/_fixtures/api-football-team-statistics`](#packagesingestionsrcadapters-fixturesapi-football-team-statistics) — 3
- [`packages/ingestion/src/adapters/_fixtures/api-football-transfers`](#packagesingestionsrcadapters-fixturesapi-football-transfers) — 2
- [`packages/ingestion/src/adapters/_fixtures/football-data-org`](#packagesingestionsrcadapters-fixturesfootball-data-org) — 6
- [`packages/ingestion/src/adapters/_fixtures/highlightly`](#packagesingestionsrcadapters-fixtureshighlightly) — 6
- [`packages/ingestion/src/adapters/_fixtures/highlightly-box-score`](#packagesingestionsrcadapters-fixtureshighlightly-box-score) — 2
- [`packages/ingestion/src/adapters/api-football`](#packagesingestionsrcadaptersapi-football) — 16
- [`packages/ingestion/src/adapters/football-data-org`](#packagesingestionsrcadaptersfootball-data-org) — 3
- [`packages/ingestion/src/adapters/highlightly`](#packagesingestionsrcadaptershighlightly) — 7
- [`packages/ingestion/src/adapters/replay`](#packagesingestionsrcadaptersreplay) — 3
- [`packages/ingestion/src/bakeoff`](#packagesingestionsrcbakeoff) — 5
- [`packages/ingestion/src/harness`](#packagesingestionsrcharness) — 4
- [`packages/ingestion/src/news`](#packagesingestionsrcnews) — 13
- [`packages/ingestion/src/news/_recorded`](#packagesingestionsrcnews-recorded) — 3
- [`scripts`](#scripts) — 6
- [`scripts/backup`](#scriptsbackup) — 12
- [`scripts/dev-proxy`](#scriptsdev-proxy) — 1

## root

| File | What it is |
|---|---|
| `.dockerignore` | Files left out of image build contexts. |
| `.editorconfig` | Editor defaults (indentation, line endings). |
| `.env.example` | Copy to .env and fill in. Never commit .env. Every variable added here must also be listed in docs/03-project-map.md. |
| `.gitattributes` | Line endings and file types for git. |
| `.gitignore` | Files git leaves out. |
| `.npmrc` | Workspace packages are always linked from the workspace, never from the registry. |
| `.nvmrc` | The Node version. |
| `.prettierignore` | Files Prettier leaves alone. |
| `CLAUDE.md` | CLAUDE.md — Operating rules for this repository |
| `README.md` | FMIP — Football Match Intelligence Platform |
| `docker-compose.yml` | Local development stack. cp .env.example .env docker compose up -d Postgres, Redis, the API and the web app. |
| `package.json` | Package `fmip`: Football Match Intelligence Platform — monorepo root: scripts and dependencies. |
| `pnpm-lock.yaml` | Exact dependency versions (generated). |
| `pnpm-workspace.yaml` | The pnpm workspaces (apps/*, packages/*). |
| `prettier.config.mjs` | Prettier settings (re-exports @fmip/config). |
| `render.yaml` | The public preview (T-086, D-064) -- RETIRED on 2026-10-24 (T-1485, D-257). |
| `setup-repo.sh` | FMIP — repository bootstrap Windows: right-click inside this folder -> "Open Git Bash here", then run: bash setup-repo.sh Nothing to edit. |
| `tsconfig.json` | TypeScript compiler settings. |
| `turbo.json` | JSON data or settings. |

## .claude

| File | What it is |
|---|---|
| `settings.json` | JSON data or settings. |

## .claude/agents

| File | What it is |
|---|---|
| `architect.md` | The FMIP / Stadiomind architect - before a substantial change, lays out two or three options with their trade-offs against CLAUDE.md's rules and the existing decisions, recommends one and drafts the decision; monthly, c… |
| `business-adviser.md` | The FMIP / Stadiomind business adviser - keeps the licence register of every data, news and image source (D-014), the costs and their trend, and the privacy duties of a UK-based service, and writes any decision touching… |
| `chief-of-staff.md` | The FMIP / Stadiomind chief of staff and project manager - reads every team agent's findings and reports, the open pull requests, the task tables and the pending decisions, and writes the maintainer's one-page Persian b… |
| `code-reviewer.md` | Reviews an FMIP / Stadiomind branch or pull request, with fresh eyes, against CLAUDE.md's non-negotiable rules and the project's known failure modes, runs the cheap checks that prove it, and returns APPROVE or CHANGES R… |
| `content-community.md` | The FMIP / Stadiomind news editor and community moderator's assistant - watches the news feeds (fetches, failing or silent sources, image licences, football only), the moderation queue and sanctions, and the Persian tex… |
| `data-auditor.md` | Audits the correctness of FMIP / Stadiomind production data and the live site (scores after extra time, shoot-outs, league and conference tables, stage names, line-ups, duplicate entities, stale jobs, forecasts, the new… |
| `designer.md` | The FMIP / Stadiomind product designer - draws a visible change on real data in the Stadiomind design system (desktop and phone, English and Persian, light and dark) before it is built, and reviews pages and release scr… |
| `model-scientist.md` | Watches the FMIP / Stadiomind forecast model's live record (pre-kick-off log loss, Brier, accuracy, calibration, published against shadow, drift, weak competitions), keeps the lab's verdicts, judges promotion readiness… |
| `ops-release.md` | Watches FMIP / Stadiomind production (server, containers, disk, build cache, backups, ingestion jobs, request budget, watchdog, site response) with a read-only snapshot, and runs the release checklist before and after e… |
| `product-strategist.md` | The FMIP / Stadiomind product manager and strategist - turns requests and teammate feedback into tasks with checkable acceptance criteria against the blueprint, prioritises them, keeps the competitor view, and checks se… |
| `qa-engineer.md` | Tests FMIP / Stadiomind - checks a pull request's tests and runs the targeted ones, walks the live site daily in English and Persian at phone and desktop widths (layout, RTL, overflow, console errors, speed, stale or wr… |
| `security.md` | The FMIP / Stadiomind security engineer - reviews pull requests for authorisation, input handling, SQL, XSS, secrets, rate limits, audited admin actions, dependencies and prompt injection, and checks the server and site… |

## .claude/hooks

| File | What it is |
|---|---|
| `guard.cases.json` | JSON data or settings. |
| `guard.mjs` | Compose options that take a value, so the value is not mistaken for the subcommand. |
| `test-guard.mjs` | Runs guard.mjs on every case in guard.cases.json (T-1682): `node .claude/hooks/test-guard.mjs`. |

## .claude/skills/business-advice

| File | What it is |
|---|---|
| `SKILL.md` | Business advice for FMIP / Stadiomind - licensing of every data, news and image source (D-014: licensed data on the critical path), privacy duties for a UK-based service, costs (server, backup storage, provider plans) a… |

## .claude/skills/content-watch

| File | What it is |
|---|---|
| `SKILL.md` | Content and community for FMIP / Stadiomind - the news feeds' health (fetches, failing or silent sources, image licences, football only), the moderation queue and sanctions, and the Persian text and right-to-left displa… |
| `content-watch.sql` | The content and community agent's daily read (T-1694, D-339), read-only through the data auditor's runner: bash .claude/skills/data-audit/run.sh .claude/skills/content-watch/content-watch.sql |

## .claude/skills/daily-brief

| File | What it is |
|---|---|
| `SKILL.md` | Write the maintainer's one-page Persian brief for FMIP / Stadiomind from the team's findings and reports, the open pull requests, the task tables and pending decisions; keep the weekly plan and review and the risk log (… |

## .claude/skills/data-audit

| File | What it is |
|---|---|
| `SKILL.md` | Audit the correctness of FMIP / Stadiomind production data - scores, shoot-outs, tables, conferences, line-ups, identities, freshness, forecasts and the news pages - by read-only invariants on the server and spot checks… |
| `golden.md` | The golden set: defects we have shipped, and what must catch them |
| `invariants.sql` | The data audit's invariants (T-1680, D-326): statements that must always hold. |
| `report-template.md` | گزارش بررسی صحت داده — {تاریخ شمسی} ({YYYY-MM-DD} UTC) |
| `run.sh` | The data audit's invariants on production, read-only (T-1680, D-326). bash .claude/skills/data-audit/run.sh # prints the table, saves it bash .claude/skills/data-audit/run.sh drill.sql # any other read-only query file T… |

## .claude/skills/fmip-architecture

| File | What it is |
|---|---|
| `SKILL.md` | Architecture advice for FMIP / Stadiomind - the options and trade-offs for a substantial change, a draft decision in the project's format, module and provider boundaries (boundary-check.sh), the tech-debt register, and… |
| `boundary-check.sh` | Module boundaries of the API (CLAUDE.md section 5: a module exposes only its public service, no cross-module imports of internals) and the provider boundary (rule 2), for the architect (T-1684). bash .claude/skills/fmip… |

## .claude/skills/fmip-design

| File | What it is |
|---|---|
| `SKILL.md` | Design for FMIP / Stadiomind - mockups of a visible change on real data in the Stadiomind design system, and a design review of a page or a change's screenshots for consistency, hierarchy, accessibility (WCAG 2.2 AA), R… |

## .claude/skills/fmip-qa

| File | What it is |
|---|---|
| `SKILL.md` | Test FMIP / Stadiomind like its users and its CI - a pull request's test coverage and targeted runs, a daily smoke walk of the live site in English and Persian at phone and desktop widths (layout, RTL, overflow, console… |

## .claude/skills/fmip-review

| File | What it is |
|---|---|
| `SKILL.md` | Review an FMIP / Stadiomind branch or pull request against CLAUDE.md's rules and the project's known failure modes - canonical identity, provider isolation, coverage states, freshness, immutable forecasts, the three pre… |
| `review-checks.sh` | Mechanical checks of a branch's diff against CLAUDE.md (T-1682, D-328), for the code reviewer. bash .claude/skills/fmip-review/review-checks.sh [base] # committed branch vs base WORKTREE=1 bash .claude/skills/fmip-revie… |

## .claude/skills/fmip-security

| File | What it is |
|---|---|
| `SKILL.md` | Security for FMIP / Stadiomind - a pull request's security review (authorisation, input handling, SQL, XSS, secrets, rate limits, audit of admin actions, dependencies) and a weekly read-only check of the server and site… |
| `server-hardening.sh` | Read-only security snapshot of the production server and site (T-1684, D-328), for the security agent. bash .claude/skills/fmip-security/server-hardening.sh Lists listening ports, the SSH daemon's effective settings, th… |

## .claude/skills/model-watch

| File | What it is |
|---|---|
| `SKILL.md` | Watch the FMIP / Stadiomind forecast model's live record - each version's pre-kick-off log loss, Brier and accuracy, published against shadow on the same fixtures, drift over 28 days, by competition, calibration - and k… |
| `model-watch.sql` | The model scientist's weekly read (T-1684, D-328): the live record of every version, pre-kick-off only. |

## .claude/skills/ops-check

| File | What it is |
|---|---|
| `SKILL.md` | Production health and release checks for FMIP / Stadiomind - containers, disk, memory, build cache, watchdog conditions, backups, ingestion runs, request budget, HTTP 5xx, site probes, certificate - by a read-only snaps… |
| `ops-check.sh` | The ops agent's read-only snapshot of production (T-1682, D-328). bash .claude/skills/ops-check/ops-check.sh Feeds server-snapshot.sh to `ssh fmip-prod bash -s`, prints the result and saves it to $OPS_OUT (default E:/FM… |
| `server-snapshot.sh` | Runs ON the production server, fed by ops-check.sh over ssh (T-1682, D-328). |

## .claude/skills/product-strategy

| File | What it is |
|---|---|
| `SKILL.md` | Product, strategy and growth for FMIP / Stadiomind - turn a request or feedback into a task with acceptance criteria against the blueprint and roadmap, keep the competitor view (Sofascore, FotMob, 365Scores, ESPN, Opta-… |
| `seo-check.sh` | Read-only search and sharing health of the live site (T-1694, D-339), for the product and strategy agent. bash .claude/skills/product-strategy/seo-check.sh Fetches robots.txt, the sitemap and key pages from the server (… |

## .claude/skills/team-charter

| File | What it is |
|---|---|
| `SKILL.md` | The shared rules, finding format and folders of the Stadiomind agent team (D-328). |

## .github/workflows

| File | What it is |
|---|---|
| `ci.yml` | CI: Verify (format, lint, typecheck, test, build), E2E and E2E journeys, on every PR and main. |
| `uptime.yml` | Off-machine uptime check of the live site every 10 minutes. |

## apps/api

| File | What it is |
|---|---|
| `Dockerfile` | Built from the repository root so the lockfile and workspace packages are in context: docker build -f apps/api/Dockerfile . |
| `eslint.config.mjs` | /*.mjs'], languageOptions: { globals: { process: 'readonly', performance: 'readonly', setTimeout: 'readonly', fetch: 'readonly', console: 'readonly', }, }, rules: { 'no-console': 'off', }, }, { files: ['* |
| `package.json` | Package `@fmip/api`: FMIP backend. NestJS on the Fastify adapter.: scripts and dependencies. |
| `tsconfig.build.json` | TypeScript compiler settings. |
| `tsconfig.json` | TypeScript compiler settings. |
| `vitest.config.mts` | Vitest configuration. |

## apps/api/backtest

| File | What it is |
|---|---|
| `2026-09-13T04-16-55-420Z-E0.json` | JSON data or settings. |
| `2026-09-13T04-20-19-462Z-E0.json` | JSON data or settings. |
| `2026-09-29T13-38-35-815Z-SP1.json` | JSON data or settings. |
| `2026-09-29T13-38-47-099Z-D1.json` | JSON data or settings. |
| `2026-09-29T13-38-59-405Z-I1.json` | JSON data or settings. |
| `2026-09-29T13-39-21-592Z-F1.json` | JSON data or settings. |
| `2026-09-29T13-39-36-956Z-N1.json` | JSON data or settings. |
| `2026-09-29T13-39-48-150Z-P1.json` | JSON data or settings. |
| `2026-09-29T13-40-00-489Z-B1.json` | JSON data or settings. |
| `2026-09-29T13-40-24-078Z-T1.json` | JSON data or settings. |
| `2026-09-29T13-40-45-736Z-SC0.json` | JSON data or settings. |
| `2026-09-29T13-41-05-198Z-E0.json` | JSON data or settings. |
| `2026-09-29T14-35-14-667Z-SP1.json` | JSON data or settings. |
| `2026-09-29T14-35-16-222Z-D1.json` | JSON data or settings. |
| `2026-09-29T14-35-18-471Z-I1.json` | JSON data or settings. |
| `2026-09-29T14-35-20-072Z-F1.json` | JSON data or settings. |
| `2026-09-29T14-35-21-782Z-N1.json` | JSON data or settings. |
| `2026-09-29T14-35-23-485Z-P1.json` | JSON data or settings. |
| `2026-09-29T14-35-25-414Z-B1.json` | JSON data or settings. |
| `2026-09-29T14-35-27-585Z-T1.json` | JSON data or settings. |
| `2026-09-29T14-35-28-948Z-SC0.json` | JSON data or settings. |
| `2026-09-29T14-35-31-465Z-E0.json` | JSON data or settings. |

## apps/api/scripts

| File | What it is |
|---|---|
| `load-match-alerts.mjs` | Load measurement for match alerts (T-834, D-098): a Saturday of goals across many competitions through the real live-job path -- the ingestion job, the writers, the alert derivation, `NotificationsService.emit` and the… |
| `load-sse.mjs` | The home goals of our fixture in a scores snapshot, or null when it is not there. |
| `power-index-backtest.mjs` | Matches to accumulate before the first index is worth measuring. |

## apps/api/src

| File | What it is |
|---|---|
| `app.module.ts` | The remaining modules from `docs/02-architecture.md` are registered here as they are built. |
| `deploy-env.spec.ts` | The names .env.example documents: each `NAME=` line. |
| `http-options.ts` | How the API's HTTP application is created: by `main.ts`, and by the security spec that has to test the same server (T-813). |
| `main.ts` | Process entry point: builds and starts the application. |

## apps/api/src/cli

| File | What it is |
|---|---|
| `absence-history.spec.ts` | T-1650: the absence history from the server's terminal names an administrator and a reason before anything runs, as the backfill does, and may be narrowed to one season or one competition. |
| `absence-history.ts` | Past seasons' absences for the training store (T-1650, D-306), from a terminal on the server: docker compose run --rm -T api node dist/cli/absence-history.js \ --by you@your-domain --reason "absences for the model facto… |
| `agents-console.ts` | The agents console's server side that has no route (T-1696, T-1697, D-340), from a terminal on the server or over `ssh fmip-prod`: docker compose exec -T api node dist/cli/agents-console.js invite --name "Mostafa" ... l… |
| `backfill.spec.ts` | T-502: the season backfill from the server's terminal names an administrator and a reason, exactly as the admin page asks for them, before anything runs. |
| `backfill.ts` | The season backfill (T-030) from a terminal on the server (T-502). docker compose run --rm -T api node dist/cli/backfill.js \ --by you@your-domain --reason "six new leagues added" `--season 2025/26` reads that season in… |
| `person-link-sample.spec.ts` | T-1006: the precision sample's arguments and sheet, and the switch it gates. |
| `person-link-sample.ts` | The precision sample for linking persons to stories (T-1006, D-126). docker compose run --rm -T api node dist/cli/person-link-sample.js --size 300 Reads a random sample of stored articles that link a team and prints, on… |
| `review-ended-seasons.spec.ts` | T-1662: ended seasons' findings are reviewed from the server's terminal only with an administrator and a reason, every check or one, and a dry run marks nothing. |
| `review-ended-seasons.ts` | Ended seasons' open data-quality findings reviewed in batches (T-1662), from a terminal on the server: docker compose run --rm -T api node dist/cli/review-ended-seasons.js \ --by you@your-domain --reason "past seasons'… |

## apps/api/src/database

| File | What it is |
|---|---|
| `database.module.spec.ts` | Tests for `database.module`. |
| `database.module.ts` | Injection token for the shared `pg.Pool`. |
| `main-phase.ts` | The main competition of a season, as SQL (T-1394, D-209): what a reader means by "the Champions League" -- the league or group stage and every round after it -- and not the qualifying rounds before it. |

## apps/api/src/modules/activity

| File | What it is |
|---|---|
| `activity.http.spec.ts` | The stamped day's count of each metric. |
| `activity.module.ts` | `GET /admin/activity?days=` (T-807): how many registrations, sign-ins, predictions, messages, notifications and the rest happened per UTC day over the last `days` (30 by default, at most 90). |
| `activity.service.ts` | Activity counts per UTC day (T-807, blueprint 19). |
| `activity.spec.ts` | Tests for `activity`. |

## apps/api/src/modules/activity/internal

| File | What it is |
|---|---|
| `activity-store.ts` | A timestamp column as its UTC calendar day, `YYYY-MM-DD`. |
| `series.ts` | `?days=`: absent means the default thirty; otherwise a whole number from 1 to `ACTIVITY_MAX_DAYS`. |

## apps/api/src/modules/admin

| File | What it is |
|---|---|
| `.gitkeep` | Keeps an empty folder in git. |
| `admin.controller.ts` | `/admin/...` (T-070): the operator's view and the audited writes. |
| `admin.http.spec.ts` | Tests for `admin.http`. |
| `admin.module.ts` | The administration boundary (02-architecture.md, T-070): the operator's view across the platform and the audited high-impact writes. |
| `admin.service.ts` | The administration area (blueprint 16, T-070, D-046): reads across the platform for an operator, and the two high-impact writes Phase 1 has — an account's status and a season's declared coverage — each in one transactio… |
| `competition-order.controller.ts` | The competitions' order in the console (T-1162, D-154), administrators only, as `catalog.mjs --set-order` is the operator's: `GET /admin/competitions` lists every competition in the order readers meet them, `PUT /admin/… |
| `competition-order.http.spec.ts` | The competitions' order in the console (T-1162, D-154): administrators only; a place from 1 or `null` to clear it, always with a reason; the same audit action as `catalog.mjs --set-order`, now with the previous place; t… |

## apps/api/src/modules/admin/internal

| File | What it is |
|---|---|
| `admin-store.ts` | What an audit record says (rule 10): who, what, on which record, why, before and after. |
| `competition-order-store.ts` | The competitions' order in the console (T-1162, D-154): the same write `catalog.mjs --set-order` makes (T-504) -- `competition.display_order` and an `audit_log` row `catalog.competition_order_set` on the competition --… |

## apps/api/src/modules/agents-console

| File | What it is |
|---|---|
| `agents-console.controller.ts` | The agents console (T-1696, T-1697, D-340), under `/console/`. |
| `agents-console.http.spec.ts` | The agents console (T-1696, T-1697, D-340): an account opens only from a one-time invitation; a session is the console's own cookie; wrong passwords lock a name; nothing but signing in answers without a session; the sna… |
| `agents-console.module.ts` | The agents console (T-1696, T-1697, D-340): owns the `console_*` tables. |

## apps/api/src/modules/agents-console/internal

| File | What it is |
|---|---|
| `console-rules.spec.ts` | Tests for `console-rules`. |
| `console-rules.ts` | The agents console's rules (T-1696, T-1697, D-340), pure so they are tested without a database: the session cookie, the lock after wrong passwords, the snapshot's shape and what is withheld from it, and what a command o… |
| `console-store.ts` | The agents console's tables (T-1696, T-1697, D-340). |

## apps/api/src/modules/analysis

| File | What it is |
|---|---|
| `analysis.controller.ts` | Community-written analysis (blueprint 10.3, T-261). **Three audiences, and the route prefix says which.** `/fixtures/:id/ community-analyses` is public and needs no session — a published analysis is meant to be read. |
| `analysis.http.spec.ts` | The analysis workflow over HTTP (T-261). The acceptance criterion is **every transition is audited and every published version is immutable**, so these do not stop at status codes: each decision is followed by a read of… |
| `analysis.module.ts` | Community-written match analysis (blueprint 10.3, E26). **Its own boundary, and that is the epic's whole argument.** The obvious alternative is a second author on the founder's analysis, and it would make the founder's… |
| `analysis.service.ts` | The analysis workflow: draft → submit → review → publish (blueprint 10.3, T-261). **Every rule that could be enforced twice is enforced once, in the schema.** Whether the author holds a contributor grant is `PL014`; whe… |
| `community-analysis.schema.spec.ts` | Community-written match analysis against the real schema (T-260). |

## apps/api/src/modules/analysis/internal

| File | What it is |
|---|---|
| `analysis-store.ts` | The SQL for community-written analysis (T-260, T-261). |

## apps/api/src/modules/ask

| File | What it is |
|---|---|
| `ask-limit.http.spec.ts` | The ceilings on `GET /ask` (T-838): a guest per address, as the web app forwards it in `X-Fmip-Client-IP` (D-093), a member per account. |
| `ask.controller.ts` | `GET /ask?q=` (T-421): a question, read by the model when there is one, answered by the search. |
| `ask.http.spec.ts` | Natural-language search through the API (T-420 to T-422), with a scripted model against the seed: a readable intent finds Liverpool by id and says how the question was read; an unreadable answer, a refusal and a call th… |
| `ask.module.ts` | Natural-language search (E42): the search module's public service behind a reading the intelligence port may or may not be able to give. |
| `ask.service.ts` | The standing instruction: stable across every question, so the provider can cache it. |

## apps/api/src/modules/briefings

| File | What it is |
|---|---|
| `briefings.controller.ts` | A member's briefing (E43): `GET /me/briefing` is the document and the prose or the reason there is none; `POST /me/briefing` asks for a new version over the feed as it is now. |
| `briefings.http.spec.ts` | Briefings through the API (T-430, T-431), with a scripted model: a member who follows a team with a match in the window gets a document with that match on its day; a briefing that names it is published; one that reads m… |
| `briefings.module.ts` | Briefings (E43, Phase 5): the Following feed's public service, read into a document and, when a model exists and the member asks, written over by the model behind the intelligence port. |
| `briefings.service.ts` | Briefings (E43): the feed's window as a document (T-430), a machine's prose over it (T-431) that the gate holds to the document, and the prose as a notification (T-432). |

## apps/api/src/modules/briefings/internal

| File | What it is |
|---|---|
| `briefing-document.ts` | The feed's span as a digest (T-430): the items the feed already ranked, grouped by the day they are about, each by id. |
| `briefing-store.ts` | Briefing versions (T-431): a member's own, written once, read by them. |

## apps/api/src/modules/campaigns

| File | What it is |
|---|---|
| `campaign-scale.http.spec.ts` | A large campaign is carried in one send (T-837). |
| `campaigns.controller.ts` | Campaigns for administrators (T-332, D-075). |
| `campaigns.http.spec.ts` | Campaigns through the API (T-332, D-075): an audience is a saved filter with a size; a campaign is sent once, to every active member the filter reaches, through the inbox -- a member who turned the kind off is muted, no… |
| `campaigns.module.ts` | Campaigns (T-332, D-075): an audience is a saved query, a send is a row. |
| `campaigns.service.spec.ts` | Campaign emission a page at a time (T-903, D-107): one inbox statement and one outcome statement per page, every member in exactly one page, and a page the inbox could not write counted as failed without stopping the re… |
| `campaigns.service.ts` | Campaigns (T-332, D-075): an audience is a saved query, a send is a row. |

## apps/api/src/modules/campaigns/internal

| File | What it is |
|---|---|
| `campaign-store.ts` | Campaign rows (T-332, D-075): every statement in one place. |

## apps/api/src/modules/catalog

| File | What it is |
|---|---|
| `bracket.spec.ts` | Tests for `bracket`. |
| `catalog.controller.ts` | `?min_minutes=` on the competition page (T-824): a whole number of minutes from 1 to `LEADERS_MINUTES_MAX`; absent or `0` is no floor. |
| `catalog.http.spec.ts` | Registration offers these rows and requires one, so a database the seed never touched -- every production one -- must hold them from its migrations (D-078). |
| `catalog.module.ts` | The catalog boundary's read side: summary lists for forms, the competition page (T-035), the team page (T-036) and the player page (T-037). |
| `catalog.service.ts` | The catalog boundary's read side: the lists a form or a follow control needs, the competition page (T-035) and the team page (T-036). |
| `catalog.spec.ts` | Tests for `catalog`. |
| `coaches.http.spec.ts` | `GET /coaches/:id` and the team page's `head_coach` (T-1439, D-230) against the real schema: a coach page for a person the provider described as a coach or a line-up named so, 404 for anyone else, the career with crests… |
| `competition-context.http.spec.ts` | Tests for `competition-context.http`. |
| `competition-context.spec.ts` | Tests for `competition-context`. |
| `competition-directory.http.spec.ts` | A language subtag no product locale uses, so the order this spec states is its own and a parallel spec's order for `en` is never read or disturbed. |
| `competition-leaders.http.spec.ts` | Tests for `competition-leaders.http`. |
| `competition.http.spec.ts` | Tests for `competition.http`. |
| `follow-suggestions.http.spec.ts` | Tests for `follow-suggestions.http`. |
| `leader-boards.http.spec.ts` | A finished match; returns the home and away participant ids. |
| `leaders.spec.ts` | Tests for `leaders`. |
| `localised-names.schema.spec.ts` | Localised entity names, against the real schema (T-303). |
| `main-phase.http.spec.ts` | T-1394 (D-209) against the real schema: a cup's season is its main competition. |
| `player-availability.http.spec.ts` | The player page's current availability (T-1007, D-127) against the real schema: the team's next scheduled match, and what the feed's absence list says about the player for it -- nothing until the feed was asked, "not li… |
| `player-club.spec.ts` | T-1629 (D-295): the club a player page names. |
| `player-position.spec.ts` | T-1603: a player's position from what our records say, never a guess. |
| `player-provider-seasons.http.spec.ts` | `GET /players/:id/provider-seasons` (T-1431, D-223) against the real schema: nothing until the provider was asked, the latest season's lines with the ones our own record counts marked so, the career team by team, and `l… |
| `player.http.spec.ts` | Tests for `player.http`. |
| `provider-leaders.spec.ts` | Tests for `provider-leaders`. |
| `team-season-stats.http.spec.ts` | `GET /teams/:id/season-stats` (T-1437, D-228) against the real schema: nothing until the provider was asked, then the stored season whole, the seasons to choose from, `?season=` picking one, and `limited` where the prov… |
| `team-splits.http.spec.ts` | Tests for `team-splits.http`. |
| `team-splits.spec.ts` | Tests for `team-splits`. |
| `team.http.spec.ts` | No stored photo for a squad member (T-1321): the state, not an empty string. |
| `transfers.http.spec.ts` | `GET /teams/:id/transfers` and `GET /players/:id/transfers` (T-1440, D-231) against the real schema: nothing until the provider was asked, arrivals and departures with our clubs and players linked and the rest as the pr… |

## apps/api/src/modules/catalog/internal

| File | What it is |
|---|---|
| `bracket.ts` | The knockout bracket of a continental cup (blueprint 5.1, T-630), built from the season's stored fixtures and nothing else. |
| `coach-read.spec.ts` | Tests for `coach-read`. |
| `coach-read.ts` | The coaches' read side (T-1439, D-230): the coach page and the team page's head coach, from `coach_spell` (the provider's careers at the teams we carry), `coach_fetch`, `team_coach_fetch` and the line-ups' coach referen… |
| `competition-context.ts` | The match centre's competition context (T-840, blueprint 4.2), the pure half: which part of the competition a match belongs to, and a side's line in a table with the gaps our records can state. |
| `competition-store.ts` | SQL for the competition page (T-035). Reads only. |
| `fixture-checks.ts` | When a page's whole list of matches was last answered by the provider, changed or not (T-1633, D-296), for the club page's and the competition page's footers. |
| `fixture-media.spec.ts` | Crests and logos on the lists of matches (T-1617): each side's crest and the competition's logo from the page's one media read, `not_supplied` for an entity with none, never a stand-in (rule 3). |
| `fixture-media.ts` | Crests and logos on the lists of matches (T-1617): the competition, team and player pages name both sides of every fixture, and each side's crest comes from our own origin, read with the page's other media in one query… |
| `leaders.ts` | Matches played, or null when no line-up (nor provider line) names the player (T-1441). |
| `player-provider-seasons.ts` | The player page's provider seasons and career (T-1431, D-223), read from what the `player_seasons` job stored. |
| `player-store.ts` | The minutes of one season row (T-823): whole only when every match the player played carries the feed's minutes; a partial sum is never `total`. |
| `provider-leaders.ts` | The only provider whose season totals we keep (T-1431). |
| `team-season-stats.ts` | The team page's season statistics (T-1437, D-228), read from what the `team_seasons` job stored. |
| `team-splits.ts` | One finished fixture of the team as the splits read it (T-632): which side it was on, the score after extra time where one was played (null when we hold none), whether a shoot-out followed, and the team's own statistics. |
| `team-store.ts` | SQL for the team page (T-036). Reads only. |
| `transfers.ts` | A club's and a player's transfers (T-1440, D-231), read from what the `transfers` job stored. |

## apps/api/src/modules/channel-post

| File | What it is |
|---|---|
| `channel-post.http.spec.ts` | The daily post against the real schema (T-525): the day is claimed once however many instances tick at the same moment, a refused day is taken over while a failed one never is, a day with no match leaves no row, the pos… |
| `channel-post.module.ts` | `GET /health/channel` (T-525): whether a channel is configured, whether this instance posts to it, and how the newest day went. |
| `channel-post.port.ts` | A public channel the product posts to (T-525), behind one port. |
| `channel-post.service.ts` | The posts to a public channel: each day the day's matches with the statistical model's forecast (T-525), each linking to its match page; the previous day's finished matches against the model's last forecast before kick-… |
| `channel-post.spec.ts` | The store's rules without a database; `channel-post.http.spec.ts` proves the SQL keeps them. |

## apps/api/src/modules/channel-post/internal

| File | What it is |
|---|---|
| `channel-post-store.ts` | `channel_post` (T-525): one row per kind of post and day (T-1430), the primary key being the whole of "at most once". |
| `daily-post.spec.ts` | Tests for `daily-post`. |
| `daily-post.ts` | The day's post, as text (T-525). Pure: which matches, in what order, in what words, split into how many messages -- every rule here is tested without a database or a channel. **It is the statistical model's and says so… |
| `pack.ts` | How every channel post is cut into messages (T-525, shared since T-1430): at competition boundaries, each message under the channel's ceiling and opening with the post's own header, so a message read alone still says wh… |
| `results-post.spec.ts` | Tests for `results-post`. |
| `results-post.ts` | The previous day's results against the statistical model (T-1430, D-222), as text. |
| `telegram-channel.spec.ts` | Tests for `telegram-channel`. |
| `telegram-channel.ts` | The Telegram adapter behind the channel port (T-525): the Bot API's `sendMessage`, over `fetch`, with no dependency. |
| `weekly-post.spec.ts` | Tests for `weekly-post`. |
| `weekly-post.ts` | The statistical model's accuracy over one ISO week (T-1430, D-222), as text. |

## apps/api/src/modules/consensus

| File | What it is |
|---|---|
| `consensus-list.controller.ts` | `GET /consensus?fixtures=<id>,<id>` (T-136). |
| `consensus.controller.ts` | `GET /fixtures/:id/consensus` (T-134, blueprint 6.6). |
| `consensus.http.spec.ts` | Community consensus over HTTP (T-134, blueprint 6.6). |
| `consensus.module.ts` | The community consensus boundary (blueprint 6.6, T-134). |
| `consensus.service.ts` | The community consensus boundary (blueprint 6.6, T-134). |
| `consensus.spec.ts` | The consensus arithmetic (T-134, blueprint 6.6). |

## apps/api/src/modules/consensus/internal

| File | What it is |
|---|---|
| `consensus-store.ts` | The SQL for community consensus (T-134). All of it, and nothing else. It reads `user_prediction` / `prediction_version` and `rating_snapshot` directly rather than through the predictions and reputation services. That is… |
| `distribution.ts` | Turning a fixture's standing predictions into the two distributions blueprint 6.6 asks for (T-134). |

## apps/api/src/modules/conversations

| File | What it is |
|---|---|
| `chat-fanout.spec.ts` | The acceptance criterion for T-231: **a message sent through one instance reaches a socket held by another.** So the suite runs two complete API instances against one Postgres and one Redis, which is what production is. |
| `chat-health.controller.ts` | `GET /health/chat` (T-233). Public and read-only, like `/health/live` (T-071) beside it. It names no member, no conversation and no message — only how many of each there are — because an operational number that identifi… |
| `chat-live-cards.spec.ts` | The acceptance criterion for T-232: **a score change updates a shared card without a new message.** Blueprint 8.3 puts it as "match cards shared in chat remain live; the score and status update without replacing the ori… |
| `chat.gateway.spec.ts` | The acceptance criterion for T-230, over a real socket against the real schema: **a socket can only ever carry conversations its member participates in** — at subscribe time, and again at delivery, because membership ca… |
| `chat.gateway.ts` | "A fixture moved" (T-232), as the gateway needs it. |
| `conversations.controller.ts` | Conversations over HTTP (blueprint 8.3, T-221). |
| `conversations.http.spec.ts` | The acceptance criterion for T-221, over HTTP with real sessions and the real schema: **a blocked or sanctioned member cannot send, and every conversation can be left.** `SocialModule` is here because a direct conversat… |
| `conversations.module.ts` | Which origins may open a chat socket (T-230). |
| `conversations.schema.spec.ts` | Conversations against the real schema (T-220). |
| `conversations.service.ts` | SQLSTATEs the T-220 triggers raise. |
| `group-threads.http.spec.ts` | Match threads inside a group (T-244), against the real schema. **"A thread is a conversation about a fixture, and says which."** Both clauses are tested for what they actually claim. *A conversation*: it arrives in the… |

## apps/api/src/modules/conversations/internal

| File | What it is |
|---|---|
| `chat-bus.ts` | What happened, and where. One shape on the wire between instances. |
| `conversations-store.ts` | The SQL for conversations (T-221). All of it, and nothing else. The refusals are not here. Who may write, whether a block stands, whether a sanction is in force, whether the sender is over the ceiling, and what number a… |

## apps/api/src/modules/data-quality

| File | What it is |
|---|---|
| `data-quality-scheduler.service.ts` | The data-quality sweep's BullMQ queue and worker (T-820). |
| `data-quality.controller.ts` | The data-quality findings for administrators (T-821): `GET /admin/data-quality` (each check's newest run, open findings per competition and check, the open findings themselves) and `POST /admin/data-quality/:id/review`… |
| `data-quality.http.spec.ts` | A second season of the same competition, which no sweep here is narrowed to. |
| `data-quality.module.ts` | Data-quality checks over the stored feed (T-820, E82) and their admin surface (T-821). |
| `data-quality.service.ts` | Rows to findings for every swept check. Pure; exported for the unit tests. |
| `data-quality.spec.ts` | Tests for `data-quality`. |

## apps/api/src/modules/data-quality/internal

| File | What it is |
|---|---|
| `checks.ts` | The data-quality checks (T-820), each a pure function from rows the store read to a finding or nothing. |
| `coverage-proposals.ts` | What the findings mean for a past season's coverage (T-914, D-109). |
| `data-quality-store.ts` | The key of the transaction-scoped advisory lock one write holds (T-820): a sweep and the standings job's table comparison never resolve each other's rows halfway through, and two sweeping processes do not both write. |

## apps/api/src/modules/delivery

| File | What it is |
|---|---|
| `delivery.http.spec.ts` | A deployment with no provider says so and delivers nothing (T-330): `/health/delivery` reports both channels absent, and the inbox carries the same fact on every page so a member is told rather than left waiting. |
| `delivery.module.ts` | `GET /health/delivery` (T-330): which channels this deployment can carry a notification on. |
| `delivery.port.ts` | Thrown by a channel that exists when this member has nowhere to receive on it -- no device registered for push. |
| `delivery.service.ts` | What happened on one channel: absent, sent, failed, or skipped because this member has nowhere to receive on it. |
| `delivery.spec.ts` | The port's honest half (T-330): with no provider, both channels are absent and say so; a provider name this build cannot drive stops the process instead of silently becoming "absent"; delivering into absence is an outco… |

## apps/api/src/modules/delivery/internal

| File | What it is |
|---|---|
| `push-subscriptions.ts` | A member's devices for Web Push (T-330, D-074): one row per browser registration -- the endpoint its push service handed out and the two keys a message is encrypted with. |
| `smtp-email.spec.ts` | The SMTP channel (D-073): named without its connection or its sender it refuses to start; with both, every message goes out from the configured sender with the recipient, subject and text the port handed it. |
| `smtp-email.ts` | The e-mail channel (T-330, D-073): SMTP, which every transactional e-mail service speaks and no vendor owns, so the deployment chooses the service and this build does not. |
| `webpush.spec.ts` | The Web Push channel (D-074): named without its keys or its subject it refuses to start; a push goes to every device the member registered, a device whose service says it is gone is removed, and a member with no device… |
| `webpush.ts` | The push channel (T-330, D-074): Web Push, the standard every browser's push service speaks, signed with a VAPID key pair the deployment generated once. |

## apps/api/src/modules/failure-counts

| File | What it is |
|---|---|
| `failure-counts.http.spec.ts` | Waits for the background upserts the response hook started. |
| `failure-counts.module.ts` | `GET /admin/health/failures?hours=` (T-803): 5xx responses per route and failed jobs per queue over the last `hours` (24 by default, at most the thirty days kept). |
| `failure-counts.service.ts` | How often, at most, a process deletes the buckets past the retention. |
| `failure-counts.spec.ts` | Tests for `failure-counts`. |

## apps/api/src/modules/failure-counts/internal

| File | What it is |
|---|---|
| `failure-counts-store.ts` | The SQL for `http_error_count` and `job_failure_count` (T-803). |
| `summarise.ts` | The arithmetic of T-803's counts, pure so it is tested without a database: which hour a failure belongs to, how long a window may be, and how the stored rows become one entry per route and per queue. |

## apps/api/src/modules/fixtures

| File | What it is |
|---|---|
| `covered.spec.ts` | Tests for `covered`. |
| `fixtures.module.ts` | The fixtures boundary (02-architecture.md): matches, incidents, lineups, statistics and coverage. |
| `fixtures.service.ts` | The fixtures boundary's read side: the scores list (T-030) and the match centre (T-033). |
| `freshness.spec.ts` | Tests for `freshness`. |
| `key-players.http.spec.ts` | A fixture; returns the participant id of each team. |
| `key-players.spec.ts` | Tests for `key-players`. |
| `live-answer.http.spec.ts` | T-1394 (D-209) against the real schema: a match whose stored clock stands still is measured from the live list's last answer as well as its last change, so half-time is `current` while the provider answers; in play an u… |
| `match-centre.controller.ts` | `GET /fixtures/:id`: the match centre payload (T-033). |
| `match-centre.http.spec.ts` | Tests for `match-centre.http`. |
| `scores.controller.ts` | `GET /scores?from=&to=&tz=&live=&favourites=&country=&competition=&stage=&gender=&age=`. |
| `scores.http.spec.ts` | Tests for `scores.http`. |
| `scores.spec.ts` | Tests for `scores`. |
| `shared-snapshots.spec.ts` | A read the test finishes by hand, and a count of how many were started. |
| `sse.spec.ts` | Tests for `sse`. |
| `stream.controller.ts` | Tunables the tests shorten; production takes the defaults. |
| `stream.http.spec.ts` | Reads SSE events off a fetch body. One reader for the life of the connection; `collect` returns once `until` is satisfied or the deadline passes, keeping what it has read so a second call continues the stream. |

## apps/api/src/modules/fixtures/internal

| File | What it is |
|---|---|
| `arrange.ts` | Pinning and grouping (blueprint 4.1): favourites above the standard list, the rest grouped by competition under its country. |
| `change-feed.ts` | LISTENs on Postgres for fixture changes and fans them out in-process (D-034). |
| `covered.ts` | How stored rows and a season's declared coverage become one `Covered` module (blueprint 4.3). |
| `freshness.ts` | The freshness rule (rule 4, T-083, D-045), pure so it is tested without a clock. |
| `key-players-store.ts` | SQL for the key players (T-841). Reads only: the season's finished matches of a team before a kick-off and the per-match player figures (T-101) of that team's side in them. |
| `key-players.ts` | The key-players rule (T-841), pure so it is one tested function: the players with the most minutes for the team in this competition's season before the match; a tie on minutes goes to more goals plus assists, then the n… |
| `live-answer.ts` | When the provider's live list last answered while a match was live or suspended (T-1394, D-209), as SQL over the fixture `id` expression given: the newest completed `live` ingestion run, of a provider the fixture is map… |
| `match-centre-store.ts` | The window of recent matches the form and head-to-head modules show. |
| `scores-query.ts` | Parsing and validation of `GET /scores` query parameters. |
| `scores-store.ts` | A card plus the country its competition belongs to, for grouping. |
| `shared-snapshots.ts` | One read and one serialisation per distinct snapshot at a time -- the first remedy in `docs/08-load-test.md`, "What limits it". |
| `sse.ts` | Server-sent events, by hand: the format is four field names and a blank line, and a dependency would hide the one thing that matters here — that every event carries an `id` (the snapshot time) so a client that reconnect… |

## apps/api/src/modules/following-feed

| File | What it is |
|---|---|
| `following-feed.http.spec.ts` | The Following feed (T-333, blueprint 12.1) over the real tables: a member follows one club as a favourite and one competition, and follows one contributor; around them are a match tomorrow, a story, the founder's analys… |
| `following-feed.module.ts` | `GET /me/feed` (T-333). A member's own; a guest has nothing to follow. |
| `following-feed.service.ts` | The Following feed (blueprint 12.1, T-333): what happened, and what is about to, around the teams, competitions and contributors a member follows -- matches, stories, the founder's analyses and followed contributors' po… |

## apps/api/src/modules/following-feed/internal

| File | What it is |
|---|---|
| `following-feed-store.ts` | The reads behind the Following feed (T-333), each bounded by the window and by what the member follows, and each carrying the facts the ranking names -- never a count of views, which nothing here records. |

## apps/api/src/modules/forecast

| File | What it is |
|---|---|
| `accuracy.http.spec.ts` | T-1369 against the real schema: RPS computed when read agrees with `rps()`, the week boundary is the database's (Monday, UTC), the console's series keep each version and role apart, and the public page serves the publis… |
| `candidate-records.spec.ts` | Tests for `candidate-records`. |
| `candidates.controller.ts` | The candidates' shadow records for the console (T-1103, D-140): read-only, administrators only (a member gets `forbidden`, D-108). |
| `candidates.store.spec.ts` | T-1103 against the real schema: each candidate's pre-kick-off record and its pairs with the published version, from the stored evaluations. |
| `evaluation.controller.ts` | Evaluations are read by anyone; running one is an operator action over HTTP (the result-ingestion job of E2 will call the service directly). |
| `evaluation.http.spec.ts` | Runs statements in one transaction so trigger toggles never leak to another suite. |
| `evaluation.service.ts` | Post-match evaluation (T-066): once a fixture has a full-time score, every available forecast version is scored against it, once, immutably. |
| `forecast-competitions.store.spec.ts` | Which fixtures the forecast treats as clubs of different leagues (T-503), against the real schema: a continental cup's are; a national-team competition's are not (T-1332), since the model holds no history for national t… |
| `forecast-list.controller.ts` | `GET /forecasts?fixtures=<id>,<id>` (T-136). |
| `forecast-module.spec.ts` | Tests for `forecast-module`. |
| `forecast-shadow.store.spec.ts` | T-531 against the real schema: a shadow version is stored like any forecast, numbered within its own role, and absent from every read the product serves. |
| `forecast-triggers.service.spec.ts` | Tests for `forecast-triggers.service`. |
| `forecast-triggers.service.ts` | Fixtures inside the window that were considered. |
| `forecast-triggers.spec.ts` | A fixture's newest published version, made a day before `NOW` (fit through the day before that). |
| `forecast.controller.ts` | `/fixtures/:id/forecasts`. Reading is public: the forecast is a product surface. Computing a version is an operator action (the ingestion jobs will call the service directly, T-026); over HTTP it needs an admin session. |
| `forecast.http.spec.ts` | A seeded fixture the model has never been asked about. |
| `forecast.module.ts` | `MODEL_SERVICE_URL=off`: this deployment has no model service, and says so. |
| `forecast.service.ts` | The forecast boundary (T-064): asks the model, stores what it was asked and what it answered as an immutable version, and serves the versions. |
| `forecast.spec.ts` | A store that remembers what it was asked to write and echoes it back. |
| `model-accuracy.spec.ts` | Accuracy over time (T-1369, D-187), as arithmetic: the sums the store reads added up per period and in total, divided once, and each row's coverage read from its match count. |
| `model-client.spec.ts` | Tests for `model-client`. |
| `power-index-backtest.spec.ts` | Matches where the home side wins more often the larger its index lead. |
| `power-index-measure.spec.ts` | A round-robin division where team strength is by construction ordered. |
| `power-index-note.spec.ts` | T-1602: every note the measures write reads back to a code and its numbers, so a Persian page never shows the English sentence. |
| `power-index-squad.spec.ts` | T-112, D-081: the two Power Index components our own match records reach. |
| `power-index.controller.ts` | `/fixtures/:id/power-index` (T-114, blueprint 6.1). |
| `power-index.http.spec.ts` | Tests for `power-index.http`. |
| `power-index.service.spec.ts` | Tests for `power-index.service`. |
| `power-index.service.ts` | The Power Index (blueprint 6.1, T-111). Measures the components from the training history and our own schedule, combines them with the published weights (T-110), and stores the result as an immutable row. Computing twic… |
| `power-index.spec.ts` | Tests for `power-index`. |
| `power-index.store.spec.ts` | Tests for `power-index.store`. |
| `scoring.spec.ts` | Tests for `scoring`. |

## apps/api/src/modules/forecast/internal

| File | What it is |
|---|---|
| `candidate-records.ts` | Every candidate's shadow record (T-1103): each model version with stored shadow forecasts, and each the model service offers now even before its first forecast (a count of zero, never absent). |
| `evaluation-store.ts` | SQL for the evaluation side of the forecast boundary (D-025). |
| `forecast-store.ts` | What the store needs to know about a fixture to ask the model. |
| `forecast-triggers.ts` | When a forecast version is due (T-120, blueprint 6.4). |
| `model-accuracy.ts` | Model accuracy over time (T-1369, D-187), as pure arithmetic over the sums `PostgresEvaluationStore.accuracySums` reads: one row per competition and week or month (and, for the console, per model version and role). |
| `model-client.ts` | The API's side of the internal contract with the model service (T-063). |
| `power-index-backtest.ts` | Validating the Power Index weights against history (T-113). |
| `power-index-measure.ts` | Measuring the Power Index components (T-111). |
| `power-index-note.ts` | A Power Index component's note in our words (T-1602). |
| `power-index-squad.ts` | The two Power Index components our own match records can reach once a paid feed supplies line-ups and player ratings (T-112, D-081): line-up quality and stability. |
| `power-index-store.ts` | What the Power Index needs from the database (T-111). |
| `power-index.ts` | The Power Index formula (blueprint 6.1, T-110). |
| `rounding.ts` | Three probabilities that total exactly 1 at `digits` decimals (blueprint 6.2: "must always total 100% after rounding"). |
| `scoring.ts` | How one forecast version did against a full-time score. |

## apps/api/src/modules/founder

| File | What it is |
|---|---|
| `founder-feed.controller.ts` | `GET /founder-analyses` (T-132). The one endpoint behind three of the surfaces the blueprint names: the homepage, the team page and the competition page. Public, and upcoming matches only. A bad filter is ignored rather… |
| `founder.controller.ts` | `/fixtures/:id/founder-analysis` (T-131, blueprint 6.5). |
| `founder.http.spec.ts` | Tests for `founder.http`. |
| `founder.module.ts` | The founder's analysis boundary (blueprint 6.5, T-131). |
| `founder.service.ts` | The founder's analysis boundary (blueprint 6.5, T-131). |
| `founder.spec.ts` | Tests for `founder`. |

## apps/api/src/modules/founder/internal

| File | What it is |
|---|---|
| `founder-store.ts` | The SQL for the founder's analysis (T-131). |
| `validate.ts` | Validating a published analysis (T-131). Pure, and deliberately not a schema library: the rules are few, they are the blueprint's, and every message here is one a person reads while writing. The database enforces the sa… |

## apps/api/src/modules/groups

| File | What it is |
|---|---|
| `group-conversation.spec.ts` | The acceptance criterion for T-245: **membership changes take effect on the conversation immediately.** "Immediately" here means *with nothing to synchronise*. |
| `group-invite-links.controller.ts` | Invite links over HTTP (blueprint 8.2, T-1021, D-132). |
| `group-invite-links.http.spec.ts` | Invite links over HTTP, against the real schema (T-1021, D-132). |
| `group-invite-links.service.ts` | Why a link verb was refused. `gone` is a dead link that is allowed to say which kind of dead it is (`message`); a dead link to an invite-only group is `not_found` instead, because the group is not findable and a dead li… |
| `group-polls.controller.ts` | Group polls over HTTP (blueprint 8.2, T-643, D-091), under the group they belong to. |
| `group-polls.http.spec.ts` | Group polls over HTTP, against the real schema (T-643, D-091). |
| `group-polls.service.ts` | Why a poll verb was refused. `members_only` is not `forbidden`: one says polls are for the people *in* the group, the other that this is for the people who *run* it (or, for closing, who asked). |
| `groups.controller.ts` | Groups over HTTP (blueprint 8.2, T-241). **Two doors, not one endpoint that means two things.** `POST /groups/:slug/members` joins a public group; `POST /groups/:slug/requests` asks a discoverable one. |
| `groups.http.spec.ts` | Groups over HTTP, against the real schema (T-241). |
| `groups.module.ts` | The groups boundary (blueprint 8.2 and the exclusive groups of 10.1, T-241). |
| `groups.schema.spec.ts` | Groups against the real schema (T-240). Nothing in the API writes these tables yet — T-241 is the service — so this writes what the service will write and checks the half that belongs to the database. Here that half is… |
| `groups.service.ts` | How many groups a directory page shows. |
| `invite-links.spec.ts` | Accepting a group's rules (T-1023): the three answers. |
| `polls.spec.ts` | Group polls' pure half (T-643, D-091): the shape of a valid poll and what a viewer sees. |

## apps/api/src/modules/groups/internal

| File | What it is |
|---|---|
| `group-summary.ts` | A BCP 47 tag, the same shape a member's preferred language has (T-020). |
| `groups-store.ts` | A group as every read of one returns it, with its size. |
| `invite-links-store.ts` | A link as its managers read it, with its state decided by the database clock. |
| `polls-store.ts` | How many polls a group page lists: every open one (at most three) and the latest closed. |
| `polls.ts` | Group polls' pure half (T-643, D-091): what a valid poll is, and what one viewer is shown of a stored one. |

## apps/api/src/modules/health

| File | What it is |
|---|---|
| `backup-verdict.spec.ts` | The Backups line of `deploy/check-setup.sh` (T-1427, D-219), run as it ships: the function is sourced from the file and called through bash, not copied here. |
| `health.controller.ts` | — |
| `health.module.ts` | — |
| `health.service.ts` | Liveness only: it answers "this process is running and can serve HTTP". |
| `health.spec.ts` | Tests for `health`. |
| `report-capabilities.spec.ts` | `deploy/report-capabilities.mjs` (T-075) as it actually ships: the file is run, not a copy of its logic, because it runs on the server through `node -` inside the container and nothing else would catch it drifting. |

## apps/api/src/modules/homepage

| File | What it is |
|---|---|
| `homepage-feature.controller.ts` | Featured matches on the homepage (blueprint 2.3 and 16, T-1161, D-153). |
| `homepage-feature.http.spec.ts` | Featured matches on the homepage (T-1161, D-153): only an editor or an administrator features, with a note and a window; a guest reads what is featured; an expired feature is gone at the next read with no job; clearing… |
| `homepage.module.ts` | The homepage's editorial placement (T-1161, D-153): which matches an editor features, and for how long. |
| `homepage.service.ts` | The homepage module's public surface for other boundaries (T-1641): which matches an editor features now (T-1161, D-153), the same features `GET /featured-matches` lists, so the moments' big one (D-299) ranks a featured… |

## apps/api/src/modules/homepage/internal

| File | What it is |
|---|---|
| `feature-store.ts` | Featured matches on the homepage (T-1161, D-153): featuring and clearing, each with its `audit_log` row in the same transaction (rule 10), target type `fixture`. |

## apps/api/src/modules/identity

| File | What it is |
|---|---|
| `account-deletion.http.spec.ts` | A settled prediction, written the way settlement leaves it; the lock trigger is why it is in here. |
| `auth-rate-limit.http.spec.ts` | A documentation-range IPv6 address nobody else's run will use. |
| `data-export.http.spec.ts` | Tests for `data-export.http`. |
| `identity.controller.ts` | A second copy of one's data within a day (D-158): when the next is possible, in hours. |
| `identity.http.spec.ts` | Tests for `identity.http`. |
| `identity.module.ts` | Options from the environment. Refuses a missing or weak SESSION_SECRET. |
| `identity.service.ts` | Registration, sessions, e-mail verification and password reset (T-040). |
| `identity.spec.ts` | Tests for `identity`. |
| `platform-rules.http.spec.ts` | Take the test version away again. Any account another spec registered while it was in force is put back on 1.0.0, which is what it would have accepted without this spec: its acceptance is moved to 1.0.0 rather than dele… |

## apps/api/src/modules/identity/internal

| File | What it is |
|---|---|
| `account-deletion-store.ts` | What one deletion did, beyond the account itself. |
| `auth-rate-limit.ts` | Rate limits before signing in (T-810, D-093). |
| `cookies.ts` | The session cookie, by hand. A dozen lines of RFC 6265 is smaller than a plugin, and every attribute below is a security decision that should be visible in this file rather than in a library default. |
| `data-export-store.ts` | The audit action of a copy of a member's data (T-846, D-158). |
| `delivery-mailer.spec.ts` | Identity's mail through the delivery port (D-073): sent by the e-mail channel where there is one, printed by the fallback where there is none or the send failed, never thrown. |
| `delivery-mailer.ts` | Identity's mail through the delivery port (D-073): the verification and the reset links leave by the same e-mail channel every notification uses, and where the deployment has none they are printed as before (D-026), so… |
| `identity-store.ts` | A `user_account` row as the queries below return it. |
| `mailer.ts` | Outbound e-mail as a port. The identity service composes messages; how they leave the process is a deployment decision (D-026 defers the provider to T-074). Until then `LogMailer` prints them, which is also exactly what… |
| `password.ts` | Constant-time comparison against a stored hash. |
| `platform-rules-store.ts` | The version in force: the highest version number published, compared as numbers (`1.10.0` after `1.9.0`), never by timestamp, so a clock cannot reorder two publications (T-931, D-113). |
| `tokens.ts` | Opaque tokens for sessions and e-mailed links. |
| `validation.ts` | Request validation, by hand and per field, producing the `fields` map the `ApiError` contract promises. |

## apps/api/src/modules/ingestion

| File | What it is |
|---|---|
| `absence-history.service.ts` | Past seasons' absences for the training store (T-1650, D-306), run by the operator's command `dist/cli/absence-history.js` and never scheduled. |
| `backlog-batch.spec.ts` | T-501: the post-match backlog's pace is the deployment's to raise, within reason. |
| `coverage.service.ts` | Coverage profile computation and freshness (T-027). |
| `coverage.spec.ts` | Tests for `coverage`. |
| `fixture-window.spec.ts` | T-505: a week around now every hour, and the rest of the season once a day. |
| `incident-repeats.spec.ts` | T-1394 (D-209): a booking, a sending-off or a substitution the provider's list carries twice is written once. |
| `ingest-runs.http.spec.ts` | Competitions this file created, removed with everything hanging off them. |
| `ingest-runs.service.ts` | One ingestion job's newest completed run (T-801's watchdog). |
| `ingestion-admin.controller.ts` | `POST /admin/ingestion/backfill` (T-030): the season's fixtures from its start, once. |
| `ingestion-jobs.service.ts` | How far back and forward the fixtures job looks, in days. |
| `ingestion-jobs.spec.ts` | The provider ids in the recordings, and the rows we map them to. |
| `ingestion-scheduler.service.ts` | The BullMQ queue and worker that run the ingestion jobs on a schedule (T-026). |
| `ingestion-scheduler.spec.ts` | Tests for `ingestion-scheduler`. |
| `ingestion.controller.ts` | `GET /health/ingestion` (T-071): the newest ingest runs, the last failure and the failure count of the last day, read from `ingest_run` — so an ingest failure is visible without SSH. |
| `ingestion.module.ts` | The ingestion boundary (02-architecture.md). |
| `ingestion.service.ts` | Resolves provider ids to internal UUIDs, queueing the unknown ones. |
| `ingestion.spec.ts` | The port, in memory. It has no way to create an entity at all, which is the structural version of "never silently created": the resolver could not do it even by mistake. |
| `lineup-answer.spec.ts` | T-1376: a line-up not announced yet is the provider's answer, not a refusal. |
| `live-answer-notify.http.spec.ts` | T-1394 (D-209): a match the live list answered about without a change is told to the open pages as a `fixture_change` notification, the shape the row triggers raise, so every stream re-sends its snapshot with the new `l… |
| `live-question.spec.ts` | T-501: the live job asks the provider once a tick, not once per competition, and every fixture in the answer goes back to the competition it came from. |
| `refetch-share.spec.ts` | T-913, D-110: the re-ask queue spends a stated share of the day's budget, and never the rest. |
| `season-coverage.spec.ts` | Tests for `season-coverage`. |
| `table-gap.spec.ts` | T-030: the provider's table as a check on ours, without false alarms. |

## apps/api/src/modules/ingestion/internal

| File | What it is |
|---|---|
| `absence-history-store.spec.ts` | The absence history's SQL on a database (T-1650, D-306): which past seasons are asked, the upsert that finds the match, the club and the player through `provider_mapping` only, the player kept by the provider's id until… |
| `absence-history-store.ts` | The SQL of the absence history (T-1650, D-306). |
| `absence-history.spec.ts` | T-1650 (D-306): the absence history asks each past season once, skips the seasons the provider says it does not cover, stays inside the bulk tier, and stops at a quota refusal. |
| `absence-history.ts` | Past seasons' absences, for the training store only (T-1650, D-306). |
| `ask-pacer.spec.ts` | Tests for `ask-pacer`. |
| `ask-pacer.ts` | Spaces a job's bulk asks to the provider (T-1422). |
| `budget-tier.spec.ts` | Sends one request as `tier` and answers its status. |
| `budget-tier.ts` | Which part of the day's request budget a request may draw on (T-1365, D-183). |
| `club-colour.spec.ts` | A club's colour from the shirts it wore at home (T-1416, D-218): each line-up's shirts are stored on the match, and the club's colour is the one worn most often in its latest ten home matches with a shirt -- unless an e… |
| `club-facts-store.spec.ts` | The club-and-ground pass's SQL on a database (T-1438, D-229): which seasons and grounds are owed an ask, what a season's teams write -- a club's founding year and home ground, the ground's facts, never a national team's… |
| `club-facts-store.ts` | The provider's id for an internal id of `type`, the lowest when there are two. |
| `club-facts.spec.ts` | The club-and-ground pass (T-1438, D-229) against a fake store and adapter. |
| `club-facts.ts` | Clubs' founding years and home grounds, and the grounds' capacity, address, surface and picture (T-1438, D-229). |
| `coach-store.spec.ts` | The `coaches` job's SQL and the coach read side on a database (T-1439, D-230): which teams are owed an ask, the answer's writes (a coach we do not hold queued, a team we do not carry counted, only empty bio fields fille… |
| `coach-store.ts` | The `coaches` job's SQL (T-1439, D-230): which teams are owed an ask, the ask records, the answer's writes, and putting back the coach references the coach id space moved out. |
| `coaches.spec.ts` | Tests for `coaches`. |
| `coaches.ts` | Coaches from the provider's coaches endpoint (T-1439, D-230). |
| `coverage-rules.ts` | How evidence becomes a coverage state (T-027, blueprint 4.3). |
| `coverage-store.ts` | The SQL behind the coverage computation (T-027). |
| `group-assign.spec.ts` | T-1333 against the real schema: the standings job writes each group-stage fixture's group from the provider's group tables, and our group tables are then built from those fixtures. |
| `groups.spec.ts` | Tests for `groups`. |
| `groups.ts` | Which group each team is in, from the provider's group tables (T-1333). |
| `half-time-break.spec.ts` | The half-time interval (T-1551): the live list says `HT`, and the match centre showed "LIVE · 45′" through the interval because nothing kept it. |
| `ingest-store.spec.ts` | An id a reviewer has set aside (`ignored`, T-1338) against one still waiting for review, with no database: the resolver is a table of answers and the pool records what was asked of it. |
| `ingest-store.ts` | The writers the ingestion jobs use (T-026). |
| `kit-colour-store.spec.ts` | The `kit_colours` job's SQL (T-1417, D-218) on a database: a finished match with a stored line-up and a side without a shirt is owed an ask; an answered one never again; an unanswered one again only after the retry wait… |
| `kit-colour-store.ts` | The `kit_colours` job's SQL (T-1417, D-218): `fixture_kit_fetch` and the matches owed shirts. |
| `kit-colours.spec.ts` | The `kit_colours` job (T-1417, D-218), over a fake adapter and store. |
| `kit-colours.ts` | The shirts of past matches (T-1417, D-218). |
| `lineup-asks.spec.ts` | T-1625, D-293: who the line-ups job asks, from 75 minutes before kick-off. |
| `lineup-asks.ts` | Which matches the line-ups job asks for their line-up, and in what order (T-1625, D-293). |
| `lineup-sides.spec.ts` | Line-ups filed under the other team (T-1628, D-294). |
| `participant-swap.spec.ts` | A match the provider turns round (T-1410): the daily sweep of 2026-10-14 failed whole on `fixture_participant_team_once` because fixture 1552933 came back with home and away the other way about. |
| `person-bio-store.spec.ts` | The bio pass's SQL against the real schema (T-1428, D-220): who is owed an ask (players only, with an empty field, squad members first), the ask record, and the write, which fills only the empty fields. |
| `person-bio-store.ts` | The bio pass's SQL (T-1428, D-220): who is owed an ask, the ask record, and the one write, which fills only the fields still empty. |
| `person-bios.spec.ts` | The bio rule and the bio pass of the `people_names` job (T-1428, D-220). |
| `person-bios.ts` | Player bios from the provider's player profile (T-1428, D-220). |
| `person-name-store.spec.ts` | The `people_names` job's SQL against the real schema (T-1398, D-213): who is owed an ask, which names are left alone because a person chose them, the ask record, and the one compare-and-set write of a full name with its… |
| `person-name-store.ts` | A Latin initial (or several), then a Latin letter: the provider's short form ("M. |
| `person-names.spec.ts` | The name rule and the sweep of the `people_names` job (T-1398, D-213). |
| `person-names.ts` | Full player names from the provider's player profile (T-1398, D-213). |
| `placeholder-persons.spec.ts` | A line-up slot labelled "Trialist" (T-1707, D-342). |
| `player-season-store.spec.ts` | The `player_seasons` job's SQL on a database (T-1431, D-223): who is owed a season or a career ask, the replacing writes that keep only competitions and teams we know, and the ask records that pace the retries. |
| `player-season-store.ts` | The players the job may ask about: each person named in a line-up of a finished match of a current season that kicked off before `$2`, with the year that season starts in and the latest such kick-off. |
| `player-seasons.spec.ts` | The `player_seasons` sweep (T-1431, D-223) against a fake store and adapter. |
| `player-seasons.ts` | Players' season totals and careers as the provider counts them (T-1431, D-223). |
| `postgres-mapping-store.ts` | How stale `provider_mapping.last_seen_at` may be while a mapping keeps being resolved: a sighting moves it on only once this long has passed (T-1374, D-192). |
| `request-meter.spec.ts` | T-501: each ingest run counts the requests it sent, and only its own, even while two runs share one adapter. |
| `request-meter.ts` | How many requests an ingest run sent to its provider (T-501). |
| `resolver.ts` | Entity resolution: external id -> internal UUID. |
| `run-store.ts` | SQL for `ingest_run` (T-071). One row per job run; open while `running`. |
| `season-conference.spec.ts` | T-1667 (D-319) against the real schema: the standings job writes each club's conference from the provider's conference tables, and each run that reads them leaves the season's rows exactly as they say; T-1671 ranks each… |
| `shootout-kicks.spec.ts` | A penalty shoot-out's kicks marked on the incident (T-1673, D-322). |
| `sources.spec.ts` | Tests for `sources`. |
| `sources.ts` | Which provider answers which ingestion job (T-026, D-049). |
| `squad-store.spec.ts` | The squads job's SQL against the real schema (T-1324): which clubs are due, the day's count, the ask record, and the read-only person lookup. |
| `squad-sweep.spec.ts` | Tests for `squad-sweep`. |
| `squad-sweep.ts` | Player photos and the listed squad for players already in our records (T-1324, D-176; T-1428, D-220). |
| `stage-of-round.spec.ts` | A fixture's stage when the adapter reads none from its round (T-1340): the operator's stage owns the round the way `catalog --add-stage` stamps it, so a poll no longer takes the stage back. |
| `team-season-store.spec.ts` | The `team_seasons` job's SQL on a database (T-1437, D-228): which teams and seasons are owed an ask -- past seasons once, current ones again after a week or a match -- the replacing write, and the ask records that pace… |
| `team-season-store.ts` | The provider's id for an entity of ours, the lowest when there are two. |
| `team-seasons.spec.ts` | The `team_seasons` sweep (T-1437, D-228) against a fake store and adapter. |
| `team-seasons.ts` | Teams' season statistics as the provider counts them (T-1437, D-228). |
| `transfer-store.spec.ts` | The `transfers` job's SQL on a database (T-1440, D-231): which clubs and players are owed an ask, the replacing write that joins players and clubs through `provider_mapping` only, and the ask records that pace the retri… |
| `transfer-store.ts` | Each club in a fixture of a current season, with that season's latest kick-off. |
| `transfers.spec.ts` | The `transfers` sweep (T-1440, D-231) against a fake store and adapter. |
| `transfers.ts` | Transfers, as the provider lists them (T-1440, D-231). |
| `zone-tables.spec.ts` | T-1399 against the real schema: Argentina's Liga Profesional. |

## apps/api/src/modules/intelligence

| File | What it is |
|---|---|
| `intelligence.module.ts` | `GET /health/intelligence` (T-401): whether this deployment has a language model to drive. |
| `intelligence.port.ts` | A language model behind one port (T-401, Phase 5, D-070): a provider chosen at deployment, and **a deployment that has none saying so**. |
| `intelligence.service.ts` | The one place a request reaches a language model (T-401). |
| `intelligence.spec.ts` | The port's honest half (T-401): with nothing configured the model is absent and says so; a provider this build cannot drive, a driveable one with no key, or an effort that is not one of the three stops the process inste… |

## apps/api/src/modules/intelligence/internal

| File | What it is |
|---|---|
| `anthropic-model.spec.ts` | The adapter (T-402) against a scripted Messages surface: the request it sends is the reference's shape -- the deployment's model, adaptive thinking, the effort, the refusal fallback -- and the stop reason is read before… |
| `anthropic-model.ts` | The first adapter behind the port (T-402, D-070): Anthropic's Messages API through the official SDK. |
| `chat-completions-model.spec.ts` | The second adapter (T-404, D-072) against a scripted `fetch`: the request is the chat-completions shape Mistral's reference documents, the effort travels only for the provider that takes it, the finish reason is read be… |
| `chat-completions-model.ts` | The second adapter behind the port (T-404, D-072): the `POST /chat/completions` shape that Mistral's La Plateforme and most other vendors serve, over `fetch` and nothing else. |

## apps/api/src/modules/locale-holds

| File | What it is |
|---|---|
| `locale-holds.controller.ts` | Holding back a language that is ready (T-1163, D-155). |
| `locale-holds.http.spec.ts` | Holding back a language (T-1163, D-155): administrators only, each hold and release with a reason and an audit row carrying what was there before; one hold in force per language; English is never held; a guest reads whi… |
| `locale-holds.module.ts` | Holding back a language that is ready (T-1163, D-155): owns `locale_hold`. |

## apps/api/src/modules/locale-holds/internal

| File | What it is |
|---|---|
| `locale-hold-store.ts` | Holding back a language (T-1163, D-155): each hold and release with its `audit_log` row in the same transaction (rule 10), target type `locale`. |

## apps/api/src/modules/localised-names

| File | What it is |
|---|---|
| `localised-names.http.spec.ts` | Tests for `localised-names.http`. |
| `localised-names.interceptor.ts` | `?locale=` on every read (T-1312). Registered once for the whole API, so an endpoint that names a team, a competition or a country answers in the reader's language without each store carrying its own copy of the lookup,… |
| `localised-names.module.ts` | Localised names on every surface (T-1312): reads `entity_alias` name rows (T-303) and `country`, writes nothing. |
| `localised-names.service.ts` | A locale tag for `?locale=`, validated as T-303 does it: anything that is not a plausible BCP 47 tag is `null` rather than 400 -- a locale is a preference, not an address, and a page must not fail because its reader's l… |

## apps/api/src/modules/localised-names/internal

| File | What it is |
|---|---|
| `name-walk.spec.ts` | Tests for `name-walk`. |
| `name-walk.ts` | The pure half of localised names on every surface (T-1312): find the named entities in an answer, and put the reader's names into a copy of it. |

## apps/api/src/modules/match-alerts

| File | What it is |
|---|---|
| `match-alerts.http.spec.ts` | Match alerts through the live job (T-830, D-098), against the real schema: the real jobs, writers, alert derivation, notifications and carrier, with a scripted provider in place of the network and a capturing push chann… |
| `match-alerts.module.ts` | Match alerts (blueprint 12.2, T-830, D-098). |
| `match-alerts.service.spec.ts` | Carrying a run's alerts (T-834): a pass reads a page (500 for match alerts), so a run that told more members than that passes again until they have nothing due. |
| `match-alerts.service.ts` | The queue the ingestion jobs hand their events to (T-835). |
| `match-events.spec.ts` | Tests for `match-events`. |
| `team-news.http.spec.ts` | Team news and line-up alerts through the line-ups job (T-832, D-100), against the real schema: the real job, writers, derivation, notifications and carrier, with a scripted provider and a capturing push channel. |
| `team-news.spec.ts` | T-832, D-100: team news and line-ups derived from two readings, keyed once. |

## apps/api/src/modules/match-alerts/internal

| File | What it is |
|---|---|
| `match-alerts-store.ts` | A reading of one match with what the line and the audience need. |
| `match-events.ts` | What a match alert is, as pure functions over two readings of one match (T-830, D-098): the state before a live write and the state after it. **Derived from the change, not from the state.** A kick-off is a match that *… |
| `team-news.ts` | Team news as match alerts (T-832, D-100): the line-ups announced, and a player the provider says will miss the match. |

## apps/api/src/modules/media

| File | What it is |
|---|---|
| `image-check.spec.ts` | Tests for `image-check`. |
| `media-fetch.service.ts` | One HTTP answer, as much of it as the checks need. |
| `media-index.spec.ts` | The read side of a country's flag (T-1611, D-282), with no database: the pool answers the one query `index` sends with stored rows, and records it. |
| `media-scheduler.service.ts` | The media fetch tick (T-1320, D-176): its own queue, one worker at a time. |
| `media.controller.ts` | `GET /media/:kind/:id/:version` (T-1320, D-176): a stored crest, logo or photo, streamed from the media volume. |
| `media.http.spec.ts` | The media store end to end (T-1320, D-176): an address noted by ingestion is fetched once onto the volume, served from our own route with a year's cache and an ETag, 404 when absent; a photo many people share is taken f… |
| `media.module.ts` | The media boundary (T-1320, D-176): crests, logos and player photos copied from the provider to our own volume (`MEDIA_DIR`) and served from our own origin. |
| `media.service.ts` | The media boundary's public service (T-1320, D-176). |

## apps/api/src/modules/media/internal

| File | What it is |
|---|---|
| `image-check.ts` | What a downloaded image is allowed to be (T-1320, D-176). |
| `image-variant.ts` | A stored crest, logo or photo at a smaller width, as WebP (T-1462, D-242). |
| `media-files.ts` | The media volume (T-1320, D-176): files named by their sha256 under `MEDIA_DIR`, so two entities with the same image share one file and a rewrite of the same bytes is a no-op. |
| `media-store.ts` | The SQL of the media store (T-1320, D-176), over `entity_media`. |

## apps/api/src/modules/model-upset

| File | What it is |
|---|---|
| `model-upset.controller.ts` | The day's finished match whose result the statistical model rated least likely (T-1507, D-265), or `not_supplied` with why. |
| `model-upset.http.spec.ts` | T-1507 against the real schema: the day's finished match whose result the model's last published pre-kick-off version rated least likely, among seasons whose scores are fully covered, ties broken by kick-off; a version… |
| `model-upset.module.ts` | The home page's "forecast against reality" card (T-1507, D-265): reads `fixture`, `fixture_score`, `coverage_profile` and the published `forecast` versions, and owns no table. |
| `model-upset.service.ts` | The statistical model's biggest miss of a day (T-1507, D-265): the finished match whose result its last pre-kick-off forecast rated least likely, among competitions with full coverage. |
| `model-upset.spec.ts` | The pure half of T-1507: the day asked, and the answer built from the store's row. |

## apps/api/src/modules/model-upset/internal

| File | What it is |
|---|---|
| `upset-store.ts` | The day's least likely result, in one read (T-1507, D-265). |
| `upset.ts` | The pure half of the model's biggest miss of a day (T-1507, D-265): which day is asked, and how the store's one row becomes the answer. |

## apps/api/src/modules/moderation

| File | What it is |
|---|---|
| `group-moderation.controller.ts` | Administrators and groups (blueprint 10.4, T-1025, D-135): `moderator` or `admin`, the same gate as the rest of the moderation queue. |
| `group-moderation.http.spec.ts` | Administrators and groups (T-1025, D-135), against the real schema. |
| `group-moderation.service.ts` | The reason and the reports a group decision names, checked. |
| `moderation-admin.controller.ts` | The moderation queue (blueprint 10.4 and 16, T-212). **Its own controller rather than a corner of the admin one.** The admin boundary owns coverage, accounts and the audit log; moderation owns reports, decisions and san… |
| `moderation-admin.http.spec.ts` | The moderation queue (T-212). The acceptance criterion is rule 10: **every action records actor, time, reason and previous value**. So the tests do not stop at the status code — they read `audit_log` afterwards and chec… |
| `moderation.controller.ts` | Reporting and a member's own standing (blueprint 10.4, T-211). |
| `moderation.http.spec.ts` | The acceptance criterion for T-211, over HTTP with real sessions and the real schema: **a restricted member is refused where they would have written, not hidden afterwards** — and told, so they can appeal. |
| `moderation.module.ts` | The moderation boundary (blueprint 10.4, D-053). |
| `moderation.schema.spec.ts` | The moderation spine against the real schema (T-210). |
| `moderation.service.ts` | The moderation boundary (blueprint 10.4, T-211). **Reporting is never gated.** Filing a report needs a session and nothing else — no verified e-mail, and emphatically not an unsanctioned account. |
| `rate-limit.http.spec.ts` | Rate limits (T-213, D-054). The rule belongs to moderation and the surface belongs to whichever boundary it protects, so the tests live with the rule: the next surface that gets a ceiling puts its test beside this one r… |

## apps/api/src/modules/moderation-assist

| File | What it is |
|---|---|
| `moderation-assist.controller.ts` | `POST /admin/moderation/reports/:id/suggest` (T-441): a moderator asks the assistant about one report -- a new suggestion version, or the reason there is none. |
| `moderation-assist.http.spec.ts` | Moderation assistance through the API (T-440 to T-442), with a scripted model: a suggestion is a row beside the report that the queue carries with the assistant's state; an answer that is not a suggestion is a rejected… |
| `moderation-assist.module.ts` | Moderation assistance (E44, Phase 5): suggestions beside reports, from the language model behind the intelligence port, for a moderator who decides. |
| `moderation-assist.service.ts` | Moderation assistance (E44, T-441): a suggestion beside a report, for a moderator who decides. |

## apps/api/src/modules/moderation-assist/internal

| File | What it is |
|---|---|
| `suggestion-store.ts` | Suggestions beside reports (T-440): written once, read with the queue. |

## apps/api/src/modules/moderation/internal

| File | What it is |
|---|---|
| `group-moderation-store.ts` | Every statement about administrators and groups (T-1025, D-135). |
| `moderation-store.ts` | The SQL for moderation (T-211). All of it, and nothing else. The rules are not here. A decision's immutability, a sanction's end, the refusal of a friend request from a restricted member: all of that is the schema's (T-… |

## apps/api/src/modules/moments

| File | What it is |
|---|---|
| `moments.controller.ts` | `GET /moments?timezone=&locale=&big_one=` (T-1641, D-299; T-1644, D-302): today's moments that matter, for the site's top bar. |
| `moments.http.spec.ts` | T-1641 against the real schema: the scores page's cards, the last published version before kick-off (never a later one, never a shadow), a featured match as the big one, the counts in the reader's zone, a member's follo… |
| `moments.module.ts` | Today's moments that matter (T-1641, D-299): read-only, no table of its own. |
| `moments.service.ts` | Today's moments that matter (T-1641, D-299), read-only. |
| `moments.spec.ts` | The moments' rule engine (T-1641, D-299) without a database: every threshold at its edge, the priority between kinds, the caps, the quiet day, and a match without a forecast. "Now" is Thursday 29 October 2026, 18:00 UTC. |

## apps/api/src/modules/moments/internal

| File | What it is |
|---|---|
| `moments.ts` | Today's moments that matter (T-1641, D-299), pure: which matches the top bar shows and why, from the scores answer, the pre-kick-off published forecasts and what the viewer follows. |

## apps/api/src/modules/news

| File | What it is |
|---|---|
| `breaking-admin.controller.ts` | The editor's breaking mark (blueprint 2.3, T-1004, D-125): `POST /admin/stories/:id/breaking` with the note readers see on the homepage strip, for `BREAKING_WINDOW_HOURS`; `POST .../breaking/clear` with a reason to end… |
| `breaking-alert.http.spec.ts` | The breaking alert (T-1005, D-125), through the editor's real mark: opt-in, to followers of a team, competition or person the story links, once per story however often it is marked, deep-linked to the story, with the mu… |
| `breaking-alerts.service.ts` | How many delivery passes a breaking alert's carry may take before the timer has the rest. |
| `breaking.http.spec.ts` | The breaking mark (T-1004, D-125): only an editor marks, with a note, for the stated window; a guest sees the strip; an expired mark is gone at the next read with no job; clearing early takes a reason; every mark and cl… |
| `debate-admin.controller.ts` | The editor's half of the debate section (blueprint 3.1, T-143): `GET /admin/debates`, `POST /admin/stories/:id/debate` to select a story with the note readers see, and `POST .../debate/clear` with a reason. |
| `debate-admin.http.spec.ts` | The editor's half of the debate section (T-143, rule 10): only an editor or an administrator selects; a selection needs a note and lands on the public section with it; selecting twice is refused rather than re-noted; cl… |
| `gnews-config.spec.ts` | GNews from the environment (T-1367, D-185): off and harmless without a key. |
| `gnews-ingestion.http.spec.ts` | The GNews job against the real schema (T-1367, D-185), every answer scripted. |
| `gnews-ingestion.service.ts` | Postgres' unique_violation: a run of this source is already open. |
| `news-clustering.service.ts` | A name or alias shorter than this after folding ("roma", "ajax", "psg") is a word a headline can carry without meaning the club; below it nothing is linked, and the alias table is where a longer form belongs. |
| `news-coverage-admin.controller.ts` | News coverage per competition, stated (blueprint 3.2, T-1010, D-129): `GET /admin/news/coverage` lists every active competition with the carried sources that linked a story to it in the window and the count, the gaps fi… |
| `news-coverage.http.spec.ts` | News coverage per competition, stated (T-1010, D-129): the carried sources that linked a story to a competition inside the window and the distinct stories; a dropped source and a report older than the window do not coun… |
| `news-dedupe.http.spec.ts` | One report shown once, and no item that is not an article (T-1396, D-211), against the real schema with every feed scripted. |
| `news-entity.http.spec.ts` | News on the team and competition pages (T-944, D-119): the stories the news boundary linked to the team or competition, newest first, from its existing links; a team nobody wrote about says so; an unknown id is 404; and… |
| `news-filters.http.spec.ts` | The news filters by story type, player and date (T-1003, D-124). |
| `news-fixture.http.spec.ts` | Related news for a match (T-145): reports linked to the match come first, then reports linked to one of its sides inside the window around kick-off; a report about a side from outside the window and a report about nobod… |
| `news-images.http.spec.ts` | News photos end to end (T-1322, D-177), against the real schema with every response scripted: a source whose licence covers photos gets its own photo stored on our volume and served from our route with its credit and li… |
| `news-images.service.ts` | The injection token for `MEDIA_DIR`, resolved; `null` when unset. |
| `news-ingestion.http.spec.ts` | The news job against the real schema (T-142, D-061), with every response scripted: what a feed says is the input, what the tables hold is the output. |
| `news-ingestion.service.ts` | Postgres' unique_violation: a run of this source is already open. |
| `news-language-visibility.http.spec.ts` | A source's stories only for readers of its language (T-1330, D-178): a Persian source with `same_language_only` is left out of every read in another language and shown in Persian (any `fa-*` tag); a story that also has… |
| `news-media.controller.ts` | `GET /media/news/:file` (T-1322, D-177): a stored news photo, from our own volume, while a reader may see it -- stored, not hidden by an editor, from a source whose licence still covers photos. |
| `news-person-links.http.spec.ts` | Persons linked to stories (T-1006, D-126) against the real schema: a person is linked by full name or recorded alias, as whole words, only while they hold an open spell at a team the story links, and only when no other… |
| `news-player.http.spec.ts` | News on the player page (T-1007, D-127): the stories linked to the person (D-126), newest first, in the entity-news shape of D-119. |
| `news-read-windows.http.spec.ts` | The latest section read through windows (T-1450) returns exactly what the unbounded read returns. |
| `news-scheduler.service.ts` | The BullMQ queue and worker that read the publishers' feeds on a schedule (T-142). |
| `news-sections.http.spec.ts` | The four sections over the real schema (T-143, blueprint 3.1 and 3.2). |
| `news-sources-admin.controller.ts` | News sources in the console (T-1015): `GET /admin/news-sources`, `POST /admin/news-sources/preview` (the feed fetched once after its robots.txt, nothing written), `POST /admin/news-sources` (added only when that check p… |
| `news-sources-admin.http.spec.ts` | News sources in the console (T-1015): an administrator previews a feed (robots.txt first, then one read, nothing written), adds it only when that check passes, edits it (a new address is checked again) and drops it with… |
| `news-tagging.http.spec.ts` | Which teams and competitions a story is filed under (T-1396, D-211), against the real schema. |
| `news-team-context.http.spec.ts` | Which team a story is filed under once D-211's rule has found the name (T-1400, D-215), against the real schema. |
| `news-trending-saves.http.spec.ts` | Trending counts saves (T-1008, D-128) against the real schema: distinct members who saved a story inside the window rank it beside the panel discussion; a save older than the window is not counted; a save moved by a clu… |
| `news.controller.ts` | The news sections (blueprint 3.1, T-143): `GET /news?section=latest\| trending\|debate\|following`, with `country`, `competition`, `team` and `language` filters (blueprint 3.2) and `before` to page latest and following. |
| `news.module.ts` | News (blueprint 3.3, E14): publishers' feeds read as headline and link under the rights each source grants (D-061). |
| `news.schema.spec.ts` | The article schema, against the real database (T-141, D-061). |
| `saved-articles.controller.ts` | Saved articles (blueprint 3.3 and 2.1, T-842): the member's own list, and nobody else's -- every route is `/me`, a session is required, and nothing here is readable about another member. |
| `saved-articles.http.spec.ts` | Saved articles over the real schema (T-842): a member saves a story, sees it (headline and link only, D-061) newest first, saves it again without a second row, removes it; another member sees none of it; a guest is a 40… |
| `story-type-admin.controller.ts` | An editor's story type (blueprint 3.2, T-1001, D-123): `POST /admin/stories/:id/type` with one of the eleven types and a reason, beside the debate mark. |
| `story-type-alert.http.spec.ts` | Transfer and availability alerts (T-1032, D-166), through the editor's real type endpoint and the feed reader's real publisher labelling: opt-in, to followers of a team or person the story links (a competition is not en… |
| `story-type-alerts.service.ts` | How many delivery passes an alert's carry may take before the timer has the rest. |
| `story-type-publisher.http.spec.ts` | A story's type from the publisher's own category (T-1002, D-123), through the real ingestion job with a scripted feed and a mapping scripted for this run's feed host. |
| `story-type.http.spec.ts` | Story types (T-1001, D-123): the vocabulary is the contract's and the database's at once; a story with no label says `not_supplied`; an editor's label supersedes and never edits, and every one is an audit row with the l… |
| `translations-admin.controller.ts` | A person's language version of an article (T-304, blueprint 13): `POST /admin/articles/:id/translations` writes one as a new version, `POST .../translations/:language/review` has a second person approve it as another. |
| `translations-admin.http.spec.ts` | A person's language version of an article (T-304): written as a new version by an editor, read back on the story page with whose words it is, reviewed by a second person as another new version and refused to the author;… |

## apps/api/src/modules/news/internal

| File | What it is |
|---|---|
| `breaking-admin-store.ts` | The editor's breaking mark (T-1004, D-125): marking and clearing, each with its `audit_log` row in the same transaction (rule 10), target type `story`. |
| `debate-admin-store.ts` | The editor's half of the debate section (blueprint 3.1, T-143): selecting a story and clearing one, each with its `audit_log` row in the same transaction (rule 10). |
| `feed-probe.ts` | How much of a publisher's summary the preview shows. |
| `gnews-store.ts` | The GNews row the migration seeds (T-1367, `1765844000000_gnews-source.sql`). |
| `news-coverage-store.ts` | News coverage per competition (T-1010, D-129): for each competition, the carried sources -- not dropped -- with a report linked to it whose first publication falls inside the window, the stories each linked, and the dis… |
| `news-image-store.ts` | A source's image right (T-1322, D-177); `null` licence means it grants none. |
| `news-media.ts` | Where news photos live on our server, and how one is fetched (T-1322, D-177). |
| `news-read-store.ts` | The shown photo's columns, as every card query selects them (T-1322). |
| `news-sources-admin-store.ts` | The fields an administrator sets on a source. |
| `news-store.ts` | How the linker decides (T-142); the values live in `NewsClusteringService`. |
| `news-transport.ts` | The injection token for the transport the news job reads feeds through. |
| `robots.spec.ts` | Tests for `robots`. |
| `robots.ts` | The part of robots.txt a feed fetcher has to honour (T-142, D-061: "fetching obeys robots.txt and each feed's stated terms"). |
| `saved-articles-store.ts` | What a saved row reads as (T-842): the publisher's headline and link while the report is held, otherwise the reason it is not -- a dropped publisher named with no link to them (D-061), never a dead link and never a copy. |
| `story-label-store.ts` | A story's type (T-1001, D-123). A label is never edited: a new one supersedes the current one (`superseded_at`) in the same transaction, and the partial unique index keeps one current label per story even when two write… |
| `story-type-mapping.spec.ts` | The publisher-category mapping (T-1002, D-123): exact strings only, no type for an ambiguous item, and every committed entry held to a recorded item from its feed. |
| `story-type-mapping.ts` | One publisher category that means one story type (T-1002, D-123). |
| `translation-names.ts` | The translators' glossary (T-1011, D-130) as the API reads it, and the names a translation must carry (T-1012, D-131): the entities the article links, as their localised name or the glossary's term, and every locked glo… |
| `translations-admin-store.ts` | How many of each bucket the desk's queue shows at most (T-1013). |

## apps/api/src/modules/notifications

| File | What it is |
|---|---|
| `audience.http.spec.ts` | One notification to a whole audience in one statement (T-835): `emitToAudience`, the set-based `emit` a match alert is written with. |
| `carry.http.spec.ts` | The way out (T-330, the composition): a notification of any kind leaves the building as the inbox's own sentence and route -- an e-mail with the absolute link, a push with the path -- once, claimed before the send; one… |
| `drain.spec.ts` | `drain()` (T-837): pages until nothing in scope is due, stops when another carrier holds the rest, and yields at its bounds; the timer's tick never runs two drains at once. |
| `emission.http.spec.ts` | Emitting notifications from the events that already happen (T-271). |
| `inbox.http.spec.ts` | The inbox, and the settings behind it (T-272). |
| `mutes.http.spec.ts` | Per-team, per-competition and per-category controls (T-331, blueprint 12.2): a member can silence one team without silencing football. |
| `notifications.controller.ts` | The inbox, and what a member may change about it (blueprint 12.2, T-272). **Everything here is `/me`.** A notification is addressed to one person and there is no reading of anybody else's — not for an administrator eith… |
| `notifications.module.ts` | In-product notifications (blueprint 12.2, E27). **It imports nothing**, and that is what makes it safe for every other module to import. |
| `notifications.schema.spec.ts` | Notifications against the real schema (T-270). |
| `notifications.service.ts` | What a carrier composes for one due notification: a message per channel, or `null` for a channel it has nothing for. |
| `push.http.spec.ts` | A member's devices (T-330, D-074): the settings page reads whether push exists and how many devices are registered; a browser's subscription is kept, the same endpoint again refreshes rather than doubles, a malformed on… |
| `quiet-hours.http.spec.ts` | Quiet hours and frequency limits (T-273). |
| `send-pool.spec.ts` | Sending concurrently with a bounded pool (T-836): the pool's arithmetic, the setting, and `carry()` over it with a scripted store and a push channel that takes time -- at most N in flight, each notification claimed and… |

## apps/api/src/modules/notifications/internal

| File | What it is |
|---|---|
| `notifications-store.ts` | The SQL for notifications (T-270, T-271). |
| `send-pool.ts` | How many messages the carrier sends at once (T-836). |

## apps/api/src/modules/panel

| File | What it is |
|---|---|
| `match-panel-opening.schema.spec.ts` | Which fixtures have a panel at all, against the real schema (T-253). |
| `match-panel.schema.spec.ts` | The public match panel against the real schema (T-251). |
| `panel-admin.controller.ts` | Which matches have a public discussion (blueprint 10.2, T-253). **`moderator` or `admin`**, the same pair the moderation queue uses (blueprint 7.3). |
| `panel-admin.http.spec.ts` | Opening and closing a match panel (T-253). |
| `panel-link.http.spec.ts` | A panel post's link over HTTP (T-1030, D-136): one thing of the post's own match, refused by the schema for any other match, and a card that says when the feed changed or removed what was linked rather than showing the… |
| `panel-social.controller.ts` | Reacting to a panel post, and following a contributor (blueprint 10.2, T-252). **Every write here needs a session and nothing else.** No role, no contributor grant, no eligibility: reacting and following are open to mem… |
| `panel-social.http.spec.ts` | Reacting and following over HTTP (T-252). **The criterion is that neither becomes posting access**, and over HTTP that means two things: every one of these routes needs a session and *nothing else*, and having used them… |
| `panel-social.schema.spec.ts` | Reacting to a panel post, and following a contributor, against the real schema (T-252). |
| `panel-social.service.ts` | Reacting to a panel post, and following a contributor (blueprint 10.2, T-252). **Everything here is open to any signed-in member.** There is no `member_may_contribute` in this file and there should never be one: a check… |
| `panel.controller.ts` | The public match discussion (blueprint 10.2, T-251). **`GET /fixtures/:id/panel` takes no session and asks for none.** A guest reads, which is half the acceptance criterion and is easiest to get wrong by accident: one `… |
| `panel.http.spec.ts` | The public match panel over HTTP (T-251). |
| `panel.module.ts` | The public match discussion boundary (blueprint 10.2, T-251). **Its own module rather than a corner of the fixtures one.** A fixture is a football entity; a panel is a place people talk, with a gate, a ceiling and a mod… |
| `panel.service.ts` | The public match discussion (blueprint 10.2, T-251). **Reading is open; posting is granted.** The two are separate methods and separate shapes, because they have different audiences: `panel` answers anybody including a… |

## apps/api/src/modules/panel/internal

| File | What it is |
|---|---|
| `panel-admin-store.ts` | The SQL for opening and closing a match panel (T-253). |
| `panel-link.spec.ts` | Tests for `panel-link`. |
| `panel-link.ts` | A stored incident detail in our words (T-1378, D-196): a row written before the adapters named it holds the provider's text, which is mapped here and never passed on. |
| `panel-social-store.ts` | The SQL for panel reactions and member follows (T-252). |
| `panel-store.ts` | The SQL for the public match panel (T-251). |

## apps/api/src/modules/predictions

| File | What it is |
|---|---|
| `friend-alerts.http.spec.ts` | "A friend predicted a match you follow" through `PUT /fixtures/:id/prediction` (T-832, D-100), against the real schema. |
| `friend-alerts.spec.ts` | "A friend predicted a match you follow" (T-832, D-100): to the friends who care about the match, only where the predictor's own visibility lets them read the prediction (D-063), one per friend per match, and never the p… |
| `friend-predictions.http.spec.ts` | Friends' recent predictions on the member's homepage through `GET /me/friends/predictions` (T-942, D-115), against the real schema. |
| `group-comparison.http.spec.ts` | Prediction comparison inside a group (T-246), against the real schema. **"Who called a fixture which way, in one place; never a second settlement."** The second clause is the one worth testing hardest: the comparison mu… |
| `history.controller.ts` | A member's prediction history over HTTP (blueprint 7.2, T-056). |
| `history.http.spec.ts` | Tests for `history.http`. |
| `history.spec.ts` | Tests for `history`. |
| `lock.http.spec.ts` | A two throwaway clubs fixture kicking off at `kickoff` (SQL expression, DB clock). |
| `predictions.controller.ts` | `/fixtures/:id/prediction`: the signed-in member's own prediction. |
| `predictions.http.spec.ts` | Tests for `predictions.http`. |
| `predictions.module.ts` | The predictions boundary (02-architecture.md): user predictions, locking (T-051), settlement (T-052) and the member's history (T-056, whose visibility the profile boundary decides). |
| `predictions.service.ts` | The predictions boundary (T-050): a member's stance on a fixture as a series of immutable versions. |
| `predictions.spec.ts` | Tests for `predictions`. |
| `settle.spec.ts` | Tests for `settle`. |
| `settlement.controller.ts` | Settlement over HTTP (T-052): the aggregate per fixture is public (how the crowd did); the settlement tick (T-1380) settles on its own, and these endpoints stay for an operator who wants a run now. |
| `settlement.http.spec.ts` | A two throwaway clubs fixture; predictions are placed while it is open, then it is moved into the past. |
| `settlement.service.ts` | Settlement (T-052): every prediction on a final fixture gets its settlement row, once; a void one is superseded when the match is finished for real. |

## apps/api/src/modules/predictions/internal

| File | What it is |
|---|---|
| `friend-alerts.ts` | "A friend predicted a match you follow" (blueprint 8.1, T-832, D-100), as a function over three questions so the rule can be tested without a database: who the predictor's friends are, which of them care about this matc… |
| `history-query.ts` | Paging for a member's prediction history (T-056). |
| `prediction-store.ts` | SQL for the predictions boundary (D-025). |
| `settle.ts` | The settlement rules (blueprint 6.6: "a postponed or abandoned match is void until a valid settlement rule is applied"). |
| `settlement-store.ts` | One settled prediction as the rating engine reads it (T-053). |
| `validation.ts` | A submission after validation; what the store writes. |

## apps/api/src/modules/profile

| File | What it is |
|---|---|
| `favourite-order.spec.ts` | Tests for `favourite-order`. |
| `first-run.http.spec.ts` | The first-run flow's two endpoints (T-620). |
| `following.http.spec.ts` | A Manchester United v Liverpool match, kicking off `offset` from now. |
| `profile.controller.ts` | Public, privacy applied to the viewer (signed in or not). |
| `profile.http.spec.ts` | Tests for `profile.http`. |
| `profile.module.ts` | The profile boundary (02-architecture.md): profiles, privacy, and (T-042) favourites and following. |
| `profile.service.ts` | The profile boundary: what a member shows, to whom, and what they follow (T-041, T-042). |
| `profile.spec.ts` | Tests for `profile`. |
| `territory.http.spec.ts` | The viewing territory (T-312, blueprint 11): chosen by the member, stored, never inferred. |

## apps/api/src/modules/profile/internal

| File | What it is |
|---|---|
| `favourite-order.ts` | How favourites and follows order a list of fixtures (blueprint 4.1: "favourite teams and major fixtures can be pinned above the standard list"). |
| `following-store.ts` | Which catalog table backs each followable type. |
| `profile-store.ts` | One member's profile as the page needs it, with the owner's id and privacy. |
| `validation.ts` | Partial update: absent fields are left alone, `null` clears, anything else must validate. |
| `visibility.ts` | The one rule of profile privacy, as a pure function so it can be tested without a database and read without scrolling. - The owner always sees their own profile. - `public` : anyone, signed in or not. - `friends` : a si… |

## apps/api/src/modules/rate-limits

| File | What it is |
|---|---|
| `inventory.spec.ts` | The inventory's own logic (T-811). That it covers every route the router has is the console security spec's to prove, against the booted app. |
| `inventory.ts` | The rate-limit inventory (T-811, D-103): every write the API takes -- any method but GET, HEAD and OPTIONS -- is either held by a ceiling below or listed in `EXEMPT` with the reason it needs none. |
| `rate-limits.http.spec.ts` | The ceilings T-811 added and the report (D-103): a push registration past its ceiling is refused with a wait and counted for the day; deleting an account is held to the sign-in ceilings against its username, and the loc… |
| `rate-limits.module.ts` | `GET /admin/rate-limits` (T-811): every ceiling with its number as the `rate_limit` table has it now, the writes it holds and its refusals per UTC day for the last week, and every write without a ceiling with the reason. |
| `rate-limits.service.ts` | The last `days` UTC dates up to and including `now`'s, oldest first, as `YYYY-MM-DD`. |
| `refusal-counter.ts` | After every response: a 429 on a route held by one database-enforced ceiling is that ceiling's refusal, counted for the day (T-811). |

## apps/api/src/modules/rating-thresholds

| File | What it is |
|---|---|
| `rating-thresholds.controller.ts` | Rating thresholds in the console (T-1160, D-152, D-164), administrators only. |
| `rating-thresholds.http.spec.ts` | Rating thresholds as versioned rows (T-1160, D-152, D-164): administrators only; a new version with a reason, a start never in the past and an audit row carrying the version it supersedes; no row edited; the version in… |
| `rating-thresholds.module.ts` | Rating thresholds as versioned rows (T-1160, D-152, D-164): owns `rating_threshold_version`. |
| `rating-thresholds.service.ts` | Rating thresholds as versioned rows (T-1160, D-152, D-164): which version is in force, every version, and a new one. |
| `thresholds.spec.ts` | Rating thresholds as versioned rows (T-1160, D-152, D-164): the request and version 1's row. |

## apps/api/src/modules/rating-thresholds/internal

| File | What it is |
|---|---|
| `threshold-store.ts` | SQL for `rating_threshold_version` (T-1160, D-152). |
| `thresholds.ts` | The thresholds in force (T-1160, D-152, D-164): one `rating_threshold_version` row as the code reads it. |

## apps/api/src/modules/reputation

| File | What it is |
|---|---|
| `achievement-notification.http.spec.ts` | An achievement unlock is a notification (T-946, D-117), through the real reputation job, notifications and schema. |
| `achievement-unlocks.spec.ts` | Which achievements are new, and which of those are news (T-946, D-117). |
| `achievements.spec.ts` | The n-th settlement, a minute apart, in a fixed order. |
| `career-points.http.spec.ts` | Tests for `career-points.http`. |
| `career-points.service.ts` | How many ledger lines a member sees at once. |
| `contributor-eligible.http.spec.ts` | "A member becoming eligible for contributor review, to administrators" (blueprint 18.3, T-833, D-100), through `ReputationService.recompute` -- the path the settlement job takes -- against the real schema. |
| `contributor-flag-scheduler.service.ts` | The daily contributor-flag check's BullMQ queue and worker (T-1031, D-137). |
| `contributor-flag.http.spec.ts` | A contributor below the threshold for a sustained period (T-1031, D-137), against the real schema: the daily check raises one flag per stretch from the stored ratings, tells the administrator once, never pauses anybody;… |
| `contributor-flag.service.ts` | Contributors below the threshold for a sustained period (blueprint 9.4, T-1031, D-137). **It flags and tells; it never pauses.** There is no call from here to `ContributorService.change`, and there must never be one: a… |
| `contributor-flag.spec.ts` | Tests for `contributor-flag`. |
| `contributor.controller.ts` | Contributor eligibility and contributor approval (blueprint 9.4 and 10.2, T-250). **Two audiences, one controller, and the split is by route prefix.** `GET /me/contributor` is the member's own view of both halves — what… |
| `contributor.http.spec.ts` | Contributor eligibility and contributor approval over HTTP (T-250). |
| `contributor.schema.spec.ts` | Contributor eligibility and contributor grants, against the real schema (T-250). |
| `contributor.service.ts` | Contributor eligibility and contributor grants (blueprint 9.4 and 10.2, T-250). **The whole point of this service is that it has two verbs and they are not the same verb.** `statusOf` computes; `grant`, `pause`, `resume… |
| `contributor.spec.ts` | The four measurable requirements (blueprint 9.4, `13-policy.md` §1, T-250). |
| `eligibility-notice.spec.ts` | T-833, D-100: administrators hear of a member newly qualifying, once per transition. |
| `formula.spec.ts` | Tests for `formula`. |
| `group-leaderboard.http.spec.ts` | The group leaderboard (T-243), against the real schema. |
| `history.spec.ts` | `n` settlements, one every eight hours from 1 Jan 2026, so days hold two or three each; correctness, exact scores, confidence and difficulty vary on fixed cycles so the rating moves. |
| `leaderboard.http.spec.ts` | Tests for `leaderboard.http`. |
| `leaderboard.spec.ts` | Tests for `leaderboard`. |
| `period-board.spec.ts` | `n` settlements for one member, one every eight hours from `start`, with correctness, exact scores, confidence and difficulty on fixed cycles offset by `seed`, so members rate differently. |
| `period-leaderboard.http.spec.ts` | What each member settled, as the formula reads it, per period. |
| `points.spec.ts` | Tests for `points`. |
| `reputation.controller.ts` | Ratings over HTTP (T-053). A rating is public (blueprint 9.3: profiles and leaderboards show it); recomputing one's own is a member action; the pass over everyone is an operator action until the job runner (T-026) calls… |
| `reputation.http.spec.ts` | A model that always favours the home side heavily (80 / 12 / 8). |
| `reputation.module.ts` | The reputation boundary (02-architecture.md): Performance Rating (T-053), Career Points (T-054), leaderboards (T-055), contributor approval (T-250). |
| `reputation.service.ts` | The reputation boundary (T-053): Performance Rating from settled predictions and the stored forecasts, under a versioned formula. |
| `settlement-scheduler.service.ts` | The settlement tick's BullMQ queue and worker (T-1380). |
| `settlement-scheduler.spec.ts` | Tests for `settlement-scheduler`. |
| `threshold-rules.spec.ts` | The rating and eligibility under a threshold version (T-1160, D-152, D-164): version 1 moves nothing, and a later one moves only what it names. |

## apps/api/src/modules/reputation/internal

| File | What it is |
|---|---|
| `achievement-unlocks.ts` | Telling a member they earned an achievement (blueprint 12.2, T-946, D-117). **Once, the first time it is derived.** Achievements stay derived on read (D-091); the reputation job, after each recompute, records the first… |
| `achievements.ts` | Achievements (blueprint 9.2, T-643, D-091), version 1: milestones derived on read from what is already stored -- the member's current settlements, their predictions' first submissions and the fixtures of the rounds they… |
| `contributor-flag-store.ts` | The SQL for contributor flags (T-1031, D-137). |
| `contributor-flag.ts` | A contributor below the threshold for a sustained period (blueprint 9.4, T-1031, D-137). |
| `contributor-store.ts` | The SQL for contributor eligibility and contributor grants (T-250). |
| `eligibility-notice.ts` | Telling administrators a member newly meets the contributor requirements (blueprint 18.3, T-833, D-100). **A transition, not a state.** The reputation job recomputes a member many times; `contributor_eligibility_state`… |
| `eligibility.ts` | Who qualifies to be considered as a contributor (blueprint 9.4, T-250). |
| `formula.ts` | The Performance Rating formula (blueprint 9.1), version 1. |
| `history.ts` | A settled prediction as the formula sees it, plus where it was played. |
| `leaderboard.ts` | Leaderboard rules (blueprint 9.3), version 1. |
| `period-board.ts` | A settled prediction as the formula sees it, plus whose it is. |
| `points-store.ts` | SQL for the Career Points ledger (D-025). |
| `points.ts` | Career Points rules (blueprint 9.2), version 1. |
| `rating-store.ts` | SQL for rating snapshots (D-025). Insert-only; the newest per user is current. |

## apps/api/src/modules/search

| File | What it is |
|---|---|
| `.gitkeep` | Keeps an empty folder in git. |
| `arabic-search.spec.ts` | Tests for `arabic-search`. |
| `community-search.http.spec.ts` | Tests for `community-search.http`. |
| `search.controller.ts` | `GET /search?q=&types=&limit=`. Public; a session only narrows the members found, by the blocks on either side (T-642). |
| `search.http.spec.ts` | Tests for `search.http`. |
| `search.module.ts` | The search boundary (02-architecture.md): entity search over the catalog and aliases (T-038), and stories, groups and members (T-642). |
| `search.service.ts` | The search boundary (02-architecture.md): teams, competitions and people by name or alias (T-038, D-039), and news stories, findable groups and public members (T-642, D-087). |
| `search.spec.ts` | Tests for `search`. |

## apps/api/src/modules/search/internal

| File | What it is |
|---|---|
| `community-search-store.ts` | SQL for the kinds members and publishers make (T-642, D-087): the same matching as the catalog's -- `search_key()` on both sides, trigram word similarity or prefix, the same threshold -- so a headline, a group name and… |
| `result-images.spec.ts` | Each search result's image (T-1617): the right kind per type, one read, none invented. |
| `result-images.ts` | Each entity result's image (T-1617): a team's crest, a competition's logo, a person's photo, from our own origin (D-176) in one media read for the whole page of results; `not_supplied` where none is held (rule 3). |
| `search-query.ts` | Parsing of `GET /search` parameters (T-038). |
| `search-store.ts` | How close a query must come to a name or alias to count (pg_trgm `word_similarity`, 0–1). |

## apps/api/src/modules/social

| File | What it is |
|---|---|
| `social.controller.ts` | The social graph over HTTP (blueprint 8.1, T-201). |
| `social.http.spec.ts` | The acceptance criterion for T-201, over HTTP with real sessions and the real schema: request, cancel, accept, decline, remove, block, unblock — and a friends-only profile visible to a friend, which is the half of this… |
| `social.module.ts` | The social graph boundary (blueprint 8.1, T-201): friends, requests, blocks. |
| `social.schema.spec.ts` | The social graph against the real schema (T-200). |
| `social.service.ts` | SQLSTATE raised by the T-200 triggers when a block stands between two members. |

## apps/api/src/modules/social/internal

| File | What it is |
|---|---|
| `social-store.ts` | The SQL for the social graph (T-201). All of it, and nothing else. Two conventions run through every statement here. **The pair is ordered by the database.** `friendship` stores `low_id` and `high_id` under a CHECK (T-2… |

## apps/api/src/modules/standings

| File | What it is |
|---|---|
| `.gitkeep` | Keeps an empty folder in git. |
| `boards.spec.ts` | Tests for `boards`. |
| `conference-tables.spec.ts` | The competition page's conference tables (T-1671, D-319): each conference ranks its own clubs over all their league matches, those against the other conference included; a club in no conference is said, not dropped. |
| `group-tables.spec.ts` | The competition page's group tables (T-1336): each group under its stage, rows only once a match is finished, the newest change across the groups, and no group at all said as an absence rather than an empty list. |
| `standings.module.ts` | The standings boundary (02-architecture.md): tables and leaders computed from stored results (T-035). |
| `standings.service.ts` | The standings boundary (02-architecture.md, T-035): league tables and statistical leaders computed from the results and incidents the fixtures boundary stores (D-038). |
| `table.spec.ts` | Tests for `table`. |

## apps/api/src/modules/standings/internal

| File | What it is |
|---|---|
| `standings-store.ts` | The boards count the season's main competition only (T-1394, D-209): a cup's qualifying rounds are not its top scorers' goals. |
| `table.ts` | A league table from finished results (blueprint 5.1), pure so the ranking is tested without a database. |

## apps/api/src/modules/summaries

| File | What it is |
|---|---|
| `summaries.controller.ts` | Match summaries (E41): `GET /fixtures/:id/summary` for anyone -- the published version or the reason there is none -- and `POST /admin/fixtures/:id/summary` for an editor to ask for a new version, with the reason the au… |
| `summaries.http.spec.ts` | Match summaries through the API (T-412, T-413), with a scripted model: a finished match gets a version when the answer names only what the record holds; a plausible name the record lacks is a rejected version the page n… |
| `summaries.module.ts` | Match summaries (E41, Phase 5): the record read through the public services of fixtures, forecast and consensus -- never their internals -- assembled into facts, handed to the language model behind the intelligence port… |
| `summaries.service.ts` | The standing instruction: stable across every summary, so the provider can cache it. |

## apps/api/src/modules/summaries/internal

| File | What it is |
|---|---|
| `grounding.spec.ts` | The grounding gate (T-411) against summaries written to pass and to fail: a name the record lacks, a number the record lacks, a minute with added time, a season's year, a sentence-initial word that is not a name. |
| `grounding.ts` | The grounding gate (T-411): mechanical, in code, before anybody sees a summary. |
| `match-facts.ts` | The facts a summary is written from (T-410): the match record as the match centre already serves it, each part under its coverage state, and nothing else. |
| `match-summary-store.ts` | Match summary versions (T-411): written once, read many. |

## apps/api/src/modules/viewing

| File | What it is |
|---|---|
| `box-score-feed.http.spec.ts` | The box-score job against a real database (T-1432, D-224): our match is found on the source's list through the mapping table, its box score asked once, each player placed through `provider_mapping` (never a name), the f… |
| `box-score-feed.service.ts` | Per-player expected goals from Highlightly's box score (T-1432, D-224): for each finished match of a competition mapped to Highlightly, inside the highlights feed's 51-hour window, find the source's match on its list fo… |
| `box-score-feed.spec.ts` | Tests for `box-score-feed`. |
| `highlight-feed.http.spec.ts` | The highlights feed against a real database (T-1366, D-184): a verified clip is placed on our match through the mapping table and stored once with its territory rule; a visitor in an allowed territory sees it, as a link… |
| `highlight-feed.service.ts` | The highlights feed (T-1366, D-184): for each finished match of a mapped competition, inside the 51-hour window, ask Highlightly for the day's verified full-match highlights, place each clip on our match through `provid… |
| `highlight-feed.spec.ts` | Tests for `highlight-feed`. |
| `highlightly-quota.service.ts` | What the watchdog reads of the shared ceiling (T-1432). |
| `highlights-list.http.spec.ts` | `GET /highlights` against a real database (T-1434, D-226): the feed's clips of this file's own competition, newest match first, each with its match and publisher; a chosen territory gets what the match page's rule offer… |
| `highlights-list.spec.ts` | The Highlights list's choices (T-1434, D-226): which clips a reader is offered (the match page's territory rule, or every territory when none is chosen), the competitions the filter offers, the total and the page. |
| `viewing-admin.controller.ts` | The editorial desk (T-313, D-069): where viewing data comes from until a licence says otherwise. |
| `viewing-defaults-scheduler.service.ts` | The defaults tick (T-1360, D-181): applies every standing default to the covered upcoming fixtures it does not list yet, through the database's one copy of the rule (`viewing_apply_defaults`). |
| `viewing-defaults.http.spec.ts` | Defaults and bulk listing (T-1360, D-181), through the API: a default lists the covered upcoming matches of its competition and nothing else; applying again adds nothing; a removed listing is an exception it never re-cr… |
| `viewing.controller.ts` | `?page=` (T-1434): a whole number from 1 to `MAX_PAGE`, absent is 1; anything else is refused. |
| `viewing.http.spec.ts` | Where a match can be watched (T-313, D-069), through the API: a guest with no territory is asked, not guessed at; a territory nobody declared is `not_supplied`, dated only when somebody said so; a territory the desk cov… |
| `viewing.module.ts` | `GET /health/highlights` (T-1366): whether the highlights feed is on, whether this process runs it, today's requests against its ceiling and the newest run. |
| `viewing.schema.spec.ts` | The viewing schema (T-311, blueprint 11) against the real database: a listing is per territory and per service; a source says what it grants and a highlight cannot carry more (`PL017`); coverage is per territory and a s… |
| `viewing.service.ts` | The viewing module for a match (blueprint 11, T-313): where it can be watched and where its highlight is, in one territory, with the truth about what is known. |

## apps/api/src/modules/viewing/internal

| File | What it is |
|---|---|
| `box-score-feed.ts` | The box-score job's rules (T-1432, D-224), pure: how many box scores a run may ask for, when a stored one is asked for again, and which of a box score's figures become rows of ours. |
| `box-score-store.ts` | The one source this table holds today (migration `1765877000000`). |
| `highlight-feed-store.ts` | The feed's `viewing_source` row, fixed by id in migration `1765843000000` (rule 1). |
| `highlight-feed-transport.ts` | The injection token for the transport the highlights feed reaches the provider through. |
| `highlight-feed.ts` | The highlights feed's rules (T-1366, D-184), pure: whether the feed is on, where a clip may be offered, and which of our matches a clip belongs to. |
| `viewing-admin-store.ts` | The editorial desk's row, fixed by the T-313 migration and named by id (rule 1). |
| `viewing-read-store.ts` | The viewing rows for a set of matches in one territory (T-313). |

## apps/api/src/modules/watchdog

| File | What it is |
|---|---|
| `admin-alerts.service.ts` | The cursor the delivery reads and moves; `PostgresAlertCursor` in the module. |
| `admin-alerts.spec.ts` | Throw from the next `advance`, as a process dying before COMMIT would. |
| `cloudflare-ranges.spec.ts` | A reader answering the two published lists, counting its calls. |
| `live-feed.http.spec.ts` | T-1486 (D-258) against the real schema: the watchdog reads each match in progress with its clock, its last change and the live list's last answer, so a match held at 45 through the interval is not a stalled feed while t… |
| `watchdog-scheduler.service.ts` | The watchdog's BullMQ queue and worker (T-801): a job scheduler that runs `WatchdogService.tick` every minute, then delivers the alerts the tick wrote, and any a previous run left behind, to administrators (T-802). |
| `watchdog.controller.ts` | `GET /admin/health/watchdog` (T-801): every condition with its threshold and state, and the newest transitions. |
| `watchdog.http.spec.ts` | A match in play (minute 63) unchanged for `minutes`. |
| `watchdog.module.ts` | The watchdog (T-801, E80): a scheduled job over the health views that keeps each condition's state and logs a transition only when a level changes. |
| `watchdog.service.ts` | One tick a minute: an outage reaches an administrator within minutes (Phase 8's exit criteria). |
| `watchdog.spec.ts` | A match unchanged for `unchanged` seconds, whose live list answered 30 seconds ago. |

## apps/api/src/modules/watchdog/internal

| File | What it is |
|---|---|
| `alert-cursor.ts` | The key of the advisory lock one alert delivery holds (T-802). |
| `cloudflare-ranges.ts` | Cloudflare's address ranges as committed in `deploy/cloudflare-ranges.caddy` (T-930, D-112): the only addresses Caddy lets reach the origin. |
| `conditions.ts` | The watchdog's conditions (T-801), each a pure function from what the health views say to a level. |
| `probes.ts` | The watchdog's own queue; its failures are watched like any other's. |
| `readings.ts` | A section of the observations the tick could not read, and why. |
| `transition.ts` | A condition as the previous tick left it. |
| `watchdog-store.ts` | The key of the transaction-scoped advisory lock one tick holds (T-801). |

## apps/api/src/observability

| File | What it is |
|---|---|
| `http-observability.http.spec.ts` | Tests for `http-observability.http`. |
| `http-observability.ts` | Tracing and error tracking over HTTP (T-071, D-044). |
| `json-logger.spec.ts` | Tests for `json-logger`. |
| `json-logger.ts` | Structured logging (T-071, D-044): one JSON object per line on stdout, so a log shipper or `jq` can filter by level, context, request id or event without parsing prose. |

## apps/api/src/security

| File | What it is |
|---|---|
| `console-security.http.spec.ts` | Security tests for the administration console and member settings (T-813, blueprint 19: "security tests cover ... administrator actions"). **Table-driven, and the table is checked against the router.** The whole applica… |
| `forbidden-code.spec.ts` | Every 403 the API can answer is `forbidden` (T-907, D-108), read from the source rather than probed, because most refusals need a state a probe cannot reach: a group the caller is not in, a sanction, a paused grant. |

## apps/api/src/testing

| File | What it is |
|---|---|
| `cleanup.spec.ts` | The cleanup convention, made enforceable (`docs/03-project-map.md`). |
| `cleanup.ts` | Deleting the rows a cascade cannot reach, without turning a guard off for everybody else. **The bug this exists to stop happening a third time.** Immutable tables are guarded by `refuse_change()` triggers, so a spec's o… |

## apps/model

| File | What it is |
|---|---|
| `Dockerfile` | The model service (D-009). Built from the repository root so the context matches the other images: docker build -f apps/model/Dockerfile . |
| `package.json` | Package `@fmip/model`: Turbo hooks for the Python model service. The code is Python; these scripts run the venv's interpreter so pnpm lint/typecheck/test cover it too.: scripts and dependencies. |
| `pyproject.toml` | Python project settings and dependencies. |

## apps/model/contract

| File | What it is |
|---|---|
| `forecast-request.example.json` | JSON data or settings. |
| `forecast-response.example.json` | JSON data or settings. |
| `forecast-unavailable.example.json` | JSON data or settings. |

## apps/model/fmip_model

| File | What it is |
|---|---|
| `__init__.py` | FMIP forecast model service (D-009). Packages: - ``training``: loaders that fill the training store (schema ``training``, D-016, D-028) from football-data.co.uk and Club Elo, recording every load with its source, terms… |

## apps/model/fmip_model/backtest

| File | What it is |
|---|---|
| `__init__.py` | Backtesting and calibration (T-062). A walk-forward evaluation: for each match day in the window, fit the model on everything before that day, forecast the day's matches, and score the forecasts against what happened. S… |
| `__main__.py` | Run a backtest against the training store and write the report. python -m fmip_model.backtest --divisions E0 --from 2024-10-01 --to 2025-05-31 \ --history-from 2024-07-01 --out reports Every division is evaluated separa… |
| `compare.py` | Backtest a proposed candidate file against the published version (T-1368, D-186). python -m fmip_model.backtest.compare --candidate-file path/to/<name>-<version>.json \\ [--against <candidate name> \| --against published… |
| `cross_league.py` | The fit across leagues, judged on matches between clubs of different leagues (T-533). python -m fmip_model.backtest.cross_league \\ --tune-from 2024-07-01 --tune-to 2025-06-30 \\ --test-from 2025-07-01 --test-to 2026-06… |
| `elo_prior.py` | Which Elo prior, if any, the candidate should fit with (T-922, D-111). python -m fmip_model.backtest.elo_prior --from 2025-08-01 --to 2026-06-30 \\ --history-from 2023-07-01 --out reports For every division the candidat… |
| `inputs.py` | One harness for an input's backtest (T-1101, D-139). python -m fmip_model.backtest.inputs --input null --divisions E0 SP1 IR1 \\ --from 2025-08-01 --to 2026-06-30 [--history-from 2023-07-01] [--note ...] Per division, o… |
| `lineups.py` | Fitting the line-up term on our own recorded matches (T-534, D-086). python -m fmip_model.backtest.lineups --divisions E0 SP1 D1 I1 F1 IR1 \\ --split 2026-10-15 --until 2027-06-30 --out reports Every finished match of t… |
| `market.py` | Bookmaker odds as a forecast, for the calibration benchmark. |
| `metrics.py` | Proper scoring rules and calibration for three-way forecasts. |
| `new_divisions.py` | A candidate's new divisions, judged against uniform (T-1442, D-233). python -m fmip_model.backtest.new_divisions [--candidate <name>] [--divisions AT1 ...] \\ [--from 2025-07-01] [--to 2026-10-20] [--history-from 2022-0… |
| `report.py` | Rendering a backtest as the report the decision gate reads. |
| `tune.py` | Tune the constants D-029 left to the backtest, per division, out of sample (T-532). python -m fmip_model.backtest.tune --divisions E0 SP1 \\ --tune-from 2024-08-01 --tune-to 2025-06-30 \\ --test-from 2025-08-01 --test-t… |
| `walk_forward.py` | Walk-forward evaluation: fit on the past, forecast the day, score it. |

## apps/model/fmip_model/inputs

| File | What it is |
|---|---|
| `__init__.py` | Model inputs: a term a candidate may add to the fit, judged by one harness (T-1101, D-139). |
| `_lab.py` | What T-1658 and T-1659's inputs share (D-310, D-311): the records' database, a minimum fit. **The records' database.** The lab store (``fmip_lab``, D-303) is a copy of the ``training`` schema alone: our records' fixture… |
| `_zones.py` | The committed league-zone list (T-1167, D-171), as the model reads it. |
| `coach_quality.py` | Coach quality as an input (T-1658, D-310): his sides against expectation, his time in post. **The coach** of a side is the person named on its club's latest stored line-up strictly before the match's day (``fixture_part… |
| `cross_border.py` | Travel by its proxy (T-1166, D-170): a match whose two clubs' countries differ. |
| `draw_calibration.py` | The draw recalibrated by the gap between the sides (T-1657, D-308). |
| `head_to_head.py` | Head-to-head after current strength (T-1140, D-148). |
| `late_stakes.py` | Late-season stakes as an input (T-1659, D-311): what each side can still win or lose. |
| `league_stakes.py` | League stakes (T-1120, D-143): a side whose place in the table is locked. |
| `league_stakes_zones.py` | League stakes read with zones (T-1167, D-171): a side with nothing left to play for. |
| `neutral_ground.py` | Neutral ground (T-1122, D-145): a match on neither club's usual ground has no home advantage. |
| `new_coach.py` | A new coach as a model input (T-1131, D-147): a decaying term over his first matches. |
| `null.py` | The null input (T-1101): a coinflip feature with no effect, the harness's own control. |
| `regulars_missing.py` | Regulars missing from the XI as a model input (T-1655, D-313). |
| `rest.py` | Rest days and fixture congestion as a model input (T-1110, D-141). |
| `rest_next.py` | Rest with what comes next as a model input (T-1656, D-307). |
| `second_leg.py` | The second leg of a tie (T-1121, D-144): the first leg's score as an input to the second. |
| `team_home_advantage.py` | Home advantage by team (T-1141, D-149). The model has one home advantage per division. This input gives each club a deviation from it, ``delta``, penalised toward zero (the division's value) by ``penalty * sum(delta **… |
| `xg_form.py` | Expected-goals form: what a side's recent results owe to finishing and luck (T-1652, D-312). |

## apps/model/fmip_model/model

| File | What it is |
|---|---|
| `__init__.py` | The baseline match probability model (T-061, blueprint 6.2). |
| `cross_league.py` | Clubs of different leagues on one scale (T-533, D-085). |
| `data.py` | Reading the training store into model inputs. |
| `dixon_coles.py` | Fitting the time-weighted Dixon-Coles model with an Elo prior. |
| `lineups.py` | Line-ups and absences in expected goals (T-534, D-086). |
| `own_elo.py` | Our own Elo, computed from the training store's results (T-921, D-111). |
| `poisson.py` | From expected goals to a scoreline matrix and the outcome probabilities. |
| `version.py` | The model version: a name, a number, and the frozen constants behind it. |

## apps/model/fmip_model/model/candidates

| File | What it is |
|---|---|
| `.gitkeep` | Keeps an empty folder in git. |
| `dixon-coles-elo-0.7.0.json` | JSON data or settings. |

## apps/model/fmip_model/model/published

| File | What it is |
|---|---|
| `dixon-coles-elo-0.6.0.json` | JSON data or settings. |

## apps/model/fmip_model/model/retired

| File | What it is |
|---|---|
| `dixon-coles-elo-0.5.0.json` | JSON data or settings. |

## apps/model/fmip_model/service

| File | What it is |
|---|---|
| `__init__.py` | The FastAPI service (T-063): the internal contract between apps/api and the model. |
| `__main__.py` | Run the model service: ``python -m fmip_model.service``. |
| `app.py` | The FastAPI application. GET /health liveness plus the model version, the candidates' versions, and Club Elo's recorded state (T-920) POST /forecast ForecastRequest -> Forecast \| Unavailable GET /candidates every candid… |
| `contract.py` | The internal forecast contract, as Pydantic models. |
| `forecaster.py` | Turning a request into a forecast: aliases, a cached fit, and the honest cases. |
| `store_source.py` | The training store as the forecaster's source. |

## apps/model/fmip_model/training

| File | What it is |
|---|---|
| `__init__.py` | The training store and its loaders (T-060). |
| `absences.py` | Past seasons' absences as training data (T-1650, D-306). |
| `aliases.py` | Proposing a football-data division's aliases from results (T-1442, D-233). python -m fmip_model.training.aliases propose --division AT1 [--provider api_football] The bridge from our clubs to a division's training names… |
| `clubelo.py` | Parsing Club Elo CSV into rows for ``training.elo``. |
| `coaches.py` | Coach changes read from our stored line-ups (T-1130, D-147). python -m fmip_model.training.coaches count A club's line-ups are its sides of finished matches, in every competition we carry, that have a line-up row or a n… |
| `fixture_detail.py` | Our records' match detail in the training store (T-1647, T-1648, D-305). python -m fmip_model.training.load records-stats [--into fmip_lab] python -m fmip_model.training.load records-lineups [--into fmip_lab] python -m… |
| `football_data.py` | Parsing football-data.co.uk CSV files into rows for ``training.match``. |
| `load.py` | The loader command (T-060). python -m fmip_model.training.load football-data --seasons 2324 2425 --divisions E0 SP1 python -m fmip_model.training.load clubelo --days 2024-08-01 2025-08-01 python -m fmip_model.training.l… |
| `own_elo.py` | Our own Elo in the training store (T-921, D-111): computed, stored, recomputed. python -m fmip_model.training.own_elo compute --day 2026-09-28 python -m fmip_model.training.own_elo verify --day 2026-09-28 ``compute`` re… |
| `records.py` | Our own records as training data (T-512, D-083). |
| `sources.py` | The training store's sources and the terms each is used under. |
| `store.py` | Writing to the training store (schema ``training``, D-028). |

## apps/model/reports

| File | What it is |
|---|---|
| `README.md` | Backtest reports |

## apps/model/reports/dixon-coles-elo-0.1.0

| File | What it is |
|---|---|
| `E0_2024-10-01..2025-05-31.json` | JSON data or settings. |
| `E0_2024-10-01..2025-05-31.md` | Backtest — dixon-coles-elo@0.1.0 — E0 2024-10-01..2025-05-31 |
| `IR1_2024-08-15..2025-05-15.json` | JSON data or settings. |
| `IR1_2024-08-15..2025-05-15.md` | Backtest — dixon-coles-elo@0.1.0 — IR1 2024-08-15..2025-05-15 |
| `IR1_2025-08-18..2026-07-22.json` | JSON data or settings. |
| `IR1_2025-08-18..2026-07-22.md` | Backtest — dixon-coles-elo@0.1.0 — IR1 2025-08-18..2026-07-22 |

## apps/model/reports/dixon-coles-elo-0.4.0

| File | What it is |
|---|---|
| `cross_league_2025-07-01..2026-06-30_pass1.json` | JSON data or settings. |
| `cross_league_2025-07-01..2026-06-30_pass2.json` | JSON data or settings. |

## apps/model/reports/dixon-coles-elo-0.5.0

| File | What it is |
|---|---|
| `compare_2025-08-01..2026-06-30.json` | JSON data or settings. |
| `compare_2025-08-01..2026-06-30.md` | dixon-coles-elo@0.5.0 against dixon-coles-elo@0.1.0, 2025-08-01 to 2026-06-30 |
| `elo_prior_2025-08-01..2026-06-30.json` | JSON data or settings. |
| `elo_prior_2025-08-01..2026-06-30.md` | Elo prior for dixon-coles-elo@0.5.0, 2025-08-01 to 2026-06-30 |
| `inputs_head_to_head_2024-07-01..2026-09-28.json` | JSON data or settings. |
| `inputs_head_to_head_2024-07-01..2026-09-28.md` | Input `head_to_head` against dixon-coles-elo@0.5.0, 2024-07-01 to 2026-09-28 |
| `inputs_team_home_advantage_2024-07-01..2026-09-28.json` | JSON data or settings. |
| `inputs_team_home_advantage_2024-07-01..2026-09-28.md` | Input `team_home_advantage` against dixon-coles-elo@0.5.0, 2024-07-01 to 2026-09-28 |
| `inputs_team_home_advantage_penalty_100_2023-07-01..2024-06-30.json` | JSON data or settings. |
| `inputs_team_home_advantage_penalty_100_2023-07-01..2024-06-30.md` | Input `team_home_advantage_penalty_100` against dixon-coles-elo@0.5.0, 2023-07-01 to 2024-06-30 |
| `inputs_team_home_advantage_penalty_10_2023-07-01..2024-06-30.json` | JSON data or settings. |
| `inputs_team_home_advantage_penalty_10_2023-07-01..2024-06-30.md` | Input `team_home_advantage_penalty_10` against dixon-coles-elo@0.5.0, 2023-07-01 to 2024-06-30 |
| `inputs_team_home_advantage_penalty_1_2023-07-01..2024-06-30.json` | JSON data or settings. |
| `inputs_team_home_advantage_penalty_1_2023-07-01..2024-06-30.md` | Input `team_home_advantage_penalty_1` against dixon-coles-elo@0.5.0, 2023-07-01 to 2024-06-30 |
| `inputs_team_home_advantage_penalty_30_2023-07-01..2024-06-30.json` | JSON data or settings. |
| `inputs_team_home_advantage_penalty_30_2023-07-01..2024-06-30.md` | Input `team_home_advantage_penalty_30` against dixon-coles-elo@0.5.0, 2023-07-01 to 2024-06-30 |
| `inputs_team_home_advantage_penalty_3_2023-07-01..2024-06-30.json` | JSON data or settings. |
| `inputs_team_home_advantage_penalty_3_2023-07-01..2024-06-30.md` | Input `team_home_advantage_penalty_3` against dixon-coles-elo@0.5.0, 2023-07-01 to 2024-06-30 |

## apps/model/reports/dixon-coles-elo-0.6.0

| File | What it is |
|---|---|
| `compare_2025-07-01..2026-10-08.json` | JSON data or settings. |
| `compare_2025-07-01..2026-10-08.md` | dixon-coles-elo@0.6.0 against dixon-coles-elo@0.5.0, 2025-07-01 to 2026-10-08 |
| `compare_2025-08-01..2026-06-30.json` | JSON data or settings. |
| `compare_2025-08-01..2026-06-30.md` | dixon-coles-elo@0.6.0 against dixon-coles-elo@0.5.0, 2025-08-01 to 2026-06-30 |

## apps/model/reports/dixon-coles-elo-0.7.0

| File | What it is |
|---|---|
| `new_divisions_2025-07-01..2026-10-20.json` | JSON data or settings. |
| `new_divisions_2025-07-01..2026-10-20.md` | dixon-coles-elo@0.7.0: the new divisions against uniform |
| `tune_2024-07-01..2025-06-30.json` | JSON data or settings. |

## apps/model/scripts

| File | What it is |
|---|---|
| `py.mjs` | Runs the model service's Python with the given arguments. |

## apps/model/tests

| File | What it is |
|---|---|
| `test_absences.py` | Past seasons' absences as training data (T-1650, D-306). |
| `test_backtest_inputs.py` | The input harness (T-1101, D-139): a planted effect passes the bar, no effect fails it. |
| `test_club_elo_retired.py` | Club Elo is retired (T-947, D-162). No new model version may read Club Elo: a committed candidate file that declares ``elo_prior: clubelo`` or ``clubelo_then_own`` -- or leaves the prior out, which inherits 0.1.0's ``cl… |
| `test_clubelo.py` | Tests for `clubelo`. |
| `test_coaches.py` | Coach changes from stored line-ups (T-1130, D-147). |
| `test_compare.py` | The collaborator's comparison (T-1368, D-186): a proposed candidate file against the reference, on the same matches, judged by D-139's bar. |
| `test_cross_border.py` | Travel by its proxy (T-1166, D-170): read only where the clubs' countries differ. |
| `test_cross_league.py` | Clubs of different leagues on one scale (T-533). |
| `test_cross_league_options.py` | The cross-league fit's candidate options (T-1654, D-309). |
| `test_dixon_coles.py` | The fit recovers what was put in, on synthetic seasons with known strengths. |
| `test_elo_prior.py` | The Elo-prior backtest (T-922): same matches, same fit dates, and an honest 'not run'. |
| `test_elo_source.py` | Club Elo's state as the service reports it (T-920, D-111). |
| `test_fit_real.py` | The model on real data from the training store (needs DATABASE_URL and a loaded season). |
| `test_fixture_detail.py` | Our records' team statistics and line-ups in the training store (T-1647, T-1648, D-305). |
| `test_football_data.py` | Tests for `football_data`. |
| `test_input_coach_quality.py` | Coach quality as an input (T-1658, D-310): the baseline, the shrunk record, tenure, the harness. |
| `test_input_draw_calibration.py` | The draw recalibration (T-1657, D-308) and the harness's second kind of input. |
| `test_input_head_to_head.py` | Head-to-head after current strength (T-1140, D-148). |
| `test_input_late_stakes.py` | Late-season stakes (T-1659, D-311): each side's state in the last eight rounds, by the zones. |
| `test_input_new_coach.py` | A new coach as an input (T-1131, D-147): the rule, and the harness on a planted bounce. |
| `test_input_regulars_missing.py` | Regulars missing from the XI as an input (T-1655, D-313). |
| `test_input_rest.py` | Rest and congestion as an input (T-1110, D-141). |
| `test_input_rest_next.py` | Rest with what comes next as an input (T-1656, D-307). |
| `test_input_team_home_advantage.py` | Home advantage by team (T-1141, D-149). |
| `test_input_xg_form.py` | Expected-goals form as an input (T-1652, D-312). |
| `test_league_stakes.py` | League stakes (T-1120, D-143): a side's place is locked only when no one can reach it. |
| `test_league_stakes_zones.py` | League stakes with zones (T-1167, D-171): settled within a band of the committed zones. |
| `test_lineups.py` | Line-ups and absences in expected goals (T-534). |
| `test_metrics.py` | Tests for `metrics`. |
| `test_more_leagues.py` | More leagues for the model (T-1442, D-233). |
| `test_neutral_ground.py` | Neutral ground (T-1122, D-145): no home advantage on neither club's usual ground. |
| `test_own_elo.py` | Our own Elo (T-921, D-111): the rules, the bridge, and a day recomputed from the store. |
| `test_poisson.py` | Tests for `poisson`. |
| `test_records.py` | Our own records as training data (T-512, D-083). |
| `test_second_leg.py` | The second leg (T-1121, D-144): the first leg's score, only for a real two-legged tie. |
| `test_service.py` | The service against a fake training source: the contract, the honest cases, and the golden example the apps/api contract test reads. |
| `test_sources.py` | Tests for `sources`. |
| `test_store.py` | Integration tests for the training store. |
| `test_tune.py` | Tuning the constants out of sample (T-532): chosen on one window, judged on the next. |
| `test_walk_forward.py` | Walk-forward evaluation on simulated seasons: no leaks, sensible scores, a report. |

## apps/model/tests/fixtures

| File | What it is |
|---|---|
| `football-data_E0_2425_head.csv` | CSV data (fixture or reference). |

## apps/web

| File | What it is |
|---|---|
| `.gitignore` | Files git leaves out. |
| `Dockerfile` | Built from the repository root so the lockfile and workspace packages are in context: docker build -f apps/web/Dockerfile . |
| `eslint.config.mjs` | /*.{ts,tsx}'], rules: { 'no-restricted-syntax': [ 'error', { selector: `JSXAttribute[name.name='className'] Literal[value=/${PHYSICAL_UTILITY}/]`, message: 'Physical Tailwind utility in a className. |
| `next-env.d.ts` | / <reference types="next" /> / <reference types="next/image-types/global" /> |
| `next.config.ts` | Next configuration. |
| `package.json` | Package `@fmip/web`: FMIP web application. Next.js App Router.: scripts and dependencies. |
| `perf-budgets.json` | JSON data or settings. |
| `playwright.config.ts` | Playwright configuration. |
| `postcss.config.mjs` | Postcss configuration. |
| `stylelint.config.mjs` | Layout CSS must use logical properties (CLAUDE.md rule 7). |
| `tsconfig.json` | TypeScript compiler settings. |
| `vitest.config.mts` | Vitest configuration. |

## apps/web/public

| File | What it is |
|---|---|
| `sw.js` | The service worker. |

## apps/web/public/icons

| File | What it is |
|---|---|
| `apple-touch-icon.png` | Image asset. |
| `icon-192.png` | Image asset. |
| `icon-32.png` | Image asset. |
| `icon-512.png` | Image asset. |
| `icon-maskable-512.png` | Image asset. |
| `mark.svg` | Image asset. |

## apps/web/scripts

| File | What it is |
|---|---|
| `i18n-catalogues.mjs` | `en` and the pseudo-locale format as `en-GB` (see src/i18n/format.ts); the rest are themselves. |
| `i18n-glossary.mjs` | The value after a flag, or null. |
| `make-icons.manifest.json` | JSON data or settings. |
| `make-icons.mjs` | A maskable icon may be cropped to a circle of 40% of its size around the centre; the tile is drawn full bleed and the figure shrunk into that zone. |
| `perf-budgets.mjs` | The first-load JavaScript budgets (T-808), checked against the build in `.next`. |

## apps/web/scripts/lib

| File | What it is |
|---|---|
| `perf-budgets.d.mts` | — |
| `perf-budgets.mjs` | The budgets file, parsed and checked for shape. |

## apps/web/src

| File | What it is |
|---|---|
| `proxy.ts` | Next 16 renamed this convention from `middleware` to `proxy`. |

## apps/web/src/app

| File | What it is |
|---|---|
| `fonts.spec.ts` | T-601: the site's fonts are served from this site. |
| `global-error-body.tsx` | The last boundary's body with its styles (T-809, T-1536). |
| `global-error.spec.ts` | T-1536: a stylesheet `global-error.tsx` imports is written into every page's HTML, inside the RSC payload, whether or not anything fails -- the page's own stylesheet a second time (83 kB, 12 kB of the match page's gzip). |
| `global-error.tsx` | The last boundary (T-809): an error in the locale layout itself. |
| `globals.css` | Global styles: Tailwind layers and shared component classes. |
| `manifest.ts` | The web app manifest (T-082, D-042): what a phone needs to install the app to its home screen. |
| `perf-budgets.spec.ts` | The first-load JavaScript budget's reading of the build (T-808), against a miniature `.next` laid out the way Next 16 writes one. |
| `raw-colours.spec.ts` | Every colour in the web app comes from a token (T-602, D-090). |
| `robots.ts` | `/robots.txt` (T-039). Everything public is crawlable; the pseudo-locale, the web app's own API routes and a member's own pages are not. **Unless the football here is demonstration data** (T-087), in which case nothing… |
| `sitemap.ts` | `/sitemap.xml` (T-039): the static pages, every active competition and team, under each indexable locale. |
| `tokens.css` | Design tokens (colours, spacing, type) as CSS variables. |
| `tokens.spec.ts` | The colour tokens (T-602, D-089) keep their promises. |

## apps/web/src/app/[locale]

| File | What it is |
|---|---|
| `error.tsx` | A page that failed to render, inside the locale (T-809). |
| `layout.tsx` | Every shipped locale is known at build time, so each one is rendered statically rather than on demand. |
| `not-found.tsx` | A page that does not exist, inside the locale (T-809): a page's own `notFound()` (a malformed id, an unknown competition) and any unknown path under a locale (`[...missing]/page.tsx`) land here, so the document is the l… |
| `page.tsx` | The home page in the Stadiomind design (T-1495, D-263, D-270; the canvas boards Home and HomePhone): the day's heading, the matches in play, the big match with the model's forecast and the other two voices kept apart, a… |

## apps/web/src/app/[locale]/[...missing]

| File | What it is |
|---|---|
| `page.tsx` | Any path under a locale that no page answers (T-809). |

## apps/web/src/app/[locale]/about

| File | What it is |
|---|---|
| `about-content.spec.ts` | Tests for `about-content`. |
| `about-content.ts` | What the About page's two pictures say (T-1615, D-286), as data, so the rules they carry are unit-tested (`about-content.spec.ts`) and the components only draw. "How Stadiomind works" runs the three prediction products… |
| `about-icons.tsx` | The About page's own line icons (T-1615): drawn like the shared set (`components/ui/icons.tsx`) -- 24-unit strokes in the text colour, always decorative, the word beside each saying what it means -- for the things only… |
| `about.css` | — |
| `find-your-way.tsx` | "Find your way" (T-1615, D-286): the site's main sections as tiles, in two groups -- the football, and the forecasts and predictions -- each tile a link with one line on what is there. |
| `how-it-works.spec.tsx` | The direct children of the diagram's ordered list, by their test ids. |
| `how-it-works.tsx` | "How Stadiomind works" (T-1615, D-286): the path of one match, from the licensed data to the records the forecasts build, as an ordered list that is drawn as a diagram. |
| `page.tsx` | The page for a first visit (T-523): what the product is, the three prediction products, and how a rating is earned. |

## apps/web/src/app/[locale]/account-deleted

| File | What it is |
|---|---|
| `page.tsx` | Where "Delete my account" lands (T-812, D-094): the one sentence that says it happened. |

## apps/web/src/app/[locale]/admin

| File | What it is |
|---|---|
| `page.tsx` | The minimal administration area (blueprint 16, T-070, D-046): the live paths (T-236), coverage per current season, live-data freshness, ingest failures, the rating rules in force, member search, and the two audited acti… |

## apps/web/src/app/[locale]/admin/activity

| File | What it is |
|---|---|
| `page.tsx` | The Activity page (T-807, blueprint 19): how much of each thing happened per UTC day over the last thirty days, from `GET /admin/activity`. |

## apps/web/src/app/[locale]/admin/analysis-reviews

| File | What it is |
|---|---|
| `page.tsx` | The editorial queue (blueprint 10.3, T-262). |

## apps/web/src/app/[locale]/admin/campaigns

| File | What it is |
|---|---|
| `page.tsx` | Campaigns for administrators (T-332, D-075). |

## apps/web/src/app/[locale]/admin/competitions

| File | What it is |
|---|---|
| `page.tsx` | The competitions' order (T-1162, D-154), administrators only, over the audited API. |

## apps/web/src/app/[locale]/admin/contributors

| File | What it is |
|---|---|
| `page.tsx` | Contributors on the web (T-612), over the audited API of T-250. |

## apps/web/src/app/[locale]/admin/data-quality

| File | What it is |
|---|---|
| `page.tsx` | Data-quality findings on the web (T-821), over `GET /admin/data-quality`. |

## apps/web/src/app/[locale]/admin/homepage

| File | What it is |
|---|---|
| `page.tsx` | Featured matches on the homepage (T-1161, D-153), over the audited API. |

## apps/web/src/app/[locale]/admin/members/[username]

| File | What it is |
|---|---|
| `page.tsx` | A member's page in the console (blueprint 16, T-1164), reached from the member search on `/admin`. |

## apps/web/src/app/[locale]/admin/model-accuracy

| File | What it is |
|---|---|
| `page.tsx` | Accuracy over time (T-1369, D-187): every model version, published and in shadow, by ISO week or month. |

## apps/web/src/app/[locale]/admin/model-candidates

| File | What it is |
|---|---|
| `page.tsx` | The candidates in shadow and their records (T-1103, D-140). |

## apps/web/src/app/[locale]/admin/moderation

| File | What it is |
|---|---|
| `page.tsx` | The moderation queue on the web (blueprint 16, T-610), over the API of T-212. |

## apps/web/src/app/[locale]/admin/moderation/[username]

| File | What it is |
|---|---|
| `page.tsx` | One member's moderation history (T-611), over `GET /admin/moderation/members/:username`. |

## apps/web/src/app/[locale]/admin/moderation/groups/[slug]

| File | What it is |
|---|---|
| `page.tsx` | One group before a moderator decides (blueprint 10.4, T-1025, D-135), over `GET /admin/moderation/groups/:slug`. |

## apps/web/src/app/[locale]/admin/news

| File | What it is |
|---|---|
| `page.tsx` | The editor's news desk (T-1009). The role is the API's to check (editors and administrators): the editor's debate list answers or refuses, and a refusal is said rather than shown as an empty desk (T-904). |

## apps/web/src/app/[locale]/admin/news-coverage

| File | What it is |
|---|---|
| `page.tsx` | News coverage per competition (T-1010, D-129). |

## apps/web/src/app/[locale]/admin/news-sources

| File | What it is |
|---|---|
| `page.tsx` | News sources (T-1015). The role is the API's to check (administrators only); a refusal is said rather than shown as an empty list. |

## apps/web/src/app/[locale]/admin/panels

| File | What it is |
|---|---|
| `page.tsx` | Featured matches on the web (T-613), over the audited API of T-253. |

## apps/web/src/app/[locale]/admin/rating-thresholds

| File | What it is |
|---|---|
| `page.tsx` | Rating thresholds as versioned rows (T-1160, D-152, D-164), administrators only, over the audited API. |

## apps/web/src/app/[locale]/admin/system

| File | What it is |
|---|---|
| `page.tsx` | The System page (T-804, blueprint 16): the watchdog's conditions and incidents (T-801), where its alerts went (T-802), and API errors and job failures per hour (T-803), and every write's rate limit with its refusals per… |

## apps/web/src/app/[locale]/admin/translations

| File | What it is |
|---|---|
| `page.tsx` | The translator's desk (T-1013): per language, the articles to translate, the translations awaiting a second speaker and the ones reviewed. |

## apps/web/src/app/[locale]/admin/translations/[articleId]/[language]

| File | What it is |
|---|---|
| `page.tsx` | One article at the translator's desk (T-1013). |

## apps/web/src/app/[locale]/admin/viewing

| File | What it is |
|---|---|
| `page.tsx` | Watch listings (T-1361): the desk's console for where matches can be watched, editors and administrators. |

## apps/web/src/app/[locale]/analyses/[fixtureId]

| File | What it is |
|---|---|
| `page.tsx` | The analyst's editor for one match (blueprint 10.3, T-262). |

## apps/web/src/app/[locale]/coach/[id]

| File | What it is |
|---|---|
| `page.tsx` | The coach page (T-1439, D-230), reached from the team page's head coach and manager: the band, the career as the data provider lists it at the teams we cover, and the line-ups that name him. 404 for a person who is not… |

## apps/web/src/app/[locale]/competition/[id]

| File | What it is |
|---|---|
| `competition-cards.spec.tsx` | The competition page in the Stadiomind design (T-1498, D-274): the header and its tabs, the full table whose places carry a zone colour only where the feed lists them, a day of matches with the model's percentages or th… |
| `competition-cards.tsx` | The competition page's modules in the Stadiomind design (T-1498, D-274): a surface card with its name in the wide cut and a hairline under it, and what goes in it -- the table, a round of matches with the model's three… |
| `competition-header.tsx` | The competition page's header in the Stadiomind design (T-1498, D-274): the logo on its own light tile, the name in the wide display cut, one line of facts (country, season, clubs, the round), the season menu and the fo… |
| `opengraph-image.tsx` | The card a chat app shows for a competition link (T-520): the top of the current season's table, or the page's own sentence when there is none. |
| `page.tsx` | The model's latest pre-kick-off forecast for each of these matches: one request for all of them (at most `MAX_FORECAST_FIXTURES`), never one per match. |

## apps/web/src/app/[locale]/competitions

| File | What it is |
|---|---|
| `page.tsx` | All competitions (T-1433, T-1612): every league and cup we follow, from our own API (`GET /competitions/directory`), grouped -- international, then continental, then each country. |

## apps/web/src/app/[locale]/following

| File | What it is |
|---|---|
| `page.tsx` | The Following feed (blueprint 12.1, T-333): what happened, and what is about to, around what a member follows, in the API's order. |

## apps/web/src/app/[locale]/following/saved

| File | What it is |
|---|---|
| `page.tsx` | Saved (blueprint 3.3 and 2.1, T-842), under Following: the stories the member saved, newest first, as the publisher's headline and a link to their original (D-061) -- nothing else of theirs. |

## apps/web/src/app/[locale]/forgot-password

| File | What it is |
|---|---|
| `page.tsx` | Next.js page for the route `/[locale]/forgot-password`. |

## apps/web/src/app/[locale]/founder/[fixtureId]

| File | What it is |
|---|---|
| `page.tsx` | Writing the founder's analysis (blueprint 6.5, T-131). |

## apps/web/src/app/[locale]/friends

| File | What it is |
|---|---|
| `page.tsx` | Friends, requests and blocks on one page (blueprint 8.1, T-202). |

## apps/web/src/app/[locale]/group-invite/[token]

| File | What it is |
|---|---|
| `page.tsx` | A link is a key: never indexed, and never sent onward in a `Referer` to whatever the page links to. |

## apps/web/src/app/[locale]/groups

| File | What it is |
|---|---|
| `page.tsx` | The group directory (blueprint 8.2, T-242). **What is here is what can be found.** An invite-only group is absent — not hidden by a filter on this page, but absent from the answer and from the index behind it (T-240). |

## apps/web/src/app/[locale]/groups/[slug]

| File | What it is |
|---|---|
| `page.tsx` | One group (blueprint 8.2, T-242). **A private group is not discoverable and an invite-only one is not joinable** — the acceptance criterion, and neither half is enforced here. |

## apps/web/src/app/[locale]/groups/[slug]/history

| File | What it is |
|---|---|
| `page.tsx` | A group's history (T-1026, over T-1020's `GET /groups/:slug/history`): its audited changes, for the owner and moderators. |

## apps/web/src/app/[locale]/highlights

| File | What it is |
|---|---|
| `page.tsx` | Highlights (T-1434, D-226; T-1614, D-285): the reads -- who is asking, their zone, the API's page of clips for the address, and the territories a guest may choose -- and `HighlightsView` draws them. |
| `poster.tsx` | One clip as a match poster (T-1614, D-285): the competition's logo, both crests large, the score, the date and a play badge on a pitch drawn in the page's own lines, then the way out to the clip on its publisher's site… |
| `view.spec.tsx` | The Highlights page as match posters (T-1614, D-285): the newest clip featured on the first page, the rest by the reader's day; each poster drawn from our own crests and logos (a lettered mark where none is stored, neve… |
| `view.tsx` | Highlights (T-1434, D-226; redesigned as match posters by T-1614, D-285): every official highlight link we hold -- the licensed feed's verified clips (D-184), link only, never played here -- newest match first. |

## apps/web/src/app/[locale]/leaderboard

| File | What it is |
|---|---|
| `page.tsx` | The languages a board can be drawn by (T-844): the ones the site is offered in. |

## apps/web/src/app/[locale]/login

| File | What it is |
|---|---|
| `page.tsx` | Next.js page for the route `/[locale]/login`. |

## apps/web/src/app/[locale]/match/[id]

| File | What it is |
|---|---|
| `forecast-reality.tsx` | The Summary's opening card (T-1497, D-263 point 4): what the statistical model forecast, and -- after full time -- what happened. |
| `opengraph-image.tsx` | The card a chat app shows for a match link (T-520): the teams, the score or the kick-off, and the statistical model's forecast when the page shows one. |
| `page.tsx` | The match centre page (blueprint 4.2, T-034). |

## apps/web/src/app/[locale]/messages

| File | What it is |
|---|---|
| `page.tsx` | The conversation list (blueprint 8.3, T-224). **There is no socket behind this page and deliberately is not one yet.** T-230 is the transport; E22 was ordered so that the surface is correct over ordinary requests first,… |

## apps/web/src/app/[locale]/messages/[id]

| File | What it is |
|---|---|
| `page.tsx` | One conversation (blueprint 8.3, T-224). **Correct without a socket, and still correct with one.** Everything here happens over ordinary requests. |

## apps/web/src/app/[locale]/model-accuracy

| File | What it is |
|---|---|
| `page.tsx` | "How accurate is our model?" (T-1369, D-187): the statistical model's published forecasts against the results, by month or (`?period=week`, T-1414) by ISO week, overall and per competition, over `GET /model/accuracy`. |

## apps/web/src/app/[locale]/news

| File | What it is |
|---|---|
| `page.tsx` | The news page (blueprint 3.1 and 3.2, T-143): four sections over the same stories, each saying what it is computed from, and filters by country, competition, team and language. |

## apps/web/src/app/[locale]/news/story/[id]

| File | What it is |
|---|---|
| `page.tsx` | The story page (blueprint 3.3, T-144), built against D-061: the original's words as the publisher wrote them, the way back to the publisher, the languages it exists in, its corrections, the other publishers' reports of… |
| `story-page.spec.tsx` | The story page off editorial paper (T-1621, D-291): it follows the theme, keeps its reading faces, and its rights behaviour is D-061's and D-177's as before -- the publisher's words only when the source grants the full… |

## apps/web/src/app/[locale]/notifications

| File | What it is |
|---|---|
| `page.tsx` | The inbox (blueprint 12.2, T-272). A signed-out visitor is sent to sign in rather than shown an empty inbox: an empty list would say "nothing happened", which is a different thing from "we do not know who you are". The… |

## apps/web/src/app/[locale]/offline

| File | What it is |
|---|---|
| `page.tsx` | The offline shell (T-082, D-042): what the service worker shows when a page cannot be fetched. |

## apps/web/src/app/[locale]/player/[id]

| File | What it is |
|---|---|
| `page.tsx` | The player page (blueprint 5.3, T-037) in the Stadiomind Design System (T-1500, D-271): the header with the photo in the club's ring, the name, the club line and the facts (age, height, foot, each with its coverage), fo… |

## apps/web/src/app/[locale]/player/[id]/compare

| File | What it is |
|---|---|
| `compare-page.spec.tsx` | The compare page names each player's club, national team, position and age (T-1630). |
| `page.tsx` | Two players compared (blueprint 5.3, T-631): both player pages fetched side by side and their records lined up for one season and competition. |

## apps/web/src/app/[locale]/predictions

| File | What it is |
|---|---|
| `page.tsx` | The old Predictions page (T-137, D-201) is gone (T-1519, D-269): matches and picks are one page (D-268), the founder's analysis is on it at `#analysis`, and the leaderboard and the model's record are linked from there. |

## apps/web/src/app/[locale]/register

| File | What it is |
|---|---|
| `page.tsx` | Next.js page for the route `/[locale]/register`. |

## apps/web/src/app/[locale]/reset-password

| File | What it is |
|---|---|
| `page.tsx` | Next.js page for the route `/[locale]/reset-password`. |

## apps/web/src/app/[locale]/rules

| File | What it is |
|---|---|
| `page.tsx` | The platform rules in force (T-931, D-113), for anybody. |

## apps/web/src/app/[locale]/scores

| File | What it is |
|---|---|
| `match-preview.tsx` | The matches page's preview of one match, with the pick form (T-1496, the canvas's side column): which match, both teams, "Your pick" -- the same form, server action and three states as the match centre's (`InlinePick`),… |
| `matches-analysis.tsx` | The founder's analysis on the matches page (T-1519, D-269), where the header's Analysis leads (`#analysis`): the latest analyses in the founder's own voice, never folded into a row's percentages or the community's split… |
| `matches.spec.tsx` | Matches and predictions on one page (T-1496, D-268): the row's model cell, its Pick in each state, the "Not picked yet" view, the addresses the page is driven by, and the preview's rule that the community's split appear… |
| `page.tsx` | Matches and predictions on one page (T-1496, D-268; blueprint 4.1 and 2.1): one day at a time in the viewer's zone, the day strip, four views (All, Live, Not picked yet, My teams), the day's competitions as cards whose… |

## apps/web/src/app/[locale]/search

| File | What it is |
|---|---|
| `page.tsx` | Search (T-038, T-642): teams, competitions and players by name or alias from `/ask`, and news stories, findable groups and public members from `GET /search`, each kind in its own section with its own sentence when nothi… |

## apps/web/src/app/[locale]/settings

| File | What it is |
|---|---|
| `page.tsx` | "Done." and "Working…" for every form on the page, in the reader's language. |

## apps/web/src/app/[locale]/settings/data-export

| File | What it is |
|---|---|
| `route.ts` | Settings -> Download my data (T-846, D-158). |

## apps/web/src/app/[locale]/settings/notifications

| File | What it is |
|---|---|
| `page.tsx` | What arrives, and when (blueprint 12.2, T-273). |

## apps/web/src/app/[locale]/team/[id]

| File | What it is |
|---|---|
| `page.tsx` | The team page (blueprint 5.2, T-036), in the Stadiomind Club board (T-1499, D-276; tabs since T-1386, D-204): following Day and Night, under a band filled with the club's colour when one is known (the only place it appe… |

## apps/web/src/app/[locale]/u/[username]

| File | What it is |
|---|---|
| `opengraph-image.tsx` | The card a chat app shows for a member's profile link (T-520): their name, their rating and their latest settled predictions, exactly as a signed-out visitor would see them -- every request here is made without a sessio… |
| `page.tsx` | A member's public profile (blueprint 7.2). |

## apps/web/src/app/[locale]/u/[username]/compare

| File | What it is |
|---|---|
| `page.tsx` | Two members' prediction records, side by side (blueprint 8.1, T-203). |

## apps/web/src/app/[locale]/verify-email

| File | What it is |
|---|---|
| `page.tsx` | The link from the verification e-mail lands here. |

## apps/web/src/app/[locale]/watch

| File | What it is |
|---|---|
| `page.tsx` | The Watch page (blueprint 11, T-314): the day's matches, each with where it can be watched in the viewer's territory -- the member's stored one (T-312) or the one a guest picks here, which then travels with every link o… |

## apps/web/src/app/[locale]/welcome

| File | What it is |
|---|---|
| `page.tsx` | The first-run flow (blueprint 2.3 and 7.1, T-620): language, territory, time zone and favourite teams, one step per page, each skippable. |

## apps/web/src/app/api/fixtures/[id]/stream

| File | What it is |
|---|---|
| `route.ts` | The browser's end of one match centre's stream (T-034): the page's EventSource connects here and this handler holds the connection to the API's `/fixtures/:id/stream` (D-027). |

## apps/web/src/app/api/media/[kind]/[id]/[version]

| File | What it is |
|---|---|
| `route.ts` | A stored crest, logo or photo on the site's own origin (T-1320, D-176). |

## apps/web/src/app/api/scores/stream

| File | What it is |
|---|---|
| `route.ts` | The browser's end of the scores stream (T-032). |

## apps/web/src/app/console

| File | What it is |
|---|---|
| `chat.tsx` | The chat with an agent (T-1722, D-350), drawn on the server: no model answers here. |
| `console-form.tsx` | A console form whose action answers with what happened (D-340): the outcome is said under the button, in a live region, and the button waits while the action runs. |
| `console-link.tsx` | The site's link with a console path put under the request's base (D-341). |
| `console.spec.tsx` | The agents console's web side (T-1698, D-340): served on its own host only, its cookie read back from the API's, and an open security finding shown without its detail. |
| `layout.tsx` | The agents console's root (D-340): its own `<html>`, apart from the site's `[locale]` layout. |
| `ui.tsx` | The agents console's building blocks (D-340): server components only, in Persian for the maintainer and the teammate, with the site's tokens and logical properties (rule 7). |

## apps/web/src/app/console/(app)

| File | What it is |
|---|---|
| `layout.tsx` | Every console page but sign-in and the invitation (D-340): no session, no page. |
| `page.tsx` | The console's first page (T-1698, D-340): how the team is, what waits on a person. |

## apps/web/src/app/console/(app)/agents/[name]

| File | What it is |
|---|---|
| `page.tsx` | One agent (T-1698, D-340): how it works, what it can touch, what feeds its memory and what it holds, its runs, and its controls. |

## apps/web/src/app/console/(app)/agents/[name]/chat

| File | What it is |
|---|---|
| `page.tsx` | The chat with one agent (T-1722, D-350): the conversation, newest last, and a box to write in. |

## apps/web/src/app/console/(app)/audit

| File | What it is |
|---|---|
| `page.tsx` | Who did what in the console, newest first (rule 10, D-340). |

## apps/web/src/app/console/(app)/board

| File | What it is |
|---|---|
| `page.tsx` | The project board, moved here from its claude.ai page (T-1698, T-1700, D-340). |

## apps/web/src/app/console/(app)/decisions

| File | What it is |
|---|---|
| `page.tsx` | The decision desk inside the console (T-1698, D-340): open questions, each answered with a choice, a note and a reason; then what is already decided, on the desk and in the record (D-xxx). |

## apps/web/src/app/console/(app)/findings

| File | What it is |
|---|---|
| `page.tsx` | Every agent's findings (T-1698, D-340), filtered by agent, severity and status. |

## apps/web/src/app/console/(app)/reports

| File | What it is |
|---|---|
| `page.tsx` | Every agent's reports, newest first, and the one chosen (T-1698, D-340). |

## apps/web/src/app/console/(open)/invite/[token]

| File | What it is |
|---|---|
| `page.tsx` | Opening a console account from a one-time invitation (T-1696, D-340). |

## apps/web/src/app/console/(open)/login

| File | What it is |
|---|---|
| `page.tsx` | Signing in to the console (T-1696, D-340): the console's own name and password. |

## apps/web/src/app/health

| File | What it is |
|---|---|
| `route.spec.ts` | Tests for `route`. |
| `route.ts` | The public origin's health, for the off-machine uptime check (T-806, D-156). |

## apps/web/src/components

| File | What it is |
|---|---|
| `account-deletion.spec.ts` | Delete my account on the page (T-812, D-094). |
| `achievements.spec.ts` | Achievements on a profile (blueprint 9.2, T-643, D-091) keep three promises. **Every kind has words in the catalogue**, so a new achievement cannot reach the page as a bare identifier. **None, restricted and unreachable… |
| `achievements.tsx` | The catalogue key naming each achievement; a new kind is a type error here until it has one. |
| `action-form.spec.tsx` | Two forms on one page naming the same field (T-1363): the match page's desk has three `territory` fields and the Watch console two `note` fields. |
| `action-form.tsx` | One form component for every account form. |
| `activity-report.spec.ts` | The Activity page keeps four promises (T-807). **Aggregates only, and it says so** (blueprint 19, E80's "counts, not tracking"): it receives numbers and shows numbers; no member's name or id reaches it, and the page sta… |
| `activity-report.tsx` | The Activity page's body (T-807): per section, one row per count with a bar per UTC day (inline SVG, no chart library) and the figures for today, yesterday, seven days and the whole window; under each section the same c… |
| `analysis-editor.spec.ts` | The analyst's editor and the editorial queue (T-262). |
| `analysis-editor.tsx` | The analyst's editor (blueprint 10.3, T-262). **The decision history is on the same page as the draft, and that is the point.** An analyst asked for changes needs to see what they submitted and what was said about it; a… |
| `analysis-queue.tsx` | The editorial review queue (blueprint 10.3, T-262). **A reviewer sees the submission, the author, and every decision that came before it.** Deciding from a queue that shows only the text is deciding blind — the same arg… |
| `appearance-switch.spec.tsx` | Text size, contrast and motion (blueprint 2.2, T-621), kept the way the theme is (T-602): each value one of its own list; the page rendered with the choice already on <html>; a member's choice on the account; and each c… |
| `appearance-switch.tsx` | Text size, contrast or motion (blueprint 2.2, T-621), built as the theme switch is: one form of submit buttons named after the preference, the current one marked with `aria-pressed`, so it works before any script has lo… |
| `audiences-admin.tsx` | Audiences (T-332, D-075): saved filters with a live size. |
| `brand-mark.spec.ts` | T-604: one mark. `public/icons/mark.svg` is the source; the icons are drawn from it and the inline component is a transcription of it. |
| `brand-mark.tsx` | The logo's bars, home, draw and away, on its 24-unit grid. |
| `breaking-strip.spec.tsx` | The homepage's breaking strip (T-1004, D-125), left to right and right to left. |
| `breaking-strip.tsx` | The homepage's breaking strip (blueprint 2.3, T-1004, D-125): the stories an editor marked breaking whose window has not run out, each with the editor's note, the publisher's headline (in its own language) and a way to… |
| `briefing.tsx` | The member's briefing on the Following page (E43, T-431): a machine's prose over the feed below it, labelled as such with the model, the window and the time; the sentence that says why there is none; and the button that… |
| `campaigns-admin.tsx` | Campaigns (T-332, D-075): a message to an audience, sent once, with the report of who it reached. |
| `candidate-records-report.spec.tsx` | The candidates' records in the console (T-1103), rendered: the count toward the minimum, never a verdict below it; the pairs with the published version per competition; the service's silence said. |
| `candidate-records-report.tsx` | The candidates in shadow and their records, for the console (T-1103, D-140): each candidate's pre-kick-off forecasts counted toward the minimum (D-031), and its log loss and Brier beside the published version's on the s… |
| `client-messages.tsx` | The words a client component may need, resolved on the server (T-1040). |
| `club-overview.tsx` | The club page's Overview in the Stadiomind Club board (T-1499, D-276): the main column's recent results and home and away record, the side column's matches coming up, top scorer, squad and the table around the club, and… |
| `club-page.spec.tsx` | The club page (T-1386, D-204; the Stadiomind Club board since T-1499, D-276): the surface band when no club colour is known, where the club stands at its end, the tabs as links, the recent results and the home and away… |
| `club-page.tsx` | The club page (T-1386, D-204; the Stadiomind Club board since T-1499, D-276): the band, the tabs and the modules of the tabs beyond the Overview, whose own modules are in `club-overview.tsx`. |
| `coach-page.spec.tsx` | The coach page (T-1439, D-230): an open spell is "present" only when it is current, a missing date or birth is said as such, and spells at teams we do not cover are counted, never named. |
| `coach-page.tsx` | The coach page (T-1439, D-230) in the data mode: the band with the photo, the current team, nationality and age; the career as the provider lists it at the teams we cover; and the line-ups that name him. |
| `community-action.tsx` | One control, its own form, and whatever the API said about it (T-1308). |
| `community-analysis-panel.spec.ts` | The fourth opinion on the page (T-263). The contracts guard keeps the four apart in the types. **This keeps them apart where a reader meets them** — which is the last place the rule can break, and the only place it matt… |
| `community-analysis-panel.tsx` | Published community analysis on the match page (blueprint 10.3, T-263). **A fourth signed opinion, and the page has to say so.** This sits below the founder's analysis, the model's forecast and the community consensus,… |
| `community-consensus.tsx` | The community forecast on the match centre (blueprint 4.2, T-135). |
| `community-persian.spec.tsx` | The community surfaces in Persian (T-1308, D-175): friends, groups, conversations and the match panel render their own words from the Persian catalogue on `/fa`, with Persian digits, and say exactly what they said befor… |
| `community-picks-brief.spec.tsx` | Tests for `community-picks-brief`. |
| `community-text.tsx` | A sentence with values in it, for the community surfaces (T-1308). |
| `competition-context.spec.tsx` | The match centre's competition context (T-840), rendered: a league match shows both sides' lines before kick-off with the gaps the table supports and says no qualification place is known; a cup tie says its round and le… |
| `competition-context.tsx` | A form letter in the reader's words (T-1303). |
| `competition-order-admin.spec.ts` | The competitions' order in the console (T-1162, D-154), over the audited API. |
| `competition-order-admin.tsx` | The competitions' order (T-1162, D-154): where each competition sits on the scores page and the homepage after a member's favourites, in the order readers meet them now. |
| `competition-page.spec.tsx` | The competition page's shared modules (T-1385, D-203): the follow control, live freshness, every module's coverage as a badge, the season in figures and the players' boards. |
| `competition-page.tsx` | The competition page's shared modules, first drawn for the Hybrid design (T-1385, D-203): the panels the club, player and coach pages also use, the follow form, the players' boards, the season in figures and the coverag… |
| `competitions-directory.spec.tsx` | The All competitions page's list (T-1433, T-1612), drawn: the groups, the chooser's tiles, the filter, the words in Persian, and only logical CSS. |
| `competitions-directory.tsx` | A group as the page hands it over: its heading and its count already in the reader's words. |
| `competitions-menu-panel.tsx` | The competitions menu's panel and list (T-1643, D-301), the code a reader fetches only when they first point at, focus or open Competitions: the header's shell (`competitions-menu-view.tsx`) loads it lazily, so no page… |
| `competitions-menu-view.tsx` | The competitions menu in the header (T-1643, D-301): the nav's Competitions trigger and the panel's shell, the only parts on every page's first load (D-264). |
| `competitions-menu.spec.tsx` | The competitions menu drawn (T-1643, D-301): every competition by region with its status, the counts and toggles from today's scores, nothing guessed when an answer is missing, Persian on /fa, the trigger a link without… |
| `competitions-menu.tsx` | The competitions menu (T-1643, D-301): every competition at once, grouped by region, each with what it is doing today -- the header's Competitions panel from 1024px, and the competitions page's list on a phone. |
| `contributors-admin.spec.ts` | Contributors on the web (T-612): the same four actions as the API -- grant, pause, resume, withdraw -- each with a reason, and eligibility kept apart from the grant as the contract keeps them apart. |
| `contributors-admin.tsx` | Contributors (blueprint 9.4, T-612). **Eligibility and the grant stay two things on the page, as in the contract.** What the platform computed (the four requirements and what is missing) is shown beside what a person de… |
| `conversation-controls.tsx` | The composer (blueprint 8.3, T-224). A plain form over a server action (`sendMessageAction`): it works without JavaScript, and there is **no socket behind it** — T-230 is the transport, and this surface is correct befor… |
| `conversation.spec.ts` | The conversation surface's guards (T-224). |
| `conversation.tsx` | A member's call on a shared prediction card, in words. |
| `country-flag.spec.tsx` | Country flags and region marks (T-1612, D-283): a flag from our own origin in a flag's 4:3 shape (T-1611), or a neutral dashed box with the country's code that cannot pass for a flag (rule 3); a globe and a map for the… |
| `country-flag.tsx` | A country's flag, and the two region marks beside it (T-1612, D-283). |
| `data-export.spec.ts` | Download my data on the page (T-846, D-158). |
| `data-quality-admin.spec.tsx` | The data-quality page (T-821): open findings by check and competition, linked, reviewable. |
| `data-quality-admin.tsx` | Data-quality findings over the stored feed (T-820, T-821): when each check last ran, open findings per competition and check, and each open finding with links to the match or team it names. |
| `deleted-member-rtl.spec.tsx` | A deleted member under the right-to-left pseudo-locale (T-908, rule 7). |
| `demonstration-banner.tsx` | The band that says the football on this site did not happen (T-087). **Why `connection()` is the first line.** `DEMONSTRATION_DATA` reaches the container as a runtime variable; Render does not pass it into `docker build… |
| `device-time-zone.tsx` | Selects this device's own time zone in a form's zone list (T-1480), once, after load: the register form otherwise opened on UTC, and a reader who did not look registered in it. |
| `draw-card.spec.tsx` | T-1506: a share card is drawn to the end before it is answered, and the card routes ask the API for English names whatever the reader's language. |
| `draw-card.tsx` | A share card drawn to the end before it is answered (T-1506). |
| `english-copy.spec.tsx` | T-1395 (D-210): the English site's reader-facing copy. |
| `entity-band.spec.tsx` | The club or player band with and without a club colour (T-1418, D-204, D-218). |
| `entity-band.tsx` | The top band of a club or a coach page (T-1386, D-204), in the Stadiomind Club board (T-1499, D-276). |
| `entity-image.spec.tsx` | Crests, logos and photos (T-1321, D-176): an image from our own origin, sized so nothing moves, or a neutral lettered mark that cannot pass for a crest (rule 3). |
| `entity-image.tsx` | A team's crest, a competition's logo or a person's photo (T-1321, D-176). |
| `error-page.spec.tsx` | What the locale layout provides (T-1040). |
| `error-page.tsx` | What every error page says (T-809): a page that does not exist, and a page that failed to render. |
| `filled-message.tsx` | A resolved message whose `{placeholders}` are elements -- a `<time>`, a link, an isolated score -- rather than strings (T-1303). |
| `first-run-offer.tsx` | The homepage's offer of the first run (blueprint 2.3, T-620): guests "are encouraged to select a language, territory and favourite teams". |
| `first-run.spec.ts` | The first run (blueprint 2.3 and 7.1, T-620) keeps these promises. **Offered once, dismissible.** The homepage offers it to a member whose flow is pending and to a guest who neither finished nor dismissed it; "Not now"… |
| `follow-next-steps.spec.ts` | Following with nothing followed (T-622) keeps three promises. **Never an empty page that looks broken**: a member who follows nothing gets a sentence and concrete next steps, and every way the suggestions can fail is a… |
| `follow-next-steps.tsx` | What a member who follows nothing does next (T-622): never an empty page that looks broken. |
| `following-section.tsx` | The member's follows and favourites on the settings page (T-042). |
| `forecast-bar.spec.tsx` | The model's forecast bar (the Design System's `ForecastBar`, T-1508): the labels above the bar, the receipt under it, `outcome` after full time, `compact`, and a sentence for every way there can be no forecast. |
| `forecast-bar.tsx` | The statistical model's forecast as a bar (the Design System's `ForecastBar`, T-1508, D-263): the three outcomes with their percentages written above one bar -- home in the model's colour, the draw neutral, away the mod… |
| `forecast-panel.tsx` | The model forecast on the match centre (T-065, blueprint 6.1–6.4): the latest version's probabilities, expected goals and most likely scorelines, its leading factors, data completeness and computation time; what changed… |
| `founder-analysis.tsx` | The founder's analysis on the pages a reader meets it (blueprint 6.5, T-132). **Always attributed and signed.** Every rendering here carries the author's name and the publication time, because the blueprint asks that ea… |
| `freshness-stamp.spec.tsx` | The freshness stamp (rule 4; the Design System's `Freshness`, T-1493): quiet while the surface is within its threshold, the warning saffron and a triangle past it, and nothing at all without a clock. |
| `freshness-stamp.tsx` | The stamp's words, resolved on the server for the reader's locale (T-1303). |
| `friend-controls.spec.ts` | The exits guard (T-202, D-053). D-053 says every conversational surface ships with block, mute, leave and report already built, rather than in a later epic. That is a promise about every surface Phase 3 adds, and a prom… |
| `friend-controls.tsx` | What the viewer can do about another member (blueprint 8.1, T-202). |
| `group-comparison.spec.ts` | The group surfaces for threads and comparisons (T-248). |
| `group-comparison.tsx` | What the group called (blueprint 8.2, T-246, T-248). **Nothing here is computed.** The verdict beside a call is the settlement that was stored for it; a component that worked out whether somebody was right would be a se… |
| `group-controls.spec.ts` | The group surfaces' guards (T-242). The acceptance criterion is **a private group is not discoverable, and an invite-only one is not joinable**, and the interesting thing about both halves is that this page does not enf… |
| `group-controls.tsx` | What the viewer can do about a group (blueprint 8.2, T-242). **The controls follow `GroupStanding` exactly**, and every state is a branch rather than a fall-through, so a state that arrives with nothing to offer is a fa… |
| `group-moderation.tsx` | Administrators and groups on the web (blueprint 10.4, T-1025, D-135). |
| `group-poll-form.tsx` | One poll form (T-643): whatever fields the server rendered as children, a submit button, and the API's answer beside it. |
| `group-polls.spec.tsx` | A group's polls on its page (T-643, D-091). |
| `group-polls.tsx` | How long a new poll may stay open, in days, as the form offers it. |
| `group-settings.spec.tsx` | Running a group from its page (T-1026). Each section draws what the API sent: the policy the group has, the favourite it has (by id), a list of links without a single token in it, a revoke control only on a live link, a… |
| `group-settings.tsx` | Running a group from its page (T-1026, over the API of T-1020..T-1023). |
| `health-panel.spec.ts` | The operator's panel keeps two promises (T-236). **Unreachable is not zero.** "No connections" and "we could not ask" are different facts, and showing the second as the first is rule 3 on an operational surface: a modul… |
| `health-panel.tsx` | The two live paths, on the operator's page (T-236). |
| `held-language-notice.tsx` | Told once (T-1163, D-155): the reader's stored language is held back, so FMIP is shown in the default language; their choice is kept. |
| `home-front.spec.tsx` | The home page's blocks (T-1382, D-200; rebuilt in T-1495, D-270), in their states: with data and without it, in English and in Persian, where the reading order turns round, the digits are Persian and each score stays be… |
| `home-front.tsx` | The home page's main column in the Stadiomind design (T-1495, D-263, D-270; the canvas boards Home and HomePhone): the day's heading, the matches in play, the big match with the model's forecast and the other two voices… |
| `home-member.spec.tsx` | The homepage's member sections and today's panels (T-942, D-115), rendered: each section says once when it has nothing, says so when it could not be loaded, and a friend's call is labelled as a member's own and never as… |
| `home-member.tsx` | The homepage's member sections and today's panels (blueprint 2.3, T-942, D-115). |
| `home-rail.tsx` | The homepage's side column and its news in the Hybrid design (T-1382, D-200; boards h1 and h9): the league table's top five, the model's accuracy, today's broadcasts, the member's teams, the founder's column and the cal… |
| `homepage-features-admin.spec.ts` | Featured matches on the homepage (T-1161, D-153): feature and clear over the audited API. |
| `homepage-features-admin.tsx` | Featured matches on the homepage (T-1161, D-153): an editor features a match for a window with a note readers see, and may clear it early with a reason. |
| `hybrid-atoms.spec.tsx` | The Hybrid design's shared data atoms (T-1388, D-206) not yet rebuilt to the Design System, each in its states: the community spread, the pick before and after, and the next-match card -- in English and in Persian, wher… |
| `invite-link-create.tsx` | Making an invite link (T-1026 over T-1021). |
| `json-ld.tsx` | One `<script type="application/ld+json">` per structured-data object (T-039). |
| `key-players.spec.tsx` | The match centre's key players (T-841), rendered: the stated rule under the section, season figures per player, a doubt as a doubt, nothing claimed when the provider was never asked, and a side without figures said in a… |
| `key-players.tsx` | The match centre's key players (T-841, blueprint 4.2): each side's most used players in this competition's season before the match, their minutes, goals and assists, and what the provider said about this match. "Key" is… |
| `kind-section.spec.tsx` | The sections of Settings → Notifications with catalogue words (T-832): friends' predictions, opt-in, with the value the API says is in force. |
| `kind-section.tsx` | A section of Settings → Notifications for a few kinds, worded through the catalogues (T-832): a heading, a line saying what the kinds are, and one switch per kind with the value the API says is in force -- never a copy… |
| `knockout-bracket.tsx` | The knockout bracket on the competition page (blueprint 5.1, T-630): the rounds in the order they are played, each tie with its legs and, only once the API has decided it, the aggregate and who went through. |
| `language-coverage.spec.ts` | The operator's view of the languages (T-302). |
| `language-coverage.tsx` | The operator's language table (T-302, D-066): the surface behind "how much of `tr` is done is an answer the product gives, not a grep". |
| `language-picker.spec.tsx` | The language picker drawn (T-1610, D-281): the header's globe with the page's language in short, a disclosure listing every offered language in its own name with the page's own current; the footer's row of the same link… |
| `language-picker.tsx` | The language picker (T-306; the header's globe, T-1610, D-281): the languages the product actually speaks. |
| `linked-sentence.spec.tsx` | Tests for `linked-sentence`. |
| `linked-sentence.tsx` | The halves of a sentence with a link inside it, split around its `{link}` placeholder (T-1302). |
| `lite-banner.tsx` | Lite mode's indicator (T-1387, D-205; the Hybrid board's "Lite-mode indicator"): a thin banner under the header whenever lite mode is on, never a modal. |
| `lite-mode.spec.tsx` | Lite mode in the page (T-1387, D-205): no `<img>` at all when it is on, the lettered mark in a crest's place; the banner under the header with its reason and its switch; the footnote; Settings' Auto / On / Off; and the… |
| `lite-mode.tsx` | Lite mode on the client (T-1387, D-205). The server already rendered the page lite or not (`data-lite` on <html>, from the choice, `Save-Data` and the hint cookie: `readLite`), and this keeps exactly that, so hydration… |
| `lite-setting.tsx` | Settings -> Appearance, the Lite mode row (T-1387, D-205): Auto, On, Off, built as the appearance rows are (`AppearanceSwitch`) -- one form of submit buttons, the current one `aria-pressed`, working before any script lo… |
| `live-conversation.tsx` | The chat page's socket (T-237). **It renders no message.** When something happens it asks the page to render itself again, and the server does what it already does — resolve the cards, the reactions, the mentions and th… |
| `live-match.spec.ts` | The match page listens for the public discussion moving (T-254, D-068). |
| `live-match.tsx` | The match centre that stays current (T-032, T-034): renders the server's snapshot, then subscribes to the web app's `/api/fixtures/:id/stream` and replaces the whole payload on every `snapshot`. |
| `live-scores.tsx` | A block's heading stays at the top of the screen while its matches scroll under it (T-605), on the block's own surface so nothing shows through. |
| `locale-hold-form.tsx` | Hold back a ready language, or release one (T-1163, D-155), with a reason. |
| `logical-classes.spec.ts` | No physical side in a class name (CLAUDE.md rule 7, T-1501). |
| `match-alert-settings.spec.tsx` | The match-alert controls (T-831, D-098): a section of their own in Settings → Notifications, one switch per kind with the value the API says is in force, worded through the catalogues, and silenced as a whole or per tea… |
| `match-alert-settings.tsx` | The match-alert switches (blueprint 12.2, T-831, D-098): one per kind, in the order a match happens, worded through the catalogues. **The values are the API's, not a copy of the defaults.** Each switch shows what is in… |
| `match-centre-absences.spec.tsx` | Who will miss the match, before kick-off (T-1626): each side's injured, suspended and doubtful players with the reason in the reader's words (T-1601: never the feed's English on /fa) and when the feed was asked (rule 4). |
| `match-centre-cards.tsx` | A coverage state's words, as catalogue keys. |
| `match-centre-hybrid.spec.tsx` | The Hybrid match centre (T-1384, D-202): the score band before, during and after a match, the line-ups on a pitch only where the feed places every starter, the phone's tabs, where to watch under the score, and after ful… |
| `match-centre-stadiomind.spec.tsx` | The Stadiomind match centre (T-1497): the Summary's "what was forecast, what happened" card with every version and its receipt, the live states ("Not in yet", the badge, a feed that has fallen behind), the timeline's ax… |
| `match-centre-view.tsx` | The server-rendered panels the page slots between the live modules (T-605). |
| `match-follow.spec.tsx` | The follow control in the match centre (T-945, D-116): one form posting the settings page's follow, the window said in words, and every state that is not a button a sentence -- never a guessed one. |
| `match-follow.tsx` | A match whose follow window is closing or closed: full-time or a result by other means. |
| `match-lineups.spec.tsx` | Player photos on the line-up pitch (T-1616, D-287): the photo in a ring of the side's tone with the shirt number as a badge, the best rated in saffron as a ring and a badge rather than a fill; without a photo the number… |
| `match-lineups.tsx` | The line-ups on a pitch (T-1384, D-202; T-1497): on a phone the away side in the top half, its goalkeeper at the top, the home side in the bottom half, its goalkeeper at the bottom, each line a row; from 768px one horiz… |
| `match-panel.spec.ts` | The public match discussion on the page (T-251). |
| `match-panel.tsx` | The public match discussion (blueprint 10.2, T-251). **Reading is open, and the reading half renders for everybody including a signed-out visitor.** There is no branch in this file that hides the posts from anybody — th… |
| `match-record.tsx` | The parts of the match centre that do not move during a match (T-1384, D-202): recent form, head-to-head and the season's coverage. |
| `match-row.spec.tsx` | The match row (the Design System's `MatchRow`, T-1508): status, the sides stacked home first, and the score or the model's three percentages with the receipt under the row, or a badge when there is no forecast. |
| `match-row.tsx` | One match in a list (the Design System's `MatchRow`, T-1508, D-263): the status column, both teams stacked with home first, and at the end the score -- or, before kick-off, the model's three percentages over a thin bar,… |
| `match-summary.tsx` | The match summary on the match centre (E41, T-413): what a language model wrote from the record beside it, labelled as a machine's with the model, the version and the time, and never mistaken for the founder's analysis,… |
| `match-threads.tsx` | Opening a match thread from the match (blueprint 8.2, T-248). **"A thread is opened from the match it is about"** — so the control lives here rather than on the group page, where a member would have had to describe whic… |
| `matches-freshness.spec.tsx` | The club and competition pages' footer (T-1633, D-296): what the time is of (the matches), when the provider last answered the list and when a match on it last changed, each saying its day unless it is today (D-189). |
| `matches-freshness.tsx` | The club and competition pages' footer about their matches (T-1633, D-296), said as D-189 says it on the match header: when the provider last answered the whole list, and when any match on it last changed. |
| `member-moderation-history.tsx` | Everything about one member's standing, on one page (T-611). |
| `member-name.tsx` | A member's name on a page (T-908): the display name, a link to the profile when `link` is set, and for a deleted account "a deleted member" from the catalogue, with no link and no handle. |
| `member-names.spec.ts` | "A deleted member" wherever a member is named (T-908, D-094). |
| `message-text.tsx` | A message already resolved, rendered with the truth about where it came from (T-151). |
| `minutes-figure.spec.tsx` | Minutes on the competition's leaders and the team's squad (T-824), under T-823's rule: a total only when whole, "at least" with the matches it covers, and two different sentences for "the feed sent none" and "no line-up… |
| `minutes-figure.tsx` | A season's minutes (T-824) under T-823's rule, worded through the catalogues: the total when every match played carries the feed's minutes; "at least" the supplied sum and how many matches it covers when only some do --… |
| `mobile-first.spec.tsx` | Scores and the match centre, phone first (T-605). |
| `model-accuracy-report.spec.tsx` | Accuracy over time in the console (T-1369), rendered: each version in its role, overall then per competition, a table with the uniform reference and each row's coverage, and a sparkline only where there is a line to dra… |
| `model-accuracy-report.tsx` | Accuracy over time, for the console (T-1369, D-187): every model version in each role it was stored under (published and shadow), overall and per competition, by ISO week or month of kick-off (UTC), from the pre-kick-of… |
| `model-accuracy.spec.tsx` | The public page's figures (T-1369), rendered: never a figure without a match behind it (`not_supplied`), the count beside a figure below the minimum (`limited`), the metrics explained, the model alone (rule 6), in the r… |
| `model-accuracy.tsx` | "How accurate is our model?" (T-1369, D-187): the statistical model's published pre-kick-off forecasts, scored after the match, by month or by ISO week (T-1414), over every competition and each one. |
| `model-version.spec.tsx` | A model version never reads as an e-mail address in the server's HTML (T-1465), so Cloudflare's Email Obfuscation leaves it and its decoding script off the page; the reader sees the same characters. |
| `model-version.tsx` | A model version as text (T-1465): `dixon-coles-elo@0.6.0`. |
| `moderation-queue.spec.ts` | The moderation queue on the web (T-610). The acceptance criterion is **a moderator decides without `curl`**, and the page tells "nothing waiting", "cannot be shown" and "needs the role" apart. These read the source for… |
| `moderation-queue.tsx` | The moderation queue (blueprint 10.4 and 16, T-610). **One card per member, not per report.** Three members reporting one person is three reports and one judgement; the API groups them and this keeps the grouping, so on… |
| `moments-rail-view.tsx` | The moments rail's client half (T-1642, D-300): what needs a script, and nothing more (D-264). |
| `moments-rail.spec.tsx` | The moments rail drawn (T-1642, D-300), in place of D-292's matchday rail and its drawer: the lead, a card per moment in the answer's order, the model line only where a forecast exists (rule 3), "May be behind" on a sta… |
| `moments-rail.tsx` | The moments rail (T-1642, D-300, replacing D-292's matchday rail and its drawer): the one bar under the header on every page, a handful of today's matches worth a look now, as `GET /moments` picks them (T-1641, D-299). |
| `news-coverage-report.spec.tsx` | News coverage per competition (T-1010, D-129), rendered: the competition page says how thin its news is below the floor, and says no carried source covers it before any old card (rule 3); the console's report names each… |
| `news-coverage-report.tsx` | News coverage per competition (T-1010, D-129), for the console: every active competition with the carried sources that linked a story to it in the window and the count, the gaps first. |
| `news-desk.spec.tsx` | The news desk (T-1009): the three decisions on one page, each form asking for the words its API asks for, the chosen story's record of decisions, and the type's earlier labels named as not shown to an editor. |
| `news-desk.tsx` | The editor's news desk (T-1009): debates, story types and breaking on one page, over the audited APIs of T-143, T-1001 and T-1004. |
| `news-home.spec.tsx` | The home page's news (T-1613, D-284): a small front page -- the lead, two cards, then rows -- each story with a picture that is its licensed photo, credited, or the designed panel, never a stand-in photo (rule 3); all l… |
| `news-home.tsx` | The home page's news (blueprint 2.3 and 3; T-1613, D-284): the newest stories as a small front page -- the lead with its picture, two cards, then three rows -- with the same pictures as the news page: the licensed photo… |
| `news-image.spec.tsx` | News photos and their credit (T-1323, D-177): only our own `/media/news/` address is drawn, its credit and the licence go with it wherever it is, and a story without one draws nothing. |
| `news-image.tsx` | A news photo and its credit (T-1323, D-177). |
| `news-sources-admin.spec.tsx` | News sources in the console (T-1015): the preview says what robots.txt said and what the feed would yield; a carried source can be edited and dropped, each with a reason; a dropped one shows when and why, with no form;… |
| `news-sources-admin.tsx` | News sources in the console (T-1015): read a feed once -- its robots.txt, then the feed -- and see what it would yield before adding it; edit a source, a new address read again; drop one with a reason. |
| `news-story.spec.tsx` | One story on the news front page (T-1570; T-1613, D-284). |
| `news-story.tsx` | One story on the news front page (T-1570; T-1613, D-284): the publisher's words, their name and time, the way back to them, and what the story is filed under. |
| `news-visual.spec.tsx` | A story's picture (T-1613, D-284). A licensed photo (D-177) is drawn from our own server, its size said, its credit with it. Without one the picture is never a stand-in photo (rule 3): it is a panel of the crests, logos… |
| `news-visual.tsx` | A story's picture on the news front page and the home page (T-1613, D-284). |
| `next-match-card.tsx` | "Next match" (T-1388, D-206; the Club board's card since T-1499): the top of a club page. |
| `notification-list.spec.ts` | The inbox on the page (T-272). The acceptance criterion is **every notification opens the match, profile, group or conversation that caused it**, and the link is built here rather than in the API — so this is where it c… |
| `notification-list.tsx` | The inbox, as a member reads it (blueprint 12.2, T-272). **A notification that cannot be opened is still shown.** The API sends no label for a subject that no longer resolves — a group that was deleted — and this render… |
| `notification-settings.spec.ts` | Choosing what arrives, and when (T-273). The criterion is that a held notification **says which** rule held it, and the settings page is where a member goes to understand why. So the guard is about honesty rather than m… |
| `notification-settings.tsx` | Choosing what arrives, and when (blueprint 12.2, T-273). **Every kind is listed, including the ones already on.** A settings page that showed only what a member had changed would get emptier the more they agreed with it… |
| `notifications-persian.spec.tsx` | Following and notifications in Persian (T-1305, D-175): the settings section, the inbox and the notification settings render the catalogue's Persian on `/fa`, and the English on `/en` word for word as before. |
| `panel-social.spec.ts` | Reacting and following on the page (T-252). |
| `panel-social.tsx` | Reacting to a panel post, and following a contributor (blueprint 10.2, T-252). **Both of these are shown to any signed-in member, and to nobody else.** Not because approval is being checked — it is deliberately not — bu… |
| `panels-admin.spec.ts` | Featured matches on the web (T-613): open and close a discussion with a reason, over T-253's API. |
| `panels-admin.tsx` | Featured matches (blueprint 10.2, T-613): which fixtures have a public discussion, who opened it and why, and opening or closing one with a reason. |
| `player-availability.spec.tsx` | The player page's availability and news (T-1007, D-127), rendered: nothing claimed before the feed was asked, "not listed" and never "fit" once it was, the time of the ask with a warning when it is old, and a player's n… |
| `player-availability.tsx` | The player page's next match and his availability for it (blueprint 5.3, T-1007, D-127; the Stadiomind card, T-1500): the team's next scheduled match, when it kicks off, and what the feed's absence list says about the p… |
| `player-compare.spec.ts` | The compare page's shape (T-631). It reads the source, the way the other page guards here do: what matters is which branches exist and what each renders, and that survives a change of markup. |
| `player-page.spec.tsx` | The player page in the Stadiomind Design System (T-1500, D-271): the photo in the club's ring, the facts (age, height, foot) each a figure or its "not supplied" badge, the season in tiles with minutes never shown as a z… |
| `player-page.tsx` | The player page in the Stadiomind Design System (T-1500, D-271): the header with the photo in the club's ring and the facts, the tabs, the season in tiles, the career by season, the last six matches and the next match. |
| `player-provider-seasons.spec.tsx` | The player page's provider modules (T-1431, D-223): the provider named as the source, a competition our record counts named beside the table and never shown with the provider's numbers, a missing figure as a dash and ne… |
| `player-provider-seasons.tsx` | The player page's provider modules (T-1431, D-223): the season in every competition as the provider counts it, and the career it lists. |
| `power-index-panel.tsx` | The Power Index on the match centre (T-114, blueprint 6.1). |
| `predicted-score-bidi.spec.tsx` | T-1378: a predicted scoreline reads in the page's direction, like a score (D-193). |
| `prediction-form.tsx` | The form's words, resolved on the server in the reader's language (T-1307): a client component never reads the catalogues (T-1040). |
| `prediction-history.tsx` | A member's prediction history (blueprint 7.2, T-056): per match, the version that stands as it was submitted, when, and how it settled. |
| `prediction-persian.spec.tsx` | The prediction surfaces in Persian (T-1307, D-175): the words come from the catalogue, the digits are Persian, and the three prediction products keep their own names. |
| `prediction-section.tsx` | "Your prediction" on the match centre (T-050). |
| `predictions-hybrid.spec.tsx` | The pick and the match report in the Hybrid design (T-1383, D-201): the pick control with the community's spread held back until the reader picks, and "What the model expected" -- in English and in Persian, and with the… |
| `push-offer-for.tsx` | The push offer's words, resolved on the server for the reader's locale (T-1040), around the client offer (T-1429). |
| `push-offer-lazy.tsx` | The push offer, fetched only where a follow has just happened (T-1429): it draws nothing until the browser has been asked what it can do, so its code stays out of the page's first load and arrives after hydration. |
| `push-offer-mark.tsx` | Inside a follow form: as the form submits, leave the mark the next render's push offer takes (T-1429). |
| `push-offer.spec.tsx` | Push offered at the moment of a follow (T-1429). |
| `push-offer.tsx` | Push, offered at the moment a member follows something (T-1429). |
| `push-toggle.tsx` | Push on this device (T-330, D-074). The browser owns the subscription: it asks the member's permission, registers with its own push service using the deployment's public key, and hands the result to the API, which keeps… |
| `rating-history-fa.spec.tsx` | The rating over time in Persian (T-1306, D-175): the labels come from the catalogue, the figures in Persian digits, and English stays word for word. |
| `rating-history.spec.ts` | The rating over time on a profile (blueprint 9.3, T-640) keeps four promises. **Nothing settled is a sentence, not an empty chart** (rule 3). **A private history stays private**: the section follows the API's restricted… |
| `rating-history.tsx` | A sentence with elements in it: `{name}` placeholders in the locale's own word order, each filled with a node, so a figure or a `<time>` keeps its markup wherever the language puts it. |
| `receipt.spec.tsx` | The model's receipt (the Design System's `Receipt`, T-1508): facts joined with " · ". |
| `receipt.tsx` | The model's provenance line (the Design System's `Receipt`, T-1508, D-263): model version, forecast version, when it was computed -- the items joined with " · ", in the machine-fact mono face and the model's colour, on… |
| `register-defaults.spec.ts` | The register form's defaults (T-1480). The country list opened on its first entry (Afghanistan) and the time zone on UTC, so a reader who did not look registered with both. These read the source, as `account-deletion.sp… |
| `related-news.tsx` | Related news on the match centre (blueprint 4.2, T-145): the stories the news page would show, filtered to this match and its sides inside the window around kick-off, under the same rights -- headline and link to the pu… |
| `remember-cookie.tsx` | Sets one cookie once the page it is on has been shown (T-1163): how a notice meant to be read once is not shown again. |
| `rules-prompt.tsx` | The ask (T-931, D-113): a newer version of the platform rules is published and the member has not accepted it. |
| `save-article.spec.tsx` | Saved articles on the web (T-842): a save control on the news cards and the story page, and a Saved list under Following that shows the publisher's headline and link only (D-061), says so when a publisher was dropped, a… |
| `save-article.tsx` | The save control on a news card and the story page (T-842): a plain form over a server action, so it works without script. |
| `score-card-bidi.spec.tsx` | T-1375: on a right-to-left page the home goals sit beside the home team. |
| `score-card-community.tsx` | The community's line on a scores card (T-940, D-114): how many members' standing predictions picked each outcome. |
| `score-card-forecast.tsx` | The statistical model's line on a scores card (T-940, D-114). |
| `score-card-stage.spec.tsx` | The provider's stage and round on a score card, in the reader's words (T-1339): Persian on /fa, exactly the provider's English on /en. |
| `score-card.tsx` | A coverage state in the glossary's words (T-1303). |
| `score.tsx` | A score, rendered so it cannot be read backwards (T-153, T-1375, rule 7). **The rule.** A score is a pair, home first, read in the page's own direction: on an English page the home goals sit on the left, on a Persian or… |
| `service-worker.tsx` | Registers the service worker (T-082) once the page has loaded, so the shell is cached for the next visit and the app can be installed. |
| `share-card-image.tsx` | The pictures behind the share cards (T-520), for `next/og`'s `ImageResponse`. |
| `share-link.tsx` | A share control (T-521): the share sheet, or a copied link. |
| `shared-persian.spec.tsx` | The shared helpers in Persian (T-1309, D-175): what is left on a `/fa` page once the areas moved their own words is these helpers' -- the bracket, the status cell, the viewing line, a conversation's name, a page title. |
| `shell-nav.spec.tsx` | The header's nav and the phone's tab bar (T-1381, D-199; Stadiomind, T-1494, D-267; T-1610, D-281), drawn: the order, the current entry (by the pathname and the query), the words in Persian, and the tab bar's place (pho… |
| `shell-nav.tsx` | The shell's two navigations (T-1381, D-199; Stadiomind, D-267), the only parts of the header that need the pathname: which entry is current. |
| `site-footer.spec.tsx` | The site footer (T-1610, D-281): the name and a line on what the site is, every section in three columns with the three prediction products each under its own name (rule 6), What Stadiomind is and the rules (linked from… |
| `site-footer.tsx` | Each column's heading. "Stadiomind" is the name, the same in every language. |
| `site-header.tsx` | The site shell (T-1381, D-199): the header, the matchday rail under it (T-1624, D-292) and the phone's bottom tab bar, the same on every page. |
| `stamp.tsx` | A stored moment as a reader reads it (T-1201): "30 Sept 2026, 21:32" in the viewer's zone, with "UTC" said when that is the zone used, and the exact instant kept in `dateTime` for a machine. |
| `standings-table.spec.tsx` | The competition page's tables (T-1336): a season with group stages shows every group's table, under its stage when there are several, and a group not yet started as a sentence with its teams; a league's page keeps its o… |
| `standings-table.tsx` | The table's figure columns (T-1203). On a phone the table keeps position, team, played, goal difference and points, the columns a reader ranks by; won, drawn, lost and the goals appear from the tablet width up, the form… |
| `story-links.spec.tsx` | The story page's share, follow and prediction-product links (T-941, blueprint 3.3). |
| `story-links.tsx` | The story page's controls that lead somewhere else (T-941, blueprint 3.3): following what the story is about, and the match's three prediction products. |
| `story-type.spec.tsx` | A story's type on the card and the story page (T-1001, D-123). |
| `story-type.tsx` | A story's type and whose word it is (T-1001, D-123): the publisher's own category or an editor's label, named as such. |
| `system-candidates.spec.tsx` | The candidates in shadow on the System page (T-1165), rendered: each with its newest answer, the last 24 hours and its last failure; a candidate that has never answered says so rather than showing zero; the service's si… |
| `system-report.spec.ts` | The System page keeps four promises (T-804). **"Nothing recorded" and "cannot be shown" are different sentences.** An empty report is good news; a report that never arrived is not, and the page whose job is to say what… |
| `system-report.tsx` | The sections of the System page (T-804). Each takes its report or `null`, and `null` is "cannot be shown", said in a notice; an empty report is "nothing recorded", said in a sentence. Never one for the other. |
| `team-season-stats.spec.tsx` | The team page's season statistics (T-1437, D-228): the provider named as the source, a season never asked or answered empty said so and never shown as zeros, a missing figure as a dash, and goals by minute and penalties… |
| `team-season-stats.tsx` | The team page's season statistics (T-1437, D-228): one competition's season as the provider counts it, chosen from the seasons it has, with whose numbers they are and when they were fetched. |
| `theme-switch.spec.tsx` | The theme switch (T-602). Three answers and no others; the page is rendered with the choice already on <html>, so nothing flashes; a member's choice travels with the account; and the control is a plain form whose presse… |
| `theme-switch.tsx` | Auto (the device's own), Day or Night (T-602, D-089; named for the Hybrid design, D-198). |
| `three-products.spec.ts` | The separation guard, on the surfaces (T-133, CLAUDE.md rule 6). |
| `time-zone-field.tsx` | The time zone step's field (T-620). The server renders the stored zone (or UTC), so the form works without script. With script, and when `propose` is set, the browser's own zone -- `Intl`'s, read on this device, never f… |
| `transfers.spec.tsx` | The club and player pages' transfers (T-1440, D-231): the provider named as the source, our clubs and players linked, the provider's names for the rest as plain text and never a link, the fee as the provider wrote it, a… |
| `transfers.tsx` | The club page's arrivals and departures and the player page's moves, as the provider lists them (T-1440, D-231). |
| `translated.spec.ts` | Tests for `translated`. |
| `translated.tsx` | One message, rendered with the truth about where it came from (T-151). |
| `translation-desk.spec.tsx` | The translator's desk (T-1013): the form in Arabic, right to left (rule 7); the headline alone for a headline-only source (PL016); no review form for the author; each check beside its field; and the glossary shown, neve… |
| `translation-desk.tsx` | The translator's desk for one article (T-1013): the publisher's words, the glossary terms they use, the write form and the review form over T-304's API, with each automatic check (T-1012) beside the field it concerns. *… |
| `venue-card.spec.tsx` | The ground's card on the match page (T-1438, D-229): what the source says about the ground, a fact it did not give left out rather than drawn as zero, and one sentence when it gave none -- not yet fetched, or not descri… |
| `venue-card.tsx` | The ground's card on the match page (T-1438, D-229): its picture from our own origin, name and city, capacity, surface and address, with the coverage of those facts beside the title. |
| `viewing-console-forms.tsx` | The upcoming matches as one form (T-1361): a box per match, then the service, the access and the page, and "List selected". |
| `viewing-console.spec.tsx` | Watch listings in the console (T-1361): nothing but the picker and the broadcasters until a competition is chosen; an uncovered season offers no default and ticks nothing; a covered one shows its defaults, ticks the mat… |
| `viewing-console.tsx` | The Watch listings console (T-1361) over the desk's API (T-313, T-1360): pick a territory and a competition; declare the season's coverage there; keep the broadcasters; add and remove standing defaults; and list the nex… |
| `viewing-desk.tsx` | The editorial desk on the match page (T-313, D-069), for an editor only: declaring coverage for this match's season in a territory, adding a broadcaster, listing the match on a service, setting the official highlight pa… |
| `viewing-panel.spec.tsx` | The Watch line and the knockout bracket in Persian (T-1304): the sentence about a territory keeps the name where Persian word order puts it, and the bracket's own words come from the catalogue. |
| `viewing-panel.tsx` | Where a match can be watched, and its highlight afterwards (blueprint 11, T-314, T-315): one component, rendered in four places, one answer. |
| `voices.spec.tsx` | The three prediction voices (the Design System's `Voice`, T-1509; rule 6): three components, each told apart by how its name is set, each with an honest empty state, each a section named for screen readers. |
| `voices.tsx` | The three prediction voices (the Design System's `Voice`, T-1509, D-263; CLAUDE.md rule 6): the statistical model, the founder and the community, each on its own card and never merged -- never averaged, never one combin… |

## apps/web/src/components/ui

| File | What it is |
|---|---|
| `button.spec.tsx` | The buttons (T-603): one look per variant and size, and a pending state that cannot be pressed twice. |
| `button.tsx` | The buttons (T-603). One place for what a button looks like, so a form in the admin desk and one in a group page press the same way. Server-component safe: no state of its own; the caller's `useActionState` says when it… |
| `card.tsx` | A card (T-603): a panel a step off the page (`bg-surface`), a hairline edge, and room inside. |
| `coverage-badge.spec.tsx` | The coverage badge (rule 3; the Design System's `CoverageBadge`, T-1493): every state said in a word and a glyph of its own, never by hue alone. |
| `coverage-badge.tsx` | A module's coverage, said beside its name or in place of what is missing (rule 3; the Design System's `CoverageBadge`, T-1493, D-263). |
| `cx.ts` | Joins class lists, dropping the empty ones. |
| `field.spec.tsx` | The fields (T-603): a label tied to its control, and a hint and an error a screen reader hears on focus because the control names them. |
| `field.tsx` | The form fields (T-603). Each one is a label, a control, and the two things a control may need to say about itself: a hint (what to put here) and an error (what was wrong with what was sent). Both are tied to the contro… |
| `icons.tsx` | The Hybrid design's line icons (T-1388, D-206): 24-unit strokes drawn in the text colour, so an icon takes the colour of whatever it sits in and no icon names a colour of its own. |
| `index.ts` | The shared components (T-603): buttons, fields, cards and notices from one place. |
| `link-out.spec.tsx` | A link off the site (T-1388): it always names who hosts the destination. |
| `link-out.tsx` | A link that leaves FMIP (T-1388, D-206): a broadcaster's page, a publisher's highlights. |
| `link.spec.tsx` | The internal link (T-1456): viewport prefetching off by default, a caller's own choice kept, every other prop passed through. |
| `link.tsx` | The site's internal link (T-1456): `next/link` with viewport prefetching off unless a caller asks for it. |
| `live-badge.spec.tsx` | The live badge (the Design System's `LiveBadge`, T-1493): a match in play, with its minute. |
| `live-badge.tsx` | A match in play, with its minute (the Design System's `LiveBadge`, T-1493, D-263): a saffron pill with a dot, the words in saffron as text. |
| `notice.spec.tsx` | Notices, form results and cards (T-603). A refusal interrupts and a confirmation waits its turn; the colour and the live-region role come from the same word, so they cannot disagree. |
| `notice.tsx` | Notices and form results (T-603). A **Notice** is a sentence the page wants seen: a refusal, a stale figure, a thing that went through. Its tone picks both the colour and the live-region role: a danger or a warning inte… |
| `rating-chip.spec.tsx` | A player's match rating (the Design System's `RatingChip`, T-1510): four bands, the figure always written. |
| `rating-chip.tsx` | The four bands, lowest first: each differs in lightness as well as colour. |
| `section-tabs.spec.tsx` | Section tabs inside a page (the Design System's `Tabs`, T-1510). |
| `section-tabs.tsx` | Section tabs inside a page (the Design System's `Tabs`, T-1510, D-263; T-1386's band tabs): the competition's, the club's and the player's. |
| `stat-bar.spec.tsx` | One statistic between the two sides (the Design System's `StatBar`, T-1510). |
| `stat-bar.tsx` | One statistic compared between the two sides (the Design System's `StatBar`, T-1510, D-263): the two figures at the ends, the statistic's name between them, and a split bar under it -- the home side's share in ink from… |
| `target.spec.ts` | Tests for `target`. |
| `target.ts` | A link that sits inside a dense line of text (a fixture line, a "where to watch" line) and still meets WCAG 2.2's 24 x 24 minimum target size (axe `target-size`). |
| `ui-classes.spec.ts` | Buttons, fields, cards and notices come from `components/ui` (T-603). |

## apps/web/src/i18n

| File | What it is |
|---|---|
| `client-catalogues.spec.ts` | The catalogues stay on the server (T-1040). |
| `format.spec.ts` | Tests for `format`. |
| `format.ts` | Dates, times and numbers in the reader's language (T-300). |
| `glossary-script.spec.ts` | `i18n:glossary` (T-1011, D-130), run against a scratch catalogue and glossary so the committed files are never touched. |
| `locales.spec.ts` | Tests for `locales`. |
| `locales.ts` | Locale registry. English is the source language (D-003). Arabic joined in T-150 and is the first real right-to-left locale; the six Latin-script languages joined in T-300. Every one of them routes and renders, and every… |
| `messages.spec.ts` | Keys whose surface is planned and not built. |
| `messages.ts` | The message catalogue and the missing-string policy (T-151, blueprint 13.2). **The rule this file exists for: an untranslated string is visibly untranslated.** It is never machine output presented as a translation, and… |
| `product-name.spec.ts` | The product's public name is Stadiomind (T-1503, D-262). |

## apps/web/src/i18n/catalogues

| File | What it is |
|---|---|
| `ar.json` | JSON data or settings. |
| `de.json` | JSON data or settings. |
| `en.json` | JSON data or settings. |
| `es.json` | JSON data or settings. |
| `fa.json` | JSON data or settings. |
| `fr.json` | JSON data or settings. |
| `it.json` | JSON data or settings. |
| `pt.json` | JSON data or settings. |
| `tr.json` | JSON data or settings. |

## apps/web/src/lib

| File | What it is |
|---|---|
| `action-failure.spec.ts` | Tests for `action-failure`. |
| `action-failure.ts` | What a refused action tells the member (T-907, D-108). |
| `activity.spec.ts` | Tests for `activity`. |
| `activity.ts` | The Activity page's words and arithmetic (T-807), pure so the spec can hold them. |
| `admin-actions.ts` | The administration area's server actions (T-070). |
| `analysis-actions.ts` | Writing, submitting and reviewing analysis (T-262). **Nothing here decides anything.** Whether the author holds a contributor grant, whether the match has kicked off, whether a submission already has a decision -- all o… |
| `analysis-text.tsx` | The analyst's editor's words, resolved on the server in the reader's language (T-1307), because the editor is a client component and the catalogues never reach the browser (T-1040). |
| `announce.spec.ts` | Tests for `announce`. |
| `announce.ts` | Live-score announcements for assistive technology (T-081, D-041). |
| `api-locale.spec.ts` | Tests for `api-locale`. |
| `api.ts` | `GET /admin/overview` (T-070): the operator's view; 401/403 come back as results. |
| `appearance.ts` | The accessibility preferences (blueprint 2.2, T-621), kept exactly as the theme is (T-602, D-090): a cookie per preference that the locale layout reads and writes on <html> as an attribute, so the first paint already ha… |
| `auth-actions.ts` | What a form gets back. `null` before the first submit; `ok: true` for an action that stays on the page; field errors come straight from the API's `ApiError.fields`, so the web app never re-implements a validation rule. |
| `band-colour.spec.ts` | The club band's paint (T-1418, D-204, D-218): every text on it at 4.5:1 or more. |
| `band-colour.ts` | A club's colour on the top band of its page (T-1418, D-204, D-218): the fill and the text on it. |
| `bracket.spec.ts` | The knockout bracket's words (T-630). Acceptance: a tie not yet drawn is stated, never invented — and a tie not yet decided names no winner. |
| `bracket.ts` | The knockout bracket's words (T-630). Pure, so what a reader is told about a tie — and above all what they are not told while it is undecided — is one tested place. In the reader's language (T-1309); `locale` defaults t… |
| `brand-colours.ts` | The light colour tokens as plain values, for the renderers that cannot read a CSS variable (T-602, D-090): `next/og` drawing the share cards, the web manifest, the `theme-color` meta and the inline mark that `next/og` a… |
| `breaking-actions.ts` | The editor's breaking mark from the news page (T-1004, D-125, rule 10): marking a story with the note readers see on the homepage strip, and ending a mark early with a reason. |
| `briefing-actions.ts` | What became of the inbox notification (T-432), as the second sentence of a published outcome. |
| `campaign-actions.ts` | Campaigns from the administration area (T-332, D-075). |
| `client-ip.spec.ts` | Tests for `client-ip`. |
| `client-ip.ts` | The reader's network address, for the API's per-address rate limits on the account forms (T-810, D-093). |
| `coach.ts` | The coach page's rules (T-1439, D-230), apart from the markup so they can be argued with in a unit test. |
| `compare.spec.ts` | The counting rules for comparing two members (T-203). |
| `compare.ts` | Comparing two members' prediction records (blueprint 8.1, T-203). |
| `competition-context.ts` | The words of the match centre's competition context (T-840). |
| `competition-order-actions.ts` | The competitions' order from the console (T-1162, D-154): one audited `PUT /admin/competitions/:id/order` with a reason. |
| `competition-overview.spec.ts` | The Hybrid competition page's helpers (T-1385, D-203): the tab the URL opens, which round the Overview shows, fixtures by round with no provider label printed, and the season's figures counted from stored results only. |
| `competition-overview.ts` | The Hybrid competition page's pure helpers (T-1385, D-203): which tab the URL opens, the links that keep the season, the round the Overview calls "this matchweek", fixtures grouped by round, and the league's figures cou… |
| `competition.spec.ts` | Tests for `competition`. |
| `competition.ts` | The competition page's pure helpers (T-035): the season the URL selects, the links that keep it, and how a fixture and a form run read. |
| `competitions-directory.spec.ts` | The competitions directory's choices (T-1433): the bar's slice of the product's order, the page's groups, and the filter. |
| `competitions-directory.ts` | The competitions directory's pure choices (T-1433): what the header's competitions bar shows, how the All competitions page groups every competition, and what its filter matches. |
| `competitions-menu-actions.ts` | The competitions menu's list, drawn by the server when the header's panel asks (T-1643, D-301): on the first opening of a page -- or a hover of its trigger just before -- and again on an opening once what it has is more… |
| `competitions-menu-state.ts` | The competitions menu's client side (T-1643, D-301): whether it is open, who opened it, and the shape of what it draws. |
| `competitions-menu.spec.ts` | The competitions menu's rules (T-1643, D-301): which group each competition is filed under, its order there, its status, and what the filter and the toggles keep. |
| `competitions-menu.ts` | The competitions menu's rules (T-1643, D-301), pure so they are unit-tested (`competitions-menu.spec.ts`); `components/competitions-menu.tsx` fetches and draws. |
| `console-actions.ts` | The agents console's forms (D-340), as server actions: each posts to the API with the console's cookie and comes back to the page with what happened. |
| `console-api.ts` | The agents console's calls to the API (D-340), made by the web server with the console's own cookie, `fmip_console`, which lives on the console's host only. |
| `console-base.ts` | The agents console's base path for this request (D-341): '' on its own host, `CONSOLE_PATH` (e.g. |
| `console-host.ts` | The agents console's host (D-340): `CONSOLE_HOST`, e.g. |
| `contributor-actions.ts` | Granting, pausing, resuming and withdrawing a contributor from the web (T-612), over the audited API of T-250. |
| `contributor-flags.spec.ts` | Tests for `contributor-flags`. |
| `contributor-flags.ts` | The words for a contributor flag on the console (T-1031, D-137). |
| `conversation-actions.ts` | Sending, reading and leaving a conversation (blueprint 8.3, T-224). |
| `conversation-title.spec.ts` | Naming a conversation (T-244). A group's room and every one of its match threads carry the same `group` and no members of their own, so the failure to guard against is the quiet one: a list that named them all by their… |
| `conversation-title.ts` | A catalogue sentence in the reader's language (T-1309), its values in. |
| `data-export.ts` | Settings -> Download my data (T-846, D-158): the route handler at `app/[locale]/settings/data-export/route.ts` sends a refused member back to Settings with one of these in `?export=`, and the page says why. |
| `data-quality-actions.ts` | Marking a data-quality finding reviewed from the web (T-821), over the audited API: the reason is recorded with the administrator's name. |
| `debate-actions.ts` | The editor's two decisions about the debate section (T-143, rule 10), from the news page itself: selecting a story with the note readers will see, and clearing one with a reason. |
| `demonstration.spec.ts` | Demonstration data, and the four things that say so (T-087). |
| `demonstration.ts` | Whether the football data in this deployment is demonstration data (T-087). **The problem this exists for.** The public preview runs the whole product against a database loaded with development fixtures: matches that we… |
| `feed.spec.ts` | Tests for `feed`. |
| `feed.ts` | Each kind of item, named in words. Total, so a fifth kind fails the build until it has one. |
| `first-run-actions.ts` | The first-run flow's writes (T-620). A member's answer goes to the account at once, through the endpoints Settings uses; a guest's goes to the browser's cookie and reaches the account at sign-up. Either way the reader m… |
| `first-run-cookie.ts` | A guest's first-run choices (T-620), from this browser's cookie; `{}` when none. |
| `first-run.spec.ts` | Tests for `first-run`. |
| `first-run.ts` | The first-run flow (blueprint 2.3 and 7.1, T-620): language, territory, time zone and favourite teams, each skippable, offered once. |
| `fold-name.ts` | The filters' one way of comparing names (T-1433; its own module since T-1643, D-301): the competitions menu folds the words typed in the reader's browser, and this file is all it carries there for that. |
| `forecast-diff.spec.ts` | Tests for `forecast-diff`. |
| `forecast-diff.ts` | What changed between two forecast versions, and what can honestly be blamed for it (T-121, blueprint 6.4). |
| `forecast.spec.ts` | Tests for `forecast`. |
| `forecast.ts` | The page's locale as the catalogue takes it. |
| `formation.ts` | Where a side's starters go on the match centre's pitch (T-1384, D-202; T-1397, D-212), from the line-up data the API returns and nothing else. |
| `founder-actions.ts` | Publishing the founder's analysis (T-131). |
| `friend-actions.ts` | Friends, requests and blocks (blueprint 8.1, T-202). |
| `group-about.spec.ts` | Tests for `group-about`. |
| `group-about.ts` | A group's language and favourite as a reader meets them (T-1022, D-133). |
| `group-actions.ts` | Groups: joining, asking, invitations and who runs one (blueprint 8.2, T-242). |
| `group-poll-actions.ts` | Group polls (T-643, D-091): asking, voting, closing and removing. |
| `group-settings-actions.ts` | What the owner, and whoever the policy lets invite, change from a group's page (T-1026, over T-1020..T-1022). |
| `group-settings.spec.ts` | The owner's settings, read from their forms (T-1026). |
| `group-settings.ts` | What the owner's settings on a group's page read from their forms, and how the group's history is put into words (T-1026, over T-1020..T-1023). |
| `highlights.spec.ts` | The Highlights page's address (T-1434): what it reads from the query, what it asks the API, and the links that keep the filter, the page and a guest's territory. |
| `highlights.ts` | The Highlights page's address (T-1434, D-226): the competition filter, the page and a guest's territory, read from the query and written back into every link, so a filtered page is an address to share. |
| `home.spec.ts` | T-526: the homepage keeps the reader's order and shows only what is real. |
| `home.ts` | What the homepage shows (blueprint 2.3, T-526; the Hybrid front page, T-1382, D-200), chosen from answers the product already gives. |
| `homepage-feature-actions.ts` | Featuring a match on the homepage and clearing it early from the web (T-1161, D-153), over the audited API. |
| `intl-cache.spec.ts` | One formatter per locale and option set (T-1466): asked twice the same, the same object; asked differently, a different one that formats as `Intl` itself would. |
| `intl-cache.ts` | `Intl` formatters, made once per locale and option set (T-1466). |
| `invite.spec.ts` | T-522: an invite link names the inviter and nothing else, and offers, never sends. |
| `invite.ts` | Invite links (T-522): a member's link to the registration page, and what a sign-up through it is offered afterwards -- the inviter's profile, with its own friend-request control and a sentence saying why it is there. |
| `key-players.ts` | The words of the match centre's key players (T-841). |
| `language-coverage.ts` | How far each language has got, as the operator's table on `/admin` shows it (T-302, D-066). |
| `language-hold.spec.ts` | Holding back a language that is ready (T-1163, D-155): a hold only takes a language away; English is never held; when the holds cannot be read only English is offered; a reader whose stored language is held is told once. |
| `language-hold.ts` | Holding back a language that is ready (T-1163, D-155), as the web applies it. |
| `language-negotiation.spec.ts` | Tests for `language-negotiation`. |
| `language-negotiation.ts` | The language a first request is sent to when the reader has not chosen one (T-1310, D-175): the first language in their browser's `Accept-Language` that the product offers, else none. |
| `language-picker.spec.ts` | The language picker offers what the product speaks (T-306). |
| `language-picker.ts` | The offered locales with their autonyms: what the header hands the picker. |
| `language-switch.ts` | The language picker's links (T-306), and nothing that needs a catalogue. |
| `leaderboard.spec.ts` | The default board: everyone, all time, the floor, page one. |
| `leaderboard.ts` | The leaderboard page's pure helpers (T-055): reading the minimum-sample filter and page from the URL, the API query, the links that keep state, and how an entry reads. |
| `lite.spec.ts` | Lite mode's rules (T-1387, D-205): the preference read from a cookie or a form, what counts as a slow connection on each side, the mode those make, and the poll that replaces the open stream. |
| `lite.ts` | Lite mode for slow connections (T-1387, D-205): no images, no web fonts (the device's own), compact lists and fewer live updates. |
| `live-signal.ts` | "A match on this page just moved" (T-1635, D-297): the match centre and the scores page hear a goal, a card or a new status over their own stream before anything else on the page does. |
| `live-source.ts` | A live surface's connection to its stream (T-032, T-034), and how lite mode makes fewer live updates (T-1387, D-205). |
| `live-strip.spec.ts` | The live strip's rules (T-1381, D-199) the moments rail keeps (T-1642, D-300). |
| `live-strip.ts` | The live strip's rules (T-1381, D-199), pure so they are unit-tested (`live-strip.spec.ts`). |
| `live.spec.ts` | Tests for `live`. |
| `live.ts` | Freshness for live surfaces (rule 4, T-032). |
| `locale-hold-actions.ts` | Holding back a ready language and releasing it (T-1163, D-155), over the audited API, administrators only. |
| `locale-query.spec.ts` | Tests for `locale-query`. |
| `locale-query.ts` | `?locale=` on a catalog request (T-303): the language the reader is on, so the API can answer a localised name beside the canonical one. |
| `match.spec.ts` | Tests for `match`. |
| `match.ts` | Pure helpers for the match centre page (T-034): the catalogue keys for incidents and statistics, minutes and statistic values in the reader's digits (T-1309), and the list of blueprint 4.2 modules the platform does not… |
| `matchday-rail.spec.ts` | The matchday rail's rules (T-1624, D-292): which leagues, in which order, with which status, and which league's matches the drawer opens on. |
| `matchday-rail.ts` | The matchday rail's rules (T-1624, D-292), pure so they are unit-tested (`matchday-rail.spec.ts`); `components/matchday-rail.tsx` fetches and draws. |
| `member-name.ts` | What a member is called on a page (T-908, D-094). |
| `member-page.spec.ts` | A member's page in the console (T-1164): one page, the API's answers only, no write. |
| `member-page.ts` | A member's page in the console (blueprint 16, T-1164): account status, rating history and tier, settlements, Career Points, eligibility and grants, sanctions and flags, and the audit rows about them, on one page. |
| `moderation-actions.ts` | The moderator's writes from the web (T-610): a decision on a member, and a request for the assistant's suggestion on one report. **Nothing here decides who may moderate or what a valid decision is.** The role, the outco… |
| `moments-rail.spec.ts` | The moments rail's rules (T-1642, D-300): the eyebrow and the sentence per kind, with and without a forecast, the time at the eyebrow's end (stale included), when the rail asks again, and the desktop row's "fits / N mor… |
| `moments-rail.ts` | The moments rail's rules (T-1642, D-300), pure so each is unit-tested (`moments-rail.spec.ts`): the words over each card (its eyebrow and the time at its inline end), the one sentence the model's numbers make, when the… |
| `news-desk.spec.ts` | Tests for `news-desk`. |
| `news-desk.ts` | The news desk's record of one story (T-1009, rule 10): every editor's decision about it, newest first, read from the lists the API already keeps -- the debate selections and the breaking marks, each with who, when, the… |
| `news-source-actions.ts` | News sources from the console (T-1015), over the audited API: reading a feed once before it is added, adding, editing and dropping. |
| `news.spec.ts` | Tests for `news`. |
| `news.ts` | The page's query. A malformed filter is dropped here rather than sent on: the API would refuse it with a 400, and a mistyped id in a URL should show a reader the section, not an error page. |
| `notification-actions.ts` | A sentence this file says itself, in the reader's language (T-1305). |
| `notification-links.ts` | Turning a notification into a route (T-272), and what it says. |
| `notification-messages.ts` | The words the notification pages' client components render (T-1305). |
| `notification-sections.ts` | The kinds Settings → Notifications gives a section of their own, worded through the catalogues rather than the general list's English labels (T-832). |
| `panel-actions.ts` | Posting on a public match panel (T-251). **The action does not check whether the member may post.** The API asks the database, the database decides, and this passes the answer on. |
| `panel-admin-actions.ts` | Opening and closing a featured match's public discussion from the web (T-613), over the audited API of T-253. |
| `panel-link.spec.ts` | Tests for `panel-link`. |
| `panel-link.ts` | A catalogue sentence with its values in, in `locale` (T-1308). |
| `panel-social-actions.ts` | Reacting to a panel post, and following a contributor (T-252). **Neither action checks whether the member may post**, and there is nothing to check: reacting and following are open to any member. |
| `person-name.spec.ts` | Tests for `person-name`. |
| `person-name.ts` | One name style per match page (T-1395, D-210). |
| `platform-rules.spec.ts` | Tests for `platform-rules`. |
| `platform-rules.ts` | The platform rules on a page (T-931, D-113). |
| `player-compare.spec.ts` | The compare page's alignment and coverage rules (T-631). |
| `player-compare.ts` | Two players compared (blueprint 5.3, T-631): the pure half of the compare page. |
| `player-provider.ts` | The player page's provider seasons and career (T-1431, D-223): pure helpers, so the rules are tested without rendering. |
| `player.spec.ts` | Tests for `player`. |
| `player.ts` | The player page's pure helpers (T-037): age, labels, the season selector over the record and the match log. |
| `power-index.spec.ts` | Tests for `power-index`. |
| `power-index.ts` | Wording for the Power Index panel (T-114, blueprint 6.1). |
| `prediction-actions.ts` | Submits (or resubmits) the member's prediction for a fixture (T-050). |
| `prediction-form.spec.ts` | Tests for `prediction-form`. |
| `prediction-form.ts` | Turns the prediction form's fields into the API request (T-050). |
| `prediction-history.spec.ts` | Tests for `prediction-history`. |
| `prediction-history.ts` | The prediction history's pure helpers (T-056): how a version, its time and its settlement read, and the paging of the profile's list. |
| `prediction-text.spec.ts` | Tests for `prediction-text`. |
| `prediction-text.ts` | The words of the prediction surfaces (T-1307): the predictions page, the leaderboard, a member's prediction history, the founder's and the contributors' analysis. |
| `predictions-days.spec.ts` | The member's own picks from one page of their history (D-201), as the matches page reads them (T-1496): a per-match read only where that page cannot answer. |
| `predictions-days.ts` | The member's own predictions on the listed matches, from one page of `GET /me/predictions` (newest kick-off first). |
| `push-actions.ts` | A device's push registration, handed from the browser to the API (T-330, D-074). |
| `push-offer-intent.ts` | The follow intent's half of the push offer's rules (T-1429), apart from the rest so the follow forms' mark -- on every page with a follow button -- carries only this. |
| `push-offer.ts` | When to offer push at the moment of a follow (T-1429). |
| `push-subscribe.ts` | The browser side of turning push on for this device (T-330, D-074), shared by the Settings switch and the offer at a follow (T-1429). |
| `rail-actions.ts` | The moments rail drawn again (T-1642, D-300; the matchday rail's since T-1635, D-297). |
| `rating-history.spec.ts` | Tests for `rating-history`. |
| `rating-history.ts` | A rating as the page prints it: one decimal, in the locale's digits ("58.0", "۵۸٫۰"). |
| `reader-time-zone-server.ts` | The reader's zone for a page (T-1391, D-207): the member's, else the one a guest chose in the first run, else the locale's default (UK time on `/en`, Tehran time on `/fa` (D-337), UTC elsewhere). |
| `reader-time-zone.spec.ts` | One reader zone on every page (T-1391, D-207). |
| `reader-time-zone.ts` | The reader's time zone, the same on every page (T-1391, D-207): the member's zone, else the one a guest chose in the first run (T-620), else the locale's default. |
| `rules-actions.ts` | Accept the platform rules the member just read (T-931, D-113). |
| `saved-actions.ts` | Save a story to the member's list (T-842). |
| `score-card-products.spec.ts` | Tests for `score-card-products`. |
| `score-card-products.ts` | What the scores card says about the model, the community and viewing (T-940, D-114, blueprint 4.1), reduced on the server to the few plain values a row needs, so the client receives a line per card and not a forecast. *… |
| `scores-filters.spec.ts` | Tests for `scores-filters`. |
| `scores-filters.ts` | The scores page's country, competition and stage filters (T-633, blueprint 4.1). |
| `scores.spec.ts` | Tests for `scores`. |
| `scores.ts` | The scores page's pure helpers (T-031): which day the page shows, the yesterday / today / next-five-days strip, how a card's status and kick-off read in the viewer's zone. |
| `search.spec.ts` | Tests for `search`. |
| `search.ts` | Which image a result of each kind carries (T-1617): a team's crest, a competition's logo, a person's photo. |
| `seo.spec.ts` | Tests for `seo`. |
| `seo.ts` | The SEO surface (T-039, D-040): one canonical URL per page under its locale, language alternates for the shipped locales with `x-default` on the default one, no indexing of the pseudo-locale or of pages that are a membe… |
| `session.ts` | The reader's address for the API's rate limits on the account forms (T-810) and `/ask` (T-838), if known. |
| `set-cookie.spec.ts` | Tests for `set-cookie`. |
| `set-cookie.ts` | Reads the session out of the API's `Set-Cookie` header so the web app can set the same cookie on its own origin (D-027). |
| `share-card.spec.ts` | T-520: a share card says what its page says and nothing more, the same way for everybody who sees the chat it was pasted into. |
| `share-card.ts` | The words on a share card (T-520): the picture a chat app shows when a link to a match or a table is pasted into it. |
| `share.spec.ts` | T-521: the share sheet where there is one, a copied link where not. |
| `share.ts` | Sharing a page (T-521): the platform's share sheet where there is one, a copied link where not, and the link itself to copy by hand when neither works. |
| `shell-nav.spec.ts` | The shell's navigations (T-1381, D-199; Stadiomind, T-1494, D-267; T-1610, D-281): the header's order and targets, the tab bar's, the footer's, and which entry a page belongs to. |
| `shell-nav.ts` | The site shell's navigations (T-1381, D-199; T-1610, D-281): the header's nav, the phone's bottom tab bar and the site footer's links. |
| `stage-label.spec.ts` | Every form the provider sends that the helper knows (T-1339). |
| `stage-label.ts` | A stage name or a round in the reader's words (T-1339, T-1375). |
| `story-actions.ts` | Follow or unfollow a team or competition from a story page (T-941). |
| `story-type-actions.ts` | An editor's story type from the news desk (T-1009) over `POST /admin/stories/:id/type` (T-1001, D-123, rule 10). |
| `summary-actions.ts` | An editor asks for a new summary version (T-412), with the reason the audit log keeps. |
| `system.spec.ts` | Tests for `system`. |
| `system.ts` | The System page's arithmetic and words (T-804), kept out of the page so a spec can hold them without a browser. |
| `team-season-stats.ts` | The team page's season statistics (T-1437, D-228): pure helpers, so the rules are tested without rendering. |
| `team.spec.ts` | Tests for `team`. |
| `team.ts` | The team page's pure helpers (T-036): the squad grouped by position, how the table context reads, and which side the team was on in a match. |
| `territory.spec.ts` | Tests for `territory`. |
| `territory.ts` | The name of a territory in the reader's language, from the platform's own region names where it has them, else the API's English name. |
| `theme-actions.ts` | The theme switch (T-602): a plain form post, so it works before any script has loaded. |
| `theme-cookie.ts` | The theme this browser renders with (T-602); `system` when none was chosen. |
| `theme.ts` | The colour theme (T-602, D-089): light, dark, or `system`, which follows the device. |
| `thread-actions.ts` | Opening a group's thread about a match (T-248). **There is no "does it exist yet" question here, and that is deliberate.** `POST /groups/:slug/threads` is idempotent (T-244): two members reaching for the same match get… |
| `transfers.ts` | The club and player pages' transfers (T-1440, D-231): pure helpers, so the rules are tested without rendering. |
| `translation-actions.ts` | Writing and reviewing a translation at the desk (T-1013), over T-304's two routes. **Nothing here decides anything**: who may write, who may review (never the author), what the source's rights allow and which checks fai… |
| `triple.spec.ts` | The arithmetic the model and the community both need (T-135). |
| `triple.ts` | Three numbers for the three outcomes, and the arithmetic on them (T-135). **Why this is not in `lib/forecast.ts`.** The rounding that makes three shares total exactly 100 is the same arithmetic whether the shares came f… |
| `viewing-actions.ts` | The editorial desk's writes (T-313, D-069), from the match page itself: declaring coverage, adding a broadcaster, listing this match on a service, setting the official highlight page, and taking either down with a reaso… |
| `viewing-console-actions.ts` | The Watch listings console's writes (T-1361), over the desk's API of T-313 and T-1360: declaring coverage for a competition's season in a territory, adding a broadcaster, adding and removing a standing default, listing… |
| `viewing-console.spec.ts` | Tests for `viewing-console`. |
| `viewing-console.ts` | The Watch listings console's pure pieces (T-1361): reading the page's query, which matches the bulk form starts with ticked, the bulk request built from the form, and the words the console shows. |
| `viewing.spec.ts` | Tests for `viewing`. |
| `viewing.ts` | The Watch surfaces' pure helpers (blueprint 11, T-314): reading the territory a guest chose, the state a module is in -- and there are four, because "not supplied" and "nothing listed" are different sentences and the di… |
| `words-server.ts` | The words the live surfaces need, resolved on the server for the reader's locale and handed to their client components (T-1303, T-1040). |
| `words.ts` | Words for the live surfaces (T-1303): the scores list and the match centre render in client components, which may not import the catalogues (T-1040). |

## apps/web/tests/e2e

| File | What it is |
|---|---|
| `a11y.spec.ts` | The accessibility pass (T-081, D-041): WCAG 2.2 AA as axe-core checks it, on every kind of page the platform has, plus the two things a rule engine cannot judge — the keyboard path into the content and the live region t… |
| `about.spec.ts` | The About page's two pictures (T-1615, D-286), without an API behind them (they need none): "How Stadiomind works" is an ordered list of six steps drawn as a diagram, and "Find your way" is the main sections as links. |
| `appearance.spec.ts` | Text size, contrast and motion (blueprint 2.2, T-621) in a real browser. |
| `competitions-menu.spec.ts` | The header's competitions menu without an API behind it (T-1643, D-301). |
| `competitions.spec.ts` | The All competitions page without an API behind it (T-1433). |
| `error-pages.spec.ts` | Error pages carry `lang` and `dir` (T-809). |
| `fixed-clock.cjs` | The web server's clock for the visual baseline (T-1502), loaded with `NODE_OPTIONS=--require=./tests/e2e/fixed-clock.cjs`. |
| `header-row.spec.ts` | The desktop header is one row at every width, whatever the face (T-1534). |
| `highlights.spec.ts` | The Highlights page without an API behind it (T-1434). |
| `home-hybrid.spec.ts` | The home page on the production build (T-1382, D-200; rebuilt in T-1495, D-270), at a phone's 390 px and a desktop's 1440 px, in English, Persian and the RTL pseudo-locale. |
| `lite.spec.ts` | Lite mode for slow connections (T-1387, D-205) in a real browser against the production build: the server renders it from the choice or `Save-Data`; a lite page requests no web font and no image; a slow connection only… |
| `match.spec.ts` | The match centre page without an API behind it (CI's E2E job runs the web app alone): a malformed id is a 404 page, an unreachable service is named, and the stream proxy answers honestly. |
| `mobile.spec.ts` | Scores and the match centre on a phone (T-605): at 360 x 800, in light and dark, at the default text size and the largest (T-621), in both writing directions, the page itself never scrolls sideways (a wide table may, in… |
| `moments-rail.spec.ts` | The moments rail on the production build (T-1642, D-300), in place of the matchday rail and its drawer (D-292). |
| `navigation.spec.ts` | The Stadiomind navigation (T-1494, D-267; T-1610, D-281) in a real browser, without an API behind it: every route keeps a working nav on a 390px phone and a 1440px screen, the phone's five tabs lead where they say and a… |
| `product-name.spec.ts` | No page says the working name (T-1503, D-262): the title, every meta tag, the structured data and the visible text say Stadiomind, on English, on Persian (where the name stays in Latin letters) and on the RTL QA surface. |
| `pwa.spec.ts` | Until the service worker is activated and this page is under its control. |
| `rtl.spec.ts` | The RTL pseudo-locale check (D-003). These assertions are about computed layout, not screenshots. A screenshot diff fails on a font hint or an antialiasing change and teaches everyone to ignore it; a computed-style asse… |
| `scores.spec.ts` | The scores page without an API behind it (CI's E2E job runs the web app alone). |
| `seo.spec.ts` | The SEO surface (T-039) with JavaScript switched off: what a crawler gets is the rendered HTML, so the content, the canonical link, the language alternates, the robots rule and the structured data all have to be in it. |
| `share-cards.spec.ts` | The share cards (T-520) are drawn, not just linked (T-1505). |
| `theme.spec.ts` | The theme (T-602, D-089) in a real browser. |
| `touch-targets.spec.ts` | The secondary pages' links on a phone (T-1574): every one a thumb is meant to press is a 44px target, in English and Persian. |
| `visual.spec.ts` | The visual baseline of the Stadiomind pages (T-1502, D-264): every rebuilt page in Night and Day, at a desktop width and at 390 px, compared with the committed pictures on every CI run. |

## apps/web/tests/e2e/budgets

| File | What it is |
|---|---|
| `budgets.spec.ts` | Performance budgets, the server half (T-808). |

## apps/web/tests/e2e/journeys

| File | What it is |
|---|---|
| `admin-refusal.spec.ts` | Every page of the administration console, to someone who may not use it (T-813). |
| `club.spec.ts` | The club page in the Stadiomind Club board (T-1499, T-1529, D-267), with the seed behind it, in English, Persian and the RTL pseudo-locale, on a 390px phone and a 1440px desktop. |
| `competition-page.spec.ts` | The competition page in the Stadiomind design (T-1498, D-265) with the API and the seed behind it, in English, Persian and the right-to-left pseudo-locale, on a 390 px phone and a 1440 px desktop: the header and the six… |
| `competitions-menu.spec.ts` | The competitions menu with the seed behind it (T-1643, D-301): every competition at once, grouped by region, each a link to its page; the filter narrows by name as the reader types; All, Today and Live keep what their c… |
| `competitions.spec.ts` | The All competitions page with the seed behind it (T-1433): it groups every competition (international, then continental, then each country), filters by name or country as the reader types, and opens a competition's pag… |
| `font-swap.spec.ts` | The page does not move when its fonts arrive (T-1536). |
| `group-owner.spec.ts` | Running a group from its page (T-1026), with the API and the seed behind it: the owner chooses who may invite and the group's language, makes an invite link (shown once, with a copy control) and revokes it, reads the gr… |
| `header-row.spec.ts` | The desktop header with the language picker as production draws it (T-1534; the globe, T-1610, D-281): with the API behind the web app the second language is offered, so the bar carries the globe and the page's language… |
| `highlights.spec.ts` | The Highlights page with the seed behind it (T-1434, D-226). |
| `home.spec.ts` | The member's homepage (T-942, D-115), with the API and the seed behind it. |
| `invite.spec.ts` | T-522: a member's invite link. The new member registers through it, lands on the inviter's profile with its friend-request control and a sentence saying why, and nothing has been sent on their behalf. Runs only in the `… |
| `journeys.spec.ts` | The blueprint's essential user journeys, the slices of them Phase 1 ships (T-080, D-043), driven through the real web app, API, database and seed: 18.1 a new member predicts a match — sent to sign in, registers, verifie… |
| `localised-names.spec.ts` | A localised entity name is a row against the canonical id, shown in the reader's language beside the name it is a name for (T-303, blueprint 13.1). |
| `match-centre.spec.ts` | The Stadiomind match centre on the seed's played match (T-1497), in English, Persian and the right-to-left pseudo-locale, on a phone (390px) and a desktop (1440px). |
| `match-states.spec.ts` | The match centre before kick-off (T-1550), on the seed's scheduled match in English and Persian. |
| `matches.spec.ts` | Matches and predictions on one page (T-1496, D-268), through the whole stack: the seed's open match (Liverpool v Manchester United, 1 January 2099, no forecast stored) and its played day. - The row carries the model's c… |
| `members.ts` | Making a member, the way a member is actually made. |
| `mobile.spec.ts` | Scores and the match centre on a phone, with real matches (T-605): the seed's played day and its two matches behind the web app, at 360 x 800, in light and dark, at the default text size and the largest (T-621), left to… |
| `moments-rail.spec.ts` | The moments rail with the API and the seed behind it (T-1642, D-300). |
| `news.spec.ts` | The news page through the real web app and API (T-143, blueprint 3.1 and 3.2). |
| `persian.spec.ts` | The WCAG levels every page is held to, as elsewhere. |
| `player.spec.ts` | The Stadiomind player page (T-1500, D-271) on the seed, in English, Persian and the right-to-left pseudo-locale, on a 390px phone and a 1440px desktop: the header with the photo's ring, the three facts with their figure… |
| `rtl-content.spec.ts` | The right-to-left audit on real content (T-153, CLAUDE.md rule 7). |
| `social.spec.ts` | Blueprint 19's social list, walked with two members (Phase 3 exit criteria). **Why this file exists at all.** The Phase 3 exit criteria were walked on the public preview on 2026-09-16 and four of them were met. |
| `target-size.spec.ts` | The team, player and competition pages with the seed behind them, at a desktop width and on a 360px phone: axe finds nothing, `target-size` (WCAG 2.2 AA, 24 x 24) included. |

## apps/web/tests/e2e/visual.spec.ts-snapshots

| File | What it is |
|---|---|
| `about-day-390-chromium-linux.png` | Image asset. |
| `about-day-chromium-linux.png` | Image asset. |
| `about-night-390-chromium-linux.png` | Image asset. |
| `about-night-chromium-linux.png` | Image asset. |
| `competition-day-390-chromium-linux.png` | Image asset. |
| `competition-day-chromium-linux.png` | Image asset. |
| `competition-night-390-chromium-linux.png` | Image asset. |
| `competition-night-chromium-linux.png` | Image asset. |
| `home-day-390-chromium-linux.png` | Image asset. |
| `home-day-chromium-linux.png` | Image asset. |
| `home-night-390-chromium-linux.png` | Image asset. |
| `home-night-chromium-linux.png` | Image asset. |
| `match-day-390-chromium-linux.png` | Image asset. |
| `match-day-chromium-linux.png` | Image asset. |
| `match-night-390-chromium-linux.png` | Image asset. |
| `match-night-chromium-linux.png` | Image asset. |
| `model-day-390-chromium-linux.png` | Image asset. |
| `model-day-chromium-linux.png` | Image asset. |
| `model-night-390-chromium-linux.png` | Image asset. |
| `model-night-chromium-linux.png` | Image asset. |
| `player-day-390-chromium-linux.png` | Image asset. |
| `player-day-chromium-linux.png` | Image asset. |
| `player-night-390-chromium-linux.png` | Image asset. |
| `player-night-chromium-linux.png` | Image asset. |
| `scores-day-390-chromium-linux.png` | Image asset. |
| `scores-day-chromium-linux.png` | Image asset. |
| `scores-night-390-chromium-linux.png` | Image asset. |
| `scores-night-chromium-linux.png` | Image asset. |
| `team-day-390-chromium-linux.png` | Image asset. |
| `team-day-chromium-linux.png` | Image asset. |
| `team-night-390-chromium-linux.png` | Image asset. |
| `team-night-chromium-linux.png` | Image asset. |

## deploy

| File | What it is |
|---|---|
| `Caddyfile` | The edge inside the VPS (T-074, D-048). Cloudflare terminates the public TLS; this is the origin it talks to, over TLS with the Cloudflare origin certificate (SSL mode "Full (strict)"). Plain HTTP on :80 is redirected b… |
| `backup-verdict.sh` | The Backups line of check-setup.sh (T-075, T-1427, D-219), as a function of what was read, so the decision can be tested without a server. |
| `check-setup.sh` | One command that says what this deployment can and cannot do (T-075). bash deploy/check-setup.sh On the VPS, from /opt/fmip. |
| `cloudflare-ranges.caddy` | Cloudflare's published address ranges (T-930, D-112): the only addresses the origin answers. |
| `docker-compose.prod.yml` | Production stack (T-074, D-048). Used through COMPOSE_FILE=deploy/docker-compose.prod.yml in the VPS's .env, so that every plain `docker compose ...` on the server — including the backup scripts of T-072 — means this fi… |
| `report-capabilities.mjs` | What the API says about itself, in lines a shell can read (T-075). |
| `rollout.sh` | Zero-downtime redeploy of the production stack (T-074, D-048). bash deploy/rollout.sh # build, migrate, roll model → api → web bash deploy/rollout.sh web # roll one service only (no build/migrate) NO_BUILD=1 bash deploy… |
| `verify-rollout.sh` | Proves a rollout is zero-downtime (T-074's acceptance criterion) by hitting the site through Caddy every 200 ms while `rollout.sh` replaces the running containers, then counting every answer that was not 200. bash deplo… |

## deploy/certs

| File | What it is |
|---|---|
| `README.md` | deploy/certs |

## deploy/preview

| File | What it is |
|---|---|
| `Dockerfile` | The preview image (T-086, D-064). One container, because the free plan of every host worth using gives one. It runs the API and the web app together and exposes only the web app's port: nothing in the browser talks to t… |
| `start.mjs` | Structured, one object per line, the same shape the API logs (D-044). |

## docs

| File | What it is |
|---|---|
| `00-decisions.md` | Decision log |
| `01-roadmap.md` | Roadmap |
| `02-architecture.md` | Architecture |
| `03-project-map.md` | Project map |
| `04-tasks-phase-1.md` | Phase 0 + Phase 1 task backlog |
| `04-tasks-phase-10.md` | Phase 10 — News depth and community depth |
| `04-tasks-phase-11.md` | Phase 11 — Model depth and the console's configuration |
| `04-tasks-phase-12.md` | Phase 12 — A design pass over the pages a reader meets |
| `04-tasks-phase-13.md` | Phase 13 — Persian, and images |
| `04-tasks-phase-14.md` | Phase 14 — Model factors |
| `04-tasks-phase-2.md` | Phase 2 — Depth on football intelligence |
| `04-tasks-phase-3.md` | Phase 3 — Community |
| `04-tasks-phase-4.md` | Phase 4 — Reach |
| `04-tasks-phase-5.md` | Phase 5 — Intelligence layer |
| `04-tasks-phase-6.md` | Phase 6 — Breadth, first members, a better model |
| `04-tasks-phase-7.md` | Phase 7 — A face, a console, and the rest of the blueprint |
| `04-tasks-phase-8.md` | Phase 8 — Run it like a live product, and keep the promises still open |
| `04-tasks-phase-9.md` | Phase 9 — Carry the load, repair the record, and finish the pages people see first |
| `05-data-providers.md` | Data providers |
| `06-session-handoff.md` | Session handoff |
| `07-backups.md` | 07 — Backups and restore |
| `08-load-test.md` | 08 — Load test: the live path at peak |
| `09-deploy.md` | Production deployment |
| `10-public-preview.md` | A public address for testing, for free |
| `11-preview.md` | The public preview |
| `12-power-index.md` | The Power Index |
| `13-policy.md` | Phase 3 policy |
| `14-maintainer.md` | What only the maintainer can do |
| `15-model.md` | The forecast model: how it works, and how to propose a change |
| `16-model-factors-report.md` | The model factors report (Phase 14, T-1661) |
| `18-handover.md` | Handover: starting on another account or another machine |
| `product-blueprint.md` | Product blueprint |

## docs/research

| File | What it is |
|---|---|
| `highlightly-coverage-2026-10.md` | Highlightly Pro coverage check (T-1445, 2026-10-21) |
| `youtube-highlights-design-2026-10.md` | Official YouTube channels as a second highlights source: design (T-1489, D-261) |

## packages/config

| File | What it is |
|---|---|
| `eslint.config.mjs` | Eslint configuration. |
| `package.json` | Package `@fmip/config`: Shared TypeScript, ESLint and Prettier configuration for the FMIP monorepo: scripts and dependencies. |
| `tsconfig.json` | TypeScript compiler settings. |
| `vitest.config.ts` | Vitest configuration. |

## packages/config/eslint

| File | What it is |
|---|---|
| `base.js` | Shared flat ESLint configuration for every TypeScript workspace in FMIP. |

## packages/config/prettier

| File | What it is |
|---|---|
| `index.js` | Shared Prettier configuration for the FMIP monorepo. @type {import('prettier').Config} |

## packages/config/tests

| File | What it is |
|---|---|
| `shared-config.spec.ts` | Tests for `shared-config`. |

## packages/config/tsconfig

| File | What it is |
|---|---|
| `base.json` | JSON data or settings. |
| `library.json` | JSON data or settings. |
| `nestjs.json` | JSON data or settings. |
| `nextjs.json` | JSON data or settings. |

## packages/console-publisher

| File | What it is |
|---|---|
| `README.md` | @fmip/console-publisher |
| `eslint.config.mjs` | Eslint configuration. |
| `package.json` | Package `@fmip/console-publisher`: The agents console's snapshot and command sync, run on the maintainer's computer (D-340).: scripts and dependencies. |
| `tsconfig.json` | TypeScript compiler settings. |
| `vitest.config.mts` | Vitest configuration. |

## packages/console-publisher/src

| File | What it is |
|---|---|
| `chat.spec.ts` | Tests for `chat`. |
| `chat.ts` | The chat with the agents, on the maintainer's computer (T-1722, D-350): the pure part. |
| `publish.ts` | The agents console's publisher, on the maintainer's computer (T-1699, D-340). |
| `snapshot.spec.ts` | Tests for `snapshot`. |
| `snapshot.ts` | The agents console's snapshot, built on the maintainer's computer (T-1699, D-340): pure functions over what the files say, so they are tested on fixtures and `publish.ts` only reads files and runs `ssh`. |

## packages/contracts

| File | What it is |
|---|---|
| `eslint.config.mjs` | Eslint configuration. |
| `package.json` | Package `@fmip/contracts`: The single source of truth for the API shape. Consumed by apps/api and apps/web.: scripts and dependencies. |
| `tsconfig.build.json` | TypeScript compiler settings. |
| `tsconfig.json` | TypeScript compiler settings. |
| `vitest.config.mts` | Vitest configuration. |

## packages/contracts/glossary

| File | What it is |
|---|---|
| `ar.json` | JSON data or settings. |
| `de.json` | JSON data or settings. |
| `en.json` | JSON data or settings. |
| `es.json` | JSON data or settings. |
| `fa.json` | JSON data or settings. |
| `fr.json` | JSON data or settings. |
| `it.json` | JSON data or settings. |
| `pt.json` | JSON data or settings. |
| `tr.json` | JSON data or settings. |

## packages/contracts/src

| File | What it is |
|---|---|
| `activity.ts` | Activity counts for the admin console (T-807, blueprint 19): how many of each thing happened per UTC day, counted from rows the product already stores for its own purposes. |
| `admin.ts` | The minimal administration area (blueprint 16, T-070, D-046): what an operator needs to see before the provider jobs exist — coverage per season, freshness, ingest failures, member search — and the two high-impact actio… |
| `agents-console.ts` | The snapshot shape this API reads; the publisher writes the same number. |
| `appearance.spec.ts` | The appearance preferences (T-602, T-621) are closed lists the API validates against, the database CHECKs repeat, and the web renders on <html>. |
| `campaigns.ts` | Campaigns (T-332, D-075): an audience is a saved query, a send is a row. |
| `catalog.ts` | Read endpoints over the catalog (T-010 tables). |
| `chat-socket.ts` | The chat socket protocol (blueprint 8.3, T-230, D-010). |
| `coaches.ts` | Coaches from the data provider's coaches endpoint (T-1439, D-230): a coach is a person by our id, never by name (rule 1), and his career is the provider's list of spells at the teams we carry. |
| `community-analysis.ts` | Community-written match analysis (blueprint 10.3, T-260). **A fourth signed opinion, and nothing here is shared with the other three.** Rule 6 names the statistical model, the founder's analysis and the community consen… |
| `competition-context.ts` | `GET /fixtures/:id/competition-context` (T-840, blueprint 4.2): where the two sides stood in this competition before the match -- their table or group positions, or, in a knockout round, which round it is and the tie it… |
| `competition-order.ts` | The highest place a competition can be given (the column is a `smallint`). |
| `confederation.spec.ts` | Tests for `confederation`. |
| `confederation.ts` | Football's six confederations (T-1643, D-301): which one a competition belongs to, so the header's competitions menu can file it by region. |
| `consensus.ts` | Community consensus (blueprint 6.6, T-134). |
| `contributor.ts` | Approval to post on a public match panel (blueprint 9.4 and 10.2, T-250). |
| `conversations.ts` | Conversations (blueprint 8.3, T-220). **Order is a sequence, not a time.** Every message carries `seq`, unique and increasing within its conversation, and every question a client asks about order is asked in those terms. |
| `coverage.spec.ts` | Tests for `coverage`. |
| `coverage.ts` | Coverage states. Not every competition has the same data depth. Rule 3 in `CLAUDE.md`: when data is missing the API says so explicitly. It never returns an empty module that looks populated, and never invents a value. |
| `data-quality.ts` | Data-quality checks over the stored feed (T-820, E82, D-097). |
| `failure-counts.ts` | API errors and job failures, counted (T-803): 5xx responses per route template and failed or stalled BullMQ jobs per queue, in UTC-hour buckets, kept for thirty days. |
| `following-feed.ts` | The Following feed (blueprint 12.1, T-333): what is happening around the teams, competitions and contributors a member follows, **ranked from qualified signals and never from raw volume**, and saying what it is showing. |
| `following.ts` | `/me/following` on `apps/api` (T-042). Following is a row; favourite is a flag on it. Favourites are pinned first on the scores page and shown on the profile; everything followed feeds the Following views (blueprint 4.1… |
| `forecast.ts` | The internal contract between `apps/api` and the model service (T-063). |
| `founder-analysis.ts` | The founder's match analysis (blueprint 6.5, T-130). |
| `glossary.spec.ts` | The committed glossary files (T-1011, D-130), read the way the API reads them. |
| `glossary.ts` | The shared football glossary (T-1011, D-130): `glossary/en.json` is the English side, one entry per term keyed by a stable id (`term.<slug>`, or `team.<uuid>`, `competition.<uuid>`, `person.<uuid>` for a name -- rule 1)… |
| `groups.ts` | Groups (blueprint 8.2, and the exclusive groups of 10.1, T-240). |
| `health.ts` | `GET /health` on `apps/api`. Liveness only: it says the process is serving HTTP. It reports nothing about Postgres or Redis, because the API checks neither in this answer. The ingestion and live-path views below are sep… |
| `homepage.ts` | The shortest window a feature may be given, in hours. |
| `identity.ts` | `/auth/*` on `apps/api` (T-040). The session itself travels in an HttpOnly cookie, never in a body, so no type here carries a token. The one-time tokens for e-mail verification and password reset arrive by e-mail and ar… |
| `index.ts` | Re-exports this folder’s public parts. |
| `intelligence.ts` | The intelligence layer (Phase 5, D-070): a language model behind one port, chosen at deployment, with an honest absence -- and the shape every piece of machine-written text on the product takes. |
| `key-players.ts` | `GET /fixtures/:id/key-players` (T-841, blueprint 4.2): each side's most used players in this competition's season before the match, their season figures and whether the provider says they will miss it. "Key" is a state… |
| `league-zones-check.ts` | The checker for the committed list (T-1167, D-171). |
| `league-zones.spec.ts` | The committed list (T-1167, D-171), read the way the API reads it. |
| `league-zones.ts` | League zones (T-1167, D-171): the qualification and relegation places of a league season, from a committed list -- `zones/league-zones.json`, read as `@fmip/contracts/zones/league-zones.json` by the API and by the model… |
| `locale-hold.ts` | The locales a hold may name: every real interface language but English, the source language (D-003) a held one falls back to. |
| `match-centre.ts` | `GET /fixtures/:id` (T-033): the match centre of blueprint 4.2 as far as the platform's own tables reach — header, timeline, statistics, line-ups, recent form, head-to-head — each module wrapped in `Covered` so the page… |
| `match-panel.ts` | The public match discussion (blueprint 10.2, T-251). |
| `media.spec.ts` | Media addresses (T-1461): each ends in its type's extension, so the edge caches it by the path alone, and the version reads back the same from an address with or without one. |
| `media.ts` | Entity media (T-1320, D-176): a team's crest, a competition's logo, a person's photo, served from our own origin. |
| `moderation.ts` | Reports, decisions and sanctions (blueprint 10.4 and 16, T-210). |
| `moments.ts` | Today's moments that matter (T-1641, D-299): the site's top bar, up to `MOMENTS_LIMIT` matches picked by what is happening on the pitch and what the published statistical model expected before kick-off. |
| `news.ts` | The news sections (blueprint 3.1, T-143). |
| `notifications.ts` | In-product notifications (blueprint 12.2, T-270). **A notification is a consequence, not a feature.** Every kind below is already an event somewhere else in the product, so this epic subscribes rather than invents — and… |
| `panel-admin.ts` | Deciding which matches have a public discussion (blueprint 10.2, T-253). **An operator decides, and the decision has a name on it.** Every shape here carries a `reason`, and none of them is optional: a panel opened for… |
| `panel-social.ts` | Reacting to a panel post, and following a contributor (blueprint 10.2, T-252). **Both are open to any member, and neither is a way to post.** That is the acceptance criterion and it is a property of these types as much… |
| `platform-independent.spec.ts` | The contracts package belongs to no platform (T-321). |
| `player-provider-seasons.ts` | A player's season totals and career as the data provider counts them (T-1431, D-223), beside -- never mixed into -- the record we compute from the matches we ingest (`PlayerPage.record`, D-038). |
| `power-index.ts` | The Power Index (blueprint 6.1, T-110). The explanatory number beside each team in a match centre: 0 to 100, with the components it was built from. Two properties are contractual rather than incidental, because the blue… |
| `predictions.ts` | Registered-user predictions (blueprint 6.6, T-050). |
| `profile.ts` | `/profiles/*` and `/me/*` on `apps/api` (T-041). |
| `rate-limits.ts` | The rate-limit inventory (T-811, D-103): every write the API takes, the ceiling it is held to, or the reason it has none, with how many requests each ceiling refused per UTC day. |
| `rating-threshold.ts` | Rating thresholds as versioned rows (T-1160, D-152, D-164). |
| `refusals.spec.ts` | T-904 (D-108): one refusal body per role, each a `forbidden` and nothing else. |
| `reputation.ts` | Performance Rating (blueprint 9.1, T-053): a 0–100 measure of prediction quality, provisional until 30 settled predictions and established at 50. |
| `scores.spec.ts` | Where a live match's freshness is measured from (T-1394, D-209): the last change in play, and the later of that and the provider's last live answer where the stored clock stands still. |
| `scores.ts` | `GET /scores` (T-030): the scores list of blueprint 4.1. |
| `search.ts` | Search (blueprint 2.2 and 5). Entity search (T-038): teams, competitions and people by name, accent-folded and trigram-matched, and by alias — the spellings, transliterations and abbreviations a name does not carry itse… |
| `social.ts` | The social graph: friends, requests and blocks (blueprint 8.1, T-200). |
| `team-season-stats.ts` | A team's statistics for one season of one competition as the data provider counts them (T-1437, D-228), shown as the provider's, beside -- never mixed into -- the table and the splits we compute from the matches we inge… |
| `territory.ts` | The viewer's territory (blueprint 11, T-312). |
| `three-products.spec.ts` | The separation guard (T-133, extended in T-134; CLAUDE.md rule 6). |
| `transfers.ts` | Transfers as the data provider lists them (T-1440, D-231): the moves into and out of a club, and a player's moves. |
| `translation-checks.spec.ts` | The automatic checks (T-1012, D-131): a passing and a failing pair for each, with right-to-left targets among them, and the promise that a check only ever returns a verdict. |
| `translation-checks.ts` | The automatic translation checks (T-1012, D-131): a pure function over the publisher's version and a person's translation of it. |
| `translation-desk.ts` | The translator's desk on the web console (T-1013): a queue of articles per language and, for one article, everything a translator or a reviewer needs beside the form -- the publisher's words, the newest translation, the… |
| `viewing.ts` | Watch and highlights (blueprint 11, T-311): where a match can be watched in the viewer's territory, and the official highlight afterwards. |
| `watchdog.ts` | The watchdog (T-801): conditions evaluated on a schedule over the health views, each with its threshold and its state, and the transitions between states as a durable log. |

## packages/contracts/zones

| File | What it is |
|---|---|
| `league-zones.json` | JSON data or settings. |

## packages/db

| File | What it is |
|---|---|
| `Dockerfile` | The migration tool image (T-074): node-pg-migrate plus this package's migrations, so the production database is migrated by docker compose run --rm migrate without Node or pnpm installed on the VPS. |
| `eslint.config.mjs` | Eslint configuration. |
| `package.json` | Package `@fmip/db`: Database schema, migrations and seed data.: scripts and dependencies. |
| `tsconfig.build.json` | TypeScript compiler settings. |
| `tsconfig.json` | TypeScript compiler settings. |
| `vitest.config.mts` | Vitest configuration. |

## packages/db/migrations

| File | What it is |
|---|---|
| `1757400000000_bootstrap.sql` | Rule 1: every football entity has an internal UUID that we generate. |
| `1757500000000_catalog.sql` | T-010: the catalog. The reference entities that every fixture, prediction and article will point at: where football is played, by whom, in what. Rule 1 (CLAUDE.md): every row is identified by a UUID we generate. Names,… |
| `1757600000000_fixtures.sql` | T-011: the match. A fixture is the canonical entity the whole product hangs off (blueprint 1.1); everything a match centre shows is a row in one of the tables below, or a coverage state saying why it is absent (T-012).… |
| `1757700000000_ingestion.sql` | T-012: the ingestion boundary's own tables. |
| `1757800000000_unresolved-entity.sql` | T-013: the unresolved queue. When a provider hands ingestion an id that provider_mapping does not know, the entity resolver writes it here and stops. It never creates a catalog row from a guess (02-architecture.md, "Ide… |
| `1758000000000_identity.sql` | T-040: accounts. The identity boundary (02-architecture.md) owns users, credentials, sessions and roles; profile, privacy and favourites are the profile boundary's tables and arrive with T-041 and T-042. Same convention… |
| `1758100000000_profile.sql` | T-041: the profile boundary's first two tables. profile holds what a member says about themselves; privacy_setting holds who may see it. |
| `1758200000000_followed-entity.sql` | T-042: following and favourites. One row per (member, entity): the row's existence is "following"; the flag is "favourite". A favourite is always followed, so the scores page can pin favourites and the feed can include… |
| `1758300000000_training-store.sql` | T-060: the training store, as its own schema (D-028). |
| `1758400000000_training-team-alias.sql` | T-063: the bridge between the catalog and the training store. |
| `1758500000000_forecast.sql` | T-064: forecast versions (02-architecture.md, "Forecast versioning"): input_snapshot → model_version → forecast → evaluation (T-066) Rule 5 in CLAUDE.md: forecasts are immutable. |
| `1758600000000_evaluation.sql` | evaluation (T-066) One row per forecast version once the fixture has a full-time score: what happened, how much probability the version gave it, and the two scores the backtest harness uses (log loss, Brier), so model p… |
| `1758700000000_fixture-change-notify.sql` | T-032: the change feed behind the SSE gateway (D-034). |
| `1758800000000_predictions.sql` | T-050: registered-user predictions (blueprint 6.6, 02-architecture.md "predictions"). |
| `1758900000000_prediction-lock.sql` | T-051: predictions lock at kick-off, decided by the database clock. |
| `1759000000000_settlement.sql` | T-052: settlement of predictions (blueprint 6.6, 9.1). |
| `1759100000000_rating.sql` | T-053: Performance Rating snapshots (blueprint 9.1, 02-architecture.md "Reputation reproducibility"). |
| `1759200000000_career-points.sql` | T-054: Career Points (blueprint 9.2). Participation and achievement, kept apart from the Performance Rating: a ledger of immutable transactions, each earned by one settlement for one reason under one rule version. The t… |
| `1759300000000_search.sql` | Entity search (T-038, D-039): trigram similarity over accent-folded, lower-cased names, plus an alias table for the spellings a name does not carry itself (transliterations, abbreviations, former names, common misspelli… |
| `1759400000000_audit-log.sql` | The audit log (rule 10, T-070, D-046): one immutable row per high-impact administrative action — who, when, what, on which record, why, and the value before and after. |
| `1759500000000_power-index.sql` | T-110: the Power Index (blueprint 6.1). The number beside each team that says how strong it is, from 0 to 100, and — this is the part that makes it a product rather than a statistic — the components it was built from, s… |
| `1759600000000_founder-analysis.sql` | T-130: the founder's match analysis (blueprint 6.5). |
| `1759700000000_arabic-search-key.sql` | T-152: fold Arabic-script letter variants in `search_key`, so the same name typed in Arabic and in Persian is the same string to search. **The measurement that prompted this.** The seeded Persian alias for Manchester Un… |
| `1759800000000_social-graph.sql` | T-200: the social graph (blueprint 8.1) — friend requests, friendships and blocks. |
| `1759900000000_moderation.sql` | T-210: the moderation spine (blueprint 10.4 and 16, D-053) — reports, decisions, sanctions and appeal notes. |
| `1760000000000_rate-limit.sql` | T-213: rate limits, which are the only automation in this product's moderation (D-054). |
| `1760100000000_conversations.sql` | T-220: conversations (blueprint 8.3) — the message store, its ordering, and every refusal that has to stand before the first message can be sent. |
| `1760200000000_message-cards.sql` | T-222: shared football cards (blueprint 8.3). "Match cards shared in chat remain live. |
| `1760300000000_message-search.sql` | T-223: searching inside one conversation (blueprint 8.3). **`search_key` rather than a text-search configuration**, and that is the decision in this migration. |
| `1760400000000_reactions-mentions-pins.sql` | T-225: reactions, mentions and pinned messages (blueprint 8.3). |
| `1760500000000_groups.sql` | T-240: groups (blueprint 8.2, and the exclusive groups of 10.1). **Three visibilities, and the middle one is why there are three.** A boolean would give public and private and lose the case the blueprint asked for: disc… |
| `1760600000000_group-conversations.sql` | T-245: a group has a conversation, and its membership is the group's. **The acceptance criterion is "membership changes take effect on the conversation immediately", and there are two ways to get that.** One mirrors `gr… |
| `1760700000000_group-threads.sql` | T-244: a match thread inside a group. **"A thread is a conversation about a fixture, and says which."** The acceptance criterion is two clauses and both of them are load-bearing. *A conversation.* Not a new kind of plac… |
| `1760800000000_contributor-grant.sql` | T-250: who may post on a public panel (blueprint 9.4 and 10.2, D-059). |
| `1760900000000_match-panel.sql` | T-251: the public match discussion (blueprint 10.2). **The first surface where something a member writes is shown to the public**, and the gate is the whole feature. |
| `1761000000000_panel-reactions-following.sql` | T-252: reacting to a panel post, and following a contributor (blueprint 10.2). **The whole task is that neither of these becomes posting access**, and the schema is where that is settled rather than remembered. |
| `1761100000000_match-panel-opening.sql` | T-253: which fixtures have a panel at all (blueprint 10.2). **Until now every fixture had a panel, because nothing said which ones did.** That is the wrong default and it was always going to be: a public discussion atta… |
| `1761200000000_notifications.sql` | T-270: in-product notifications (blueprint 12.2). **A notification is a consequence, not a feature.** Every one of these is already an event somewhere else in the product -- a settlement, a friend request, a mention, a… |
| `1761300000000_quiet-hours-end.sql` | T-273: when quiet hours end, so a held notification knows when to arrive. |
| `1761400000000_community-analysis.sql` | T-260: community-written match analysis (blueprint 10.3). **This is a fourth signed opinion, and the schema is where rule 6 is most likely to break.** Community analysis contains a predicted result, a confidence and rea… |
| `1761500000000_editor-role.sql` | T-261: the `editor` role. Blueprint 7.3 and 10.2 have named an editor since the beginning -- "manual approval by the founder, editor or administrator" -- and the role list has not had one, because until now nothing need… |
| `1761600000000_localised-names.sql` | T-303: localised entity names against the canonical UUID (blueprint 13.1). |
| `1761700000000_panel-post-notifies.sql` | T-254: a public panel post announces itself the way a goal does. |
| `1761800000000_news-schema.sql` | T-141: the article schema (blueprint 3.3, 13.1), built against what a source actually grants (D-061). |
| `1761900000000_news-fetch.sql` | T-142: the record of every attempt to read a publisher's feed, and one correction to the article schema that reading real feeds made necessary. |
| `1762000000000_story-debate.sql` | The debate section is what editors selected (blueprint 3.1, T-143). |
| `1762100000000_viewing-territory.sql` | T-312 (blueprint 11): the viewer's territory, chosen by the member and stored, never inferred from an address. |
| `1762200000000_viewing.sql` | T-311 (blueprint 11): where a match can be watched and where its highlights are, stored per territory, under the rights each source grants. |
| `1762300000000_notification-mutes.sql` | T-331 (blueprint 12.2): per-team, per-competition and per-category controls. |
| `1762400000000_article-translations.sql` | T-304 (blueprint 3.3 and 13): one canonical article with a controlled version per language. |
| `1762500000000_viewing-editorial.sql` | T-313 (D-069): viewing data is editorial, link-only, until a licence says otherwise. |
| `1762600000000_match-summary.sql` | T-411 (Phase 5, D-070): a match summary as an immutable version. |
| `1762700000000_moderation-suggestion.sql` | T-440 (Phase 5, D-070): what a language model suggested about a report, as an immutable row beside it. |
| `1762800000000_member-briefing.sql` | T-431 (Phase 5, D-070): a member's briefing as an immutable version -- what a language model wrote over the Following feed's window, with the document it was given (the items, by id), the prompt version, the model and w… |
| `1762900000000_briefing-notification.sql` | T-432 (Phase 5, D-070): a briefing is the same notification the inbox already has, and the one place a notification leaves the building is the delivery port (T-330). |
| `1763000000000_match-summary-skipped.sql` | T-412 (Phase 5, D-070): a finished match whose record holds only the score gets no summary, and that decision is a version too. |
| `1763100000000_push-subscription.sql` | T-330 (D-074): a member's devices for Web Push, and a fourth delivery outcome. |
| `1763200000000_campaigns.sql` | T-332 (D-075): campaigns. An audience is a saved query, a send is a row. `audience` is a saved filter over members -- a small closed vocabulary (a followed team or competition, a country, a language, verified only, join… |
| `1763300000000_member-countries.sql` | T-040 (blueprint 7.1, D-078): the countries a member can register with. |
| `1763400000000_fixture-detail-fetch.sql` | T-102: which finished fixtures have had their post-match detail fetched. |
| `1763500000000_fixture-player-stat.sql` | T-101: each player's numbers in one match. |
| `1763600000000_fixture-absence.sql` | T-103: who will miss a match, and when the provider was last asked. |
| `1763700000000_ingest-run-requests.sql` | T-501: how many requests each ingest run sent to its provider. |
| `1763800000000_forecast-cross-competition.sql` | T-503: a forecast the model cannot give because the match is between clubs of different leagues -- a European cup's, and any other competition that is not a single domestic league. |
| `1763900000000_competition-display-order.sql` | T-504: where a competition sits on the scores page, after a member's own favourites. |
| `1764000000000_forecast-shadow.sql` | T-531: shadow forecasts. A candidate model version is computed beside the published one for every forecast the published one makes, stored exactly as a forecast is (rule 5: immutable, with its inputs and its model), and… |
| `1764100000000_channel-post.sql` | T-525: the daily post to a public channel -- the day's matches with the statistical model's forecast. |
| `1764200000000_training-our-records.sql` | T-512, D-083: the training store's third source -- our own records of the licensed feed, copied from `fixture` by the model's loader. |
| `1764300000000_first-run.sql` | T-620: the first-run flow (language, territory, time zone, favourite teams) is offered once. |
| `1764400000000_theme-preference.sql` | T-602: the colour theme a member chose (D-089): light, dark, or `system`, which follows the device. |
| `1764500000000_group-polls.sql` | T-643 (D-091): group polls (blueprint 8.2, "shared fixtures, articles, polls and prediction comparisons"). |
| `1764600000000_display-preferences.sql` | T-621: the accessibility preferences a member chose (blueprint 2.2): text size, contrast and motion, kept on the account like the theme (T-602) so a second device renders them after sign-in. |
| `1764710000000_auth-rate-limits.sql` | T-810: rate limits on signing in, signing up, the forgotten-password e-mail and the two e-mailed links (D-026 deferred this; the numbers are D-093). **The same ceilings, a different counter.** The ceilings are rows in `… |
| `1764720000000_account-deletion.sql` | T-812 (D-094): a member deletes their account. |
| `1764732000000_failure-counts.sql` | T-803: API errors and job failures counted, one row per UTC hour and key, incremented in place, kept for thirty days. |
| `1764733100000_watchdog.sql` | T-801: the watchdog over the health views. |
| `1764740000000_admin-alerts.sql` | T-802 (D-096): the watchdog's alerts delivered to administrators. **A `system_alert` kind and a `watchdog_event` subject.** The kind lists in `notification` and `notification_preference` are two copies of the contract's… |
| `1764750000000_data-quality.sql` | T-820: data-quality findings over the stored feed (E82, D-097). |
| `1764760000000_match-alerts.sql` | T-830 (blueprint 12.2, D-098): match alerts. |
| `1764770000000_backup-run.sql` | T-805 (D-101): the backup and the restore drill say what happened, where the API can read it. |
| `1764780000000_lineup-friend-alerts.sql` | T-832 (blueprint 8.1 and 12.2, D-100): three notification kinds. match_availability a player the provider says will miss a followed match match_lineups both line-ups of a followed match announced friend_predicted a frie… |
| `1764790000000_editorial-notifications.sql` | T-833 (blueprint 18.3, D-100): editorial notifications. |
| `1764800000000_saved-articles.sql` | T-842 (blueprint 3.3 and 2.1): a member saves a news story and finds it again under Following -> Saved. |
| `1764810000000_rate-limit-inventory.sql` | T-811: the rate-limit inventory (D-103). Every write the API takes is listed in `apps/api/src/modules/rate-limits/inventory.ts` with its ceiling or the reason it has none, and the list found two writes that needed one:… |
| `1764820000000_match-alert-queue.sql` | T-835: match alerts off the live job. The live job now only records each event in `match_alert` and hands a BullMQ job the word; a worker expands the events to their audience (one set-based insert per event) and carries… |
| `1764830000000_ask-rate-limit.sql` | T-838 (D-104): the ceilings on `GET /ask`, the gap D-103 recorded. |
| `1764840000000_fixture-refetch-request.sql` | T-913: asking the feed again for one fixture's details (E91, D-110). |
| `1764850000000_training-own-elo.sql` | T-921, D-111: an Elo computed from our own training store, for the days Club Elo does not answer. |
| `1764870000000_follow-fixture.sql` | T-945: following a match (blueprint 12.1, D-116). |
| `1764880000000_achievement-unlocked.sql` | T-946 (blueprint 12.2, D-117): an achievement unlock is a notification. 1. |
| `1764900000000_story-label.sql` | A story's type (blueprint 3.2, T-1001, D-123). |
| `1764910000000_article-category.sql` | The publisher's own category strings on a feed item, as carried (T-1002, D-123). |
| `1764920000000_story-breaking.sql` | "Breaking": an editor's mark with a window (blueprint 2.3 and 12.2, T-1004, D-125). |
| `1764930000000_breaking-news-notification.sql` | T-1005 (blueprint 12.2, D-125): the breaking alert. 1. |
| `1764940000000_translation-check-override.sql` | T-1012 (D-131): a reviewer's reason for passing a failing automatic check on one translated version. |
| `1764950000000_group-invite-policy.sql` | T-1020 (D-132): who may invite to a group. |
| `1764960000000_group-invite-link.sql` | T-1021 (D-132): invite links. A link is an invitation to whoever holds it, so it obeys what a direct invitation obeys (T-240, T-1020): only somebody the group's invite policy lets invite makes one, a contact sanction st… |
| `1764970000000_group-language-favourite.sql` | T-1022 (D-133): a group's preferred language, and its favourite club or competition. **The language is a tag, not a translation.** It says what the members write in, so the group's page and conversation can be marked up… |
| `1764980000000_group-rules.sql` | T-1023 (D-133): a group's rules, written by its owner, versioned, and accepted on joining. **Versioned, never edited in place.** Each change is a new row with the next number; the text a member accepted is the text they… |
| `1764990000000_group-closure.sql` | T-1025 (D-135): administrators close a group, reopen it, and remove its content, each as a moderation decision about the group. **A closed group is read-only to its members.** Nothing new goes into it -- no message, rea… |
| `1765000000000_panel-post-link.sql` | T-1030 (D-136): a panel post links to at most one thing of its own match -- an incident, a player in either line-up, the author's own prediction, or a team statistic -- rendered as a card beside the post (blueprint 10.2… |
| `1765010000000_contributor-flag.sql` | T-1031 (blueprint 9.4, D-137): a contributor below the threshold for a sustained period is flagged to administrators, and never paused by the platform. 1. |
| `1765100000000_forecast-shadow-per-version.sql` | T-1102 (D-140): several candidates in shadow at once. |
| `1765120000000_homepage-feature.sql` | Featured matches on the homepage (blueprint 2.3 and 16, T-1161, D-153). |
| `1765130000000_locale-hold.sql` | Holding back a language that is ready (blueprint 13 and 16, T-1163, D-155). |
| `1765200000000_rating-threshold-version.sql` | Rating thresholds as versioned rows (blueprint 16, T-1160, D-152, D-164). |
| `1765300000000_platform-rules-version.sql` | The platform-rules version a member accepted (blueprint 7.1 and 9.4, 13-policy.md, T-931, D-113). |
| `1765600000000_story-type-notifications.sql` | T-1032 (blueprint 12.2, D-166): transfer and availability alerts from typed stories. |
| `1765700000000_watchdog-candidate-key.sql` | T-1165 (D-140): the watchdog's condition for a candidate in shadow is keyed `candidate:<version>`, and a version is `name@x.y.z`. |
| `1765790000000_persian-names.sql` | Persian display names for the clubs a Persian reader meets first and for every competition we carry (T-1311, D-175): rows in entity_alias with kind = 'name' and language = 'fa', which localised_name() already reads (T-3… |
| `1765800000000_entity-media.sql` | T-1320 (D-176): the entity media store. Team crests, competition logos and player photos are copied once from the provider onto our own volume and served from our own origin, so a reader's browser never asks the provide… |
| `1765810000000_news-images.sql` | T-1322 (D-177, amending D-061): news photos, only from the sources whose licence covers them, and only the agency's own photos, each shown with its credit and licence. **The right lives on the source, as the words' righ… |
| `1765815000000_tasnim-image-right.sql` | Tasnim's image right (T-1322, D-177). 1765810000000 matched Tasnim by the host tasnimnews.com, but the source we carry reads its feed from tasnimnews.ir, so the statement updated no row in production. |
| `1765820000000_news-source-same-language.sql` | T-1330 (D-178): a source whose stories are shown only to readers of its own language, set per source by an administrator in the console. |
| `1765825000000_tasnim-media-host.sql` | Tasnim serves its photos from its own media host, newsmedia.tasnimmedia.com (measured on 2026-10-01: all four photos of the first fetch after D-177 went live were refused as "not one of the agency's own hosts"). |
| `1765830000000_team-squad-fetch.sql` | T-1324 (D-176): player photos for players already in our records. |
| `1765836000000_national-competition-names.sql` | Persian names for the national-team competitions added on 2026-10-01 (T-1332, D-179; written by the agent at the maintainer's request, D-175). |
| `1765837000000_national-team-fa-names.sql` | Persian names for the national teams whose CLDR region name is not what a Persian football reader calls the side (T-1335; written by the agent at the maintainer's request, D-175). |
| `1765838000000_home-nations-fa-names.sql` | Persian names for the national teams whose country has no ISO code, so no CLDR name to fall back on (T-1337; written by the agent at the maintainer's request, D-175): the four home nations and Kosovo. |
| `1765839000000_repair-future-finished.sql` | A match a day or more ahead that the provider called finished (T-1348). |
| `1765840000000_viewing-default.sql` | T-1360 (D-181): a default broadcaster per competition and territory. |
| `1765841000000_season-feed-coverage.sql` | T-1364: whether the provider reports absences for a season at all. |
| `1765843000000_highlight-feed.sql` | T-1366 (D-184): verified match highlights from a licensed feed, Highlightly. |
| `1765844000000_gnews-source.sql` | T-1367 (D-185): English stories from GNews' free plan. |
| `1765847000000_season-fixture-poll.sql` | T-1371 (D-189): when a season's fixture list was last asked for, so the match page can say when a match was last checked, not only when its row last changed. |
| `1765848000000_persian-names-ultra.sql` | Persian names for the 20 competitions added on the API-Football Ultra plan on 2026-10-11 (T-1379, D-197; written by the agent at the maintainer's request, D-175). |
| `1765849000000_reask-duplicated-incidents.sql` | T-1382: ask again for the detail of every fixture whose timeline holds the same incident twice. |
| `1765850000000_english-focus.sql` | T-1391 (D-207): the English site for a reader abroad. 1. |
| `1765853000000_english-club-names.sql` | T-1395 (D-210): English display names for the big foreign clubs, in the form an English reader expects ("Bayern Munich", not the feed's "Bayern München"), beside the Iranian clubs' (T-1391, D-207). |
| `1765854000000_reask-repeated-incidents.sql` | T-1394 (D-209): ask again for the detail of every fixture whose timeline holds the same booking, sending-off or substitution twice. |
| `1765855000000_news-tagging.sql` | T-1396 (D-211): a story is filed under a team or competition only where its headline writes that name as a name, and a report the site already carries is shown once. |
| `1765856000000_lineup-grid.sql` | T-1397 (D-212): a starter's place in the side's shape, so the match centre can draw every formation on the pitch (4-2-3-1, 3-4-2-1, ...), not only the three-line ones T-1384 could place from the roles alone. |
| `1765857000000_person-name-fetch.sql` | T-1398 (D-213): full player names from the provider's player profile. |
| `1765860000000_news-team-context.sql` | T-1400 (D-215): a story is filed under a national team only where its headline writes the country as a football team, never under a men's team when it names women, never under the senior side when it names an age group,… |
| `1765861000000_english-club-names-more.sql` | T-1400 (D-215): English display names for the clubs D-210 (migration 1765853000000) left as the feed names them, in the competitions added since or not covered then: the Championship, the Scottish Premiership, the Belgi… |
| `1765864000000_news-links-leftovers.sql` | T-1411 (D-217): the news links D-215 (migration 1765860000000) reported as not handled. 1. "Jordan Pickford defiant amid threat to England No 1 spot" lost England: "to England" read as a place. |
| `1765865000000_club-colour.sql` | T-1416 (D-218): a club's colour, derived from the shirts it wore. |
| `1765866000000_kit-colour-fetch.sql` | T-1417 (D-218): the shirts of past matches, asked for once each. |
| `1765867000000_persian-club-names.sql` | Persian names for the clubs a Persian reader meets most outside the Pro League (T-1420; written by the agent at the maintainer's request, D-175): this season's clubs of the Premier League, La Liga, Serie A, the Bundesli… |
| `1765868000000_persian-club-names-europe.sql` | Persian names for this season's Champions League, Europa League and Championship clubs that T-1420 left in English (T-1421; written by the agent at the maintainer's request, D-175), read from production on 2026-10-20 (r… |
| `1765869000000_persian-club-names-cups.sql` | Persian names for this season's Conference League, DFB-Pokal and Coppa Italia clubs that T-1420 and T-1421 left in English (T-1423; written by the agent at the maintainer's request, D-175), read from production on 2026-… |
| `1765870000000_persian-club-names-fa-cup.sql` | Persian names for this season's FA Cup clubs that the earlier batches left in English, most of them from the National League and the non-league pyramid (T-1424; written by the agent at the maintainer's request, D-175),… |
| `1765871000000_persian-club-names-europe-leagues.sql` | Persian names for this season's Copa del Rey clubs and the clubs of the Belgian, Polish, Serbian, Croatian, Scottish, Austrian, Swiss, Danish, Greek and Czech top flights that the earlier batches left in English (T-1425… |
| `1765872000000_persian-club-names-world.sql` | Persian names for this season's last English-named clubs: the AFC Champions League Elite, MLS, the Brasileirão, the Argentine league, the Libertadores and the club friendlies (T-1426; written by the agent at the maintai… |
| `1765873000000_person-bio-squad-listing.sql` | T-1428 (D-220): the player data the provider already sends and we dropped. 1. |
| `1765875000000_channel-post-kinds.sql` | T-1430 (D-222): the public channel gets two more posts beside the day's forecasts (T-525) -- the previous day's results against the statistical model's last forecast before kick-off, and on Mondays the model's accuracy… |
| `1765876000000_player-season-stat.sql` | T-1431 (D-223): players' season totals and careers as the provider counts them. |
| `1765877000000_player-expected-goals.sql` | T-1432 (D-224): each player's expected goals in one match, from a source of its own. |
| `1765880000000_team-season-stat.sql` | T-1437 (D-228): teams' season statistics as the provider counts them. |
| `1765881000000_venue-club-referee.sql` | T-1438 (D-229): grounds, clubs and the referee, from the plan we pay for. 1. |
| `1765882000000_coaches.sql` | T-1439 (D-230): coaches -- their own id space, their careers, and the asks. 1. |
| `1765883000000_transfers.sql` | T-1440 (D-231): transfers, as the provider lists them. |
| `1765885000000_persian-national-team-names.sql` | Persian names for the senior men's national teams that had none (T-1443; written by the agent at the maintainer's request, D-175), read from production on 2026-10-21 (read-only): 178 of 189, the other 11 named by T-1335… |
| `1765890000000_news-fetch-finished-index.sql` | When the feeds were last read (T-1459): `lastFetchedAt` asks `max(finished_at)` over the finished reads on every news request -- the section, a match's, a team's, a player's -- and `news_fetch` gains a row per source pe… |
| `1765891000000_season-display-label.sql` | What a page calls a season (T-1483, D-256). |
| `1765892000000_fixture-half-time-break.sql` | The half-time interval of a live match (T-1551). |
| `1765893000000_repair-provider-id-zero.sql` | Provider id 0 (T-1600). API-Football writes 0 for a coach, player or venue it does not know, and the adapters took 0 as an id: the first unknown one seen was mapped to `0` (or `coach:0`), and every later unknown one res… |
| `1765894000000_country-flags.sql` | T-1611 (D-282): a country's flag is entity media like a crest (D-176). |
| `1765897000000_align-lineup-sides.sql` | Line-ups filed under the other team (T-1628, D-294). |
| `1765898000000_competition-model-training.sql` | Whether a competition's finished matches feed the model's training store (T-1649, D-304). |
| `1765899000000_training-fixture-stat.sql` | T-1647, D-305: each finished match's team statistics from our own records, in the training store, for the model-factor experiments (D-303): expected goals, shots and shots on target per side, copied from `fixture_stat`… |
| `1765899100000_training-fixture-lineup.sql` | T-1648, D-305: each finished match's line-ups and minutes from our own records, in the training store, for the regulars index of the model-factor experiments (T-1655, D-303): one row per player named on a side's line-up… |
| `1765899800000_persian-names-cups.sql` | Persian names for the ten cups added on 2026-10-29 for the model factors (T-1649, D-303, D-304; written by the agent at the maintainer's request, D-175). |
| `1765899900000_absence-history.sql` | T-1650 (D-306; D-303 point 4): past seasons' absences, for the training store only. |
| `1765900100000_season-conference.sql` | T-1667 (D-319): which conference each club of a season is in. |
| `1765900300000_incident-in-shootout.sql` | T-1673 (D-322): a penalty shoot-out's kicks are marked on the incident. |
| `1765900400000_fake-periods.sql` | T-1681 (D-327): scores of periods a match never had are removed. |
| `1765900500000_agents-console.sql` | The agents console (T-1696, D-340): `agents.traveltohormuz.ir`, for the maintainer and the teammate, apart from the site's members. |
| `1765900600000_placeholder-lineup-persons.sql` | T-1707 (D-342): line-up slots a feed labels "Trialist", "Unknown", "TBA" are not people. |
| `1765900700000_trim-team-names.sql` | T-1711 (str-2026-11-02-02): team names stored with a provider's padding. |
| `1765900830000_console-message.sql` | Chat with an agent in the agents console (T-1722, D-350). |

## packages/db/scripts

| File | What it is |
|---|---|
| `catalog.mjs` | The catalogue, as an operator sees it (T-029). docker compose run --rm migrate node scripts/catalog.mjs --list docker compose run --rm migrate node scripts/catalog.mjs --adopt-teams --dry-run Why this exists. |
| `grant-role.mjs` | Grant, revoke and list the roles a member holds (T-076). docker compose run --rm migrate node scripts/grant-role.mjs --list docker compose run --rm migrate node scripts/grant-role.mjs \ --email you@your-domain --role ad… |
| `highlightly-pairs.mjs` | Highlightly's teams paired with ours by matching kick-offs (T-1370, D-188). docker compose run --rm -v /tmp:/tmp migrate node scripts/highlightly-pairs.mjs docker compose run --rm -v /tmp:/tmp migrate node scripts/highl… |
| `viewing.mjs` | The editorial desk's watch listings, from a terminal (T-1360, D-181). docker compose run --rm -T migrate node scripts/viewing.mjs --list-defaults docker compose run --rm -T migrate node scripts/viewing.mjs --set-default… |

## packages/db/scripts/data

| File | What it is |
|---|---|
| `training-aliases.csv` | CSV data (fixture or reference). |

## packages/db/seed

| File | What it is |
|---|---|
| `001_catalog.sql` | Development seed: a small, real slice of the catalog. |
| `002_fixtures.sql` | Development seed: one finished fixture, so that match-centre work has a real row to read before ingestion exists. |
| `003_ingestion.sql` | Development seed for the ingestion tables. provider_mapping: API-Football's public identifiers for three seeded entities (league 39 = Premier League, team 33 = Manchester United, team 40 = Liverpool). |
| `004_training-aliases.sql` | Development seed: training-store names for the seeded English clubs, so the model service can forecast a seeded fixture once E0 is loaded (python -m fmip_model.training.load football-data --seasons 2425 --divisions E0). |
| `005_competition-divisions.sql` | Development seed: football-data.co.uk division codes for the seeded competitions the model can fit (E0 = Premier League; SP1 = La Liga). |
| `006_entity-aliases.sql` | Aliases for the seeded catalog (T-038): the spellings people type that the name itself does not carry. |
| `007_e2e-fixture.sql` | Development seed: one scheduled fixture far in the future, so that the prediction journey (T-080) has a match that is open to predict and never reaches kick-off. |

## packages/db/src

| File | What it is |
|---|---|
| `catalog-colour.spec.ts` | `catalog.mjs --set-colour` (T-1416, D-218): an editor's club colour, which the shirts' derivation never overwrites, and `none` to hand the club back to it -- audited with the reason and the colour before (rule 10). |
| `catalog-ignore.spec.ts` | `catalog.mjs --ignore` and `--unignore` against the real schema (T-1338): pending ids set aside with who and why, a resolved one left alone, the waiting national sides selected by the scope they were seen in, every row… |
| `catalog-national.spec.ts` | `catalog.mjs --adopt-national` against the real schema (T-1332, D-179): a team queued from an international competition is offered as a national team, adopted with the country the operator states, and a team queued from… |
| `catalog-order.spec.ts` | `catalog.mjs --set-order --locale` (T-1391, D-207): a language's own order of the competitions, kept apart from the default one (`display_order`), audited with the language and the place it had before (rule 10). |
| `catalog.spec.ts` | The refusals in `scripts/catalog.mjs` (T-029). |
| `founder-analysis.spec.ts` | What the founder-analysis migration guarantees (T-130). |
| `grant-role.spec.ts` | The refusals in `scripts/grant-role.mjs` (T-076). |
| `highlightly-pairs.spec.ts` | `scripts/highlightly-pairs.mjs` (T-1370): Highlightly's teams paired with ours by matching kick-offs, for a person to confirm. |
| `index.ts` | Where the migration files live. Resolved from this file so it is correct whether the package is used from source or from `dist`. |
| `migrations.spec.ts` | Tests for `migrations`. |
| `season-display-label.spec.ts` | `season_display_label` (T-1483, D-256): a season played within one calendar year is shown by its year; every other label is shown as stored. |
| `seed.spec.ts` | Tests for `seed`. |
| `seed.ts` | Where the seed files live. Resolved from this file so it is correct whether the package is used from source or from `dist`. |
| `trim-team-names.spec.ts` | Migration `1765900700000_trim-team-names.sql` against the real schema (T-1711, str-2026-11-02-02): a team name stored with the provider's padding is tidied, a tidy one is left alone. |
| `viewing-cli.spec.ts` | The refusals in `scripts/viewing.mjs` (T-1360): the desk's listings from a terminal. |

## packages/ingestion

| File | What it is |
|---|---|
| `eslint.config.mjs` | Eslint configuration. |
| `package.json` | Package `@fmip/ingestion`: Provider adapters, the normalised model they produce, and the recorded-fixture contract harness that verifies them.: scripts and dependencies. |
| `tsconfig.build.json` | TypeScript compiler settings. |
| `tsconfig.json` | TypeScript compiler settings. |
| `vitest.config.mts` | Vitest configuration. |

## packages/ingestion/bakeoff

| File | What it is |
|---|---|
| `2026-09-10T19-24-40-280Z-recorded.json` | JSON data or settings. |
| `2026-09-10T19-40-32-482Z-live.json` | JSON data or settings. |
| `2026-09-11T05-04-31-338Z-live.json` | JSON data or settings. |

## packages/ingestion/scripts

| File | What it is |
|---|---|
| `bakeoff.mjs` | — |
| `record.mjs` | — |

## packages/ingestion/scripts/plans

| File | What it is |
|---|---|
| `api-football.mjs` | What to record from API-Football on the free plan (T-021). |
| `bakeoff.mjs` | The live bake-off's fixture set (T-024). The protocol asks for twenty matches across the five target leagues plus the Champions League over seven days; the free plans serve past seasons only (API-Football: 2022–2024), s… |
| `football-data-org.mjs` | What to record from football-data.org on the free tier (T-022). |
| `highlightly.mjs` | What to record from Highlightly on the BASIC plan (T-023): the same Premier League 2023/24 fixtures as the other two providers (league 33973). |

## packages/ingestion/src

| File | What it is |
|---|---|
| `country-name.ts` | How two spellings of a country's name compare (T-1428, D-220): lower case, no accents, every run of anything but letters and digits one space, so "Côte d'Ivoire", "Cote-d’Ivoire" and "COTE D IVOIRE" are one name. |
| `index.ts` | The provider-neutral model every adapter produces. |
| `normalised.ts` | The provider-neutral shapes every adapter produces (rule 2 in CLAUDE.md: nothing provider-specific crosses this boundary). |
| `placeholder-name.spec.ts` | Tests for `placeholder-name`. |
| `placeholder-name.ts` | Labels a feed prints in a line-up slot in place of a player's name (T-1707, D-342): "Trialist" for a club's unnamed trialist, "Unknown", "TBA" and the like. |
| `transfer-window.ts` | How often a club's or a player's transfers are asked for again (T-1440, D-231): weekly while a transfer window is open, monthly otherwise. |

## packages/ingestion/src/adapters

| File | What it is |
|---|---|
| `_absence-reason.ts` | The words a provider gives for an absence, as our code (T-1601, rule 2). |
| `_contract.ts` | The interface every provider adapter implements (02-architecture.md, "The adapter layer"). |
| `_group.ts` | A group's own name from the label a provider gives one of its tables (T-1333): "Group A" → "A", "League A - Group 1" → "1", "GROUP_B" read as "Group B" → "B". |
| `_incident-detail.ts` | A provider's incident detail in our words (T-1378, D-196, rule 2). |
| `_name.ts` | A team's, competition's or venue's name as a provider wrote it, made tidy (T-1711): leading and trailing whitespace dropped, runs of whitespace inside collapsed to one space. |
| `absence-reason.spec.ts` | T-1601: every reason API-Football gave on production (2026-10-26, 56 texts over 3,415 absences) in our words, so a Persian page never shows the provider's English. |
| `incident-detail.spec.ts` | T-1378 (rule 2): a provider's incident text never reaches a page. |

## packages/ingestion/src/adapters/_fixtures

| File | What it is |
|---|---|
| `README.md` | Recorded provider responses |

## packages/ingestion/src/adapters/_fixtures/api-football

| File | What it is |
|---|---|
| `availability-burnley-man-city.json` | JSON data or settings. |
| `detail-burnley-man-city.json` | JSON data or settings. |
| `lineup-burnley-man-city.json` | JSON data or settings. |
| `list-fixtures-opening-weekend.json` | JSON data or settings. |
| `list-fixtures-season-not-on-plan.json` | JSON data or settings. |
| `live-all-now.json` | JSON data or settings. |
| `standings-final-table.json` | JSON data or settings. |

## packages/ingestion/src/adapters/_fixtures/api-football-coachs

| File | What it is |
|---|---|
| `coachs-id-4.json` | JSON data or settings. |
| `coachs-team-manchester-city.json` | JSON data or settings. |

## packages/ingestion/src/adapters/_fixtures/api-football-team-statistics

| File | What it is |
|---|---|
| `fa-cup-2024-manchester-united.json` | JSON data or settings. |
| `premier-league-2020-manchester-united.json` | JSON data or settings. |
| `premier-league-2025-manchester-united.json` | JSON data or settings. |

## packages/ingestion/src/adapters/_fixtures/api-football-transfers

| File | What it is |
|---|---|
| `transfers-haaland.json` | JSON data or settings. |
| `transfers-man-city.json` | JSON data or settings. |

## packages/ingestion/src/adapters/_fixtures/football-data-org

| File | What it is |
|---|---|
| `detail-burnley-man-city.json` | JSON data or settings. |
| `lineup-not-on-free-tier.json` | JSON data or settings. |
| `list-fixtures-competition-not-on-tier.json` | JSON data or settings. |
| `list-fixtures-opening-weekend.json` | JSON data or settings. |
| `live-by-ids-finished.json` | JSON data or settings. |
| `standings-final-table.json` | JSON data or settings. |

## packages/ingestion/src/adapters/_fixtures/highlightly

| File | What it is |
|---|---|
| `detail-burnley-man-city.json` | JSON data or settings. |
| `detail-unknown-match.json` | JSON data or settings. |
| `lineup-empty-on-plan.json` | JSON data or settings. |
| `list-fixtures-opening-weekend.json` | JSON data or settings. |
| `live-by-ids-one-unknown.json` | JSON data or settings. |
| `standings-final-table.json` | JSON data or settings. |

## packages/ingestion/src/adapters/_fixtures/highlightly-box-score

| File | What it is |
|---|---|
| `box-score-juventus-lazio.json` | JSON data or settings. |
| `matches-serie-a-2026-10-18.json` | JSON data or settings. |

## packages/ingestion/src/adapters/api-football

| File | What it is |
|---|---|
| `api-football.spec.ts` | T-1376. Before a line-up is announced, `/fixtures?id=` answers with the fixture and an empty `lineups`. That is the recorded line-up answer with its line-ups taken out, so no hand-written recording is needed. |
| `club-facts.spec.ts` | Tests for `club-facts`. |
| `club-facts.ts` | API-Football's teams and venues (T-1438, D-229): `/teams?league=&season=` lists every team of a competition's season with its founding year and its home ground, and `/venues?id=` describes one ground. |
| `coaches.spec.ts` | Tests for `coaches`. |
| `coaches.ts` | API-Football `/coachs?team=` → the normalised model (T-1439, D-230), and the coach id space. |
| `index.ts` | API-Football adapter (T-021): api-sports.io v3, written against the free plan (100 requests/day, 10/minute, seasons limited to the plan's window). |
| `map.ts` | API-Football (api-sports.io, v3) → the normalised model. |
| `nationality.ts` | API-Football's spellings of a nationality that differ from the name our `country` row carries, each to its FIFA trigram (T-1428, D-220). |
| `player-seasons.spec.ts` | Tests for `player-seasons`. |
| `player-seasons.ts` | API-Football `/players?id=&season=` and `/players/teams?player=` → the normalised model (T-1431, D-223). |
| `rate-limit.spec.ts` | Tests for `rate-limit`. |
| `season-absences.spec.ts` | T-1650 (D-306): a season's absences in one answer, for the training store. |
| `team-statistics.spec.ts` | Tests for `team-statistics`. |
| `team-statistics.ts` | API-Football `/teams/statistics?league=&season=&team=` → the normalised model (T-1437, D-228). |
| `transfers.spec.ts` | Tests for `transfers`. |
| `transfers.ts` | API-Football `/transfers?team=` and `/transfers?player=` → the normalised model (T-1440, D-231). |

## packages/ingestion/src/adapters/football-data-org

| File | What it is |
|---|---|
| `football-data-org.spec.ts` | Tests for `football-data-org`. |
| `index.ts` | football-data.org adapter (T-022): v4, written against the free tier (TIER_ONE: twelve competitions, 10 requests/minute, delayed scores; lineups, bookings and substitutions are paid and therefore `unsupported` here). |
| `map.ts` | football-data.org (v4) → the normalised model. |

## packages/ingestion/src/adapters/highlightly

| File | What it is |
|---|---|
| `box-score.spec.ts` | Tests for `box-score`. |
| `box-score.ts` | Highlightly's per-player box score (T-1432, D-224): `GET /box-score/{id}`, and `GET /matches` to find that id for one of our matches. |
| `highlightly.spec.ts` | Tests for `highlightly`. |
| `highlights.spec.ts` | Tests for `highlights`. |
| `highlights.ts` | Highlightly's highlights (T-1366, D-184): `GET /highlights` and `GET /highlights/geo-restrictions/{id}` on the same host and headers as the match adapter. |
| `index.ts` | Highlightly adapter (T-023): the Football API product at soccer.highlightly.net (T-1392, D-208; it was the All Sports route sports.highlightly.net/football until the maintainer chose the Football API Pro plan, 7,500 req… |
| `map.ts` | Highlightly (soccer.highlightly.net) → the normalised model. |

## packages/ingestion/src/adapters/replay

| File | What it is |
|---|---|
| `index.ts` | The replay source (T-026, D-049). Not a fourth provider: a way to run a real adapter with no key, no network and no terms. It builds the adapter under test with a `ReplayTransport` over that provider's committed recordi… |
| `plan.ts` | What the committed recordings actually contain. |
| `replay.spec.ts` | Tests for `replay`. |

## packages/ingestion/src/bakeoff

| File | What it is |
|---|---|
| `bakeoff.spec.ts` | Tests for `bakeoff`. |
| `metrics.ts` | The bake-off's measurements (05-data-providers.md, "The bake-off protocol"). |
| `report.ts` | The bake-off's results table, written into `docs/05-data-providers.md` between two markers so a rerun replaces the previous table and touches nothing else in the file (T-024's acceptance criterion). |
| `run.ts` | Runs the three adapters over the same fixture set and measures them (T-024). |
| `timed-transport.spec.ts` | A `fetch` that never answers until its signal aborts. |

## packages/ingestion/src/harness

| File | What it is |
|---|---|
| `contract-check.spec.ts` | A conforming adapter, or a broken one when given a tweak. |
| `contract-check.ts` | One recorded scenario: a contract call, its arguments, the responses the provider gave, and what a conforming adapter must make of them. |
| `replay-transport.ts` | One recorded exchange. Stored under `adapters/_fixtures/<provider>/`. |
| `validate.ts` | Structural validation of normalised shapes and adapter manifests. |

## packages/ingestion/src/news

| File | What it is |
|---|---|
| `feed-images.spec.ts` | News photos in a feed (T-1322, D-177), against a recording of Mehr's Iranian-football feed (`_recorded/mehrnews-rss-tp24.xml`, trimmed) and format samples for the other places a feed puts a photo. |
| `feed.spec.ts` | The feed reader (T-142) against the two formats publishers actually use. |
| `feed.ts` | A publisher's feed → normalised news items (T-142, D-061). |
| `gnews.spec.ts` | The GNews reader (T-1367, D-185). The sample below is written for the spec in the shape GNews documents for API v4 (`totalArticles`, `articles[]` with `title`, `description`, `content`, `url`, `image`, `publishedAt`, `l… |
| `gnews.ts` | GNews (gnews.io, API v4) -> normalised news items (T-1367, D-185). |
| `image-file.spec.ts` | Minimal headers of each accepted format, built byte by byte (T-1322). |
| `image-file.ts` | What a downloaded news photo is, read from its own bytes (T-1322, D-177). |
| `image-provenance.spec.ts` | Whether a photo is the agency's own (T-1322, D-177), against two recorded article pages -- Mehr's lead photo with no other credit, and Tehran Times republishing an AFP/Getty photo -- and samples for the rest. |
| `image-provenance.ts` | Whether a news photo is the agency's own (T-1322, D-177). |
| `non-article.spec.ts` | Items that are not articles (T-1396, D-211). |
| `non-article.ts` | Items a feed carries that are not articles (T-1396, D-211): a page whose headline says it is a running ticker, a guide to where a match can be watched or heard, or a betting offer. |
| `other-code.spec.ts` | Items about another code of football (T-1400, D-215). |
| `other-code.ts` | Items about another sport that shares the word "football" (T-1400, D-215). |

## packages/ingestion/src/news/_recorded

| File | What it is |
|---|---|
| `mehrnews-article-6963958.html` | Saved page or feed used as a test fixture. |
| `mehrnews-rss-tp24.xml` | Saved page or feed used as a test fixture. |
| `tehrantimes-article-530610.html` | Saved page or feed used as a test fixture. |

## scripts

| File | What it is |
|---|---|
| `check-dev-stack.sh` | Brings the local stack up and proves both services actually answer. |
| `dev-proxy.sh` | Runs a small forward proxy in Docker so that tooling on the development host can reach registries the host itself cannot. |
| `file-index.mjs` | Writes docs/17-file-index.md: every tracked file, grouped by folder, with one line on what it is (T-1701). |
| `model-backtest.sh` | Backtests a proposed model candidate against the published version and the current candidate (T-1368, D-186). |
| `model-lab-setup.sh` | Build (or rebuild) the lab store, `fmip_lab` (T-1646, D-303): a copy of the `training` schema on the production Postgres, for experiments that load more history than the published version fits on. |
| `public-preview.sh` | A public HTTPS address for the development stack, with no domain, no account and no port forward (T-085, D-050). bash scripts/public-preview.sh start # stack + tunnel, prints the URL bash scripts/public-preview.sh statu… |

## scripts/backup

| File | What it is |
|---|---|
| `backup.sh` | Dumps the FMIP database, writes a manifest the restore drill can check against, copies both off-provider, and prunes old copies (T-072, D-032). bash scripts/backup/backup.sh Runs anywhere the compose stack runs: the VPS… |
| `fmip-backup.service` | systemd unit for the VPS (T-072). Install with fmip-backup.timer: sudo cp scripts/backup/fmip-backup.{service,timer} /etc/systemd/system/ sudo systemctl daemon-reload sudo systemctl enable --now fmip-backup.timer system… |
| `fmip-backup.timer` | Runs fmip-backup.service daily at 03:30 UTC, the quietest hour for European football, and catches up after a reboot (Persistent). |
| `fmip-restore-drill.service` | systemd unit for the VPS (T-805, D-101). Install with fmip-restore-drill.timer: sudo cp scripts/backup/fmip-restore-drill.{service,timer} /etc/systemd/system/ sudo systemctl daemon-reload sudo systemctl enable --now fmi… |
| `fmip-restore-drill.timer` | Runs fmip-restore-drill.service on the first Monday of each month at 04:40 UTC (D-032's monthly drill, T-805): an hour after the daily backup (03:30 plus up to ten minutes of jitter), so the dump it restores is that mor… |
| `fmip-wal-ship.service` | systemd unit for the VPS (T-845, D-157). Install with fmip-wal-ship.timer: sudo cp scripts/backup/fmip-wal-ship.{service,timer} /etc/systemd/system/ sudo systemctl daemon-reload sudo systemctl enable --now fmip-wal-ship… |
| `fmip-wal-ship.timer` | Runs fmip-wal-ship.service every five minutes (T-845). |
| `lib.sh` | Shared by backup.sh and restore-drill.sh (T-072, T-805). |
| `pitr.sh` | Point-in-time recovery (T-845, D-157): Postgres's own WAL archiving, shipped through the same rclone crypt remote as the daily dumps. |
| `pull-copy.sh` | A complete copy of FMIP on the maintainer's own machine (T-1341): bash scripts/backup/pull-copy.sh [destination] destination: the argument, else FMIP_COPY_DIR, else ../fmip-copy. |
| `restore-drill.sh` | Restores a dump into a throwaway Postgres and proves the copy is whole: checksum, every migration, and the exact row count of every table must match the manifest written at dump time (T-072, D-032). bash scripts/backup/… |
| `wal-archive.sh` | Postgres's archive_command (T-845, D-157). |

## scripts/dev-proxy

| File | What it is |
|---|---|
| `squid.conf` | Forward proxy for the development host (see scripts/dev-proxy.sh). |
