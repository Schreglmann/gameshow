/**
 * Generates `src/data/cities.generated.ts` — the curated city table behind the
 * `city-compass` game type (see specs/games/city-compass.md).
 *
 * Source: the `all-the-cities` devDependency (135k cities above 1000 inhabitants,
 * derived from GeoNames, CC BY 4.0). That table is too large for a browser bundle
 * and far too noisy for a picker aimed at cities an audience recognizes, so this
 * script keeps a prominence tier per city and filters by country and population.
 *
 * GeoNames names a city either in English or in its own language, with no rule that
 * says which (`Munich`, but `Antwerpen`; `Prague`, but `Sevilla`). GERMAN_NAMES below
 * renames the ones that differ from German. Every key of every override table is
 * checked against the source data, because a key that matches nothing — GeoNames
 * renamed `Odesa` to `Odessa` at some point — would leave the English name on stage
 * with no other symptom.
 *
 *   node --import=tsx scripts/generate-city-dataset.ts            # write the dataset
 *   node --import=tsx scripts/generate-city-dataset.ts --report   # list what would be written
 */

import { writeFileSync } from 'fs';
import path from 'path';
import allCities from 'all-the-cities';

type Tier = 'capital' | 'metro' | 'major' | 'local';

interface RawCity {
  name: string;
  country: string;
  featureCode: string;
  population: number;
  loc: { coordinates: [number, number] };
}

interface Picked {
  name: string;
  country: string;
  lat: number;
  lon: number;
  population: number;
  tier: Tier;
}

// ── Thresholds ────────────────────────────────────────────────────────────────

/** Capitals below this are administrative outposts (Adamstown, Yaren, Ngerulmud). */
const MIN_CAPITAL_POP = 2_000;
/** Worldwide metropolis floor. */
const MIN_METRO_POP = 300_000;
/** Europe gets denser coverage than the rest of the world. */
const MIN_EUROPE_POP = 150_000;
/** Countries bordering the German-speaking area, or one country further. */
const MIN_NEIGHBOR_POP = 60_000;
const MIN_DE_POP = 25_000;
/**
 * Austria, Switzerland and Liechtenstein go down to small towns, because a nearby
 * small town is the most telling hint the game has. GeoNames counts the core
 * municipality, so these numbers run well below the figures a local would quote
 * (Wels is listed at 16,857). 6000 is the floor that still includes Zell am See
 * (7619) and Zermatt (6629).
 */
const MIN_DACH_SMALL_POP = 6_000;
/**
 * Austria alone goes lower still. Its GeoNames figures are the Ortschaft rather than
 * the Gemeinde, and the gap grows as the town gets smaller — Hallein is listed at
 * 7208 against a real 21,000, Seekirchen am Wallersee at 3579 against 11,300 — so
 * MIN_DACH_SMALL_POP cut off the whole band of towns the game most wants: the ones
 * that pin a region down at once. 2000 here is roughly 2500–6000 real inhabitants.
 *
 * Only for the seat of an administrative division (ALLOWED_ADMIN_SEATS), which in
 * Austria is what tells a Gemeinde from a hamlet. Below 6000 the plain PPL entries
 * are mostly the latter — `Taxach`, `Neualm`, `Burgfried`, `Glasenbach` all sit in
 * that band, and none of them is a place anyone would name.
 */
const MIN_AT_TOWN_POP = 2_000;

/**
 * Only real places. PPLX is a city district — it would put `Favoriten` next to
 * `Vienna` and `Wandsbek` next to `Hamburg`. PPLG (seat of government) is allowed
 * for the sake of The Hague, PPLQ/PPLH/PPLW are abandoned, historical or destroyed.
 */
const ALLOWED_FEATURE_CODES = new Set(['PPL', 'PPLA', 'PPLA2', 'PPLA3', 'PPLA4', 'PPLA5', 'PPLC', 'PPLG']);

/** The subset of the above that marks a municipality rather than a named hamlet. */
const ALLOWED_ADMIN_SEATS = new Set(['PPLA', 'PPLA2', 'PPLA3', 'PPLA4', 'PPLA5', 'PPLC']);

const EUROPE = new Set([
  'AL', 'AD', 'AT', 'BY', 'BE', 'BA', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE',
  'GI', 'GR', 'HU', 'IS', 'IE', 'IT', 'LV', 'LI', 'LT', 'LU', 'MT', 'MD', 'MC', 'ME', 'NL',
  'MK', 'NO', 'PL', 'PT', 'RO', 'RU', 'SM', 'RS', 'SK', 'SI', 'ES', 'SE', 'CH', 'UA', 'GB',
  'VA', 'XK',
]);

const NEIGHBOR_COUNTRIES = new Set(['IT', 'CZ', 'SK', 'HU', 'SI', 'HR', 'PL', 'FR', 'NL', 'BE', 'DK', 'LU']);
const DACH_SMALL = new Set(['AT', 'CH', 'LI']);

