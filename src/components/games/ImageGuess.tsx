import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import type { GameComponentProps } from './types';
import type { ImageGuessConfig, ImageGuessQuestion } from '@/types/config';
import type { GamemasterAnswerData } from '@/types/game';
import { useMusicPlayer } from '@/context/MusicContext';
import { Lightbox, useLightbox } from '@/components/layout/Lightbox';
import BaseGameWrapper from './BaseGameWrapper';

const DEFAULT_DURATIONS: Record<'blur' | 'pixelate' | 'zoom', number> = {
  blur: 15,
  pixelate: 15,
  zoom: 18,
};
const MAX_BLUR_PX = 40;
const MAX_ZOOM_SCALE = 30;
const PIXEL_MIN_SIZE = 4;
const CONCRETE_EFFECTS: ('blur' | 'pixelate' | 'zoom')[] = ['blur', 'pixelate', 'zoom'];

/** Quadratic ease-out: fast start, slow end — used for blur */
function easeOutBlur(t: number): number {
  return 1 - (1 - t) * (1 - t);
}

/** Stronger ease-out for zoom: same feel as blur but extra slow after 80% */
function easeOutZoom(t: number): number {
  return 1 - Math.pow(1 - t, 2.5);
}

/** Pixelate pixel-width mapping — C1 smooth (no abrupt speed changes).
 *  0–25%: quadratic decelerating into the linear zone (4→LOW px)
 *  25–75%: linear LOW→HIGH px (guessable, many distinct widths, steady feel)
 *  75–100%: quadratic accelerating to full resolution (HIGH→full)
 *  Derivatives match at every boundary so progression feels seamless.
 *  LOW/HIGH are clamped for low-res images. */
function pixelateWidth(t: number, fullWidth: number): number {
  const LOW = Math.min(45, fullWidth * 0.25);
  const HIGH = Math.min(130, fullWidth * 0.7);
  const T1 = 0.25;
  const T2 = 0.75;
  const slope = (HIGH - LOW) / (T2 - T1);

  if (t <= T1) {
    const a = (PIXEL_MIN_SIZE - LOW + slope * T1) / (T1 * T1);
    const b = slope - 2 * a * T1;
    return a * t * t + b * t + PIXEL_MIN_SIZE;
  }
  if (t <= T2) {
    return LOW + slope * (t - T1);
  }
  const dt = t - T2;
  const T3 = 1 - T2;
  const a = (fullWidth - HIGH - slope * T3) / (T3 * T3);
  return a * dt * dt + slope * dt + HIGH;
}

function getEasing(mode: 'blur' | 'zoom'): (t: number) => number {
  if (mode === 'zoom') return easeOutZoom;
  return easeOutBlur;
}

function resolveObfuscation(value?: string): 'blur' | 'pixelate' | 'zoom' {
  if (value === 'blur' || value === 'pixelate' || value === 'zoom') return value;
  return CONCRETE_EFFECTS[Math.floor(Math.random() * CONCRETE_EFFECTS.length)];
}

