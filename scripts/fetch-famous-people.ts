/**
 * Fetch portrait images of famous people into local-assets/images/Personen/download/.
 *
 * Source: Wikipedia REST summary API (en first, de as fallback) → originalimage.source
 *         on upload.wikimedia.org.
 *
 * Filenames: "Vorname Nachname.<ext>" with original capitalization and spaces.
 * Idempotent: skips files already present in download/ or in the parent Personen/ folder.
 *
 * Usage (from repo root):
 *   npx tsx scripts/fetch-famous-people.ts [--dry-run]
 */

import fs from 'fs';
import path from 'path';
import { ProxyAgent, setGlobalDispatcher } from 'undici';

const proxyUrl = process.env.HTTPS_PROXY || process.env.https_proxy || process.env.HTTP_PROXY || process.env.http_proxy;
if (proxyUrl) {
  setGlobalDispatcher(new ProxyAgent(proxyUrl));
}

const SAVE_DIR = path.join(process.cwd(), 'local-assets', 'images', 'Personen', 'download');
const EXISTING_DIR = path.join(process.cwd(), 'local-assets', 'images', 'Personen');
const DRY_RUN = process.argv.includes('--dry-run');

const USER_AGENT =
  'Gameshow-DAM-Fetch/1.0 (https://github.com/vivid-planet/gameshow; georg.schreglmann@vivid-planet.com)';

// Each entry: [display-name, optional-wikipedia-title-override]
// Override is used when the Wikipedia article title differs from how we want
// to name the file (e.g. "King Charles III" → "Charles III").
type Entry = { name: string; titleEn?: string; titleDe?: string };

