/**
 * Example games ("Beispiele") — code fixtures that generate one real, playable
 * example per game type (except `video-guess`) plus the media they need.
 *
 * `materializeExamples` is the single shared entry point used by both the admin
 * "Beispiele erstellen" button (POST /api/backend/games/examples) and the CLI
 * (`npm run fixtures` → scripts/create-examples.ts). It is idempotent.
 *
 * Real German questions; rules follow the canonical archetypes in
 * specs/rules-standard.md. All media is self-synthesized and copyright-free
 * (see server/example-media.ts). Nothing binary is committed — generated games
 * land in the gitignored `games/beispiel-*.json` and media in `local-assets/`.
 *
 * See specs/example-games.md.
 */

import path from 'path';
import { mkdir, writeFile, rename, readFile } from 'fs/promises';
import type { AppConfig, GameConfig } from '../src/types/config.js';
import { renderMediaItem, type MediaItem } from './example-media.js';
import { buildDefaultConfig, isGitCryptBlob } from './clean-install.js';

export interface ExampleGame {
  /** File name without extension, e.g. `beispiel-simple-quiz` → games/beispiel-simple-quiz.json */
  fileName: string;
  gameFile: GameConfig;
  /** Media this game needs generated into local-assets/. */
  media?: MediaItem[];
}

// Canonical archetype rule blocks (see specs/rules-standard.md). Reused verbatim.
const A = ['Jede Frage wird beiden Teams gleichzeitig gestellt.', 'Die Teams schreiben ihre Antwort auf.'];
const B = ['Beide Teams raten gleichzeitig.', 'Die erste Antwort eines Teams zählt.', 'Antwortet ein Team falsch, darf das andere Team antworten.'];

