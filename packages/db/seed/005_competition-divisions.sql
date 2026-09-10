-- Development seed: football-data.co.uk division codes for the seeded
-- competitions the model can fit (E0 = Premier League; SP1 = La Liga). The
-- others are left NULL on purpose: the model says "competition_not_mapped"
-- for them rather than guessing.

UPDATE competition SET football_data_division = 'E0'
 WHERE id = '00000000-0000-4000-8000-000000000201' AND football_data_division IS DISTINCT FROM 'E0';
UPDATE competition SET football_data_division = 'SP1'
 WHERE id = '00000000-0000-4000-8000-000000000202' AND football_data_division IS DISTINCT FROM 'SP1';
