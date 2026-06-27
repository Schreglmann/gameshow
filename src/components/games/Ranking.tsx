import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import type { GameComponentProps } from './types';
import type { RankingConfig, RankingQuestion } from '@/types/config';
import type { GamemasterAnswerData, GamemasterCommand } from '@/types/game';
import { useShuffledQuestions } from '@/hooks/useShuffledQuestions';
import { useArrowRightLongPress } from '@/hooks/useArrowRightLongPress';
import { safePlay } from '@/utils/safePlay';
import { toMediaSrc } from '@/utils/assetUrl';
import BaseGameWrapper from './BaseGameWrapper';

// Classify how `next` differs from `prev` as a single structural edit. Used to
// reconcile the progressive-reveal count when a question's answers are edited
// live. A pure text edit / reorder / multi-change is reported as 'same' (equal)
// or 'complex' so the caller falls back to clamping rather than mis-shifting.
type AnswerDiff =
  | { type: 'same' }
  | { type: 'complex' }
  | { type: 'removed'; index: number }
  | { type: 'added'; index: number };

function diffSingleElement(prev: string[], next: string[]): AnswerDiff {
  if (prev.length === next.length) {
    return prev.every((v, i) => v === next[i]) ? { type: 'same' } : { type: 'complex' };
  }
  if (next.length === prev.length - 1) {
    let d = next.length; // default: the removed element was the last one
    for (let i = 0; i < next.length; i++) {
      if (prev[i] !== next[i]) { d = i; break; }
    }
    for (let i = 0; i < next.length; i++) {
      if (next[i] !== prev[i < d ? i : i + 1]) return { type: 'complex' };
    }
    return { type: 'removed', index: d };
  }
  if (next.length === prev.length + 1) {
    let ins = prev.length; // default: the added element is at the end
    for (let i = 0; i < prev.length; i++) {
      if (next[i] !== prev[i]) { ins = i; break; }
    }
    for (let i = 0; i < prev.length; i++) {
      if (prev[i] !== next[i < ins ? i : i + 1]) return { type: 'complex' };
    }
    return { type: 'added', index: ins };
  }
  return { type: 'complex' };
}

export default function Ranking(props: GameComponentProps) {
  const config = props.config as RankingConfig;

  const questions = useShuffledQuestions(config.questions, config.randomizeQuestions, config.questionLimit);

  const totalQuestions = questions.length > 0 ? questions.length - 1 : 0;

  return (
    <BaseGameWrapper
      title={config.title}
      rules={config.rules || [
        'Errate die Antworten in der richtigen Reihenfolge.',
        'Pro Runde wird ein Platz nach dem anderen aufgelöst.',
      ]}
      totalQuestions={totalQuestions}
      pointSystemEnabled={props.pointSystemEnabled}
      pointValue={props.currentIndex + 1}
      currentIndex={props.currentIndex}
      onAwardPoints={props.onAwardPoints}
      onNextGame={props.onNextGame}
    >
      {({ onGameComplete, setNavHandler, setBackNavHandler, setGamemasterData, setCommandHandler, setAnswerRevealed }) => (
        <RankingInner
          questions={questions}
          gameTitle={config.title}
          onGameComplete={onGameComplete}
          setNavHandler={setNavHandler}
          setBackNavHandler={setBackNavHandler}
          setGamemasterData={setGamemasterData}
          setCommandHandler={setCommandHandler}
          setAnswerRevealed={setAnswerRevealed}
        />
      )}
    </BaseGameWrapper>
  );
}

interface InnerProps {
  questions: RankingQuestion[];
  gameTitle: string;
  onGameComplete: () => void;
  setNavHandler: (fn: (() => void) | null) => void;
  setBackNavHandler: (fn: (() => boolean) | null) => void;
  setGamemasterData: (data: GamemasterAnswerData | null) => void;
  setCommandHandler: (fn: ((cmd: GamemasterCommand) => void) | null) => void;
  setAnswerRevealed: (revealed: boolean) => void;
}