export const EXAMPLE_GAMES: ExampleGame[] = [
  {
    fileName: 'beispiel-simple-quiz',
    media: [
      { type: 'image', dest: 'images/Beispiele/flag-jp.png', spec: { kind: 'flag', flag: 'jp' } },
      { type: 'audio', dest: 'audio/Beispiele/melodie-fuer-elise.mp3', spec: { kind: 'melody', tune: 'fuer-elise' } },
    ],
    gameFile: {
      type: 'simple-quiz',
      title: 'Beispiel: Allgemeinwissen',
      rules: ['Beantwortet die Quizfragen.', ...A],
      questions: [
        { question: 'Welcher Planet ist der größte in unserem Sonnensystem?', answer: 'Jupiter' },
        { question: 'In welchem Jahr fiel die Berliner Mauer?', answer: '1989', info: 'Es war ein entscheidender Moment der jüngeren deutschen Geschichte.' },
        { question: 'Welches Land hat diese Flagge?', answer: 'Japan', questionImage: '/images/Beispiele/flag-jp.png' },
        { question: 'Welches Musikstück erklingt hier?', answer: 'Ludwig van Beethoven – Für Elise', questionAudio: '/audio/Beispiele/melodie-fuer-elise.mp3' },
      ],
    },
  },
  {
    fileName: 'beispiel-bet-quiz',
    gameFile: {
      type: 'bet-quiz',
      title: 'Beispiel: Wetten',
      rules: [
        'Vor jeder Frage wird die Kategorie enthüllt.',
        'Beide Teams setzen geheim einen Teil ihrer bisher verdienten Punkte.',
        'Das Team mit dem höheren Einsatz beantwortet die Frage.',
        'Bei richtiger Antwort gewinnt das Team den Einsatz dazu, bei falscher verliert es ihn.',
      ],
      questions: [
        { category: 'Geografie', question: 'Wie heißt die Hauptstadt von Australien?', answer: 'Canberra' },
        { category: 'Wissenschaft', question: 'Wie viele Planeten hat unser Sonnensystem?', answer: 'Acht' },
        { category: 'Geschichte', question: 'In welchem Jahr begann der Erste Weltkrieg?', answer: '1914' },
      ],
    },
  },
  {
    fileName: 'beispiel-guessing-game',
    gameFile: {
      type: 'guessing-game',
      title: 'Beispiel: Schätzfragen',
      rules: [
        'Schätzt die gesuchte Zahl so genau wie möglich.',
        'Jedes Team gibt seinen Tipp für jede Frage ab.',
        'Das Team, das näher an der richtigen Antwort liegt, gewinnt die Frage.',
      ],
      questions: [
        { question: 'Wie hoch ist der Eiffelturm (in Metern, mit Antenne)?', answer: 330 },
        { question: 'Wie viele Knochen hat ein erwachsener Mensch?', answer: 206 },
        { question: 'Wie viele Tasten hat ein klassisches Klavier?', answer: 88 },
      ],
    },
  },
  {
    fileName: 'beispiel-q1',
    gameFile: {
      type: 'q1',
      title: 'Beispiel: Ein Hinweis ist falsch',
      rules: ['Findet heraus, welche der vier Aussagen falsch ist.', ...A],
      questions: [
        {
          Frage: 'Welche Aussage über den Mond ist FALSCH?',
          trueStatements: [
            'Der Mond hat keine nennenswerte Atmosphäre.',
            'Auf dem Mond herrscht etwa ein Sechstel der Erdanziehung.',
            'Der Mond zeigt der Erde immer dieselbe Seite.',
          ],
          wrongStatement: 'Der Mond ist größer als der Planet Merkur.',
          answer: 'Der Mond ist größer als der Planet Merkur.',
        },
      ],
    },
  },
  {
    fileName: 'beispiel-four-statements',
    gameFile: {
      type: 'four-statements',
      title: 'Beispiel: Wer oder was wird gesucht?',
      rules: ['Errate die gesuchte Person.', 'Die Lösung wird anhand von bis zu 4 Hinweisen erraten.', 'Nach jedem Hinweis darf geraten werden.'],
      questions: [
        {
          topic: 'Gesucht: eine berühmte Persönlichkeit',
          statements: [
            'Ich wurde 1879 in Ulm geboren.',
            'Ich entwickelte die Relativitätstheorie.',
            'Für den photoelektrischen Effekt erhielt ich 1921 den Nobelpreis.',
            'Meine Formel E = mc² ist weltberühmt.',
          ],
          answer: 'Albert Einstein',
        },
      ],
    },
  },
  {
    fileName: 'beispiel-fact-or-fake',
    gameFile: {
      type: 'fact-or-fake',
      title: 'Beispiel: Fakt oder Fake?',
      rules: ['Entscheidet, ob die Aussage ein Fakt oder ein Fake ist.', ...A],
      questions: [
        { statement: 'Ein Oktopus hat drei Herzen.', answer: 'FAKT', description: 'Zwei Herzen pumpen Blut zu den Kiemen, ein drittes versorgt den restlichen Körper.' },
        { statement: 'Die Chinesische Mauer ist mit bloßem Auge aus dem Weltall zu sehen.', answer: 'FAKE', description: 'Ein verbreiteter Mythos – die Mauer ist dafür viel zu schmal.' },
        { statement: 'Honig kann praktisch unbegrenzt haltbar sein.', answer: 'FAKT', description: 'Sein niedriger Wassergehalt und hoher Säuregrad hemmen das Wachstum von Mikroorganismen.' },
      ],
    },
  },
  {
    fileName: 'beispiel-audio-guess',
    media: [
      { type: 'audio', dest: 'audio/Beispiele/melodie-fuer-elise.mp3', spec: { kind: 'melody', tune: 'fuer-elise' } },
      { type: 'audio', dest: 'audio/Beispiele/melodie-eine-kleine.mp3', spec: { kind: 'melody', tune: 'eine-kleine' } },
      { type: 'audio', dest: 'audio/Beispiele/melodie-ode-an-die-freude.mp3', spec: { kind: 'melody', tune: 'ode-to-joy' } },
    ],
    gameFile: {
      type: 'audio-guess',
      title: 'Beispiel: Errate die Melodie',
      rules: ['Errate das gespielte Musikstück.', ...B],
      questions: [
        { answer: 'Ludwig van Beethoven – Für Elise', audio: '/audio/Beispiele/melodie-fuer-elise.mp3' },
        { answer: 'Wolfgang Amadeus Mozart – Eine kleine Nachtmusik', audio: '/audio/Beispiele/melodie-eine-kleine.mp3' },
        { answer: 'Ludwig van Beethoven – Ode an die Freude', audio: '/audio/Beispiele/melodie-ode-an-die-freude.mp3', audioStart: 0, audioEnd: 4 },
      ],
    },
  },
  {
    fileName: 'beispiel-quizjagd',
    gameFile: {
      type: 'quizjagd',
      // questionsPerTeam × 2 real questions are played; each difficulty's first entry
      // is the shared "Beispiel" (skipped), so keep Σ(perDifficulty − 1) ≥ questionsPerTeam × 2
      // or the board can run dry mid-game. Here: 3×4 → 9 usable ≥ 6 needed.
      title: 'Beispiel: Quizjagd',
      questionsPerTeam: 3,
      rules: [
        'Die Teams sind abwechselnd am Zug.',
        'Jedes Team wählt 3, 5 oder 7 Punkte für eine leichte, mittlere oder schwere Frage.',
        'Bei richtiger Antwort gewinnt das Team die Punkte, bei falscher verliert es sie.',
      ],
      questions: {
        easy: [
          { question: 'Welche Farbe entsteht, wenn man Blau und Gelb mischt?', answer: 'Grün' },
          { question: 'Wie viele Beine hat eine Spinne?', answer: 'Acht' },
          { question: 'Welches Tier wird „König der Tiere“ genannt?', answer: 'Der Löwe' },
          { question: 'Wie viele Tage hat eine Woche?', answer: 'Sieben' },
        ],
        medium: [
          { question: 'Wie heißt der längste Fluss der Welt?', answer: 'Nil' },
          { question: 'In welchem Land steht der Eiffelturm?', answer: 'Frankreich' },
          { question: 'Wie heißt die Hauptstadt von Japan?', answer: 'Tokio' },
          { question: 'Welcher Planet ist der Sonne am nächsten?', answer: 'Merkur' },
        ],
        hard: [
          { question: 'Welches chemische Element hat das Symbol „Fe“?', answer: 'Eisen' },
          { question: 'Wer schrieb das Drama „Faust“?', answer: 'Johann Wolfgang von Goethe' },
          { question: 'In welchem Jahr endete der Zweite Weltkrieg?', answer: '1945' },
          { question: 'Wie heißt das größte Organ des menschlichen Körpers?', answer: 'Die Haut' },
        ],
      },
    },
  },
  {
    fileName: 'beispiel-final-quiz',
    gameFile: {
      type: 'final-quiz',
      title: 'Beispiel: Finale',
      rules: [
        'Jedes Team setzt seine bisher verdienten Punkte.',
        'Bei richtiger Antwort werden die gesetzten Punkte verdoppelt.',
        'Bei falscher Antwort verliert das Team die gesetzten Punkte.',
      ],
      questions: [
        { question: 'Wie viele Kontinente gibt es?', answer: 'Sieben' },
        { question: 'Welches ist das meistverkaufte Buch der Welt?', answer: 'Die Bibel' },
      ],
    },
  },
  {
    fileName: 'beispiel-bandle',
    media: [
      { type: 'audio', dest: 'audio/Beispiele/bandle-1.mp3', spec: { kind: 'layer', tune: 'ode-to-joy', layer: 'bass' } },
      { type: 'audio', dest: 'audio/Beispiele/bandle-2.mp3', spec: { kind: 'layer', tune: 'ode-to-joy', layer: 'melody' } },
      { type: 'audio', dest: 'audio/Beispiele/bandle-3.mp3', spec: { kind: 'layer', tune: 'ode-to-joy', layer: 'full' } },
    ],
    gameFile: {
      type: 'bandle',
      title: 'Beispiel: Bandle',
      rules: ['Errate das gespielte Musikstück.', ...B],
      questions: [
        {
          answer: 'Ludwig van Beethoven – Ode an die Freude',
          tracks: [
            { label: 'Bass', audio: '/audio/Beispiele/bandle-1.mp3' },
            { label: 'Melodie', audio: '/audio/Beispiele/bandle-2.mp3' },
            { label: 'Alles zusammen', audio: '/audio/Beispiele/bandle-3.mp3' },
          ],
        },
      ],
    },
  },
  {
    fileName: 'beispiel-image-guess',
    media: [
      { type: 'image', dest: 'images/Beispiele/bild-apfel.png', spec: { kind: 'illustration', illustration: 'apple' } },
      { type: 'image', dest: 'images/Beispiele/bild-haus.png', spec: { kind: 'illustration', illustration: 'house' } },
      { type: 'image', dest: 'images/Beispiele/bild-segelboot.png', spec: { kind: 'illustration', illustration: 'sailboat' } },
    ],
    gameFile: {
      type: 'image-guess',
      title: 'Beispiel: Bild erraten',
      rules: ['Errate, was auf dem Bild zu sehen ist.', ...B],
      questions: [
        { answer: 'Apfel', image: '/images/Beispiele/bild-apfel.png', obfuscation: 'pixelate' },
        { answer: 'Haus', image: '/images/Beispiele/bild-haus.png', obfuscation: 'blur' },
        { answer: 'Segelboot', image: '/images/Beispiele/bild-segelboot.png', obfuscation: 'zoom' },
      ],
    },
  },
  {
    fileName: 'beispiel-colorguess',
    media: [
      { type: 'image', dest: 'images/Beispiele/farben-sonnenuntergang.png', spec: { kind: 'gradient', gradient: 'sunset' } },
      { type: 'image', dest: 'images/Beispiele/farben-wald.png', spec: { kind: 'gradient', gradient: 'forest' } },
      { type: 'image', dest: 'images/Beispiele/farben-meer.png', spec: { kind: 'gradient', gradient: 'ocean' } },
    ],
    gameFile: {
      type: 'colorguess',
      title: 'Beispiel: Farben erraten',
      rules: ['Errate das Motiv anhand seiner dominanten Farben.', ...B],
      questions: [
        { answer: 'Sonnenuntergang', image: '/images/Beispiele/farben-sonnenuntergang.png' },
        { answer: 'Wald', image: '/images/Beispiele/farben-wald.png' },
        { answer: 'Meer', image: '/images/Beispiele/farben-meer.png' },
      ],
    },
  },
  {
    fileName: 'beispiel-ranking',
    gameFile: {
      type: 'ranking',
      title: 'Beispiel: Reihenfolge',
      rules: ['Bringe die Antworten in die richtige Reihenfolge.', 'Die Antworten sind in der richtigen Reihenfolge zu erraten.', 'Das Team, das am weitesten kommt, gewinnt die Runde.'],
      questions: [
        { question: 'Ordne diese Länder nach ihrer Fläche – das größte zuerst.', answers: ['Russland', 'Kanada', 'China', 'Brasilien', 'Australien'] },
        { question: 'Ordne diese Planeten nach ihrer Entfernung zur Sonne – die nächste zuerst.', topic: 'Sonnensystem', answers: ['Merkur', 'Venus', 'Erde', 'Mars', 'Jupiter'] },
      ],
    },
  },
];