export default function ImageGuess(props: GameComponentProps) {
  const config = props.config as ImageGuessConfig;
  const questions = useMemo(
    () => {
      const all = config.questions || [];
      if (all.length === 0) return all;
      return [all[0], ...all.slice(1).filter(q => !q.disabled)];
    },
    [config.questions]
  );
  const totalQuestions = questions.length > 0 ? questions.length - 1 : 0;
  const music = useMusicPlayer();

  return (
    <BaseGameWrapper
      title={config.title}
      rules={config.rules || ['Ein Bild wird schrittweise enthüllt — erratet, was darauf zu sehen ist!']}
      totalQuestions={totalQuestions}
      pointSystemEnabled={props.pointSystemEnabled}
      pointValue={props.currentIndex + 1}
      onRulesShow={() => music.fadeOut(2000)}
      onNextShow={() => music.fadeIn(3000)}
      onAwardPoints={props.onAwardPoints}
      onNextGame={props.onNextGame}
    >
      {({ onGameComplete, setNavHandler, setBackNavHandler, setGamemasterData }) => (
        <ImageGuessInner
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
  questions: ImageGuessQuestion[];
  gameTitle: string;
  onGameComplete: () => void;
  setNavHandler: (fn: (() => void) | null) => void;
  setBackNavHandler: (fn: (() => void) | null) => void;
  setGamemasterData: (data: GamemasterAnswerData | null) => void;
}

function ImageGuessInner({ questions, gameTitle, onGameComplete, setNavHandler, setBackNavHandler, setGamemasterData }: InnerProps) {
  const [qIdx, setQIdx] = useState(0);
  const [showAnswer, setShowAnswer] = useState(false);
  const [percent, setPercent] = useState(0);
  const imgRef = useRef<HTMLImageElement>(null);
  const rafRef = useRef(0);
  const { lightboxSrc, openLightbox, closeLightbox } = useLightbox();

  // Resolve obfuscation per question once on mount (random stays stable for the session)
  const resolvedEffects = useMemo(() =>
    questions.map(q => resolveObfuscation(q.obfuscation)),
    [questions]
  );

  const q = questions[qIdx];
  const obfuscation = resolvedEffects[qIdx];
  const duration = q?.duration ?? DEFAULT_DURATIONS[obfuscation];
  const isExample = qIdx === 0;
  const questionLabel = isExample ? 'Beispiel' : `Bild ${qIdx} von ${questions.length - 1}`;

  // Gamemaster sync
  useEffect(() => {
    if (!q) return;
    setGamemasterData({
      gameTitle,
      questionNumber: qIdx,
      totalQuestions: questions.length - 1,
      answer: q.answer,
    });
  }, [qIdx, gameTitle, questions, setGamemasterData, q]);

  // Auto-reveal when animation reaches 100%
  useEffect(() => {
    if (percent >= 100 && !showAnswer) {
      setShowAnswer(true);
    }
  }, [percent, showAnswer]);

  // Scroll to top on new question
  useEffect(() => {
    document.documentElement.scrollTop = 0;
    document.body.scrollTop = 0;
  }, [qIdx]);

  // Scroll to bottom when answer is revealed
  const scrollToBottom = useCallback(() => {
    window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
  }, []);

  useEffect(() => {
    if (showAnswer) {
      setTimeout(scrollToBottom, 100);
    }
  }, [showAnswer, scrollToBottom]);

  // JS-driven animation for blur and zoom (pixelate has its own rAF in PixelateCanvas)
  useEffect(() => {
    const img = imgRef.current;
    const isImgMode = obfuscation === 'blur' || obfuscation === 'zoom';

    if (showAnswer) {
      setPercent(100);
      if (img && isImgMode) {
        img.style.filter = '';
        img.style.transform = 'scale(1)';
        img.style.transformOrigin = '50% 50%';
      }
      return;
    }

    if (!isImgMode) return; // pixelate handles itself

    const ease = getEasing(obfuscation);
    const start = performance.now();
    let lastP = -1;

    // Set initial state immediately (max obfuscation)
    if (obfuscation === 'blur') {
      img!.style.filter = `blur(${MAX_BLUR_PX}px)`;
      img!.style.transform = '';
    } else {
      img!.style.filter = '';
      img!.style.transform = `scale(${MAX_ZOOM_SCALE})`;
      img!.style.transformOrigin = '50% 50%';
    }

    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / (duration * 1000));
      const eased = ease(t);
      const p = Math.round(t * 100);

      if (p !== lastP) {
        lastP = p;
        setPercent(p);
      }

      if (obfuscation === 'blur') {
        img!.style.filter = `blur(${MAX_BLUR_PX * (1 - eased)}px)`;
      } else {
        const scale = 1 + (MAX_ZOOM_SCALE - 1) * (1 - eased);
        img!.style.transform = `scale(${scale})`;
      }

      if (t < 1) {
        rafRef.current = requestAnimationFrame(tick);
      }
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [qIdx, duration, obfuscation, showAnswer]);

  const handleNext = useCallback(() => {
    if (!showAnswer) {
      setShowAnswer(true);
    } else {
      if (qIdx < questions.length - 1) {
        setQIdx(prev => prev + 1);
        setShowAnswer(false);
      } else {
        onGameComplete();
      }
    }
  }, [showAnswer, qIdx, questions.length, onGameComplete]);

  const handleBack = useCallback(() => {
    if (showAnswer) {
      setShowAnswer(false);
    } else if (qIdx > 0) {
      setQIdx(prev => prev - 1);
      setShowAnswer(true);
    }
  }, [showAnswer, qIdx]);

  useEffect(() => {
    setNavHandler(handleNext);
    setBackNavHandler(handleBack);
  }, [handleNext, setNavHandler, handleBack, setBackNavHandler]);

  if (!q) return null;

  return (
    <>
      <h2 className="quiz-question-number">{questionLabel}</h2>

      <p className="image-guess-step">Bild aufl&ouml;sen &mdash; {percent}%</p>

      <div className="image-guess-container">
        {obfuscation === 'pixelate' ? (
          <PixelateCanvas
            src={q.image}
            duration={duration}
            showAnswer={showAnswer}
            qIdx={qIdx}
            onPercentChange={setPercent}
            onClick={showAnswer ? () => openLightbox(q.image) : undefined}
          />
        ) : (
          <img
            ref={imgRef}
            src={q.image}
            alt=""
            className="image-guess-image"
            style={{ transformOrigin: '50% 50%' }}
            onClick={showAnswer ? () => openLightbox(q.image) : undefined}
          />
        )}
      </div>

      {showAnswer && (
        <div className="quiz-answer">
          <p>{q.answer}</p>
        </div>
      )}

      <Lightbox src={lightboxSrc} onClose={closeLightbox} />
    </>
  );
}

// Canvas-based pixelation — smooth continuous progression driven by rAF
interface PixelateCanvasProps {
  src: string;
  duration: number;
  showAnswer: boolean;
  qIdx: number;
  onPercentChange: (p: number) => void;
  onClick?: () => void;
}

function PixelateCanvas({ src, duration, showAnswer, qIdx, onPercentChange, onClick }: PixelateCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const [loaded, setLoaded] = useState(false);
  const rafRef = useRef(0);

  // Load image
  useEffect(() => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      imgRef.current = img;
      setLoaded(true);
    };
    img.src = src;
    setLoaded(false);
    return () => { img.onload = null; };
  }, [src]);

  // Animate pixelation via rAF
  useEffect(() => {
    const canvas = canvasRef.current;
    const img = imgRef.current;
    if (!canvas || !img || !loaded) return;

    const w = img.naturalWidth;
    const h = img.naturalHeight;
    canvas.width = w;
    canvas.height = h;

    if (showAnswer) {
      drawFull(canvas, img, w, h);
      onPercentChange(100);
      return;
    }

    let lastSmallW = -1;
    let lastP = -1;
    const start = performance.now();

    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / (duration * 1000));

      const p = Math.round(t * 100);
      if (p !== lastP) {
        lastP = p;
        onPercentChange(p);
      }

      if (t >= 1) {
        drawFull(canvas, img, w, h);
        return;
      }

      // Piecewise C1-smooth: quadratic→linear→quadratic
      const smallW = Math.max(PIXEL_MIN_SIZE, Math.min(w, Math.round(pixelateWidth(t, w))));

      // Only redraw when the rounded pixel width actually changes
      if (smallW !== lastSmallW) {
        lastSmallW = smallW;
        if (smallW >= w) {
          drawFull(canvas, img, w, h);
        } else {
          const smallH = Math.max(1, Math.round(h * (smallW / w)));
          drawPixelated(canvas, img, w, h, smallW, smallH);
        }
      }

      rafRef.current = requestAnimationFrame(tick);
    };

    // Draw initial frame immediately (most pixelated)
    const initH = Math.max(1, Math.round(h * (PIXEL_MIN_SIZE / w)));
    drawPixelated(canvas, img, w, h, PIXEL_MIN_SIZE, initH);
    lastSmallW = PIXEL_MIN_SIZE;
    onPercentChange(0);
    rafRef.current = requestAnimationFrame(tick);

    return () => cancelAnimationFrame(rafRef.current);
  }, [loaded, showAnswer, duration, qIdx, src, onPercentChange]);

  return (
    <canvas
      ref={canvasRef}
      className="image-guess-image"
      style={{ cursor: onClick ? 'pointer' : 'default', imageRendering: 'pixelated' }}
      onClick={onClick}
    />
  );
}

function drawFull(canvas: HTMLCanvasElement, img: HTMLImageElement, w: number, h: number) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(img, 0, 0, w, h);
}

function drawPixelated(canvas: HTMLCanvasElement, img: HTMLImageElement, w: number, h: number, smallW: number, smallH: number) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(img, 0, 0, smallW, smallH);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(canvas, 0, 0, smallW, smallH, 0, 0, w, h);
}
