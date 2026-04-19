import type { JokerDef } from '@/types/jokers';

export const JOKER_CATALOG: readonly JokerDef[] = [
  {
    id: 'call-friend',
    name: 'Telefonjoker',
    description:
      'Team ruft eine Person an. Antwortet sie nicht, entscheidet der GM, ob der Joker verbraucht ist.',
    icon: '📞',
  },
  {
    id: 'player-out',
    name: 'Spieler aussetzen',
    description: '1 Spieler des gegnerischen Teams setzt das nächste Spiel aus.',
    icon: '🚫',
  },
  {
    id: 'solo-answer',
    name: 'Alleinantwort',
    description:
      'Gegnerteam wählt 1 Spieler, der die nächste Frage allein beantworten muss.',
    icon: '🎯',
  },
  {
    id: 'ask-ai',
    name: 'KI-Joker',
    description:
      'GM sendet einen Prompt an eine KI; nur der erste Satz der Antwort zählt.',
    icon: '🤖',
  },
  {
    id: 'double-answer',
    name: 'Doppelte Antwort',
    description:
      'Team gibt zwei Antworten auf eine Frage – eine davon muss richtig sein.',
    icon: '✌️',
  },
  {
    id: 'swap-question',
    name: 'Frage tauschen',
    description: 'Team darf die aktuelle Frage durch die nächste ersetzen.',
    icon: '🔄',
  },
  {
    id: 'fifty-fifty',
    name: '50:50',
    description: 'GM nennt zwei plausible Antworten; eine davon ist richtig.',
    icon: '➗',
  },
  {
    id: 'steal-points',
    name: 'Punkteklau',
    description:
      'Bei richtiger Antwort bekommt das Team zusätzlich 1 Punkt vom Gegnerteam.',
    icon: '💰',
  },
] as const;

export type JokerId = (typeof JOKER_CATALOG)[number]['id'];

export function getJoker(id: string): JokerDef | undefined {
  return JOKER_CATALOG.find(j => j.id === id);
}