// ── Manual overrides ──────────────────────────────────────────────────────────

/** Capitals under MIN_CAPITAL_POP that an audience still knows. */
const FORCE_CAPITAL = new Set(['Vatican City|VA']);

/**
 * Cities whose GeoNames population understates how well known they are, because the
 * figure counts the historic core only. Venice at 51,298 would otherwise drop out of
 * a game about European cities.
 */
const FORCE_MAJOR = new Set([
  'Venice|IT', 'Merano|IT', 'Karlovy Vary|CZ',
  'Innsbruck|AT', 'Klagenfurt am Wörthersee|AT',
  'Luzern|CH', 'Sankt Gallen|CH', 'Lugano|CH',
]);

/**
 * Places below their country's threshold that an audience still knows — almost all
 * of them tourist towns. Kept at tier `local`, so the compass only offers them close
 * to the center city.
 */
const FORCE_LOCAL = new Set([
  'Berchtesgaden|DE', 'Oberstdorf|DE', 'Füssen|DE', 'Rothenburg ob der Tauber|DE', 'Mittenwald|DE',
  'St Anton am Arlberg|AT', 'Sölden|AT', 'Ischgl|AT', 'Mayrhofen|AT', 'Seefeld in Tirol|AT',
  'Heiligenblut|AT', 'Krimml|AT', 'Melk|AT', 'Dürnstein|AT', 'Mariazell|AT', 'Gmunden|AT',
  'Bad Ischl|AT', 'Alpbach|AT', 'Lech|AT',
  'St. Moritz|CH', 'Davos|CH', 'Grindelwald|CH', 'Interlaken|CH', 'Gstaad|CH', 'Andermatt|CH',
  'Verbier|CH', 'Ascona|CH', 'Appenzell|CH',
  "Cortina d'Ampezzo|IT", 'Portofino|IT', 'Positano|IT', 'Sirmione|IT',
]);

/**
 * Well-known places GeoNames leaves out entirely, because they sit below 1000
 * inhabitants. Coordinates from the German Wikipedia article of each place.
 */
const MANUAL_CITIES: Picked[] = [
  { name: 'Hallstatt', country: 'AT', lat: 47.5622, lon: 13.6493, population: 750, tier: 'local' },
  { name: 'Kaprun', country: 'AT', lat: 47.2708, lon: 12.7583, population: 3100, tier: 'local' },
];

/** Entries that survive the filters but are not cities anyone would name. */
const BLOCKLIST = new Set([
  'Palikir - National Government Center|FM',
  'Flying Fish Cove|CX',
  'Port-aux-Français|TF',
  'West Island|CC',
]);

/**
 * `<geonames name>|<country>` → German name, for the cities where the two differ.
 * Verified against the source data — a key here that matches nothing fails the run.
 */
