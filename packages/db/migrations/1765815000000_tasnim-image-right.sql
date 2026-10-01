-- Up Migration
-- Tasnim's image right (T-1322, D-177). 1765810000000 matched Tasnim by the
-- host tasnimnews.com, but the source we carry reads its feed from
-- tasnimnews.ir, so the statement updated no row in production. Same right,
-- same credit, matched by the host the feed actually uses; photos may come
-- from either host and their subdomains (newsmedia.tasnimnews.ir).

UPDATE news_source
   SET image_licence = 'cc-by-4.0',
       image_licence_url = 'https://creativecommons.org/licenses/by/4.0/',
       image_credit = 'Tasnim News Agency',
       image_hosts = ARRAY['tasnimnews.ir', 'tasnimnews.com']
 WHERE feed_url ~* '^https?://([a-z0-9-]+\.)*tasnimnews\.ir(:[0-9]+)?(/|$)'
   AND image_licence IS NULL;

-- Down Migration

UPDATE news_source
   SET image_licence = NULL,
       image_licence_url = NULL,
       image_credit = NULL,
       image_hosts = NULL
 WHERE feed_url ~* '^https?://([a-z0-9-]+\.)*tasnimnews\.ir(:[0-9]+)?(/|$)';
