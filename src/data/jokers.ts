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
] as const;

export type JokerId = (typeof JOKER_CATALOG)[number]['id'];

export function getJoker(id: string): JokerDef | undefined {
  return JOKER_CATALOG.find(j => j.id === id);
}