/**
 * Game types that act as the closing rounds of a real gameshow. The "Beispiele"
 * gameshow places these LAST in its gameOrder so the demo reads like a real show
 * (a finale doesn't belong in the middle). See specs/example-games.md.
 */
const FINAL_GAME_TYPES: ReadonlySet<GameConfig['type']> = new Set(['bet-quiz', 'quizjagd', 'final-quiz']);

export interface MaterializeResult {
  createdGames: string[];
  gameshow: string;
}

/** Read the config for writing, falling back to a fresh default when missing/encrypted/unparseable. */
async function loadConfigForWrite(configPath: string): Promise<AppConfig> {
  try {
    const raw = await readFile(configPath);
    if (isGitCryptBlob(raw)) return buildDefaultConfig();
    return JSON.parse(raw.toString('utf8')) as AppConfig;
  } catch {
    return buildDefaultConfig();
  }
}

async function writeJsonAtomic(filePath: string, value: unknown): Promise<void> {
  const tmp = `${filePath}.tmp`;
  await writeFile(tmp, JSON.stringify(value, null, 2) + '\n', 'utf8');
  await rename(tmp, filePath);
}

/**
 * Generate all example media, write `games/beispiel-*.json`, and add/activate a
 * "Beispiele" gameshow referencing them. Idempotent: regenerates media and
 * overwrites the games + gameshow on every run.
 */
