-- Up Migration
-- T-254: a public panel post announces itself the way a goal does.
--
-- Every write that changes what a match page shows raises `fixture_change`
-- (T-032, D-034), and the API's stream turns that into a push to every open
-- page. Panel posts (T-251) hang off a fixture and did not raise it, so a
-- reader of a live match's discussion saw new posts on reload -- honest, the
-- page never claimed to be live, but not blueprint 19's "public messages
-- arrive in real time" (D-068).
--
-- `notify_fixture_change()` already reads `NEW.fixture_id` for any table that
-- is not `fixture`, `lineup` or `fixture_stat`, which is exactly the column
-- `panel_post` has. Nothing else changes: the payload names the table, and the
-- stream decides what a change to `panel_post` means -- a `panel` event, not a
-- match-centre snapshot, because the panel is not in the snapshot.
CREATE TRIGGER panel_post_notify_change
  AFTER INSERT OR UPDATE OR DELETE ON panel_post
  FOR EACH ROW EXECUTE FUNCTION notify_fixture_change();

-- Down Migration
DROP TRIGGER panel_post_notify_change ON panel_post;
