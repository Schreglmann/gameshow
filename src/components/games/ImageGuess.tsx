import { useState, useEffect, useLayoutEffect, useCallback, useRef, useMemo } from 'react';
import type { GameComponentProps } from './types';
import type { ImageGuessConfig, ImageGuessQuestion } from '@/types/config';
import type { GamemasterAnswerData } from '@/types/game';
import { Lightbox, useLightbox } from '@/components/layout/Lightbox';
import BaseGameWrapper from './BaseGameWrapper';

// ── Constants ──

type EffectType = 'blur' | 'pixelate' | 'zoom' | 'swirl' | 'noise' | 'scatter';

const DEFAULT_DURATIONS: Record<EffectType, number> = {
  blur: 15,
  pixelate: 15,
  zoom: 18,
  swirl: 15,
  noise: 12,
  scatter: 18,
};
const MAX_BLUR_PX = 40;
const MAX_ZOOM_SCALE = 30;
const PIXEL_MIN_SIZE = 4;
const ALL_EFFECTS: EffectType[] = ['blur', 'pixelate', 'zoom', 'swirl', 'noise', 'scatter'];

// ── Easing functions ──

function easeOutBlur(t: number): number {
  return 1 - (1 - t) * (1 - t);
}

function easeOutZoom(t: number): number {
  return 1 - Math.pow(1 - t, 2.5);
}

// ── Pixelate width mapping (C1 smooth) ──

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

// ── Helpers ──

function resolveObfuscation(value?: string): EffectType {
  if (ALL_EFFECTS.includes(value as EffectType)) return value as EffectType;
  return ALL_EFFECTS[Math.floor(Math.random() * ALL_EFFECTS.length)];
}

function useImageLoader(src: string) {
  const imgRef = useRef<HTMLImageElement | null>(null);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => { imgRef.current = img; setLoaded(true); };
    img.src = src;
    setLoaded(false);
    return () => { img.onload = null; };
  }, [src]);
  return { img: imgRef.current, loaded };
}

function drawFull(canvas: HTMLCanvasElement, img: HTMLImageElement, w: number, h: number) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(img, 0, 0, w, h);
}

// ── Shared canvas effect props ──

interface CanvasEffectProps {
  src: string;
  duration: number;
  showAnswer: boolean;
  qIdx: number;
  onPercentChange: (p: number) => void;
  onClick?: () => void;
}

// ── Main components ──

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

  return (
    <BaseGameWrapper
      title={config.title}
      rules={config.rules || ['Ein Bild wird schrittweise enthüllt — erratet, was darauf zu sehen ist!']}
      totalQuestions={totalQuestions}
      pointSystemEnabled={props.pointSystemEnabled}
      pointValue={props.currentIndex + 1}
      currentIndex={props.currentIndex}
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
  setBackNavHandler: (fn: (() => boolean) | null) => void;
  setGamemasterData: (data: GamemasterAnswerData | null) => void;
}

