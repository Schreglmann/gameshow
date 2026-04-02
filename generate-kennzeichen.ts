import fs from 'fs';
import path from 'path';

interface District {
  code: string;
  name: string;
  state: string;
}

const districts: District[] = [
  // Wien
  { code: "W", name: "Wien", state: "Wien" },

  // Burgenland
  { code: "E", name: "Eisenstadt", state: "Burgenland" },
  { code: "EU", name: "Eisenstadt-Umgebung", state: "Burgenland" },
  { code: "GS", name: "Güssing", state: "Burgenland" },
  { code: "JE", name: "Jennersdorf", state: "Burgenland" },
  { code: "MA", name: "Mattersburg", state: "Burgenland" },
  { code: "ND", name: "Neusiedl am See", state: "Burgenland" },
  { code: "OP", name: "Oberpullendorf", state: "Burgenland" },
  { code: "OW", name: "Oberwart", state: "Burgenland" },

  // Kärnten
  { code: "K", name: "Klagenfurt", state: "Kärnten" },
  { code: "KL", name: "Klagenfurt-Land", state: "Kärnten" },
  { code: "FE", name: "Feldkirchen", state: "Kärnten" },
  { code: "HE", name: "Hermagor", state: "Kärnten" },
  { code: "SP", name: "Spittal an der Drau", state: "Kärnten" },
  { code: "SV", name: "Sankt Veit an der Glan", state: "Kärnten" },
  { code: "VI", name: "Villach", state: "Kärnten" },
  { code: "VL", name: "Villach-Land", state: "Kärnten" },
  { code: "VK", name: "Völkermarkt", state: "Kärnten" },
  { code: "WO", name: "Wolfsberg", state: "Kärnten" },

  // Niederösterreich
  { code: "AM", name: "Amstetten", state: "Niederösterreich" },
  { code: "BN", name: "Baden", state: "Niederösterreich" },
  { code: "BL", name: "Bruck an der Leitha", state: "Niederösterreich" },
  { code: "GF", name: "Gänserndorf", state: "Niederösterreich" },
  { code: "GD", name: "Gmünd", state: "Niederösterreich" },
  { code: "HL", name: "Hollabrunn", state: "Niederösterreich" },
  { code: "HO", name: "Horn", state: "Niederösterreich" },
  { code: "KO", name: "Korneuburg", state: "Niederösterreich" },
  { code: "KR", name: "Krems (Land)", state: "Niederösterreich" },
  { code: "KS", name: "Krems an der Donau", state: "Niederösterreich" },
  { code: "LF", name: "Lilienfeld", state: "Niederösterreich" },
  { code: "ME", name: "Melk", state: "Niederösterreich" },
  { code: "MI", name: "Mistelbach", state: "Niederösterreich" },
  { code: "MD", name: "Mödling", state: "Niederösterreich" },
  { code: "NK", name: "Neunkirchen", state: "Niederösterreich" },
  { code: "P", name: "Sankt Pölten", state: "Niederösterreich" },
  { code: "PL", name: "Sankt Pölten (Land)", state: "Niederösterreich" },
  { code: "SB", name: "Scheibbs", state: "Niederösterreich" },
  { code: "TU", name: "Tulln", state: "Niederösterreich" },
  { code: "WB", name: "Wiener Neustadt (Land)", state: "Niederösterreich" },
  { code: "WN", name: "Wiener Neustadt", state: "Niederösterreich" },
  { code: "WT", name: "Waidhofen an der Thaya", state: "Niederösterreich" },
  { code: "WY", name: "Waidhofen an der Ybbs", state: "Niederösterreich" },
  { code: "ZT", name: "Zwettl", state: "Niederösterreich" },

  // Oberösterreich
  { code: "L", name: "Linz", state: "Oberösterreich" },
  { code: "LL", name: "Linz-Land", state: "Oberösterreich" },
  { code: "BR", name: "Braunau am Inn", state: "Oberösterreich" },
  { code: "EF", name: "Eferding", state: "Oberösterreich" },
  { code: "FR", name: "Freistadt", state: "Oberösterreich" },
  { code: "GM", name: "Gmunden", state: "Oberösterreich" },
  { code: "GR", name: "Grieskirchen", state: "Oberösterreich" },
  { code: "KI", name: "Kirchdorf an der Krems", state: "Oberösterreich" },
  { code: "PE", name: "Perg", state: "Oberösterreich" },
  { code: "RI", name: "Ried im Innkreis", state: "Oberösterreich" },
  { code: "RO", name: "Rohrbach", state: "Oberösterreich" },
  { code: "SD", name: "Schärding", state: "Oberösterreich" },
  { code: "SE", name: "Steyr-Land", state: "Oberösterreich" },
  { code: "SR", name: "Steyr", state: "Oberösterreich" },
  { code: "UU", name: "Urfahr-Umgebung", state: "Oberösterreich" },
  { code: "VB", name: "Vöcklabruck", state: "Oberösterreich" },
  { code: "WE", name: "Wels", state: "Oberösterreich" },
  { code: "WL", name: "Wels-Land", state: "Oberösterreich" },

  // Salzburg
  { code: "S", name: "Salzburg", state: "Salzburg" },
  { code: "HA", name: "Hallein", state: "Salzburg" },
  { code: "JO", name: "Sankt Johann im Pongau", state: "Salzburg" },
  { code: "SL", name: "Salzburg-Umgebung", state: "Salzburg" },
  { code: "TA", name: "Tamsweg", state: "Salzburg" },
  { code: "ZE", name: "Zell am See", state: "Salzburg" },

  // Steiermark
  { code: "G", name: "Graz", state: "Steiermark" },
  { code: "GU", name: "Graz-Umgebung", state: "Steiermark" },
  { code: "BM", name: "Bruck-Mürzzuschlag", state: "Steiermark" },
  { code: "DL", name: "Deutschlandsberg", state: "Steiermark" },
  { code: "HF", name: "Hartberg-Fürstenfeld", state: "Steiermark" },
  { code: "LB", name: "Leibnitz", state: "Steiermark" },
  { code: "LN", name: "Leoben", state: "Steiermark" },
  { code: "LI", name: "Liezen", state: "Steiermark" },
  { code: "MT", name: "Murtal", state: "Steiermark" },
  { code: "MU", name: "Murau", state: "Steiermark" },
  { code: "SO", name: "Südoststeiermark", state: "Steiermark" },
  { code: "VO", name: "Voitsberg", state: "Steiermark" },
  { code: "WZ", name: "Weiz", state: "Steiermark" },

  // Steiermark special
  { code: "GB", name: "Gröbming", state: "Steiermark" },

  // Tirol
  { code: "I", name: "Innsbruck", state: "Tirol" },
  { code: "IL", name: "Innsbruck-Land", state: "Tirol" },
  { code: "IM", name: "Imst", state: "Tirol" },
  { code: "KB", name: "Kitzbühel", state: "Tirol" },
  { code: "KU", name: "Kufstein", state: "Tirol" },
  { code: "LA", name: "Landeck", state: "Tirol" },
  { code: "LZ", name: "Lienz", state: "Tirol" },
  { code: "RE", name: "Reutte", state: "Tirol" },
  { code: "SZ", name: "Schwaz", state: "Tirol" },

  // Vorarlberg
  { code: "B", name: "Bregenz", state: "Vorarlberg" },
  { code: "BZ", name: "Bludenz", state: "Vorarlberg" },
  { code: "DO", name: "Dornbirn", state: "Vorarlberg" },
  { code: "FK", name: "Feldkirch", state: "Vorarlberg" },

  // Special sub-district codes
  { code: "SW", name: "Schwechat", state: "Niederösterreich" },
  { code: "KG", name: "Klosterneuburg", state: "Niederösterreich" },
  { code: "LE", name: "Leoben (Stadt)", state: "Steiermark" },
];

