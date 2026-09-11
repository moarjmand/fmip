-- Aliases for the seeded catalog (T-038): the spellings people type that the
-- name itself does not carry. Fixed ids so re-running converges.

INSERT INTO entity_alias (id, entity_type, entity_id, alias, language, kind, source) VALUES
  -- Manchester United
  ('00000000-0000-4000-8000-000000000e01', 'team', '00000000-0000-4000-8000-000000000601', 'Man Utd', NULL, 'abbreviation', 'seed'),
  ('00000000-0000-4000-8000-000000000e02', 'team', '00000000-0000-4000-8000-000000000601', 'Manchester Utd', NULL, 'abbreviation', 'seed'),
  ('00000000-0000-4000-8000-000000000e03', 'team', '00000000-0000-4000-8000-000000000601', 'منچستر یونایتد', 'fa', 'transliteration', 'seed'),
  -- Liverpool
  ('00000000-0000-4000-8000-000000000e04', 'team', '00000000-0000-4000-8000-000000000602', 'لیورپول', 'fa', 'transliteration', 'seed'),
  ('00000000-0000-4000-8000-000000000e05', 'team', '00000000-0000-4000-8000-000000000602', 'The Reds', 'en', 'alias', 'seed'),
  -- Real Madrid
  ('00000000-0000-4000-8000-000000000e06', 'team', '00000000-0000-4000-8000-000000000603', 'Real', NULL, 'abbreviation', 'seed'),
  ('00000000-0000-4000-8000-000000000e07', 'team', '00000000-0000-4000-8000-000000000603', 'Los Blancos', 'es', 'alias', 'seed'),
  ('00000000-0000-4000-8000-000000000e08', 'team', '00000000-0000-4000-8000-000000000603', 'رئال مادرید', 'fa', 'transliteration', 'seed'),
  -- Persepolis
  ('00000000-0000-4000-8000-000000000e09', 'team', '00000000-0000-4000-8000-000000000604', 'پرسپولیس', 'fa', 'transliteration', 'seed'),
  ('00000000-0000-4000-8000-000000000e0a', 'team', '00000000-0000-4000-8000-000000000604', 'Perspolis', NULL, 'misspelling', 'seed'),
  ('00000000-0000-4000-8000-000000000e0b', 'team', '00000000-0000-4000-8000-000000000604', 'Piroozi', NULL, 'former_name', 'seed'),
  -- Esteghlal
  ('00000000-0000-4000-8000-000000000e0c', 'team', '00000000-0000-4000-8000-000000000605', 'استقلال', 'fa', 'transliteration', 'seed'),
  ('00000000-0000-4000-8000-000000000e0d', 'team', '00000000-0000-4000-8000-000000000605', 'Taj', NULL, 'former_name', 'seed'),
  ('00000000-0000-4000-8000-000000000e0e', 'team', '00000000-0000-4000-8000-000000000605', 'Esteqlal', NULL, 'misspelling', 'seed'),
  -- England, Iran
  ('00000000-0000-4000-8000-000000000e0f', 'team', '00000000-0000-4000-8000-000000000606', 'Three Lions', 'en', 'alias', 'seed'),
  ('00000000-0000-4000-8000-000000000e10', 'team', '00000000-0000-4000-8000-000000000607', 'تیم ملی ایران', 'fa', 'transliteration', 'seed'),
  ('00000000-0000-4000-8000-000000000e11', 'team', '00000000-0000-4000-8000-000000000607', 'Team Melli', NULL, 'alias', 'seed'),
  -- Competitions
  ('00000000-0000-4000-8000-000000000e12', 'competition', '00000000-0000-4000-8000-000000000201', 'EPL', NULL, 'abbreviation', 'seed'),
  ('00000000-0000-4000-8000-000000000e13', 'competition', '00000000-0000-4000-8000-000000000201', 'لیگ برتر انگلیس', 'fa', 'transliteration', 'seed'),
  ('00000000-0000-4000-8000-000000000e14', 'competition', '00000000-0000-4000-8000-000000000202', 'LaLiga', NULL, 'alias', 'seed'),
  ('00000000-0000-4000-8000-000000000e15', 'competition', '00000000-0000-4000-8000-000000000202', 'Primera Division', 'es', 'former_name', 'seed'),
  ('00000000-0000-4000-8000-000000000e16', 'competition', '00000000-0000-4000-8000-000000000202', 'لالیگا', 'fa', 'transliteration', 'seed'),
  ('00000000-0000-4000-8000-000000000e17', 'competition', '00000000-0000-4000-8000-000000000203', 'لیگ برتر خلیج فارس', 'fa', 'transliteration', 'seed'),
  ('00000000-0000-4000-8000-000000000e18', 'competition', '00000000-0000-4000-8000-000000000203', 'Iran Pro League', NULL, 'alias', 'seed'),
  ('00000000-0000-4000-8000-000000000e19', 'competition', '00000000-0000-4000-8000-000000000205', 'Champions League', NULL, 'alias', 'seed'),
  ('00000000-0000-4000-8000-000000000e1a', 'competition', '00000000-0000-4000-8000-000000000205', 'لیگ قهرمانان اروپا', 'fa', 'transliteration', 'seed'),
  ('00000000-0000-4000-8000-000000000e1b', 'competition', '00000000-0000-4000-8000-000000000206', 'World Cup', NULL, 'abbreviation', 'seed'),
  ('00000000-0000-4000-8000-000000000e1c', 'competition', '00000000-0000-4000-8000-000000000206', 'جام جهانی', 'fa', 'transliteration', 'seed'),
  -- People
  ('00000000-0000-4000-8000-000000000e1d', 'person', '00000000-0000-4000-8000-000000000701', 'Mo Salah', NULL, 'alias', 'seed'),
  ('00000000-0000-4000-8000-000000000e1e', 'person', '00000000-0000-4000-8000-000000000701', 'محمد صلاح', 'fa', 'transliteration', 'seed'),
  ('00000000-0000-4000-8000-000000000e1f', 'person', '00000000-0000-4000-8000-000000000702', 'Bruno', NULL, 'abbreviation', 'seed'),
  ('00000000-0000-4000-8000-000000000e20', 'person', '00000000-0000-4000-8000-000000000702', 'برونو فرناندز', 'fa', 'transliteration', 'seed'),
  ('00000000-0000-4000-8000-000000000e21', 'person', '00000000-0000-4000-8000-000000000703', 'VVD', NULL, 'abbreviation', 'seed'),
  ('00000000-0000-4000-8000-000000000e22', 'person', '00000000-0000-4000-8000-000000000703', 'فان دایک', 'fa', 'transliteration', 'seed')
ON CONFLICT (id) DO UPDATE
  SET entity_type = EXCLUDED.entity_type,
      entity_id = EXCLUDED.entity_id,
      alias = EXCLUDED.alias,
      language = EXCLUDED.language,
      kind = EXCLUDED.kind,
      source = EXCLUDED.source;