const PEOPLE: Entry[] = [
  // German politicians
  { name: 'Angela Merkel' },
  { name: 'Olaf Scholz' },
  { name: 'Friedrich Merz' },
  { name: 'Robert Habeck' },
  { name: 'Markus Söder' },
  { name: 'Christian Lindner' },
  { name: 'Frank-Walter Steinmeier' },
  { name: 'Helmut Kohl' },
  { name: 'Willy Brandt' },
  { name: 'Konrad Adenauer' },
  // German entertainers / athletes
  { name: 'Helene Fischer' },
  { name: 'Herbert Grönemeyer' },
  { name: 'Til Schweiger' },
  { name: 'Daniel Brühl' },
  { name: 'Diane Kruger' },
  { name: 'Boris Becker' },
  { name: 'Steffi Graf' },
  { name: 'Franz Beckenbauer' },
  { name: 'Dirk Nowitzki' },
  { name: 'Manuel Neuer' },

  // World leaders / politicians
  { name: 'Joe Biden' },
  { name: 'Donald Trump' },
  { name: 'Kamala Harris' },
  { name: 'Barack Obama' },
  { name: 'Emmanuel Macron' },
  { name: 'Rishi Sunak' },
  { name: 'Keir Starmer' },
  { name: 'Justin Trudeau' },
  { name: 'Vladimir Putin' },
  { name: 'Xi Jinping' },
  { name: 'Narendra Modi' },
  { name: 'King Charles III', titleEn: 'Charles III' },
  { name: 'Ursula von der Leyen' },
  { name: 'Pope Francis' },
  { name: 'Joschka Fischer' },

  // Tech / business
  { name: 'Elon Musk' },
  { name: 'Bill Gates' },
  { name: 'Steve Jobs' },
  { name: 'Jeff Bezos' },
  { name: 'Sam Altman' },
  { name: 'Tim Cook' },
  { name: 'Sundar Pichai' },
  { name: 'Satya Nadella' },
  { name: 'Larry Page' },
  { name: 'Sergey Brin' },
  { name: 'Warren Buffett' },
  { name: 'Bernard Arnault' },
  { name: 'Jensen Huang' },
  { name: 'Larry Ellison' },
  { name: 'Michael Dell' },

  // Actors
  { name: 'Leonardo DiCaprio' },
  { name: 'Brad Pitt' },
  { name: 'Tom Hanks' },
  { name: 'Tom Cruise' },
  { name: 'Robert De Niro' },
  { name: 'Meryl Streep' },
  { name: 'Scarlett Johansson' },
  { name: 'Jennifer Lawrence' },
  { name: 'Margot Robbie' },
  { name: 'Keanu Reeves' },
  { name: 'Denzel Washington' },
  { name: 'Cate Blanchett' },
  { name: 'Ryan Gosling' },
  { name: 'Emma Stone' },
  { name: 'Anya Taylor-Joy' },

  // Musicians
  { name: 'Taylor Swift' },
  { name: 'Beyoncé' },
  { name: 'Adele' },
  { name: 'Ed Sheeran' },
  { name: 'Billie Eilish' },
  { name: 'Drake', titleEn: 'Drake (musician)' },
  { name: 'Rihanna' },
  { name: 'Bruno Mars' },
  { name: 'Bono' },
  { name: 'Mick Jagger' },

  // Athletes
  { name: 'Lionel Messi' },
  { name: 'Cristiano Ronaldo' },
  { name: 'Roger Federer' },
  { name: 'Rafael Nadal' },
  { name: 'Serena Williams' },
  { name: 'LeBron James' },
  { name: 'Michael Jordan' },
  { name: 'Lewis Hamilton' },
  { name: 'Max Verstappen' },
  { name: 'Usain Bolt' },

  // Scientists / historical
  { name: 'Albert Einstein' },
  { name: 'Marie Curie' },
  { name: 'Stephen Hawking' },
  { name: 'Isaac Newton' },
  { name: 'Charles Darwin' },
  { name: 'Nikola Tesla' },
  { name: 'Leonardo da Vinci' },
  { name: 'Wolfgang Amadeus Mozart' },
  { name: 'Ludwig van Beethoven' },
  { name: 'Sigmund Freud' },

  // Authors / cultural
  { name: 'William Shakespeare' },
  { name: 'J. K. Rowling' },
  { name: 'Stephen King' },
  { name: 'Friedrich Schiller' },
  { name: 'Johann Wolfgang von Goethe' },

  // Extras to bring total to 100 after dedup
  { name: 'Vincent van Gogh' },
  { name: 'Frida Kahlo' },
  { name: 'Salvador Dalí' },
  { name: 'Mahatma Gandhi' },
  { name: 'Nelson Mandela' },
  { name: 'Martin Luther King Jr.', titleEn: 'Martin Luther King Jr.' },
  { name: 'Winston Churchill' },
  { name: 'Charlie Chaplin' },
  { name: 'Audrey Hepburn' },
  { name: 'Marilyn Monroe' },

  // ─── Batch 2: 100 more ──────────────────────────────────────────────

  // More German politicians / public figures
  { name: 'Gerhard Schröder' },
  { name: 'Joachim Gauck' },
  { name: 'Christian Wulff' },
  { name: 'Horst Köhler' },
  { name: 'Gregor Gysi' },
  { name: 'Sahra Wagenknecht' },
  { name: 'Alice Weidel' },
  { name: 'Karl Lauterbach' },
  { name: 'Annalena Baerbock' },
  { name: 'Hubertus Heil' },

  // More German athletes / coaches
  { name: 'Toni Kroos' },
  { name: 'Thomas Müller' },
  { name: 'Bastian Schweinsteiger' },
  { name: 'Jürgen Klopp' },
  { name: 'Michael Schumacher' },
  { name: 'Sebastian Vettel' },
  { name: 'Mick Schumacher' },
  { name: 'Magdalena Neuner' },
  { name: 'Maria Höfl-Riesch' },
  { name: 'Felix Neureuther' },

  // More German actors
  { name: 'Christoph Waltz' },
  { name: 'Mario Adorf' },
  { name: 'Iris Berben' },
  { name: 'Heidi Klum' },
  { name: 'Matthias Schweighöfer' },
  { name: 'Veronica Ferres' },
  { name: 'Bruno Ganz' },
  { name: 'Romy Schneider' },

  // German TV / entertainers
  { name: 'Thomas Gottschalk' },
  { name: 'Günther Jauch' },
  { name: 'Jan Böhmermann' },

  // More German musicians
  { name: 'Udo Lindenberg' },
  { name: 'Peter Maffay' },
  { name: 'Nena', titleEn: 'Nena' },
  { name: 'Lena Meyer-Landrut' },

  // More world leaders / politicians
  { name: 'Hillary Clinton' },
  { name: 'Bill Clinton' },
  { name: 'George W. Bush' },
  { name: 'Ronald Reagan' },
  { name: 'Margaret Thatcher' },
  { name: 'Tony Blair' },
  { name: 'Boris Johnson' },
  { name: 'Recep Tayyip Erdoğan' },
  { name: 'Benjamin Netanyahu' },
  { name: 'John F. Kennedy' },

  // Historical figures
  { name: 'Adolf Hitler' },
  { name: 'Joseph Stalin' },
  { name: 'Napoleon Bonaparte' },
  { name: 'Julius Caesar' },
  { name: 'Karl Marx' },
  { name: 'Vladimir Lenin' },
  { name: 'Mao Zedong' },
  { name: 'Otto von Bismarck' },
  { name: 'Anne Frank' },
  { name: 'Che Guevara' },

  // More international actors
  { name: 'Will Smith' },
  { name: 'Johnny Depp' },
  { name: 'Morgan Freeman' },
  { name: 'Anthony Hopkins' },
  { name: 'Hugh Jackman' },
  { name: 'Christian Bale' },
  { name: 'Daniel Craig' },
  { name: 'Harrison Ford' },
  { name: 'Samuel L. Jackson' },

  // More actresses
  { name: 'Angelina Jolie' },
  { name: 'Julia Roberts' },
  { name: 'Sandra Bullock' },
  { name: 'Nicole Kidman' },
  { name: 'Charlize Theron' },

  // More international musicians
  { name: 'Madonna', titleEn: 'Madonna' },
  { name: 'Michael Jackson' },
  { name: 'Elvis Presley' },
  { name: 'Freddie Mercury' },
  { name: 'John Lennon' },
  { name: 'Paul McCartney' },
  { name: 'David Bowie' },
  { name: 'Bob Dylan' },
  { name: 'Bruce Springsteen' },
  { name: 'Eminem' },

  // Newer-generation musicians
  { name: 'Lady Gaga' },
  { name: 'Ariana Grande' },
  { name: 'Justin Bieber' },
  { name: 'Shakira' },
  { name: 'Dua Lipa' },

  // More athletes
  { name: 'Tiger Woods' },
  { name: 'Tom Brady' },
  { name: 'Kobe Bryant' },
  { name: 'Mike Tyson' },
  { name: 'Muhammad Ali' },
  { name: 'Diego Maradona' },
  { name: 'Pelé' },
  { name: 'Zinedine Zidane' },
  { name: 'Kylian Mbappé' },
  { name: 'Neymar' },

  // Scientists / inventors
  { name: 'Galileo Galilei' },
  { name: 'Thomas Edison' },
  { name: 'Aristotle' },

  // Filmmakers
  { name: 'Walt Disney' },
  { name: 'Alfred Hitchcock' },
  { name: 'Stanley Kubrick' },
  { name: 'Quentin Tarantino' },
  { name: 'Steven Spielberg' },
  { name: 'Christopher Nolan' },

  // More authors
  { name: 'Ernest Hemingway' },
  { name: 'George Orwell' },
  { name: 'J. R. R. Tolkien' },
  { name: 'Friedrich Nietzsche' },
  { name: 'Immanuel Kant' },

  // ─── Famous Austrians ─────────────────────────────────────────────
  { name: 'Arnold Schwarzenegger' },
  { name: 'Falco', titleEn: 'Falco (musician)' },
  { name: 'Niki Lauda' },
  { name: 'Conchita Wurst' },
  { name: 'Gustav Klimt' },
  { name: 'Egon Schiele' },
  { name: 'Marcel Hirscher' },
  { name: 'Hermann Maier' },
  { name: 'Toni Sailer' },
  { name: 'David Alaba' },
  { name: 'Hedy Lamarr' },
  { name: 'Erwin Schrödinger' },
  { name: 'Ludwig Wittgenstein' },
  { name: 'Maria Theresa' },
  { name: 'Empress Elisabeth of Austria', titleEn: 'Empress Elisabeth of Austria' },
  { name: 'Franz Joseph I', titleEn: 'Franz Joseph I of Austria' },
  { name: 'Johann Strauss II' },
  { name: 'Gustav Mahler' },
  { name: 'Joseph Haydn' },
  { name: 'Sebastian Kurz' },
  { name: 'Alexander Van der Bellen' },
  { name: 'Friedensreich Hundertwasser' },
  { name: 'Bruno Kreisky' },
  { name: 'Tobias Moretti' },
  { name: 'Andreas Gabalier' },

  // ─── 25 more Austrians ─────────────────────────────────────────────
  // Composers
  { name: 'Franz Schubert' },
  { name: 'Anton Bruckner' },
  { name: 'Johann Strauss I' },
  { name: 'Franz Lehár' },
  { name: 'Arnold Schönberg' },

  // Scientists / thinkers
  { name: 'Karl Popper' },
  { name: 'Friedrich Hayek' },
  { name: 'Lise Meitner' },
  { name: 'Konrad Lorenz' },
  { name: 'Ludwig Boltzmann' },
  { name: 'Viktor Frankl' },
  { name: 'Alfred Adler' },
  { name: 'Bertha von Suttner' },

  // Authors
  { name: 'Stefan Zweig' },
  { name: 'Thomas Bernhard' },
  { name: 'Elfriede Jelinek' },
  { name: 'Peter Handke' },
  { name: 'Arthur Schnitzler' },

  // Actors / directors
  { name: 'Klaus Maria Brandauer' },
  { name: 'Michael Haneke' },
  { name: 'Fritz Lang' },
  { name: 'Maximilian Schell' },

  // Athletes
  { name: 'Franz Klammer' },
  { name: 'Gerhard Berger' },
  { name: 'Marko Arnautović' },

  // ─── Austrian current celebrities (singers / actors / TV) ───────────
  // Singers
  { name: 'Mathea', titleEn: 'Mathea (singer)' },
  { name: 'Ina Regen' },
  { name: 'Christina Stürmer' },
  { name: 'Yung Hurn' },
  { name: 'RAF Camora' },
  { name: 'Hubert von Goisern' },
  { name: 'Wolfgang Ambros' },
  { name: 'Rainhard Fendrich' },
  { name: 'DJ Ötzi' },
  { name: 'Lou Asril' },

  // Actors
  { name: 'Karl Markovics' },
  { name: 'Birgit Minichmayr' },
  { name: 'Valerie Pachner' },
  { name: 'Cornelius Obonya' },
  { name: 'Verena Altenberger' },
  { name: 'Josef Hader' },
  { name: 'Manuel Rubey' },
  { name: 'Robert Palfrader' },
  { name: 'Florian Teichtmeister' },
  { name: 'Ursula Strauss' },

  // TV / comedy
  { name: 'Christoph Grissemann' },
  { name: 'Dirk Stermann' },
  { name: 'Michael Niavarani' },

  // Current athletes
  { name: 'Anna Gasser' },
  { name: 'Vincent Kriechmayr' },

  // Replacements for two without Wikipedia portraits (Mathea, Lou Asril) + a content creator
  { name: 'Cesár Sampson' },
  { name: 'JJ', titleEn: 'JJ (singer)' },
  { name: 'Bambi Mercury' },
];

