import fs from 'fs';
import path from 'path';

// Austrian district-level GeoJSON (simplified 99.9% from ginseng666/GeoJSON-TopoJSON-Austria)
const BEZIRKE_URL = 'https://raw.githubusercontent.com/ginseng666/GeoJSON-TopoJSON-Austria/master/2021/simplified-99.9/bezirke_999_geo.json';
// State-level GeoJSON for state boundary outlines
const LAENDER_URL = 'https://raw.githubusercontent.com/ginseng666/GeoJSON-TopoJSON-Austria/master/2021/simplified-99.9/laender_999_geo.json';

interface District {
  code: string;
  name: string;
  state: string;
  geoIso: string; // ISO code in the GeoJSON bezirke data
}

// Map licence plate codes to GeoJSON iso codes
const districts: District[] = [
  // Wien
  { code: "W", name: "Wien", state: "Wien", geoIso: "900" },
  // Burgenland
  { code: "E", name: "Eisenstadt", state: "Burgenland", geoIso: "101" },
  { code: "EU", name: "Eisenstadt-Umgebung", state: "Burgenland", geoIso: "103" },
  { code: "GS", name: "Güssing", state: "Burgenland", geoIso: "104" },
  { code: "JE", name: "Jennersdorf", state: "Burgenland", geoIso: "105" },
  { code: "MA", name: "Mattersburg", state: "Burgenland", geoIso: "106" },
  { code: "ND", name: "Neusiedl am See", state: "Burgenland", geoIso: "107" },
  { code: "OP", name: "Oberpullendorf", state: "Burgenland", geoIso: "108" },
  { code: "OW", name: "Oberwart", state: "Burgenland", geoIso: "109" },
  // Kärnten
  { code: "K", name: "Klagenfurt", state: "Kärnten", geoIso: "201" },
  { code: "KL", name: "Klagenfurt-Land", state: "Kärnten", geoIso: "204" },
  { code: "FE", name: "Feldkirchen", state: "Kärnten", geoIso: "210" },
  { code: "HE", name: "Hermagor", state: "Kärnten", geoIso: "203" },
  { code: "SP", name: "Spittal an der Drau", state: "Kärnten", geoIso: "206" },
  { code: "SV", name: "Sankt Veit an der Glan", state: "Kärnten", geoIso: "205" },
  { code: "VI", name: "Villach", state: "Kärnten", geoIso: "202" },
  { code: "VL", name: "Villach-Land", state: "Kärnten", geoIso: "207" },
  { code: "VK", name: "Völkermarkt", state: "Kärnten", geoIso: "208" },
  { code: "WO", name: "Wolfsberg", state: "Kärnten", geoIso: "209" },
  // Niederösterreich
  { code: "AM", name: "Amstetten", state: "Niederösterreich", geoIso: "305" },
  { code: "BN", name: "Baden", state: "Niederösterreich", geoIso: "306" },
  { code: "BL", name: "Bruck an der Leitha", state: "Niederösterreich", geoIso: "307" },
  { code: "GF", name: "Gänserndorf", state: "Niederösterreich", geoIso: "308" },
  { code: "GD", name: "Gmünd", state: "Niederösterreich", geoIso: "309" },
  { code: "HL", name: "Hollabrunn", state: "Niederösterreich", geoIso: "310" },
  { code: "HO", name: "Horn", state: "Niederösterreich", geoIso: "311" },
  { code: "KO", name: "Korneuburg", state: "Niederösterreich", geoIso: "312" },
  { code: "KR", name: "Krems (Land)", state: "Niederösterreich", geoIso: "313" },
  { code: "KS", name: "Krems an der Donau", state: "Niederösterreich", geoIso: "301" },
  { code: "LF", name: "Lilienfeld", state: "Niederösterreich", geoIso: "314" },
  { code: "ME", name: "Melk", state: "Niederösterreich", geoIso: "315" },
  { code: "MI", name: "Mistelbach", state: "Niederösterreich", geoIso: "316" },
  { code: "MD", name: "Mödling", state: "Niederösterreich", geoIso: "317" },
  { code: "NK", name: "Neunkirchen", state: "Niederösterreich", geoIso: "318" },
  { code: "P", name: "Sankt Pölten", state: "Niederösterreich", geoIso: "302" },
  { code: "PL", name: "Sankt Pölten (Land)", state: "Niederösterreich", geoIso: "319" },
  { code: "SB", name: "Scheibbs", state: "Niederösterreich", geoIso: "320" },
  { code: "TU", name: "Tulln", state: "Niederösterreich", geoIso: "321" },
  { code: "WB", name: "Wiener Neustadt (Land)", state: "Niederösterreich", geoIso: "323" },
  { code: "WN", name: "Wiener Neustadt", state: "Niederösterreich", geoIso: "304" },
  { code: "WT", name: "Waidhofen an der Thaya", state: "Niederösterreich", geoIso: "322" },
  { code: "WY", name: "Waidhofen an der Ybbs", state: "Niederösterreich", geoIso: "303" },
  { code: "ZT", name: "Zwettl", state: "Niederösterreich", geoIso: "325" },
  { code: "SW", name: "Schwechat", state: "Niederösterreich", geoIso: "307" }, // part of Bruck/Leitha
  { code: "KG", name: "Klosterneuburg", state: "Niederösterreich", geoIso: "321" }, // part of Tulln
  // Oberösterreich
  { code: "L", name: "Linz", state: "Oberösterreich", geoIso: "401" },
  { code: "LL", name: "Linz-Land", state: "Oberösterreich", geoIso: "410" },
  { code: "BR", name: "Braunau am Inn", state: "Oberösterreich", geoIso: "404" },
  { code: "EF", name: "Eferding", state: "Oberösterreich", geoIso: "405" },
  { code: "FR", name: "Freistadt", state: "Oberösterreich", geoIso: "406" },
  { code: "GM", name: "Gmunden", state: "Oberösterreich", geoIso: "407" },
  { code: "GR", name: "Grieskirchen", state: "Oberösterreich", geoIso: "408" },
  { code: "KI", name: "Kirchdorf an der Krems", state: "Oberösterreich", geoIso: "409" },
  { code: "PE", name: "Perg", state: "Oberösterreich", geoIso: "411" },
  { code: "RI", name: "Ried im Innkreis", state: "Oberösterreich", geoIso: "412" },
  { code: "RO", name: "Rohrbach", state: "Oberösterreich", geoIso: "413" },
  { code: "SD", name: "Schärding", state: "Oberösterreich", geoIso: "414" },
  { code: "SE", name: "Steyr-Land", state: "Oberösterreich", geoIso: "415" },
  { code: "SR", name: "Steyr", state: "Oberösterreich", geoIso: "402" },
  { code: "UU", name: "Urfahr-Umgebung", state: "Oberösterreich", geoIso: "416" },
  { code: "VB", name: "Vöcklabruck", state: "Oberösterreich", geoIso: "417" },
  { code: "WE", name: "Wels", state: "Oberösterreich", geoIso: "403" },
  { code: "WL", name: "Wels-Land", state: "Oberösterreich", geoIso: "418" },
  // Salzburg
  { code: "S", name: "Salzburg", state: "Salzburg", geoIso: "501" },
  { code: "HA", name: "Hallein", state: "Salzburg", geoIso: "502" },
  { code: "JO", name: "Sankt Johann im Pongau", state: "Salzburg", geoIso: "504" },
  { code: "SL", name: "Salzburg-Umgebung", state: "Salzburg", geoIso: "503" },
  { code: "TA", name: "Tamsweg", state: "Salzburg", geoIso: "505" },
  { code: "ZE", name: "Zell am See", state: "Salzburg", geoIso: "506" },
  // Steiermark
  { code: "G", name: "Graz", state: "Steiermark", geoIso: "601" },
  { code: "GU", name: "Graz-Umgebung", state: "Steiermark", geoIso: "606" },
  { code: "BM", name: "Bruck-Mürzzuschlag", state: "Steiermark", geoIso: "621" },
  { code: "DL", name: "Deutschlandsberg", state: "Steiermark", geoIso: "603" },
  { code: "HF", name: "Hartberg-Fürstenfeld", state: "Steiermark", geoIso: "622" },
  { code: "LB", name: "Leibnitz", state: "Steiermark", geoIso: "610" },
  { code: "LN", name: "Leoben", state: "Steiermark", geoIso: "611" },
  { code: "LI", name: "Liezen", state: "Steiermark", geoIso: "612" },
  { code: "MT", name: "Murtal", state: "Steiermark", geoIso: "620" },
  { code: "MU", name: "Murau", state: "Steiermark", geoIso: "614" },
  { code: "SO", name: "Südoststeiermark", state: "Steiermark", geoIso: "623" },
  { code: "VO", name: "Voitsberg", state: "Steiermark", geoIso: "616" },
  { code: "WZ", name: "Weiz", state: "Steiermark", geoIso: "617" },
  { code: "GB", name: "Gröbming", state: "Steiermark", geoIso: "612" }, // part of Liezen
  { code: "LE", name: "Leoben (Stadt)", state: "Steiermark", geoIso: "611" }, // part of Leoben
  // Tirol
  { code: "I", name: "Innsbruck", state: "Tirol", geoIso: "701" },
  { code: "IL", name: "Innsbruck-Land", state: "Tirol", geoIso: "703" },
  { code: "IM", name: "Imst", state: "Tirol", geoIso: "702" },
  { code: "KB", name: "Kitzbühel", state: "Tirol", geoIso: "704" },
  { code: "KU", name: "Kufstein", state: "Tirol", geoIso: "705" },
  { code: "LA", name: "Landeck", state: "Tirol", geoIso: "706" },
  { code: "LZ", name: "Lienz", state: "Tirol", geoIso: "707" },
  { code: "RE", name: "Reutte", state: "Tirol", geoIso: "708" },
  { code: "SZ", name: "Schwaz", state: "Tirol", geoIso: "709" },
  // Vorarlberg
  { code: "B", name: "Bregenz", state: "Vorarlberg", geoIso: "802" },
  { code: "BZ", name: "Bludenz", state: "Vorarlberg", geoIso: "801" },
  { code: "DO", name: "Dornbirn", state: "Vorarlberg", geoIso: "803" },
  { code: "FK", name: "Feldkirch", state: "Vorarlberg", geoIso: "804" },
];

