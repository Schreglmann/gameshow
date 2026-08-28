import type { GameType } from '../types/config.js';

export interface GameTypeInfo {
  label: string;
  description: string;
  /**
   * Team counts (0-4) this type can be SCORED at. A gameshow may still include
   * the game at any other count — it just plays without scoring, and the
   * operator is warned. `0` is always included: with no teams every type is a
   * pure play-through (see specs/point-system.md).
   *
   * This is a `Record<GameType, …>` field, so tsc forces every present and
   * future type to declare it. Scoring-mode exceptions (`bet-quiz: transfer`,
   * `wer-kennt-mehr: count-penalty`, `guessing-game: auto`) narrow this further
   * — see SCORING_MODE_TEAM_COUNTS below. See specs/team-count.md.
   */
  supportedTeamCounts: readonly number[];
}

/** Every count from 0 to 4 — a type whose mechanic is indifferent to how many teams play. */
const ANY_TEAM_COUNT = [0, 1, 2, 3, 4] as const;
/** A head-to-head mechanic: it needs exactly one opponent, or no teams at all. */
const HEAD_TO_HEAD = [0, 2] as const;
/** A comparative mechanic: it needs at least one opponent, but any number of them. */
const NEEDS_OPPONENT = [0, 2, 3, 4] as const;

export const GAME_TYPE_INFO: Record<GameType, GameTypeInfo> = {
  'simple-quiz': {
    label: 'Klassisches Quiz',
    description: 'Freie Antworten – beide Teams schreiben, der Host wählt den Sieger.',
    supportedTeamCounts: ANY_TEAM_COUNT,
  },
  'bet-quiz': {
    label: 'Einsatzquiz',
    description: 'Teams setzen geheim Punkte auf eine Kategorie – das höhere Gebot antwortet.',
    supportedTeamCounts: ANY_TEAM_COUNT,
  },
  'guessing-game': {
    label: 'Schätzfrage',
    description: 'Zahlen schätzen – das Team mit dem näheren Wert gewinnt.',
    supportedTeamCounts: ANY_TEAM_COUNT,
  },
  'final-quiz': {
    label: 'Finalrunde',
    description: 'Beide Teams setzen vor jeder Frage eigene Punkte – richtig = Einsatz gewonnen, falsch = Einsatz verloren.',
    supportedTeamCounts: ANY_TEAM_COUNT,
  },
  'audio-guess': {
    label: 'Musikraten',
    description: 'Einen Song an einem sehr kurzen Ausschnitt erkennen.',
    supportedTeamCounts: ANY_TEAM_COUNT,
  },
  'video-guess': {
    label: 'Filmraten',
    description: 'Einen Film oder eine Szene an einem kurzen Video erkennen.',
    supportedTeamCounts: ANY_TEAM_COUNT,
  },
  'q1': {
    label: 'Q1 – Ein Hinweis ist falsch',
    description: 'Vier Aussagen beschreiben einen gesuchten Begriff – drei sind wahr, eine ist falsch.',
    supportedTeamCounts: ANY_TEAM_COUNT,
  },
  'four-statements': {
    label: 'Vier Hinweise',
    description: 'Bis zu vier Hinweise führen schrittweise zur gesuchten Lösung.',
    supportedTeamCounts: ANY_TEAM_COUNT,
  },
  'fact-or-fake': {
    label: 'Fakt oder Fake',
    description: 'Ist die Aussage wahr oder erfunden?',
    supportedTeamCounts: ANY_TEAM_COUNT,
  },
  'quizjagd': {
    label: 'Quizjagd',
    description: 'Teams wählen Schwierigkeit (3/5/7) – richtig = Punkte dazu, falsch = ab.',
    supportedTeamCounts: ANY_TEAM_COUNT,
  },
  'bandle': {
    label: 'Bandle',
    description: 'Einen Song Schicht für Schicht an immer mehr Instrumenten erraten.',
    supportedTeamCounts: ANY_TEAM_COUNT,
  },
  'image-guess': {
    label: 'Bilderrätsel',
    description: 'Ein Bild wird schrittweise enthüllt und muss erraten werden.',
    supportedTeamCounts: ANY_TEAM_COUNT,
  },
  'colorguess': {
    label: 'Logo-Farben',
    description: 'Nur die Farbverteilung eines Logos ist sichtbar.',
    supportedTeamCounts: ANY_TEAM_COUNT,
  },
  'ranking': {
    label: 'Reihenfolge',
    description: 'Antworten in der richtigen Reihenfolge erraten.',
    supportedTeamCounts: ANY_TEAM_COUNT,
  },
  'wer-kennt-mehr': {
    label: 'Wer kennt mehr?',
    description: 'Beide Teams nennen so viele Begriffe wie möglich – wer mehr nennt, gewinnt diese Anzahl als Punkte.',
    supportedTeamCounts: ANY_TEAM_COUNT,
  },
  'random-frame': {
    label: 'Zufallsbild',
    description: 'Ein zufälliges Standbild aus einem Video – aus welchem Film stammt es?',
    supportedTeamCounts: ANY_TEAM_COUNT,
  },
  'city-compass': {
    label: 'Städte-Kompass',
    description: 'Nachbarstädte stehen im richtigen Winkel – welche Stadt liegt im Zentrum?',
    supportedTeamCounts: ANY_TEAM_COUNT,
  },
};

/**
 * Clean, valid empty game per type. Used when creating a new game (GamesTab's
 * "Neues Spiel") and when changing the type of an existing game (GameEditor) —
 * in both cases the content must be a well-formed empty game for that type so
 * the per-type question form has nothing incompatible to render.
 */