function normalizeForDedup(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function extFromUrl(url: string): string {
  const p = new URL(url).pathname.toLowerCase();
  const known = ['.jpg', '.jpeg', '.png', '.webp', '.svg', '.gif', '.avif'];
  for (const ext of known) {
    if (p.endsWith(ext)) return ext === '.jpeg' ? '.jpg' : ext;
  }
  return '.jpg';
}

function isImageBuffer(buf: Buffer): boolean {
  if (buf.length < 12) return false;
  const head = buf.subarray(0, 16);
  const isJpeg = head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff;
  const isPng = head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47;
  const isGif = head[0] === 0x47 && head[1] === 0x49 && head[2] === 0x46 && head[3] === 0x38;
  const isWebp =
    head[0] === 0x52 &&
    head[1] === 0x49 &&
    head[2] === 0x46 &&
    head[3] === 0x46 &&
    head[8] === 0x57 &&
    head[9] === 0x45 &&
    head[10] === 0x42 &&
    head[11] === 0x50;
  const isAvif = head[4] === 0x66 && head[5] === 0x74 && head[6] === 0x79 && head[7] === 0x70;
  const headAscii = head.toString('ascii').trimStart();
  const isSvg = headAscii.startsWith('<svg') || headAscii.startsWith('<?xml');
  return isJpeg || isPng || isGif || isWebp || isAvif || isSvg;
}

type SummaryImage = { url: string; lang: 'en' | 'de'; isOriginal: boolean };

async function fetchWithBackoff(url: string, init: RequestInit, label: string): Promise<Response> {
  let delay = 2000;
  for (let attempt = 0; attempt < 6; attempt++) {
    const res = await fetch(url, init);
    if (res.status !== 429) return res;
    const retryAfter = parseInt(res.headers.get('retry-after') || '', 10);
    const wait = Number.isFinite(retryAfter) ? retryAfter * 1000 : delay;
    console.log(`    ⏳ 429 on ${label}, waiting ${(wait / 1000).toFixed(1)}s (attempt ${attempt + 1}/6)`);
    await sleep(wait);
    delay = Math.min(delay * 2, 60000);
  }
  return fetch(url, init);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchPageImage(title: string, lang: 'en' | 'de'): Promise<SummaryImage | null> {
  const apiTitle = encodeURIComponent(title.replace(/ /g, '_'));
  const url = `https://${lang}.wikipedia.org/api/rest_v1/page/summary/${apiTitle}?redirect=true`;
  const res = await fetchWithBackoff(
    url,
    { headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' }, redirect: 'follow' },
    `summary/${lang}/${title}`,
  );
  if (!res.ok) return null;
  const json = (await res.json()) as {
    originalimage?: { source?: string };
    thumbnail?: { source?: string };
  };
  if (json.originalimage?.source) {
    return { url: json.originalimage.source, lang, isOriginal: true };
  }
  if (json.thumbnail?.source) {
    return { url: json.thumbnail.source, lang, isOriginal: false };
  }
  return null;
}

async function resolveImage(entry: Entry): Promise<SummaryImage | null> {
  const enTitle = entry.titleEn ?? entry.name;
  const deTitle = entry.titleDe ?? entry.name;
  const en = await fetchPageImage(enTitle, 'en');
  if (en?.isOriginal) return en;
  const de = await fetchPageImage(deTitle, 'de');
  if (de?.isOriginal) return de;
  return en ?? de ?? null;
}

async function downloadBuffer(url: string): Promise<Buffer> {
  const res = await fetchWithBackoff(
    url,
    { headers: { 'User-Agent': USER_AGENT, Accept: 'image/*,*/*;q=0.8' }, redirect: 'follow' },
    `download ${path.basename(new URL(url).pathname)}`,
  );
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (!isImageBuffer(buf)) throw new Error('Response is not an image');
  return buf;
}

function existingNormalizedNames(): Set<string> {
  const names = new Set<string>();
  if (!fs.existsSync(EXISTING_DIR)) return names;
  for (const entry of fs.readdirSync(EXISTING_DIR, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const base = path.basename(entry.name, path.extname(entry.name));
    names.add(normalizeForDedup(base));
  }
  return names;
}

async function main() {
  console.log(`👤 Fetching ${PEOPLE.length} famous-people portraits...\n`);

  if (!DRY_RUN) fs.mkdirSync(SAVE_DIR, { recursive: true });

  const existing = existingNormalizedNames();
  const downloadDirExisting = new Set<string>();
  if (fs.existsSync(SAVE_DIR)) {
    for (const f of fs.readdirSync(SAVE_DIR)) {
      const base = path.basename(f, path.extname(f));
      downloadDirExisting.add(normalizeForDedup(base));
    }
  }

  let fetched = 0;
  let skipped = 0;
  let failed = 0;
  let lowRes = 0;

  let firstRealFetch = true;
  for (const entry of PEOPLE) {
    const norm = normalizeForDedup(entry.name);

    if (existing.has(norm)) {
      console.log(`  ⤳ ${entry.name} — already in Personen/, skipped`);
      skipped++;
      continue;
    }
    if (downloadDirExisting.has(norm)) {
      console.log(`  ✓ ${entry.name} — already in download/, skipped`);
      skipped++;
      continue;
    }

    try {
      if (!DRY_RUN && !firstRealFetch) await sleep(1500);
      firstRealFetch = false;
      const img = await resolveImage(entry);
      if (!img) {
        console.warn(`  ❌ ${entry.name} — no image on Wikipedia`);
        failed++;
        continue;
      }

      const ext = extFromUrl(img.url);
      const filename = `${entry.name}${ext}`;
      const outPath = path.join(SAVE_DIR, filename);

      if (DRY_RUN) {
        const tag = img.isOriginal ? 'orig' : 'thumb';
        console.log(`  🔍 ${entry.name} → ${img.lang}/${tag}: ${img.url}`);
        fetched++;
        continue;
      }

      const buf = await downloadBuffer(img.url);
      fs.writeFileSync(outPath, buf);
      const tag = img.isOriginal ? 'orig' : 'THUMB-LOWRES';
      const kb = (buf.length / 1024).toFixed(0);
      console.log(`  ✅ ${filename}  (${kb} KB, ${img.lang}/${tag})`);
      if (!img.isOriginal) lowRes++;
      fetched++;
    } catch (e) {
      const err = e as Error & { cause?: { message?: string } };
      const cause = err.cause?.message ? ` (${err.cause.message})` : '';
      console.warn(`  ❌ ${entry.name} — ${err.message}${cause}`);
      failed++;
    }
  }

  console.log(
    `\n📊 ${fetched} fetched, ${skipped} skipped, ${failed} failed, ${lowRes} low-res fallbacks`,
  );
  if (lowRes > 0) {
    console.log(
      `   ⚠  ${lowRes} entries only had a thumbnail (~320 px). Consider replacing manually.`,
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
