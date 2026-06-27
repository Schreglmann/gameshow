import type { GameType } from '@/types/config';

export interface GameTypeInfo {
  label: string;
  description: string;
}

export const GAME_TYPE_INFO: Record<GameType, GameTypeInfo> = {
  'simple-quiz': {
    label: 'Klassisches Quiz',
    description: 'Freie Antworten – beide Teams schreiben, der Host wählt den Sieger.',
  },
  'bet-quiz': {
    label: 'Einsatzquiz',
    description: 'Teams setzen geheim Punkte auf eine Kategorie – das höhere Gebot antwortet.',
  },
  'guessing-game': {
    label: 'Schätzfrage',
    description: 'Zahlen schätzen – das Team mit dem näheren Wert gewinnt.',
  },
  'final-quiz': {
    label: 'Finalrunde',
    description: 'Beide Teams setzen vor jeder Frage eigene Punkte – richtig = Einsatz gewonnen, falsch = Einsatz verloren.',
  },
  'audio-guess': {
    label: 'Musikraten',
    description: 'Einen Song an einem sehr kurzen Ausschnitt erkennen.',
  },
  'video-guess': {
    label: 'Filmraten',
    description: 'Einen Film oder eine Szene an einem kurzen Video erkennen.',
  },
  'q1': {
    label: 'Q1 – Ein Hinweis ist falsch',
    description: 'Vier Aussagen beschreiben einen gesuchten Begriff – drei sind wahr, eine ist falsch.',
  },
  'four-statements': {
    label: 'Vier Hinweise',
    description: 'Bis zu vier Hinweise führen schrittweise zur gesuchten Lösung.',
  },
  'fact-or-fake': {
    label: 'Fakt oder Fake',
    description: 'Ist die Aussage wahr oder erfunden?',
  },
  'quizjagd': {
    label: 'Quizjagd',
    description: 'Teams wählen Schwierigkeit (3/5/7) – richtig = Punkte dazu, falsch = ab.',
  },
  'bandle': {
    label: 'Bandle',
    description: 'Einen Song Schicht für Schicht an immer mehr Instrumenten erraten.',
  },
  'image-guess': {
    label: 'Bilderrätsel',
    description: 'Ein Bild wird schrittweise enthüllt und muss erraten werden.',
  },
  'colorguess': {
    label: 'Logo-Farben',
    description: 'Nur die Farbverteilung eines Logos ist sichtbar.',
  },
  'ranking': {
    label: 'Reihenfolge',
    description: 'Antworten in der richtigen Reihenfolge erraten.',
  },
  'wer-kennt-mehr': {
    label: 'Wer kennt mehr?',
    description: 'Beide Teams nennen so viele Begriffe wie möglich – wer mehr nennt, gewinnt diese Anzahl als Punkte.',
  },
  'random-frame': {
    label: 'Zufallsbild',
    description: 'Ein zufälliges Standbild aus einem Video – aus welchem Film stammt es?',
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
};

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