// State colors for highlighting (applied to the specific district)
const STATE_COLORS: Record<string, string> = {
  'Wien': '#E63946',
  'Burgenland': '#E76F51',
  'Kärnten': '#F4A261',
  'Niederösterreich': '#2A9D8F',
  'Oberösterreich': '#264653',
  'Salzburg': '#E9C46A',
  'Steiermark': '#606C38',
  'Tirol': '#457B9D',
  'Vorarlberg': '#9B2226',
};

interface GeoJSONFeature {
  type: string;
  properties: { name: string; iso: string };
  geometry: {
    type: string;
    coordinates: number[][][][];
  };
}

interface GeoJSONCollection {
  type: string;
  features: GeoJSONFeature[];
}

// SVG dimensions
const SVG_WIDTH = 600;
const SVG_HEIGHT = 380;
const PADDING = 20;

// Austria bounding box (approximate)
const AUSTRIA_BOUNDS = {
  minLon: 9.5,
  maxLon: 17.2,
  minLat: 46.35,
  maxLat: 49.05,
};

function projectLon(lon: number): number {
  const range = AUSTRIA_BOUNDS.maxLon - AUSTRIA_BOUNDS.minLon;
  return PADDING + ((lon - AUSTRIA_BOUNDS.minLon) / range) * (SVG_WIDTH - 2 * PADDING);
}

