// $BOBAI Worldcup '26 — Qualified Teams (FIFA WC 2026)
// 48 teams, alphabetical. Source: FIFA / UEFA / CONMEBOL official qualification (as of 2026-05).
window.WC_COUNTRIES = [
  // CAF (10)
  { code: 'DZ',  name: 'Algeria',          flag: '🇩🇿' },
  // CONMEBOL (6)
  { code: 'AR',  name: 'Argentina',        flag: '🇦🇷' },
  // AFC (9)
  { code: 'AU',  name: 'Australia',        flag: '🇦🇺' },
  // UEFA (16)
  { code: 'AT',  name: 'Austria',          flag: '🇦🇹' },
  { code: 'BE',  name: 'Belgium',          flag: '🇧🇪' },
  { code: 'BA',  name: 'Bosnia & Herz.',   flag: '🇧🇦' },
  { code: 'BR',  name: 'Brazil',           flag: '🇧🇷' },
  // CONCACAF (6, incl. hosts)
  { code: 'CA',  name: 'Canada',           flag: '🇨🇦' },
  { code: 'CV',  name: 'Cape Verde',       flag: '🇨🇻' },
  { code: 'CO',  name: 'Colombia',         flag: '🇨🇴' },
  { code: 'HR',  name: 'Croatia',          flag: '🇭🇷' },
  { code: 'CW',  name: 'Curaçao',          flag: '🇨🇼' },
  { code: 'CZ',  name: 'Czechia',          flag: '🇨🇿' },
  { code: 'CD',  name: 'DR Congo',         flag: '🇨🇩' },
  { code: 'EC',  name: 'Ecuador',          flag: '🇪🇨' },
  { code: 'EG',  name: 'Egypt',            flag: '🇪🇬' },
  { code: 'ENG', name: 'England',          flag: '🏴󠁧󠁢󠁥󠁮󠁧󠁿' },
  { code: 'FR',  name: 'France',           flag: '🇫🇷' },
  { code: 'DE',  name: 'Germany',          flag: '🇩🇪' },
  { code: 'GH',  name: 'Ghana',            flag: '🇬🇭' },
  { code: 'HT',  name: 'Haiti',            flag: '🇭🇹' },
  { code: 'IR',  name: 'Iran',             flag: '🇮🇷' },
  { code: 'IQ',  name: 'Iraq',             flag: '🇮🇶' },
  { code: 'CI',  name: 'Ivory Coast',      flag: '🇨🇮' },
  { code: 'JP',  name: 'Japan',            flag: '🇯🇵' },
  { code: 'JO',  name: 'Jordan',           flag: '🇯🇴' },
  { code: 'MX',  name: 'Mexico',           flag: '🇲🇽' },
  { code: 'MA',  name: 'Morocco',          flag: '🇲🇦' },
  { code: 'NL',  name: 'Netherlands',      flag: '🇳🇱' },
  // OFC (1)
  { code: 'NZ',  name: 'New Zealand',      flag: '🇳🇿' },
  { code: 'NO',  name: 'Norway',           flag: '🇳🇴' },
  { code: 'PA',  name: 'Panama',           flag: '🇵🇦' },
  { code: 'PY',  name: 'Paraguay',         flag: '🇵🇾' },
  { code: 'PT',  name: 'Portugal',         flag: '🇵🇹' },
  { code: 'QA',  name: 'Qatar',            flag: '🇶🇦' },
  { code: 'SA',  name: 'Saudi Arabia',     flag: '🇸🇦' },
  { code: 'SCO', name: 'Scotland',         flag: '🏴󠁧󠁢󠁳󠁣󠁴󠁿' },
  { code: 'SN',  name: 'Senegal',          flag: '🇸🇳' },
  { code: 'ZA',  name: 'South Africa',     flag: '🇿🇦' },
  { code: 'KR',  name: 'South Korea',      flag: '🇰🇷' },
  { code: 'ES',  name: 'Spain',            flag: '🇪🇸' },
  { code: 'SE',  name: 'Sweden',           flag: '🇸🇪' },
  { code: 'CH',  name: 'Switzerland',      flag: '🇨🇭' },
  { code: 'TN',  name: 'Tunisia',          flag: '🇹🇳' },
  { code: 'TR',  name: 'Türkiye',          flag: '🇹🇷' },
  { code: 'UY',  name: 'Uruguay',          flag: '🇺🇾' },
  { code: 'US',  name: 'USA',              flag: '🇺🇸' },
  { code: 'UZ',  name: 'Uzbekistan',       flag: '🇺🇿' },
];
// Sort alphabetically by display name (the section comments above are just for traceability)
window.WC_COUNTRIES.sort((a,b) => a.name.localeCompare(b.name));