function ImageGuessInner({ questions, gameTitle, onGameComplete, setNavHandler, setBackNavHandler, setGamemasterData }: InnerProps) {
  const [qIdx, setQIdx] = useState(0);
  const [showAnswer, setShowAnswer] = useState(false);
  const [percent, setPercent] = useState(0);
  const imgRef = useRef<HTMLImageElement>(null);
  const rafRef = useRef(0);
  const { lightboxSrc, openLightbox, closeLightbox } = useLightbox();

  const resolvedEffects = useMemo(() =>
    questions.map(q => resolveObfuscation(q.obfuscation)),
    [questions]
  );

  const q = questions[qIdx];
  const obfuscation = resolvedEffects[qIdx];
  const duration = q?.duration ?? DEFAULT_DURATIONS[obfuscation];
  const isExample = qIdx === 0;
  const questionLabel = isExample ? 'Beispiel' : `Bild ${qIdx} von ${questions.length - 1}`;
  const isImgMode = obfuscation === 'blur' || obfuscation === 'zoom';

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

  // Smooth scroll to bottom on answer reveal so the answer text comes into
  // view when the card is taller than the viewport.
  useEffect(() => {
    if (showAnswer) {
      setTimeout(() => {
        window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
      }, 100);
    }
  }, [showAnswer]);

  // Position the page so the card sits just below the sticky header (with a
  // small margin) when it grows taller than the viewport on answer reveal.
  // Mirrors the logic in SimpleQuiz — only scrolls when a small scroll can
  // bring the bottom into view.
  useLayoutEffect(() => {
    const card = document.querySelector('.quiz-container') as HTMLElement | null;
    const header = document.querySelector('header') as HTMLElement | null;
    window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior });
    if (!card) return;
    const absoluteOffsetTop = (el: HTMLElement): number => {
      let top = 0;
      let node: HTMLElement | null = el;
      while (node) {
        top += node.offsetTop;
        node = node.offsetParent as HTMLElement | null;
      }
      return top;
    };
    const applyScroll = () => {
      const headerH = header?.offsetHeight ?? 0;
      const cardTop = absoluteOffsetTop(card);
      const cardH = card.offsetHeight;
      const overflow = cardTop + cardH - window.innerHeight;
      const maxScroll = Math.max(0, cardTop - headerH - 8);
      if (overflow <= 0 || overflow > maxScroll) return;
      const target = Math.round(Math.min(overflow + 16, maxScroll));
      if (Math.abs(window.scrollY - target) > 0.5) {
        window.scrollTo({ top: target, behavior: 'instant' as ScrollBehavior });
      }
    };
    applyScroll();
    const observer = new ResizeObserver(applyScroll);
    observer.observe(card);
    if (header) observer.observe(header);
    return () => observer.disconnect();
  }, [qIdx]);

  // JS-driven animation for blur and zoom (canvas modes handle themselves)
  useEffect(() => {
    const img = imgRef.current;

    if (showAnswer) {
      setPercent(100);
      if (img && isImgMode) {
        img.style.filter = '';
        img.style.transform = 'scale(1)';
        img.style.transformOrigin = '50% 50%';
      }
      return;
    }

    if (!isImgMode) return;

    const ease = obfuscation === 'zoom' ? easeOutZoom : easeOutBlur;
    const start = performance.now();
    let lastP = -1;

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
      if (p !== lastP) { lastP = p; setPercent(p); }

      if (obfuscation === 'blur') {
        img!.style.filter = `blur(${MAX_BLUR_PX * (1 - eased)}px)`;
      } else {
        img!.style.transform = `scale(${1 + (MAX_ZOOM_SCALE - 1) * (1 - eased)})`;
      }

      if (t < 1) rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [qIdx, duration, obfuscation, showAnswer, isImgMode]);

  const handleNext = useCallback(() => {
    if (!showAnswer) {
      setShowAnswer(true);
    } else {
      if (qIdx < questions.length - 1) {
        setPercent(0);
        setQIdx(prev => prev + 1);
        setShowAnswer(false);
      } else {
        onGameComplete();
      }
    }
  }, [showAnswer, qIdx, questions.length, onGameComplete]);

  const handleBack = useCallback((): boolean => {
    if (showAnswer) {
      setShowAnswer(false);
      return true;
    } else if (qIdx > 0) {
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

  if (!q) return null;

  const canvasProps: CanvasEffectProps = {
    src: q.image,
    duration,
    showAnswer,
    qIdx,
    onPercentChange: setPercent,
    onClick: showAnswer ? () => openLightbox(q.image) : undefined,
  };

  return (
    <>
      <h2 className="quiz-question-number">{questionLabel}</h2>
      <p className="image-guess-step">Bild aufl&ouml;sen &mdash; {percent}%</p>

      <div className="image-guess-container">
        {isImgMode ? (
          <img
            ref={imgRef}
            src={q.image}
            alt=""
            className="image-guess-image"
            style={{ transformOrigin: '50% 50%' }}
            onClick={showAnswer ? () => openLightbox(q.image) : undefined}
          />
        ) : obfuscation === 'pixelate' ? (
          <PixelateCanvas {...canvasProps} />
        ) : obfuscation === 'swirl' ? (
          <SwirlCanvas {...canvasProps} />
        ) : obfuscation === 'noise' ? (
          <NoiseCanvas {...canvasProps} />
        ) : (
          <ScatterCanvas {...canvasProps} />
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

// ── PixelateCanvas ──

function PixelateCanvas({ src, duration, showAnswer, qIdx, onPercentChange, onClick }: CanvasEffectProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { img, loaded } = useImageLoader(src);
  const rafRef = useRef(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !img || !loaded) return;
    const w = img.naturalWidth, h = img.naturalHeight;
    canvas.width = w; canvas.height = h;

    if (showAnswer) { drawFull(canvas, img, w, h); onPercentChange(100); return; }

    let lastSmallW = -1, lastP = -1;
    const start = performance.now();

    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / (duration * 1000));
      const p = Math.round(t * 100);
      if (p !== lastP) { lastP = p; onPercentChange(p); }
      if (t >= 1) { drawFull(canvas, img, w, h); return; }

      const smallW = Math.max(PIXEL_MIN_SIZE, Math.min(w, Math.round(pixelateWidth(t, w))));
      if (smallW !== lastSmallW) {
        lastSmallW = smallW;
        if (smallW >= w) { drawFull(canvas, img, w, h); }
        else {
          const smallH = Math.max(1, Math.round(h * (smallW / w)));
          const ctx = canvas.getContext('2d')!;
          ctx.imageSmoothingEnabled = true;
          ctx.drawImage(img, 0, 0, smallW, smallH);
          ctx.imageSmoothingEnabled = false;
          ctx.drawImage(canvas, 0, 0, smallW, smallH, 0, 0, w, h);
        }
      }
      rafRef.current = requestAnimationFrame(tick);
    };

    const initH = Math.max(1, Math.round(h * (PIXEL_MIN_SIZE / w)));
    const ctx = canvas.getContext('2d')!;
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(img, 0, 0, PIXEL_MIN_SIZE, initH);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(canvas, 0, 0, PIXEL_MIN_SIZE, initH, 0, 0, w, h);
    onPercentChange(0);
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [loaded, showAnswer, duration, qIdx, src, onPercentChange, img]);

  return <canvas ref={canvasRef} className="image-guess-image" style={{ cursor: onClick ? 'pointer' : 'default', imageRendering: 'pixelated' }} onClick={onClick} />;
}

// ── SwirlCanvas — pixel displacement with swirl effect ──

const SWIRL_MAX_STRENGTH = 12;
const SWIRL_WORK_SIZE = 400;

function SwirlCanvas({ src, duration, showAnswer, qIdx, onPercentChange, onClick }: CanvasEffectProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { img, loaded } = useImageLoader(src);
  const rafRef = useRef(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !img || !loaded) return;
    const w = img.naturalWidth, h = img.naturalHeight;
    canvas.width = w; canvas.height = h;

    if (showAnswer) { drawFull(canvas, img, w, h); onPercentChange(100); return; }

    // Work at reduced resolution for performance
    const scale = Math.min(1, SWIRL_WORK_SIZE / Math.max(w, h));
    const ww = Math.round(w * scale), wh = Math.round(h * scale);
    const workCanvas = document.createElement('canvas');
    workCanvas.width = ww; workCanvas.height = wh;
    const workCtx = workCanvas.getContext('2d')!;
    workCtx.drawImage(img, 0, 0, ww, wh);
    const srcData = workCtx.getImageData(0, 0, ww, wh).data;

    const cx = ww / 2, cy = wh / 2;
    const maxRadius = Math.sqrt(cx * cx + cy * cy);
    const start = performance.now();
    let lastP = -1;

    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / (duration * 1000));
      const eased = easeOutBlur(t);
      const strength = SWIRL_MAX_STRENGTH * (1 - eased);
      const p = Math.round(t * 100);
      if (p !== lastP) { lastP = p; onPercentChange(p); }

      if (t >= 1) { drawFull(canvas, img, w, h); return; }

      const outData = workCtx.createImageData(ww, wh);
      const out = outData.data;
      for (let y = 0; y < wh; y++) {
        for (let x = 0; x < ww; x++) {
          const dx = x - cx, dy = y - cy;
          const dist = Math.sqrt(dx * dx + dy * dy);
          const angle = Math.atan2(dy, dx);
          const factor = Math.max(0, 1 - dist / maxRadius);
          const newAngle = angle + strength * factor * factor;
          let sx = Math.round(cx + dist * Math.cos(newAngle));
          let sy = Math.round(cy + dist * Math.sin(newAngle));
          sx = Math.max(0, Math.min(ww - 1, sx));
          sy = Math.max(0, Math.min(wh - 1, sy));
          const oi = (y * ww + x) * 4, si = (sy * ww + sx) * 4;
          out[oi] = srcData[si]; out[oi + 1] = srcData[si + 1];
          out[oi + 2] = srcData[si + 2]; out[oi + 3] = 255;
        }
      }
      workCtx.putImageData(outData, 0, 0);
      const ctx = canvas.getContext('2d')!;
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(workCanvas, 0, 0, w, h);

      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [loaded, showAnswer, duration, qIdx, src, onPercentChange, img]);

  return <canvas ref={canvasRef} className="image-guess-image" style={{ cursor: onClick ? 'pointer' : 'default' }} onClick={onClick} />;
}

// ── NoiseCanvas — TV static that clears to reveal the image ──

const NOISE_BLOCK = 1;
const NOISE_WORK_SIZE = 300;

function NoiseCanvas({ src, duration, showAnswer, qIdx, onPercentChange, onClick }: CanvasEffectProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { img, loaded } = useImageLoader(src);
  const rafRef = useRef(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !img || !loaded) return;
    const w = img.naturalWidth, h = img.naturalHeight;
    canvas.width = w; canvas.height = h;

    if (showAnswer) { drawFull(canvas, img, w, h); onPercentChange(100); return; }

    // Work at reduced resolution — upscaled blocks look like chunky TV static
    const scale = Math.min(1, NOISE_WORK_SIZE / Math.max(w, h));
    const ww = Math.round(w * scale), wh = Math.round(h * scale);
    const workCanvas = document.createElement('canvas');
    workCanvas.width = ww; workCanvas.height = wh;
    const workCtx = workCanvas.getContext('2d')!;
    workCtx.drawImage(img, 0, 0, ww, wh);
    const imgData = workCtx.getImageData(0, 0, ww, wh).data;

    const start = performance.now();
    let lastP = -1;
    let lastFrame = 0;

    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / (duration * 1000));
      const p = Math.round(t * 100);
      if (p !== lastP) { lastP = p; onPercentChange(p); }
      if (t >= 1) { drawFull(canvas, img, w, h); return; }

      // Throttle to ~20fps for flickering static feel
      if (now - lastFrame < 150) { rafRef.current = requestAnimationFrame(tick); return; }
      lastFrame = now;

      // For each block: show image or random noise based on probability
      const outData = workCtx.createImageData(ww, wh);
      const out = outData.data;
      for (let by = 0; by < wh; by += NOISE_BLOCK) {
        for (let bx = 0; bx < ww; bx += NOISE_BLOCK) {
          const isNoise = Math.random() > t;
          const gray = isNoise ? Math.floor(Math.random() * 256) : 0;
          const nr = gray, ng = gray, nb = gray;
          const bxEnd = Math.min(bx + NOISE_BLOCK, ww);
          const byEnd = Math.min(by + NOISE_BLOCK, wh);
          for (let y = by; y < byEnd; y++) {
            for (let x = bx; x < bxEnd; x++) {
              const idx = (y * ww + x) * 4;
              if (isNoise) {
                out[idx] = nr; out[idx + 1] = ng; out[idx + 2] = nb;
              } else {
                out[idx] = imgData[idx]; out[idx + 1] = imgData[idx + 1]; out[idx + 2] = imgData[idx + 2];
              }
              out[idx + 3] = 255;
            }
          }
        }
      }
      workCtx.putImageData(outData, 0, 0);
      const ctx = canvas.getContext('2d')!;
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(workCanvas, 0, 0, w, h);

      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [loaded, showAnswer, duration, qIdx, src, onPercentChange, img]);

  return <canvas ref={canvasRef} className="image-guess-image" style={{ cursor: onClick ? 'pointer' : 'default' }} onClick={onClick} />;
}