function projectLat(lat: number): number {
  const range = AUSTRIA_BOUNDS.maxLat - AUSTRIA_BOUNDS.minLat;
  return PADDING + ((AUSTRIA_BOUNDS.maxLat - lat) / range) * (SVG_HEIGHT - 2 * PADDING);
}

function coordsToPath(coords: number[][][]): string {
  return coords.map(ring => {
    const points = ring.map((p, i) => {
      const x = Math.round(projectLon(p[0]) * 10) / 10;
      const y = Math.round(projectLat(p[1]) * 10) / 10;
      return `${i === 0 ? 'M' : 'L'}${x},${y}`;
    }).join(' ');
    return points + ' Z';
  }).join(' ');
}

function multiPolygonToPath(coordinates: number[][][][]): string {
  return coordinates.map(polygon => coordsToPath(polygon)).join(' ');
}

function generateMapSVG(
  bezirkeFeatures: GeoJSONFeature[],
  laenderFeatures: GeoJSONFeature[],
  highlightIso: string,
  districtName: string,
  stateName: string
): string {
  const highlightColor = STATE_COLORS[stateName] || '#E63946';

  // For Wien (iso 900), the combined "Wien(Stadt)" feature exists, but we also need
  // to skip the individual Wien district features (iso 901-923)
  const isWien = highlightIso === '900';

  // Draw all district features (non-highlighted first, highlighted last)
  const nonHighlighted: string[] = [];
  const highlighted: string[] = [];

  for (const f of bezirkeFeatures) {
    const iso = f.properties.iso;
    // Skip individual Wien districts (901-923) — use 900 (Wien Stadt) instead
    if (parseInt(iso) >= 901 && parseInt(iso) <= 923) continue;

    const isTarget = iso === highlightIso;
    const d = multiPolygonToPath(f.geometry.coordinates);

    if (isTarget) {
      highlighted.push(`  <path d="${d}" fill="${highlightColor}" stroke="#222" stroke-width="2.5" stroke-linejoin="round"/>`);
    } else {
      nonHighlighted.push(`  <path d="${d}" fill="#E8E8E8" stroke="#CCC" stroke-width="0.5" stroke-linejoin="round"/>`);
    }
  }

  // Draw state boundaries on top for clear delineation
  const stateBorders = laenderFeatures.map(f => {
    const d = multiPolygonToPath(f.geometry.coordinates);
    return `  <path d="${d}" fill="none" stroke="#999" stroke-width="1.2" stroke-linejoin="round"/>`;
  }).join('\n');

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SVG_WIDTH} ${SVG_HEIGHT}" width="${SVG_WIDTH}" height="${SVG_HEIGHT}">
  <rect width="${SVG_WIDTH}" height="${SVG_HEIGHT}" fill="#1a1a2e" rx="12"/>