const GERMAN_NAMES: Record<string, string> = {
  // Capitals
  'Vienna|AT': 'Wien',
  'Brussels|BE': 'Brüssel',
  'Prague|CZ': 'Prag',
  'Copenhagen|DK': 'Kopenhagen',
  'Athens|GR': 'Athen',
  'Rome|IT': 'Rom',
  'Luxembourg|LU': 'Luxemburg',
  'Warsaw|PL': 'Warschau',
  'Lisbon|PT': 'Lissabon',
  'Bucharest|RO': 'Bukarest',
  'Belgrade|RS': 'Belgrad',
  'Moscow|RU': 'Moskau',
  'Kyiv|UA': 'Kiew',
  'Nicosia|CY': 'Nikosia',
  'Vatican City|VA': 'Vatikanstadt',
  'Washington, D.C.|US': 'Washington',
  'Mexico City|MX': 'Mexiko-Stadt',
  'Guatemala City|GT': 'Guatemala-Stadt',
  'Panamá|PA': 'Panama-Stadt',
  'Havana|CU': 'Havanna',
  'Santiago|CL': 'Santiago de Chile',
  'Cairo|EG': 'Kairo',
  'Algiers|DZ': 'Algier',
  'Tripoli|LY': 'Tripolis',
  'Addis Ababa|ET': 'Addis Abeba',
  'Khartoum|SD': 'Khartum',
  'Damascus|SY': 'Damaskus',
  'Baghdad|IQ': 'Bagdad',
  'Tehran|IR': 'Teheran',
  'Riyadh|SA': 'Riad',
  'Kuwait City|KW': 'Kuwait-Stadt',
  'Beijing|CN': 'Peking',
  'Tokyo|JP': 'Tokio',
  'Pyongyang|KP': 'Pjöngjang',
  'New Delhi|IN': 'Neu-Delhi',
  'Singapore|SG': 'Singapur',
  'Nur-Sultan|KZ': 'Astana',
  'Tashkent|UZ': 'Taschkent',
  'Ashgabat|TM': 'Aschgabat',
  'Dushanbe|TJ': 'Duschanbe',
  'Bishkek|KG': 'Bischkek',
  'Yerevan|AM': 'Eriwan',
  'Tbilisi|GE': 'Tiflis',

  // Germany
  'Munich|DE': 'München',

  // Switzerland
  'Genève|CH': 'Genf',
  'Sankt Gallen|CH': 'St. Gallen',

  // Austria
  'Klagenfurt am Wörthersee|AT': 'Klagenfurt',
  'Strasswalchen|AT': 'Straßwalchen',

  // Italy
  'Milan|IT': 'Mailand',
  'Naples|IT': 'Neapel',
  'Florence|IT': 'Florenz',
  'Venice|IT': 'Venedig',
  'Genoa|IT': 'Genua',
  'Bolzano|IT': 'Bozen',
  'Merano|IT': 'Meran',
  'Trento|IT': 'Trient',
  'Trieste|IT': 'Triest',
  'Siracusa|IT': 'Syrakus',

  // Belgium / Netherlands
  'Brugge|BE': 'Brügge',
  'Liège|BE': 'Lüttich',
  'Leuven|BE': 'Löwen',
  'The Hague|NL': 'Den Haag',
  'Nijmegen|NL': 'Nimwegen',
  'Arnhem|NL': 'Arnheim',

  // France
  'Strasbourg|FR': 'Straßburg',
  'Nice|FR': 'Nizza',
  'Mulhouse|FR': 'Mülhausen',
  'Dunkerque|FR': 'Dünkirchen',

  // Iberia
  'Zaragoza|ES': 'Saragossa',

  // Czechia / Poland
  'Brno|CZ': 'Brünn',
  'Karlovy Vary|CZ': 'Karlsbad',
  'České Budějovice|CZ': 'Budweis',
  'Olomouc|CZ': 'Olmütz',
  'Liberec|CZ': 'Reichenberg',
  'Ústí nad Labem|CZ': 'Aussig',
  'Kraków|PL': 'Krakau',
  'Wrocław|PL': 'Breslau',
  'Gdańsk|PL': 'Danzig',
  'Gdynia|PL': 'Gdingen',
  'Poznań|PL': 'Posen',
  'Szczecin|PL': 'Stettin',
  'Łódź|PL': 'Lodz',
  'Katowice|PL': 'Kattowitz',
  'Bydgoszcz|PL': 'Bromberg',
  'Toruń|PL': 'Thorn',
  'Olsztyn|PL': 'Allenstein',
  'Gliwice|PL': 'Gleiwitz',
  'Opole|PL': 'Oppeln',

  // Southeast Europe
  'Timişoara|RO': 'Temeswar',
  'Cluj-Napoca|RO': 'Klausenburg',
  'Braşov|RO': 'Kronstadt',
  'Sibiu|RO': 'Hermannstadt',

  // Ukraine / Russia
  'Lviv|UA': 'Lwiw',
  'Kharkiv|UA': 'Charkiw',
  'Zaporizhia|UA': 'Saporischschja',
  'Saint Petersburg|RU': 'Sankt Petersburg',
  'Nizhniy Novgorod|RU': 'Nischni Nowgorod',
  'Yekaterinburg|RU': 'Jekaterinburg',
  'Novosibirsk|RU': 'Nowosibirsk',
  'Kazan|RU': 'Kasan',
  'Rostov-na-Donu|RU': 'Rostow am Don',
  'Volgograd|RU': 'Wolgograd',
  'Voronezh|RU': 'Woronesch',
  'Chelyabinsk|RU': 'Tscheljabinsk',
  'Saratov|RU': 'Saratow',
  'Krasnoyarsk|RU': 'Krasnojarsk',
  'Vladivostok|RU': 'Wladiwostok',
  'Sochi|RU': 'Sotschi',
  'Pskov|RU': 'Pskow',

  // Rest of the world
  'New York City|US': 'New York',
  'İzmir|TR': 'Izmir',
};

// ── Selection ─────────────────────────────────────────────────────────────────

function tierFor(city: RawCity): Tier | null {
  const key = `${city.name}|${city.country}`;
  if (city.featureCode === 'PPLC') {
    return city.population >= MIN_CAPITAL_POP || FORCE_CAPITAL.has(key) ? 'capital' : null;
  }
  if (city.population >= MIN_METRO_POP) return 'metro';
  if (FORCE_MAJOR.has(key)) return 'major';
  if (EUROPE.has(city.country) && city.population >= MIN_EUROPE_POP) return 'major';
  if (NEIGHBOR_COUNTRIES.has(city.country) && city.population >= MIN_NEIGHBOR_POP) return 'major';
  if (city.country === 'DE' && city.population >= MIN_DE_POP) return 'local';
  if (DACH_SMALL.has(city.country) && city.population >= MIN_DACH_SMALL_POP) return 'local';
  if (city.country === 'AT' && city.population >= MIN_AT_TOWN_POP && ALLOWED_ADMIN_SEATS.has(city.featureCode)) {
    return 'local';
  }
  if (FORCE_LOCAL.has(key)) return 'local';
  return null;
}