// ── ScatterCanvas — image split into tiles that reassemble ──

const SCATTER_COLS = 8;
const SCATTER_ROWS = 6;

function ScatterCanvas({ src, duration, showAnswer, qIdx, onPercentChange, onClick }: CanvasEffectProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { img, loaded } = useImageLoader(src);
  const rafRef = useRef(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !img || !loaded) return;
    const w = img.naturalWidth, h = img.naturalHeight;
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d')!;

    if (showAnswer) { drawFull(canvas, img, w, h); onPercentChange(100); return; }

    const tileW = w / SCATTER_COLS, tileH = h / SCATTER_ROWS;
    const tiles: { dx: number; dy: number; rot: number }[] = [];
    for (let r = 0; r < SCATTER_ROWS; r++) {
      for (let c = 0; c < SCATTER_COLS; c++) {
        tiles.push({
          dx: (Math.random() - 0.5) * w * 2.5,
          dy: (Math.random() - 0.5) * h * 2.5,
          rot: (Math.random() - 0.5) * 120,
        });
      }
    }

    const start = performance.now();
    let lastP = -1;

    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / (duration * 1000));
      const eased = easeOutBlur(t);
      const remaining = 1 - eased;
      const p = Math.round(t * 100);
      if (p !== lastP) { lastP = p; onPercentChange(p); }

      if (t >= 1) { drawFull(canvas, img, w, h); return; }

      ctx.clearRect(0, 0, w, h);
      for (let r = 0; r < SCATTER_ROWS; r++) {
        for (let c = 0; c < SCATTER_COLS; c++) {
          const tile = tiles[r * SCATTER_COLS + c];
          const tx = c * tileW + tile.dx * remaining;
          const ty = r * tileH + tile.dy * remaining;
          const rot = tile.rot * remaining * Math.PI / 180;

          ctx.save();
          ctx.translate(tx + tileW / 2, ty + tileH / 2);
          ctx.rotate(rot);
          ctx.drawImage(img, c * tileW, r * tileH, tileW, tileH, -tileW / 2, -tileH / 2, tileW, tileH);
          ctx.restore();
        }
      }
      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [loaded, showAnswer, duration, qIdx, src, onPercentChange, img]);

  return <canvas ref={canvasRef} className="image-guess-image" style={{ cursor: onClick ? 'pointer' : 'default' }} onClick={onClick} />;
}
