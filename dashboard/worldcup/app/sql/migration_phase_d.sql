-- Phase D migration — 15-minute pre-kickoff lock + seed all 104 matches
-- Run in Supabase SQL Editor after the base schema.sql + migration_phase_c.sql.

-- 1) Harden wc_tips RLS: lock 15 minutes BEFORE kickoff
DROP POLICY IF EXISTS wc_tips_insert_own ON wc_tips;
DROP POLICY IF EXISTS wc_tips_update_own ON wc_tips;

CREATE POLICY wc_tips_insert_own ON wc_tips FOR INSERT WITH CHECK (
  user_id IN (SELECT id FROM wc_users WHERE auth_id = auth.uid())
  AND COALESCE(
        (SELECT kickoff_utc FROM wc_matches WHERE id = match_id),
        '9999-12-31'::timestamptz
      ) > NOW() + INTERVAL '15 minutes'
);

CREATE POLICY wc_tips_update_own ON wc_tips FOR UPDATE USING (
  user_id IN (SELECT id FROM wc_users WHERE auth_id = auth.uid())
  AND COALESCE(
        (SELECT kickoff_utc FROM wc_matches WHERE id = match_id),
        '9999-12-31'::timestamptz
      ) > NOW() + INTERVAL '15 minutes'
);

-- 2) Seed all 104 matches (idempotent via ON CONFLICT)
--    Team codes match wc_countries (e.g. ENG, SCO, BA, CZ). KO matches use 'TBD'.
INSERT INTO wc_matches (id, phase, group_letter, team_home, team_away, kickoff_utc, multiplier) VALUES
-- GROUP A
( 1,'group','A','MX','ZA','2026-06-11 19:00+00',1),
( 2,'group','A','KR','CZ','2026-06-12 02:00+00',1),
( 3,'group','A','CZ','ZA','2026-06-18 16:00+00',1),
( 4,'group','A','MX','KR','2026-06-19 01:00+00',1),
( 5,'group','A','ZA','KR','2026-06-25 01:00+00',1),
( 6,'group','A','CZ','MX','2026-06-25 01:00+00',1),
-- GROUP B
( 7,'group','B','CA','BA','2026-06-12 19:00+00',1),
( 8,'group','B','QA','CH','2026-06-13 19:00+00',1),
( 9,'group','B','CH','BA','2026-06-18 19:00+00',1),
(10,'group','B','CA','QA','2026-06-18 22:00+00',1),
(11,'group','B','CH','CA','2026-06-24 19:00+00',1),
(12,'group','B','BA','QA','2026-06-24 19:00+00',1),
-- GROUP C
(13,'group','C','BR','MA','2026-06-13 22:00+00',1),
(14,'group','C','HT','SCO','2026-06-14 01:00+00',1),
(15,'group','C','SCO','MA','2026-06-19 22:00+00',1),
(16,'group','C','BR','HT','2026-06-20 00:30+00',1),
(17,'group','C','MA','HT','2026-06-24 22:00+00',1),
(18,'group','C','SCO','BR','2026-06-24 22:00+00',1),
-- GROUP D
(19,'group','D','US','PY','2026-06-13 01:00+00',1),
(20,'group','D','AU','TR','2026-06-14 04:00+00',1),
(21,'group','D','US','AU','2026-06-19 19:00+00',1),
(22,'group','D','TR','PY','2026-06-20 03:00+00',1),
(23,'group','D','TR','US','2026-06-26 02:00+00',1),
(24,'group','D','PY','AU','2026-06-26 02:00+00',1),
-- GROUP E
(25,'group','E','DE','CW','2026-06-14 17:00+00',1),
(26,'group','E','CI','EC','2026-06-15 23:00+00',1),
(27,'group','E','DE','CI','2026-06-20 20:00+00',1),
(28,'group','E','EC','CW','2026-06-21 00:00+00',1),
(29,'group','E','CW','CI','2026-06-25 20:00+00',1),
(30,'group','E','EC','DE','2026-06-25 20:00+00',1),
-- GROUP F
(31,'group','F','NL','JP','2026-06-14 20:00+00',1),
(32,'group','F','SE','TN','2026-06-15 02:00+00',1),
(33,'group','F','NL','SE','2026-06-20 17:00+00',1),
(34,'group','F','TN','JP','2026-06-21 04:00+00',1),
(35,'group','F','TN','NL','2026-06-25 23:00+00',1),
(36,'group','F','JP','SE','2026-06-25 23:00+00',1),
-- GROUP G
(37,'group','G','BE','EG','2026-06-15 19:00+00',1),
(38,'group','G','IR','NZ','2026-06-16 01:00+00',1),
(39,'group','G','BE','IR','2026-06-21 19:00+00',1),
(40,'group','G','NZ','EG','2026-06-22 01:00+00',1),
(41,'group','G','NZ','BE','2026-06-27 03:00+00',1),
(42,'group','G','EG','IR','2026-06-27 03:00+00',1),
-- GROUP H
(43,'group','H','ES','CV','2026-06-15 16:00+00',1),
(44,'group','H','SA','UY','2026-06-15 22:00+00',1),
(45,'group','H','ES','SA','2026-06-21 16:00+00',1),
(46,'group','H','UY','CV','2026-06-21 22:00+00',1),
(47,'group','H','CV','SA','2026-06-27 00:00+00',1),
(48,'group','H','UY','ES','2026-06-27 00:00+00',1),
-- GROUP I
(49,'group','I','FR','SN','2026-06-16 19:00+00',1),
(50,'group','I','IQ','NO','2026-06-16 22:00+00',1),
(51,'group','I','FR','IQ','2026-06-22 21:00+00',1),
(52,'group','I','NO','SN','2026-06-23 00:00+00',1),
(53,'group','I','NO','FR','2026-06-26 19:00+00',1),
(54,'group','I','SN','IQ','2026-06-26 19:00+00',1),
-- GROUP J
(55,'group','J','AR','DZ','2026-06-17 01:00+00',1),
(56,'group','J','AT','JO','2026-06-17 04:00+00',1),
(57,'group','J','AR','AT','2026-06-22 17:00+00',1),
(58,'group','J','JO','DZ','2026-06-23 03:00+00',1),
(59,'group','J','DZ','AT','2026-06-29 02:00+00',1),
(60,'group','J','JO','AR','2026-06-29 02:00+00',1),
-- GROUP K
(61,'group','K','PT','CD','2026-06-17 17:00+00',1),
(62,'group','K','UZ','CO','2026-06-18 03:00+00',1),
(63,'group','K','PT','UZ','2026-06-23 17:00+00',1),
(64,'group','K','CO','CD','2026-06-24 02:00+00',1),
(65,'group','K','CO','PT','2026-06-28 23:30+00',1),
(66,'group','K','CD','UZ','2026-06-28 23:30+00',1),
-- GROUP L
(67,'group','L','ENG','HR','2026-06-17 20:00+00',1),
(68,'group','L','GH','PA','2026-06-17 23:00+00',1),
(69,'group','L','ENG','GH','2026-06-23 20:00+00',1),
(70,'group','L','PA','HR','2026-06-23 23:00+00',1),
(71,'group','L','PA','ENG','2026-06-27 21:00+00',1),
(72,'group','L','HR','GH','2026-06-27 21:00+00',1),
-- ROUND OF 32 (16 matches, dates approx — refined later from football-data API)
(73,'r32',NULL,'TBD','TBD','2026-06-29 19:00+00',2),
(74,'r32',NULL,'TBD','TBD','2026-06-30 17:00+00',2),
(75,'r32',NULL,'TBD','TBD','2026-06-30 20:30+00',2),
(76,'r32',NULL,'TBD','TBD','2026-07-01 01:00+00',2),
(77,'r32',NULL,'TBD','TBD','2026-07-01 17:00+00',2),
(78,'r32',NULL,'TBD','TBD','2026-07-01 21:00+00',2),
(79,'r32',NULL,'TBD','TBD','2026-07-02 01:00+00',2),
(80,'r32',NULL,'TBD','TBD','2026-07-02 16:00+00',2),
(81,'r32',NULL,'TBD','TBD','2026-07-02 20:00+00',2),
(82,'r32',NULL,'TBD','TBD','2026-07-03 00:00+00',2),
(83,'r32',NULL,'TBD','TBD','2026-07-03 19:00+00',2),
(84,'r32',NULL,'TBD','TBD','2026-07-03 23:00+00',2),
(85,'r32',NULL,'TBD','TBD','2026-07-04 03:00+00',2),
(86,'r32',NULL,'TBD','TBD','2026-07-04 18:00+00',2),
(87,'r32',NULL,'TBD','TBD','2026-07-04 22:00+00',2),
(88,'r32',NULL,'TBD','TBD','2026-07-05 18:00+00',2),
-- ROUND OF 16 (8 matches)
(89,'r16',NULL,'TBD','TBD','2026-07-05 22:00+00',2),
(90,'r16',NULL,'TBD','TBD','2026-07-06 00:00+00',2),
(91,'r16',NULL,'TBD','TBD','2026-07-06 19:00+00',2),
(92,'r16',NULL,'TBD','TBD','2026-07-07 00:00+00',2),
(93,'r16',NULL,'TBD','TBD','2026-07-07 16:00+00',2),
(94,'r16',NULL,'TBD','TBD','2026-07-07 20:00+00',2),
(95,'r16',NULL,'TBD','TBD','2026-07-08 19:00+00',2),
(96,'r16',NULL,'TBD','TBD','2026-07-08 23:00+00',2),
-- QUARTER-FINALS (4 matches)
(97,'qf', NULL,'TBD','TBD','2026-07-09 20:00+00',3),
(98,'qf', NULL,'TBD','TBD','2026-07-10 19:00+00',3),
(99,'qf', NULL,'TBD','TBD','2026-07-11 21:00+00',3),
(100,'qf',NULL,'TBD','TBD','2026-07-12 01:00+00',3),
-- SEMI-FINALS (2 matches)
(101,'sf',NULL,'TBD','TBD','2026-07-14 19:00+00',3),
(102,'sf',NULL,'TBD','TBD','2026-07-15 19:00+00',3),
-- THIRD PLACE
(103,'3rd',  NULL,'TBD','TBD','2026-07-18 21:00+00',4),
-- FINAL
(104,'final',NULL,'TBD','TBD','2026-07-19 19:00+00',4)
ON CONFLICT (id) DO UPDATE
  SET phase        = EXCLUDED.phase,
      group_letter = EXCLUDED.group_letter,
      team_home    = EXCLUDED.team_home,
      team_away    = EXCLUDED.team_away,
      kickoff_utc  = EXCLUDED.kickoff_utc,
      multiplier   = EXCLUDED.multiplier;