${nonHighlighted.join('\n')}
${highlighted.join('\n')}
${stateBorders}
  <text x="${SVG_WIDTH / 2}" y="${SVG_HEIGHT - 14}" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="22" font-weight="bold" fill="white">${districtName}</text>
</svg>
`;
}

async function main() {
  console.log('Fetching GeoJSON data...');
  const [bezirkeResp, laenderResp] = await Promise.all([
    fetch(BEZIRKE_URL),
    fetch(LAENDER_URL),
  ]);
  const bezirke: GeoJSONCollection = await bezirkeResp.json();
  const laender: GeoJSONCollection = await laenderResp.json();
  console.log(`Got ${bezirke.features.length} district features, ${laender.features.length} state features`);

  const outDir = path.join('local-assets', 'images', 'kennzeichen-maps');
  fs.mkdirSync(outDir, { recursive: true });

  let generated = 0;
  for (const district of districts) {
    // Check that the GeoJSON feature exists
    const feature = bezirke.features.find(f => f.properties.iso === district.geoIso);
    if (!feature) {
      console.warn(`WARNING: No GeoJSON feature for ${district.code} (iso ${district.geoIso}) — ${district.name}`);
      continue;
    }

    const svg = generateMapSVG(
      bezirke.features,
      laender.features,
      district.geoIso,
      district.name,
      district.state
    );

    const filePath = path.join(outDir, `${district.code}.svg`);
    fs.writeFileSync(filePath, svg);
    generated++;
  }

  console.log(`Generated ${generated} map SVGs in ${outDir}`);

  // Update the game JSON to add answerImage
  const gameFile = path.join('games', 'kennzeichen.json');
  const gameData = JSON.parse(fs.readFileSync(gameFile, 'utf-8'));

  for (const q of gameData.instances.v1.questions) {
    const match = q.questionImage?.match(/\/kennzeichen\/([A-Z]+)\.svg$/);
    if (match) {
      q.answerImage = `/images/kennzeichen-maps/${match[1]}.svg`;
    }
  }

  fs.writeFileSync(gameFile, JSON.stringify(gameData, null, 2) + '\n');
  console.log('Updated games/kennzeichen.json with answerImage fields');
}

main().catch(console.error);