function select(): Picked[] {
  /** Highest-population entry wins a name+country collision — two cities sharing a
   *  name in one country would give the compass an ambiguous label either way. */
  const best = new Map<string, RawCity>();

  for (const raw of allCities as unknown as RawCity[]) {
    if (!ALLOWED_FEATURE_CODES.has(raw.featureCode)) continue;
    const key = `${raw.name}|${raw.country}`;
    if (BLOCKLIST.has(key)) continue;
    if (tierFor(raw) === null) continue;
    const prev = best.get(key);
    if (!prev || raw.population > prev.population) best.set(key, raw);
  }

  const unmatched = [
    ...Object.keys(GERMAN_NAMES),
    ...FORCE_CAPITAL, ...FORCE_MAJOR, ...FORCE_LOCAL,
  ].filter(key => !best.has(key));

  if (unmatched.length > 0) {
    console.error(`\n${unmatched.length} override keys match no city in the source data:\n`);
    for (const key of unmatched) console.error(`  ${key}`);
    console.error('\nEither the name changed in GeoNames or the entry is a typo.\n');
    process.exit(1);
  }

  const cities: Picked[] = [...best.values()].map(raw => ({
    name: GERMAN_NAMES[`${raw.name}|${raw.country}`] ?? raw.name,
    country: raw.country,
    lat: raw.loc.coordinates[1],
    lon: raw.loc.coordinates[0],
    population: raw.population,
    tier: tierFor(raw)!,
  }));

  for (const manual of MANUAL_CITIES) {
    if (!cities.some(c => c.name === manual.name && c.country === manual.country)) cities.push(manual);
  }

  cities.sort((a, b) => a.country.localeCompare(b.country) || b.population - a.population || a.name.localeCompare(b.name));
  return cities;
}

// ── Output ────────────────────────────────────────────────────────────────────

const TIER_CODE: Record<Tier, string> = { capital: 'C', metro: 'M', major: 'J', local: 'L' };

/** Four decimals is ~11 m — far below what a bearing over tens of kilometres needs. */
function coord(n: number): string {
  return n.toFixed(4).replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
}

function render(cities: Picked[]): string {
  const lines = cities.map(
    c => `${c.name}|${c.country}|${coord(c.lat)}|${coord(c.lon)}|${c.population}|${TIER_CODE[c.tier]}`,
  );
  return `// GENERATED FILE — do not edit by hand. Regenerate with \`npm run cities:generate\`.
//
// Source: GeoNames (https://www.geonames.org) via the \`all-the-cities\` npm package,
// licensed CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/). The filtering,
// the prominence tiers and the German names come from scripts/generate-city-dataset.ts.
//
// Backs the city picker and the "Auto" neighbor selection of the \`city-compass\` game
// type — see specs/games/city-compass.md. Only the admin bundle imports this module,
// and only through a dynamic import; the show renders from the coordinates stored in
// the game JSON.
//
// One template literal rather than ${cities.length} object literals: a quarter of the source
// size, one diff line per city, and tsc only ever sees a string.

import type { City, CityTier } from '@/utils/cityCompass';

const TIER_BY_CODE: Record<string, CityTier> = { C: 'capital', M: 'metro', J: 'major', L: 'local' };

/** \`name|country|lat|lon|population|tier\`, one city per line. */
const RAW = \`\\
${lines.join('\n')}\`;

function parseCities(raw: string): City[] {
  return raw.split('\\n').map(line => {
    const [name = '', country = '', lat = '', lon = '', population = '', tier = 'L'] = line.split('|');
    return {
      name,
      country,
      lat: Number(lat),
      lon: Number(lon),
      population: Number(population),
      tier: TIER_BY_CODE[tier] ?? 'local',
    };
  });
}

export const CITIES: City[] = parseCities(RAW);
`;
}

// ── Main ──────────────────────────────────────────────────────────────────────

const cities = select();
const byTier = cities.reduce<Record<string, number>>((acc, c) => ({ ...acc, [c.tier]: (acc[c.tier] ?? 0) + 1 }), {});
console.log(`${cities.length} cities:`, byTier);

if (process.argv.includes('--report')) {
  for (const c of cities) console.log(`${TIER_CODE[c.tier]} ${c.country} ${c.name} (${c.population})`);
  process.exit(0);
}

const out = path.join(process.cwd(), 'src/data/cities.generated.ts');
writeFileSync(out, render(cities), 'utf8');
console.log(`wrote ${out}`);
