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
};