function RankingInner({ questions, gameTitle, onGameComplete, setNavHandler, setBackNavHandler, setGamemasterData, setCommandHandler, setAnswerRevealed }: InnerProps) {
  const [qIdx, setQIdx] = useState(0);
  const [revealedCount, setRevealedCount] = useState(0);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const hasPlayedRef = useRef(false);

  const q = questions[qIdx];
  const isExample = qIdx === 0;
  const questionLabel = isExample ? 'Beispiel' : `Frage ${qIdx} von ${questions.length - 1}`;
  const answers = useMemo(() => (q?.answers ?? []).filter(a => a && a.trim()), [q]);
  const answersLength = answers.length;

  useEffect(() => {
    if (!q) return;
    const list = answers.map((a, i) => ({
      rank: i + 1,
      text: a,
      revealed: i < revealedCount,
    }));
    // `answer` stays populated as a fallback for non-ranking-aware GM views
    // (e.g. older clients), but the GM renders `answerList` when present.
    const fallback = answers.map((a, i) => `${i + 1}. ${a}`).join(' · ') || '—';
    const nextQ = questions[qIdx + 1];
    const nextAns = nextQ
      ? (nextQ.answers ?? []).filter(a => a && a.trim()).map((a, i) => `${i + 1}. ${a}`).join(' · ') || '—'
      : undefined;
    setGamemasterData({
      gameTitle,
      questionNumber: qIdx,
      totalQuestions: questions.length - 1,
      question: q.question,
      answer: fallback,
      answerList: list,
      extraInfo: `Platz ${Math.min(revealedCount, answersLength)}/${answersLength}`,
      nextAnswer: nextQ ? { question: nextQ.question, answer: nextAns! } : undefined,
    });
  }, [qIdx, revealedCount, gameTitle, questions, setGamemasterData, q, answers, answersLength]);

  // Signal answer-reveal as soon as the first rank is shown so an active
  // GM deadline timer hides during the progressive reveal.
  useEffect(() => {
    setAnswerRevealed(revealedCount > 0);
  }, [revealedCount, setAnswerRevealed]);

  // Load the optional answer audio when the question changes; reset the
  // play-once guard so the next reveal cycle can trigger it.
  const answerAudio = q?.answerAudio;
  useEffect(() => {
    const audio = audioRef.current;
    hasPlayedRef.current = false;
    if (!audio) return;
    audio.pause();
    if (answerAudio) {
      audio.src = toMediaSrc(answerAudio) ?? answerAudio;
      audio.load();
    } else {
      audio.removeAttribute('src');
    }
  }, [qIdx, answerAudio]);

  // Play the answer audio once per reveal cycle: on the first revealed answer
  // when the trigger is 'first' (default), or once everything is revealed when
  // 'all'. The long-press "reveal all" jump (0 → N) satisfies both triggers.
  useEffect(() => {
    const audio = audioRef.current;
    if (revealedCount === 0) {
      hasPlayedRef.current = false;
      audio?.pause();
      return;
    }
    if (!audio || !answerAudio || hasPlayedRef.current) return;
    const trigger = q?.answerAudioTrigger ?? 'first';
    const shouldPlay = trigger === 'all'
      ? answersLength > 0 && revealedCount >= answersLength
      : revealedCount >= 1;
    if (!shouldPlay) return;
    hasPlayedRef.current = true;
    void safePlay(audio);
  }, [revealedCount, answersLength, answerAudio, q]);

  // Reconcile the progressive reveal when the CURRENT question's answers are
  // edited live (config change pushed via content-changed). The reveal is a
  // positional prefix (answers.slice(0, revealedCount)), so naively deleting a
  // *revealed* answer would slide the next hidden answer into view. Instead,
  // adjust revealedCount so a deleted item simply disappears, leaving the
  // reveal ready for the next one. A qIdx change is a navigation (handled by
  // the nav handlers) — skip it. See specs/live-config-reload.md.
  const revealedCountRef = useRef(revealedCount);
  revealedCountRef.current = revealedCount;
  const revealBaselineRef = useRef<{ qIdx: number; answers: string[] }>({ qIdx: -1, answers: [] });
  useEffect(() => {
    const prev = revealBaselineRef.current;
    revealBaselineRef.current = { qIdx, answers };
    if (prev.qIdx !== qIdx || prev.answers === answers) return;
    const rc = revealedCountRef.current;
    const diff = diffSingleElement(prev.answers, answers);
    if (diff.type === 'removed' && diff.index < rc) {
      setRevealedCount(Math.max(0, rc - 1));
    } else if (diff.type === 'added' && diff.index < rc) {
      setRevealedCount(rc + 1);
    } else if (rc > answers.length) {
      setRevealedCount(answers.length);
    }
  }, [qIdx, answers]);

  const handleNext = useCallback(() => {
    if (revealedCount < answersLength) {
      setRevealedCount(prev => prev + 1);
    } else if (qIdx < questions.length - 1) {
      setQIdx(prev => prev + 1);
      setRevealedCount(0);
    } else {
      onGameComplete();
    }
  }, [revealedCount, answersLength, qIdx, questions.length, onGameComplete]);

  const handleBack = useCallback((): boolean => {
    if (revealedCount > 0) {
      setRevealedCount(prev => prev - 1);
      return true;
    } else if (qIdx > 0) {
      const prev = questions[qIdx - 1];
      const prevCount = (prev?.answers ?? []).filter(a => a && a.trim()).length;
      setQIdx(qIdx - 1);
      setRevealedCount(prevCount);
      return true;
    }
    return false;
  }, [revealedCount, qIdx, questions]);

  useEffect(() => {
    setNavHandler(handleNext);
    setBackNavHandler(handleBack);
  }, [handleNext, handleBack, setNavHandler, setBackNavHandler]);

  const revealAll = useCallback(() => {
    setRevealedCount(answersLength);
  }, [answersLength]);

  // Allow the GM to jump straight to a specific rank by clicking the entry
  // in the structured answer list. Reveals all answers up to and including
  // the clicked rank. A long-press ArrowRight on the gamemaster arrives as
  // `nav-forward-long` and reveals every answer at once (same as the local
  // long-press / Bandle's jump-to-answer).
  const commandHandlerFn = useCallback((cmd: GamemasterCommand) => {
    if (cmd.controlId === 'nav-forward-long') {
      revealAll();
      return;
    }
    const m = cmd.controlId.match(/^rank-(\d+)$/);
    if (!m) return;
    const target = parseInt(m[1]!, 10);
    if (Number.isNaN(target)) return;
    const clamped = Math.max(0, Math.min(answersLength, target));
    setRevealedCount(clamped);
  }, [answersLength, revealAll]);

  useEffect(() => {
    setCommandHandler(commandHandlerFn);
  }, [commandHandlerFn, setCommandHandler]);

  useEffect(() => {
    document.documentElement.scrollTop = 0;
    document.body.scrollTop = 0;
  }, [qIdx]);

  useEffect(() => {
    if (revealedCount === 0) return;
    const timers: number[] = [];
    const scrollToBottom = () => {
      const target = Math.max(document.documentElement.scrollHeight, document.body.scrollHeight);
      window.scrollTo({ top: target, behavior: 'smooth' });
    };
    [0, 80, 200, 500].forEach(delay => {
      timers.push(window.setTimeout(scrollToBottom, delay));
    });
    return () => { timers.forEach(clearTimeout); };
  }, [revealedCount, qIdx]);

  // Short ArrowRight tap reveals the next answer; holding it (≥500 ms) reveals
  // all remaining answers at once. Disabled once everything is revealed so the
  // key falls through to the normal "next question" navigation.
  useArrowRightLongPress({
    enabled: revealedCount < answersLength,
    onShortPress: handleNext,
    onLongPress: revealAll,
  });

  if (!q) return null;

  return (
    <>
      <h2 className="quiz-question-number">{questionLabel}</h2>
      <div className="quiz-question">{q.question}</div>
      {q.topic && <div className="ranking-topic">{q.topic}</div>}

      <div className="statements-container">
        {answers.slice(0, revealedCount).map((text, i) => (
          <div key={`${text}-${i}`} className="statement ranking-row" style={{ cursor: 'default' }}>
            <span className="ranking-rank">{i + 1}.</span>
            <span className="ranking-text">{text}</span>
          </div>
        ))}
      </div>
      <audio ref={audioRef} />
    </>
  );
}
