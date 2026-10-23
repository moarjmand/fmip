-- Up Migration
-- What a page calls a season (T-1483, D-256). A season's stored label is
-- "2026/27" for every competition, because the catalogue and the feed name
-- seasons by their start year and the label identifies the season to both.
-- A competition played within one calendar year -- Libertadores, Brasileirão,
-- MLS, a league in Argentina or Scandinavia, the Asian Cup -- is then shown as
-- "2026/27" when its season is 2026. The pages show the year alone for a
-- season that starts in January to May of its label's own year; a European
-- season starts from July (its qualifiers included), and a split season such
-- as the Pro League's from August, so both keep their two years. The stored
-- label is unchanged.
CREATE FUNCTION season_display_label(label text, start_date date) RETURNS text
  LANGUAGE sql IMMUTABLE PARALLEL SAFE
  RETURN CASE
    WHEN label ~ '^\d{4}/\d{2}$'
      AND extract(month FROM start_date) <= 5
      AND substr(label, 1, 4)::int = extract(year FROM start_date)::int
    THEN substr(label, 1, 4)
    ELSE label
  END;

-- Down Migration
DROP FUNCTION season_display_label(text, date);
