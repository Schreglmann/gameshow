import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ReactElement } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import SimpleQuizForm from '@/components/backend/questions/SimpleQuizForm';
import GuessingGameForm from '@/components/backend/questions/GuessingGameForm';
import FourStatementsForm from '@/components/backend/questions/FourStatementsForm';
import RankingForm from '@/components/backend/questions/RankingForm';
import AudioGuessForm from '@/components/backend/questions/AudioGuessForm';

/**
 * The mini player in the asset field and the trim timeline below it share one
 * HTMLAudioElement through `useSharedAudio`, whose pool key is the `src` string
 * itself. A raw config path in one and a `toMediaSrc`-encoded path in the other
 * therefore key two separate elements: seeking or playing in one leaves the other
 * behind (the whole point of the shared pool). Any audio filename with a space —
 * i.e. nearly every music file — used to hit this.
 */

vi.mock('@/components/backend/AudioTrimTimeline', () => ({
  default: ({ src, scope }: { src: string; scope?: string }) => (
    <div data-testid="trim" data-src={src} data-scope={scope ?? ''} />
  ),
}));

vi.mock('@/components/backend/MiniAudioPlayer', () => ({
  default: ({ src, scope }: { src: string; scope?: string }) => (
    <div data-testid="mini" data-src={src} data-scope={scope ?? ''} />
  ),
}));

/**
 * AudioGuessForm queues its waveforms behind an IntersectionObserver; the jsdom stub
 * in tests/setup.ts never reports intersection, so the timeline would stay queued.
 */
class EagerIntersectionObserver {
  /** Report each element once — re-notifying on every re-render would loop forever. */
  private seen = new WeakSet<Element>();
  constructor(private cb: IntersectionObserverCallback) {}
  observe(el: Element) {
    if (this.seen.has(el)) return;
    this.seen.add(el);
    this.cb(
      [{ target: el, isIntersecting: true } as IntersectionObserverEntry],
      this as unknown as IntersectionObserver
    );
  }
  unobserve() {}
  disconnect() {}
}

const realIntersectionObserver = globalThis.IntersectionObserver;
beforeEach(() => {
  globalThis.IntersectionObserver = EagerIntersectionObserver as unknown as typeof IntersectionObserver;
});
afterEach(() => {
  globalThis.IntersectionObserver = realIntersectionObserver;
});

const RAW = '/audio/ABBA/01 Dancing Queen.m4a';
const ENCODED = '/audio/ABBA/01%20Dancing%20Queen.m4a';

/** Reveal every collapsed audio field so both players are mounted. */
function expandAll(container: HTMLElement) {
  for (const btn of container.querySelectorAll<HTMLButtonElement>('button[title="Optionen"]')) {
    fireEvent.click(btn);
  }
  // Forms differ in whether a set trim start auto-opens the panel — only click the closed ones.
  for (const btn of container.querySelectorAll<HTMLButtonElement>('button.audio-trim-toggle-btn:not(.active)')) {
    fireEvent.click(btn);
  }
}

const cases: { name: string; render: () => ReactElement }[] = [
  {
    name: 'SimpleQuizForm (Frage-Audio)',
    render: () => (
      <SimpleQuizForm
        questions={[{ question: 'F', answer: 'A', questionAudio: RAW, questionAudioStart: 5 }]}
        onChange={vi.fn()}
      />
    ),
  },
  {
    name: 'SimpleQuizForm (Antwort-Audio)',
    render: () => (
      <SimpleQuizForm
        questions={[{ question: 'F', answer: 'A', answerAudio: RAW, answerAudioStart: 5 }]}
        onChange={vi.fn()}
      />
    ),
  },
  {
    name: 'GuessingGameForm',
    render: () => (
      <GuessingGameForm
        questions={[{ question: 'F', answer: 1, questionAudio: RAW, questionAudioStart: 5 }]}
        onChange={vi.fn()}
      />
    ),
  },
  {
    name: 'FourStatementsForm',
    render: () => (
      <FourStatementsForm
        questions={[{ topic: 'T', statements: ['a'], answer: 'A', answerAudio: RAW, answerAudioStart: 5 }]}
        onChange={vi.fn()}
      />
    ),
  },
  {
    name: 'RankingForm',
    render: () => (
      <RankingForm
        questions={[{ question: 'F', answers: ['1'], answerAudio: RAW, answerAudioStart: 5 }]}
        onChange={vi.fn()}
      />
    ),
  },
  {
    name: 'AudioGuessForm',
    render: () => (
      <AudioGuessForm
        questions={[{ answer: 'A', audio: RAW, audioStart: 5 }]}
        onChange={vi.fn()}
      />
    ),
  },
];

describe('mini player / trim timeline share one audio element', () => {
  for (const c of cases) {
    it(`${c.name}: both get the same encoded src and scope`, () => {
      const { container } = render(c.render());
      expandAll(container);

      const mini = screen.getAllByTestId('mini').find(el => el.dataset.src?.includes('Dancing'));
      const trim = screen.getAllByTestId('trim').find(el => el.dataset.src?.includes('Dancing'));

      expect(mini?.dataset.src).toBe(ENCODED);
      expect(trim?.dataset.src).toBe(ENCODED);
      expect(trim?.dataset.scope).toBe(mini?.dataset.scope);
    });
  }
});
