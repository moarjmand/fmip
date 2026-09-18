-- Up Migration
-- T-312 (blueprint 11): the viewer's territory, chosen by the member and
-- stored, never inferred from an address.
--
-- A territory is an ISO 3166-1 country, not a row of `country`: broadcast
-- rights are sold by state, and a football nation is not always one --
-- England, Scotland and Wales are three `country` rows and one territory
-- (GB), and a viewer in Guernsey is in none of them. The table is seeded with
-- the full ISO list so a member anywhere can choose; the names are English
-- and a page may localise them with `Intl.DisplayNames`.
--
-- `user_account.viewing_territory` is nullable on purpose and starts null for
-- everybody: a member who has not chosen is asked, not guessed at (rule 3),
-- and `country_id` -- the football country they registered with -- is not
-- read as an answer to a question it was never asked.
CREATE TABLE territory (
  code text PRIMARY KEY,
  name text NOT NULL,
  CONSTRAINT territory_code_format CHECK (code ~ '^[A-Z]{2}$'),
  CONSTRAINT territory_name_not_blank CHECK (btrim(name) <> '')
);

COMMENT ON TABLE territory IS
  'ISO 3166-1 alpha-2 countries: what viewing availability is stored against and what a member chooses (blueprint 11, T-312).';

INSERT INTO territory (code, name) VALUES
  ('AD', 'Andorra'), ('AE', 'United Arab Emirates'), ('AF', 'Afghanistan'),
  ('AG', 'Antigua and Barbuda'), ('AI', 'Anguilla'), ('AL', 'Albania'), ('AM', 'Armenia'),
  ('AO', 'Angola'), ('AQ', 'Antarctica'), ('AR', 'Argentina'), ('AS', 'American Samoa'),
  ('AT', 'Austria'), ('AU', 'Australia'), ('AW', 'Aruba'), ('AX', 'Åland Islands'),
  ('AZ', 'Azerbaijan'),
  ('BA', 'Bosnia and Herzegovina'), ('BB', 'Barbados'), ('BD', 'Bangladesh'), ('BE', 'Belgium'),
  ('BF', 'Burkina Faso'), ('BG', 'Bulgaria'), ('BH', 'Bahrain'), ('BI', 'Burundi'),
  ('BJ', 'Benin'), ('BL', 'Saint Barthélemy'), ('BM', 'Bermuda'), ('BN', 'Brunei Darussalam'),
  ('BO', 'Bolivia'), ('BQ', 'Bonaire, Sint Eustatius and Saba'), ('BR', 'Brazil'),
  ('BS', 'Bahamas'), ('BT', 'Bhutan'), ('BV', 'Bouvet Island'), ('BW', 'Botswana'),
  ('BY', 'Belarus'), ('BZ', 'Belize'),
  ('CA', 'Canada'), ('CC', 'Cocos (Keeling) Islands'), ('CD', 'Congo (Democratic Republic)'),
  ('CF', 'Central African Republic'), ('CG', 'Congo'), ('CH', 'Switzerland'),
  ('CI', 'Côte d''Ivoire'), ('CK', 'Cook Islands'), ('CL', 'Chile'), ('CM', 'Cameroon'),
  ('CN', 'China'), ('CO', 'Colombia'), ('CR', 'Costa Rica'), ('CU', 'Cuba'), ('CV', 'Cabo Verde'),
  ('CW', 'Curaçao'), ('CX', 'Christmas Island'), ('CY', 'Cyprus'), ('CZ', 'Czechia'),
  ('DE', 'Germany'), ('DJ', 'Djibouti'), ('DK', 'Denmark'), ('DM', 'Dominica'),
  ('DO', 'Dominican Republic'), ('DZ', 'Algeria'),
  ('EC', 'Ecuador'), ('EE', 'Estonia'), ('EG', 'Egypt'), ('EH', 'Western Sahara'),
  ('ER', 'Eritrea'), ('ES', 'Spain'), ('ET', 'Ethiopia'),
  ('FI', 'Finland'), ('FJ', 'Fiji'), ('FK', 'Falkland Islands'), ('FM', 'Micronesia'),
  ('FO', 'Faroe Islands'), ('FR', 'France'),
  ('GA', 'Gabon'), ('GB', 'United Kingdom'), ('GD', 'Grenada'), ('GE', 'Georgia'),
  ('GF', 'French Guiana'), ('GG', 'Guernsey'), ('GH', 'Ghana'), ('GI', 'Gibraltar'),
  ('GL', 'Greenland'), ('GM', 'Gambia'), ('GN', 'Guinea'), ('GP', 'Guadeloupe'),
  ('GQ', 'Equatorial Guinea'), ('GR', 'Greece'),
  ('GS', 'South Georgia and the South Sandwich Islands'), ('GT', 'Guatemala'), ('GU', 'Guam'),
  ('GW', 'Guinea-Bissau'), ('GY', 'Guyana'),
  ('HK', 'Hong Kong'), ('HM', 'Heard Island and McDonald Islands'), ('HN', 'Honduras'),
  ('HR', 'Croatia'), ('HT', 'Haiti'), ('HU', 'Hungary'),
  ('ID', 'Indonesia'), ('IE', 'Ireland'), ('IL', 'Israel'), ('IM', 'Isle of Man'), ('IN', 'India'),
  ('IO', 'British Indian Ocean Territory'), ('IQ', 'Iraq'), ('IR', 'Iran'), ('IS', 'Iceland'),
  ('IT', 'Italy'),
  ('JE', 'Jersey'), ('JM', 'Jamaica'), ('JO', 'Jordan'), ('JP', 'Japan'),
  ('KE', 'Kenya'), ('KG', 'Kyrgyzstan'), ('KH', 'Cambodia'), ('KI', 'Kiribati'), ('KM', 'Comoros'),
  ('KN', 'Saint Kitts and Nevis'), ('KP', 'North Korea'), ('KR', 'South Korea'), ('KW', 'Kuwait'),
  ('KY', 'Cayman Islands'), ('KZ', 'Kazakhstan'),
  ('LA', 'Laos'), ('LB', 'Lebanon'), ('LC', 'Saint Lucia'), ('LI', 'Liechtenstein'),
  ('LK', 'Sri Lanka'), ('LR', 'Liberia'), ('LS', 'Lesotho'), ('LT', 'Lithuania'),
  ('LU', 'Luxembourg'), ('LV', 'Latvia'), ('LY', 'Libya'),
  ('MA', 'Morocco'), ('MC', 'Monaco'), ('MD', 'Moldova'), ('ME', 'Montenegro'),
  ('MF', 'Saint Martin (French part)'), ('MG', 'Madagascar'), ('MH', 'Marshall Islands'),
  ('MK', 'North Macedonia'), ('ML', 'Mali'), ('MM', 'Myanmar'), ('MN', 'Mongolia'), ('MO', 'Macao'),
  ('MP', 'Northern Mariana Islands'), ('MQ', 'Martinique'), ('MR', 'Mauritania'),
  ('MS', 'Montserrat'), ('MT', 'Malta'), ('MU', 'Mauritius'), ('MV', 'Maldives'), ('MW', 'Malawi'),
  ('MX', 'Mexico'), ('MY', 'Malaysia'), ('MZ', 'Mozambique'),
  ('NA', 'Namibia'), ('NC', 'New Caledonia'), ('NE', 'Niger'), ('NF', 'Norfolk Island'),
  ('NG', 'Nigeria'), ('NI', 'Nicaragua'), ('NL', 'Netherlands'), ('NO', 'Norway'), ('NP', 'Nepal'),
  ('NR', 'Nauru'), ('NU', 'Niue'), ('NZ', 'New Zealand'),
  ('OM', 'Oman'),
  ('PA', 'Panama'), ('PE', 'Peru'), ('PF', 'French Polynesia'), ('PG', 'Papua New Guinea'),
  ('PH', 'Philippines'), ('PK', 'Pakistan'), ('PL', 'Poland'), ('PM', 'Saint Pierre and Miquelon'),
  ('PN', 'Pitcairn'), ('PR', 'Puerto Rico'), ('PS', 'Palestine'), ('PT', 'Portugal'), ('PW', 'Palau'),
  ('PY', 'Paraguay'),
  ('QA', 'Qatar'),
  ('RE', 'Réunion'), ('RO', 'Romania'), ('RS', 'Serbia'), ('RU', 'Russia'), ('RW', 'Rwanda'),
  ('SA', 'Saudi Arabia'), ('SB', 'Solomon Islands'), ('SC', 'Seychelles'), ('SD', 'Sudan'),
  ('SE', 'Sweden'), ('SG', 'Singapore'), ('SH', 'Saint Helena, Ascension and Tristan da Cunha'),
  ('SI', 'Slovenia'), ('SJ', 'Svalbard and Jan Mayen'), ('SK', 'Slovakia'), ('SL', 'Sierra Leone'),
  ('SM', 'San Marino'), ('SN', 'Senegal'), ('SO', 'Somalia'), ('SR', 'Suriname'), ('SS', 'South Sudan'),
  ('ST', 'Sao Tome and Principe'), ('SV', 'El Salvador'), ('SX', 'Sint Maarten (Dutch part)'),
  ('SY', 'Syria'), ('SZ', 'Eswatini'),
  ('TC', 'Turks and Caicos Islands'), ('TD', 'Chad'), ('TF', 'French Southern Territories'),
  ('TG', 'Togo'), ('TH', 'Thailand'), ('TJ', 'Tajikistan'), ('TK', 'Tokelau'), ('TL', 'Timor-Leste'),
  ('TM', 'Turkmenistan'), ('TN', 'Tunisia'), ('TO', 'Tonga'), ('TR', 'Türkiye'),
  ('TT', 'Trinidad and Tobago'), ('TV', 'Tuvalu'), ('TW', 'Taiwan'), ('TZ', 'Tanzania'),
  ('UA', 'Ukraine'), ('UG', 'Uganda'), ('UM', 'United States Minor Outlying Islands'),
  ('US', 'United States'), ('UY', 'Uruguay'), ('UZ', 'Uzbekistan'),
  ('VA', 'Holy See'), ('VC', 'Saint Vincent and the Grenadines'), ('VE', 'Venezuela'),
  ('VG', 'British Virgin Islands'), ('VI', 'U.S. Virgin Islands'), ('VN', 'Viet Nam'),
  ('VU', 'Vanuatu'),
  ('WF', 'Wallis and Futuna'), ('WS', 'Samoa'),
  ('YE', 'Yemen'), ('YT', 'Mayotte'),
  ('ZA', 'South Africa'), ('ZM', 'Zambia'), ('ZW', 'Zimbabwe');

ALTER TABLE user_account
  ADD COLUMN viewing_territory text REFERENCES territory (code) ON DELETE RESTRICT;

COMMENT ON COLUMN user_account.viewing_territory IS
  'The territory the member chose to be shown viewing options for; null until they choose, and never inferred (T-312).';

-- Down Migration

ALTER TABLE user_account DROP COLUMN viewing_territory;
DROP TABLE territory;