export const GAME_TYPE_TEMPLATES: Record<GameType, object> = {
  'simple-quiz': { type: 'simple-quiz', rules: [], instances: { v1: { questions: [] } } },
  'bet-quiz': { type: 'bet-quiz', rules: [], instances: { v1: { questions: [] } } },
  'guessing-game': { type: 'guessing-game', rules: [], instances: { v1: { questions: [] } } },
  'final-quiz': { type: 'final-quiz', rules: [], instances: { v1: { questions: [] } } },
  'audio-guess': { type: 'audio-guess', rules: [], instances: { v1: { questions: [] } } },
  'video-guess': { type: 'video-guess', rules: [], instances: { v1: { questions: [] } } },
  'q1': { type: 'q1', rules: [], instances: { v1: { questions: [] } } },
  'four-statements': { type: 'four-statements', rules: [], instances: { v1: { questions: [] } } },
  'fact-or-fake': { type: 'fact-or-fake', rules: [], instances: { v1: { questions: [] } } },
  'quizjagd': { type: 'quizjagd', rules: [], instances: { v1: { questions: [], questionsPerTeam: 10 } } },
  'bandle': { type: 'bandle', rules: [], instances: { v1: { questions: [] } } },
  'image-guess': { type: 'image-guess', rules: [], instances: { v1: { questions: [] } } },
  'colorguess': { type: 'colorguess', rules: [], instances: { v1: { questions: [] } } },
  'ranking': { type: 'ranking', rules: [], instances: { v1: { questions: [] } } },
  'wer-kennt-mehr': { type: 'wer-kennt-mehr', rules: [], instances: { v1: { questions: [] } } },
  'random-frame': { type: 'random-frame', rules: [], instances: { v1: { questions: [] } } },
  'city-compass': { type: 'city-compass', rules: [], instances: { v1: { questions: [] } } },
};

/**
 * Scoring modes that narrow their type's `supportedTeamCounts`.
 *
 * A mode listed here replaces the type-level list. Only mechanics that genuinely
 * need a specific number of opponents appear:
 *
 * - `bet-quiz: transfer` — zero-sum, the bet moves off *the* opponent. With 3+
 *   there is no defined recipient; with 1 there is nobody to take it from.
 * - `wer-kennt-mehr: count-penalty` — winner `+n` / loser `−n`, likewise
 *   head-to-head.
 * - `wer-kennt-mehr: count` and `guessing-game: auto` — "who named more" /
 *   "whose guess was closest" both need at least one opponent, but work with any
 *   number of them.
 *
 * See specs/team-count.md.
 */
const SCORING_MODE_TEAM_COUNTS: Partial<Record<GameType, Record<string, readonly number[]>>> = {
  'bet-quiz': { transfer: HEAD_TO_HEAD },
  'wer-kennt-mehr': { 'count-penalty': HEAD_TO_HEAD, count: NEEDS_OPPONENT },
  'guessing-game': { auto: NEEDS_OPPONENT },
};

/** The team counts a game can be scored at, given its type and scoring mode. */
export function supportedTeamCounts(type: GameType, scoringMode?: string): readonly number[] {
  const byMode = scoringMode ? SCORING_MODE_TEAM_COUNTS[type]?.[scoringMode] : undefined;
  return byMode ?? GAME_TYPE_INFO[type]?.supportedTeamCounts ?? ANY_TEAM_COUNT;
}

/**
 * Can this game be scored with `teamCount` teams?
 *
 * The single predicate behind every team-count decision: the server uses it to
 * decide the per-game `pointSystemEnabled`, `validate-config.ts` to warn, and
 * the admin + HomeScreen to explain. An unknown type is treated as compatible —
 * refusing to score a game we cannot classify would be worse than the warning we
 * would skip. See specs/team-count.md.
 */
export function gameSupportsTeamCount(
  type: GameType,
  teamCount: number,
  scoringMode?: string,
): boolean {
  return supportedTeamCounts(type, scoringMode).includes(teamCount);
}

/** German summary of a type's supported counts, for admin hints ("2 Teams", "1-4 Teams"). */
export function teamCountSupportLabel(type: GameType, scoringMode?: string): string {
  const scorable = supportedTeamCounts(type, scoringMode).filter(n => n > 0);
  if (scorable.length === 0) return 'keine Wertung';
  const contiguous = scorable.every((n, i) => i === 0 || n === scorable[i - 1]! + 1);
  const range = contiguous && scorable.length > 1
    ? `${scorable[0]}–${scorable[scorable.length - 1]}`
    : scorable.join(', ');
  return `${range} ${scorable.length === 1 && scorable[0] === 1 ? 'Team' : 'Teams'}`;
}

/**
 * Game types whose question shapes are interchangeable in the editor — switching
 * between them in GameEditor keeps the existing questions instead of warning and
 * resetting to an empty template. simple-quiz and bet-quiz both use
 * SimpleQuizQuestion + SimpleQuizForm, so their questions render under either type.
 */
const QUESTION_SHAPE_GROUPS: GameType[][] = [['simple-quiz', 'bet-quiz']];

/** True if game types `a` and `b` share a question shape (so questions survive a type switch). */
export function gameTypesShareQuestionShape(a: GameType, b: GameType): boolean {
  if (a === b) return true;
  return QUESTION_SHAPE_GROUPS.some(group => group.includes(a) && group.includes(b));
}

/** True if `query` matches a game type — either its raw key (`simple-quiz`) or its German label (`Klassisches Quiz`). */
export function gameTypeMatchesQuery(type: GameType, query: string): boolean {
  const q = query.toLowerCase();
  if (type.toLowerCase().includes(q)) return true;
  const label = GAME_TYPE_INFO[type]?.label;
  return !!label && label.toLowerCase().includes(q);
}
