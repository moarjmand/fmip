-- Up Migration
-- Tasnim serves its photos from its own media host, newsmedia.tasnimmedia.com
-- (measured on 2026-10-01: all four photos of the first fetch after D-177
-- went live were refused as "not one of the agency's own hosts"). Added to the
-- hosts its image right accepts (T-1322, D-177); subdomains match as before.

UPDATE news_source
   SET image_hosts = ARRAY['tasnimnews.ir', 'tasnimnews.com', 'tasnimmedia.com']
 WHERE feed_url ~* '^https?://([a-z0-9-]+\.)*tasnimnews\.ir(:[0-9]+)?(/|$)'
   AND image_licence = 'cc-by-4.0';

-- Down Migration

UPDATE news_source
   SET image_hosts = ARRAY['tasnimnews.ir', 'tasnimnews.com']
 WHERE feed_url ~* '^https?://([a-z0-9-]+\.)*tasnimnews\.ir(:[0-9]+)?(/|$)'
   AND image_licence = 'cc-by-4.0';