function seededRandom(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
}

function generateEUStars(cx: number, cy: number, radius: number): string {
  const stars: string[] = [];
  for (let i = 0; i < 12; i++) {
    const angle = (i * 30 - 90) * (Math.PI / 180);
    const x = cx + radius * Math.cos(angle);
    const y = cy + radius * Math.sin(angle);
    // 5-pointed star
    const starSize = 3;
    const points: string[] = [];
    for (let j = 0; j < 10; j++) {
      const a = (j * 36 - 90) * (Math.PI / 180);
      const r = j % 2 === 0 ? starSize : starSize * 0.4;
      points.push(`${x + r * Math.cos(a)},${y + r * Math.sin(a)}`);
    }
    stars.push(`<polygon points="${points.join(' ')}" fill="#FFCC00"/>`);
  }
  return stars.join('\n    ');
}

function generateShieldPath(cx: number, cy: number, w: number, h: number): string {
  // Heraldic shield shape centered at (cx, cy) with half-width w and half-height h
  const top = cy - h;
  const bot = cy + h;
  const left = cx - w;
  const right = cx + w;
  const curveStart = cy + h * 0.3;
  return `M ${left} ${top}
    L ${right} ${top}
    L ${right} ${curveStart}
    Q ${right} ${bot - h * 0.1} ${cx} ${bot}
    Q ${left} ${bot - h * 0.1} ${left} ${curveStart}
    Z`;
}

