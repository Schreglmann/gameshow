import { useCallback, useEffect, useMemo, useState } from 'react';
import type { GameComponentProps } from './types';
import type { ColorGuessConfig, ColorGuessQuestion, ColorSlice } from '@/types/config';
import type { GamemasterAnswerData } from '@/types/game';
import { useMusicPlayer } from '@/context/MusicContext';
import { Lightbox, useLightbox } from '@/components/layout/Lightbox';
import BaseGameWrapper from './BaseGameWrapper';

// ── Pie geometry ──

const PIE_CX = 50;
const PIE_CY = 50;
const PIE_R = 46;
const LABEL_R = 30;
const MIN_LABEL_ANGLE_DEG = 18; // hide label for slices smaller than ~5%

interface Wedge {
  slice: ColorSlice;
  startDeg: number;
  endDeg: number;
  sweepDeg: number;
  pathD: string;
  labelX: number;
  labelY: number;
  labelColor: string;
}

function polar(cx: number, cy: number, r: number, angleDeg: number): { x: number; y: number } {
  const rad = ((angleDeg - 90) * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

function relativeLuminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  const r = ((n >> 16) & 0xff) / 255;
  const g = ((n >> 8) & 0xff) / 255;
  const b = (n & 0xff) / 255;
  const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function buildWedges(colors: ColorSlice[]): Wedge[] {
  if (colors.length === 0) return [];

  // A single slice at 100% needs a full circle — SVG arc can't draw 360° in one path,
  // so render it as two half-arcs.
  if (colors.length === 1) {
    const slice = colors[0];
    const midTop = polar(PIE_CX, PIE_CY, PIE_R, 0);
    const midBottom = polar(PIE_CX, PIE_CY, PIE_R, 180);
    const d = [
      `M ${midTop.x} ${midTop.y}`,
      `A ${PIE_R} ${PIE_R} 0 1 1 ${midBottom.x} ${midBottom.y}`,
      `A ${PIE_R} ${PIE_R} 0 1 1 ${midTop.x} ${midTop.y}`,
      'Z',
    ].join(' ');
    return [{
      slice,
      startDeg: 0,
      endDeg: 360,
      sweepDeg: 360,
      pathD: d,
      labelX: PIE_CX,
      labelY: PIE_CY,
      labelColor: relativeLuminance(slice.hex) > 0.55 ? '#111' : '#fff',
    }];
  }

  const wedges: Wedge[] = [];
  let cursor = 0;
  for (const slice of colors) {
    const sweep = (slice.percent / 100) * 360;
    const start = cursor;
    const end = cursor + sweep;
    cursor = end;

    const p1 = polar(PIE_CX, PIE_CY, PIE_R, start);
    const p2 = polar(PIE_CX, PIE_CY, PIE_R, end);
    const largeArc = sweep > 180 ? 1 : 0;
    const d = [
      `M ${PIE_CX} ${PIE_CY}`,
      `L ${p1.x} ${p1.y}`,
      `A ${PIE_R} ${PIE_R} 0 ${largeArc} 1 ${p2.x} ${p2.y}`,
      'Z',
    ].join(' ');
    const mid = polar(PIE_CX, PIE_CY, LABEL_R, start + sweep / 2);
    wedges.push({
      slice,
      startDeg: start,
      endDeg: end,
      sweepDeg: sweep,
      pathD: d,
      labelX: mid.x,
      labelY: mid.y,
      labelColor: relativeLuminance(slice.hex) > 0.55 ? '#111' : '#fff',
    });
  }
  return wedges;
}

// ── ColorPie subcomponent ──

interface ColorPieProps {
  colors: ColorSlice[];
  highlightIdx: number | null;
  onHighlight: (idx: number | null) => void;
  /** Extra className merged onto the root SVG — callers use this to override the
   *  default `clamp()` sizing (e.g. small admin preview or modal with a
   *  constrained width). */
  className?: string;
}

export function ColorPie({ colors, highlightIdx, onHighlight, className }: ColorPieProps) {
  const wedges = useMemo(() => buildWedges(colors), [colors]);

  if (wedges.length === 0) {
    return <div className={`color-pie color-pie--empty${className ? ` ${className}` : ''}`}>Keine Farben verfügbar</div>;
  }

  return (
    <svg
      className={`color-pie${className ? ` ${className}` : ''}`}
      viewBox="0 0 100 100"
      role="img"
      aria-label="Farbverteilung"
      onMouseLeave={() => onHighlight(null)}
    >
      {wedges.map((w, i) => {
        const isActive = highlightIdx === i;
        return (
          <path
            key={i}
            d={w.pathD}
            fill={w.slice.hex}
            stroke="#0008"
            strokeWidth={0.35}
            className={`color-pie__wedge${isActive ? ' color-pie__wedge--active' : ''}`}
            onMouseEnter={() => onHighlight(i)}
            onFocus={() => onHighlight(i)}
            onClick={() => onHighlight(isActive ? null : i)}
            tabIndex={0}
          />
        );
      })}
      {wedges.map((w, i) =>
        w.sweepDeg >= MIN_LABEL_ANGLE_DEG ? (
          <text
            key={`label-${i}`}
            x={w.labelX}
            y={w.labelY}
            textAnchor="middle"
            dominantBaseline="central"
            className="color-pie__label"
            fill={w.labelColor}
          >
            {Math.round(w.slice.percent)}%
          </text>
        ) : null
      )}
    </svg>
  );
}

// ── Main component ──

export default function ColorGuess(props: GameComponentProps) {
  const config = props.config as ColorGuessConfig;
  const questions = useMemo(() => {
    const all = config.questions || [];
    if (all.length === 0) return all;
    return [all[0], ...all.slice(1).filter(q => !q.disabled)];
  }, [config.questions]);
  const totalQuestions = questions.length > 0 ? questions.length - 1 : 0;
  const music = useMusicPlayer();

  return (
    <BaseGameWrapper
      title={config.title}
      rules={config.rules || ['Ihr seht nur die Farbverteilung eines Bildes — erratet, was zu sehen ist!']}
      totalQuestions={totalQuestions}
      pointSystemEnabled={props.pointSystemEnabled}
      pointValue={props.currentIndex + 1}
      currentIndex={props.currentIndex}
      onRulesShow={() => music.fadeOut(2000)}
      onNextShow={() => music.fadeIn(3000)}
      onAwardPoints={props.onAwardPoints}
      onNextGame={props.onNextGame}
    >
      {({ onGameComplete, setNavHandler, setBackNavHandler, setGamemasterData }) => (
        <ColorGuessInner
          questions={questions}
          gameTitle={config.title}
          onGameComplete={onGameComplete}
          setNavHandler={setNavHandler}
          setBackNavHandler={setBackNavHandler}
          setGamemasterData={setGamemasterData}
        />
      )}
    </BaseGameWrapper>
  );
}

interface InnerProps {
  questions: ColorGuessQuestion[];
  gameTitle: string;
  onGameComplete: () => void;
  setNavHandler: (fn: (() => void) | null) => void;
  setBackNavHandler: (fn: (() => boolean) | null) => void;
  setGamemasterData: (data: GamemasterAnswerData | null) => void;
}

function ColorGuessInner({
  questions,
  gameTitle,
  onGameComplete,
  setNavHandler,
  setBackNavHandler,
  setGamemasterData,
}: InnerProps) {
  const [qIdx, setQIdx] = useState(0);
  const [showAnswer, setShowAnswer] = useState(false);
  const [highlightIdx, setHighlightIdx] = useState<number | null>(null);
  const { lightboxSrc, openLightbox, closeLightbox } = useLightbox();

  const q = questions[qIdx];
  const isExample = qIdx === 0;
  const questionLabel = isExample ? 'Beispiel' : `Bild ${qIdx} von ${questions.length - 1}`;
  const colors = q?.colors ?? [];
  const highlightedSlice = highlightIdx !== null ? colors[highlightIdx] : null;

  useEffect(() => {
    if (!q) return;
    setGamemasterData({
      gameTitle,
      questionNumber: qIdx,
      totalQuestions: questions.length - 1,
      answer: q.answer,
    });
  }, [qIdx, gameTitle, questions, setGamemasterData, q]);

  useEffect(() => {
    setHighlightIdx(null);
  }, [qIdx, showAnswer]);

  const handleNext = useCallback(() => {
    if (!showAnswer) {
      setShowAnswer(true);
    } else if (qIdx < questions.length - 1) {
      setQIdx(prev => prev + 1);
      setShowAnswer(false);
    } else {
      onGameComplete();
    }
  }, [showAnswer, qIdx, questions.length, onGameComplete]);

  const handleBack = useCallback((): boolean => {
    if (showAnswer) {
      setShowAnswer(false);
      return true;
    }
    if (qIdx > 0) {
      setQIdx(prev => prev - 1);
      setShowAnswer(true);
      return true;
    }
    return false;
  }, [showAnswer, qIdx]);

  useEffect(() => {
    setNavHandler(handleNext);
    setBackNavHandler(handleBack);
  }, [handleNext, setNavHandler, handleBack, setBackNavHandler]);

  // Scroll to top on new question; scroll to bottom when the answer + image appear
  // (mirrors the SimpleQuiz / ImageGuess scroll pattern).
  useEffect(() => {
    document.documentElement.scrollTop = 0;
    document.body.scrollTop = 0;
  }, [qIdx]);

  const scrollToBottom = useCallback(() => {
    window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
  }, []);

  useEffect(() => {
    if (showAnswer) setTimeout(scrollToBottom, 100);
  }, [showAnswer, scrollToBottom]);

  if (!q) return null;

  return (
    <>
      <h2 className="quiz-question-number">{questionLabel}</h2>

      <div className="color-guess-stage">
        <div className="color-guess-pie-wrap">
          <ColorPie colors={colors} highlightIdx={highlightIdx} onHighlight={setHighlightIdx} />
          <div className="color-guess-tooltip" aria-live="polite">
            {highlightedSlice
              ? `${highlightedSlice.hex} · ${Math.round(highlightedSlice.percent)} %`
              : ' '}
          </div>
        </div>

      </div>

      {showAnswer && (
        <div className="quiz-answer">
          <p>{q.answer}</p>
          <img
            src={q.image}
            alt={q.answer}
            className="quiz-image"
            onClick={() => openLightbox(q.image)}
            onLoad={scrollToBottom}
          />
        </div>
      )}

      <Lightbox src={lightboxSrc} onClose={closeLightbox} />
    </>
  );
}