export async function materializeExamples(opts: {
  gamesDir: string;
  localAssetsBase: string;
  configPath: string;
}): Promise<MaterializeResult> {
  const { gamesDir, localAssetsBase, configPath } = opts;

  // 1. Media — dedupe by dest so shared clips are generated once.
  const seen = new Set<string>();
  const items: MediaItem[] = [];
  for (const game of EXAMPLE_GAMES) {
    for (const item of game.media ?? []) {
      if (!seen.has(item.dest)) { seen.add(item.dest); items.push(item); }
    }
  }
  await mkdir(path.join(localAssetsBase, 'images'), { recursive: true });
  await mkdir(path.join(localAssetsBase, 'audio'), { recursive: true });
  for (const item of items) await renderMediaItem(item, localAssetsBase);

  // 2. Game files.
  await mkdir(gamesDir, { recursive: true });
  const createdGames: string[] = [];
  for (const game of EXAMPLE_GAMES) {
    await writeJsonAtomic(path.join(gamesDir, `${game.fileName}.json`), game.gameFile);
    createdGames.push(game.fileName);
  }

  // 3. Config — add/replace the "beispiele" gameshow and activate it. Final-style
  // game types (the closing rounds of a real show) are ordered LAST so the demo
  // gameshow reads like a real one; the relative order within each group is kept.
  const config = await loadConfigForWrite(configPath);
  config.gameshows = config.gameshows ?? {};
  const gameOrder = [
    ...EXAMPLE_GAMES.filter(g => !FINAL_GAME_TYPES.has(g.gameFile.type)),
    ...EXAMPLE_GAMES.filter(g => FINAL_GAME_TYPES.has(g.gameFile.type)),
  ].map(g => g.fileName);
  config.gameshows.beispiele = { name: 'Beispiele', gameOrder };
  config.activeGameshow = 'beispiele';
  await writeJsonAtomic(configPath, config);

  return { createdGames, gameshow: 'beispiele' };
}