function generatePlateSVG(district: District): string {
  const { code } = district;
  const seed = code.split('').reduce((a, c) => a + c.charCodeAt(0), 0);
  const rng = seededRandom(seed);

  // Generate plate number: always 3 digits + 2 letters (standard Austrian format)
  const digits = Array.from({ length: 3 }, () => Math.floor(rng() * 10)).join('');
  const plateLetters = 'ABCDEFGHJKLNPRSTUVXYZ'; // exclude M, W, O, Q (too wide or confusable)
  const l1 = plateLetters[Math.floor(rng() * plateLetters.length)];
  const l2 = plateLetters[Math.floor(rng() * plateLetters.length)];
  const plateNum = `${digits} ${l1}${l2}`;

  // Layout constants — modeled after real Austrian plate (520mm × 110mm, scaled to 520×120px)
  const width = 520;
  const height = 120;
  const euBandWidth = 46;
  const borderRadius = 8;
  const borderWidth = 2;

  // Stripes — 4px each with 2px gap, 6px inset from plate border
  const stripeHeight = 4;
  const stripeGap = 2;
  const stripeInset = 6;
  // Top band: y=6 to y=22 (6+4+2+4+2+4=22). Bottom band: y=98 to y=114.
  // Content area: y=22 to y=98 = 76px

  // At font-size 65, cap height ≈ 47px → fills 47/76 = 62% of content area
  const fontSize = 65;
  const capHeight = Math.round(fontSize * 0.72); // 47px
  const contentCenterY = 60; // (22+98)/2 = 60
  const textBaseline = Math.round(contentCenterY + capHeight / 2); // 84

  // Austrian red
  const red = '#C8102E';

  // Per-character widths for Arial Black at font-size 65.
  // Measured directly in browser (getBBox) at 72px, scaled by 65/72.
  const charWidths: Record<string, number> = {
    'W': 65, 'M': 61,
    'G': 54, 'H': 54, 'K': 54, 'N': 54, 'O': 54, 'Q': 54, 'U': 54,
    'A': 51, 'B': 51, 'C': 51, 'D': 51, 'R': 51, 'V': 51, 'X': 51, 'Y': 51,
    'E': 47, 'P': 47, 'S': 47, 'T': 47, 'Z': 47,
    'F': 43, 'J': 43, 'L': 43, 'I': 25,
    // Digits — Arial Black tabular: all same advance width
    '0': 43, '1': 43, '2': 43, '3': 43, '4': 43, '5': 43,
    '6': 43, '7': 43, '8': 43, '9': 43,
  };

  const codeStartX = euBandWidth + 14; // 60
  const codeLetterSpacing = 1;
  const codeChars = code.split('');
  // Total text advance includes trailing letter-spacing after each char (SVG spec).
  // For shield centering, measure from the visual right edge of the last glyph,
  // which is codeEndX minus one trailing letter-spacing.
  const codeTextWidth = codeChars.reduce(
    (sum, ch) => sum + (charWidths[ch] || 47), 0
  ) + codeChars.length * codeLetterSpacing;
  const codeEndX = codeStartX + codeTextWidth;
  const codeGlyphEndX = codeEndX - codeLetterSpacing; // right edge of last glyph

  // Shield — proportions matching reference image (~40×48px)
  const shieldW = 20;    // half-width → 40px total
  const shieldH = 24;    // half-height → 48px total
  // shieldGap is the equal whitespace between code glyph end and shield left,
  // and between shield right and number start. Checked: WO + worst-case num fits at gap=10.
  const shieldGap = 10;
  const shieldCX = codeGlyphEndX + shieldGap + shieldW;
  const shieldCY = contentCenterY; // centered in content area

  // Plate number starts after shield + same gap
  const numStartX = shieldCX + shieldW + shieldGap;
  const rightMargin = 10;
  const maxNumWidth = width - numStartX - rightMargin;
  const spaceW = 20;
  const numLetterSpacing = 2;
  let clippedPlateNum = '';
  let usedWidth = 0;
  for (const ch of plateNum) {
    const w = ch === ' ' ? spaceW : (charWidths[ch] || 47) + numLetterSpacing;
    if (usedWidth + w > maxNumWidth) break;
    clippedPlateNum += ch;
    usedWidth += w;
  }
  clippedPlateNum = clippedPlateNum.trimEnd();

  // EU stars centered in upper portion of EU band
  const euStars = generateEUStars(euBandWidth / 2 + 1, 40, 13);

  // Red-White-Red stripe y positions (top)
  const topStripe1Y = stripeInset;
  const topStripe2Y = topStripe1Y + stripeHeight + stripeGap;
  const topStripe3Y = topStripe2Y + stripeHeight + stripeGap;

  // Red-White-Red stripe y positions (bottom)
  const botStripe3Y = height - stripeInset - stripeHeight;
  const botStripe2Y = botStripe3Y - stripeGap - stripeHeight;
  const botStripe1Y = botStripe2Y - stripeGap - stripeHeight;

  const stripeX = euBandWidth + 2;
  const stripeW = width - euBandWidth - borderWidth - 4;

  const shieldPath = generateShieldPath(shieldCX, shieldCY, shieldW, shieldH);

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">
  <defs>
    <clipPath id="plate-clip">
      <rect x="0" y="0" width="${width}" height="${height}" rx="${borderRadius}"/>
    </clipPath>
  </defs>

  <!-- Plate background with border -->
  <rect x="${borderWidth / 2}" y="${borderWidth / 2}" width="${width - borderWidth}" height="${height - borderWidth}" rx="${borderRadius}" fill="white" stroke="#444" stroke-width="${borderWidth}"/>

  <!-- Blue EU band -->
  <rect x="${borderWidth / 2}" y="${borderWidth / 2}" width="${euBandWidth}" height="${height - borderWidth}" rx="${borderRadius}" fill="#003399" clip-path="url(#plate-clip)"/>
  <rect x="${euBandWidth - 10}" y="${borderWidth / 2}" width="11" height="${height - borderWidth}" fill="#003399" clip-path="url(#plate-clip)"/>

  <!-- Red-White-Red stripe (top) -->
  <rect x="${stripeX}" y="${topStripe1Y}" width="${stripeW}" height="${stripeHeight}" fill="${red}" rx="1"/>
  <rect x="${stripeX}" y="${topStripe2Y}" width="${stripeW}" height="${stripeHeight}" fill="white"/>
  <rect x="${stripeX}" y="${topStripe3Y}" width="${stripeW}" height="${stripeHeight}" fill="${red}" rx="1"/>

  <!-- Red-White-Red stripe (bottom) -->
  <rect x="${stripeX}" y="${botStripe1Y}" width="${stripeW}" height="${stripeHeight}" fill="${red}" rx="1"/>
  <rect x="${stripeX}" y="${botStripe2Y}" width="${stripeW}" height="${stripeHeight}" fill="white"/>
  <rect x="${stripeX}" y="${botStripe3Y}" width="${stripeW}" height="${stripeHeight}" fill="${red}" rx="1"/>

  <!-- Coat of arms placeholder (shield) — drawn before text so text renders on top -->
  <path d="${shieldPath}" fill="#E8E8E8" stroke="#AAAAAA" stroke-width="1.5"/>

  <!-- EU stars -->
  <g>
    ${euStars}
  </g>

  <!-- A in EU band -->
  <text x="${euBandWidth / 2 + 1}" y="90" text-anchor="middle" font-size="22" font-weight="bold" fill="white" font-family="Arial, Helvetica, sans-serif">A</text>

  <!-- District code -->
  <text x="${codeStartX}" y="${textBaseline}" font-size="${fontSize}" font-weight="900" fill="black" font-family="'DIN 1451 Mittelschrift', 'Arial Black', 'Helvetica Black', sans-serif" letter-spacing="${codeLetterSpacing}">${code}</text>

  <!-- Plate number -->
  <text x="${numStartX}" y="${textBaseline}" font-size="${fontSize}" font-weight="900" fill="black" font-family="'DIN 1451 Mittelschrift', 'Arial Black', 'Helvetica Black', sans-serif" letter-spacing="${numLetterSpacing}">${clippedPlateNum}</text>
</svg>`;
}

// Generate all plates
const outDir = path.join(process.cwd(), 'local-assets', 'images', 'kennzeichen');
fs.mkdirSync(outDir, { recursive: true });

for (const district of districts) {
  const svg = generatePlateSVG(district);
  const filename = `${district.code}.svg`;
  fs.writeFileSync(path.join(outDir, filename), svg);
  console.log(`Generated ${filename}`);
}

// Generate game JSON
interface Question {
  question: string;
  answer: string;
  questionImage: string;
}

const questions: Question[] = districts.map(d => ({
  question: "",
  answer: `${d.name} (${d.state})`,
  questionImage: `/images/kennzeichen/${d.code}.svg`,
}));

const gameConfig = {
  type: "simple-quiz",
  title: "Kennzeichen Quiz",
  rules: [
    "Errate den Bezirk des Kennzeichens"
  ],
  instances: {
    v1: {
      questions: questions
    }
  },
  randomizeQuestions: true
};

fs.writeFileSync(
  path.join(process.cwd(), 'games', 'kennzeichen.json'),
  JSON.stringify(gameConfig, null, 2) + '\n'
);

console.log(`\nGenerated ${districts.length} licence plate SVGs in ${outDir}`);
console.log(`Updated games/kennzeichen.json with ${questions.length} questions`);
