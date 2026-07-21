import type { JokerDef } from '@/types/jokers';

export const JOKER_CATALOG: readonly JokerDef[] = [
  {
    id: 'call-friend',
    name: 'Telefonjoker',
    description:
      'Team ruft eine Person an. Antwortet sie nicht, entscheidet der GM, ob der Joker verbraucht ist.',
  },
  {
    id: 'player-out',
    name: 'Spieler aussetzen',
    description: '1 Spieler des gegnerischen Teams setzt das nächste Spiel aus.',
  },
  {
    id: 'solo-answer',
    name: 'Alleinantwort',
    description:
      'Gegnerteam wählt 1 Spieler, der die nächste Frage allein beantworten muss.',
  },
  {
    id: 'ask-ai',
    name: 'KI-Joker',
    description:
      'GM sendet einen Prompt an eine KI; nur der erste Satz der Antwort zählt.',
  },
  {
    id: 'double-answer',
    name: 'Doppelte Antwort',
    description:
      'Team gibt zwei Antworten auf eine Frage – eine davon muss richtig sein.',
  },
  {
    id: 'stumm',
    name: 'Stumm',
    description:
      'Gegnerteam muss die nächste Frage schriftlich beantworten – kein Sprechen erlaubt.',
  },
  {
    id: 'comeback',
    name: 'Aufholjoker',
    description:
      'Nur das zurückliegende Team kann ihn einsetzen: Im nächsten Spiel zählen seine Punkte doppelt.',
  },
] as const;

export type JokerId = (typeof JOKER_CATALOG)[number]['id'];

/**
 * The Aufholjoker id. It is the one joker with an app-enforced effect (doubling
 * the trailing team's next-game points) and is always single-use per show —
 * exempt from the `per-game` joker refresh. See specs/jokers.md + specs/comeback-joker.md.
 */
export const COMEBACK_JOKER_ID = 'comeback';

export function getJoker(id: string): JokerDef | undefined {
  return JOKER_CATALOG.find(j => j.id === id);
}

/**
 * Generic, gameshow-agnostic explanation of the joker mechanic. Rendered on the
 * global rules screen (`GlobalRulesScreen`) when the active gameshow has any
 * jokers enabled. Deliberately does NOT list the specific enabled jokers — each
 * joker's own `description` already surfaces as a header tooltip. See
 * specs/jokers.md.
 */
export const GENERIC_JOKER_RULES: readonly string[] = [
  'Jedes Team hat Joker, die es im Laufe der Show je einmal einsetzen kann.',
  'Die verfügbaren Joker seht ihr oben neben dem Punktestand.',
] as const;
