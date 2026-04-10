import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import type { GameComponentProps } from './types';
import type { BandleConfig, BandleQuestion } from '@/types/config';
import { useMusicPlayer } from '@/context/MusicContext';
import BaseGameWrapper from './BaseGameWrapper';

export default function Bandle(props: GameComponentProps) {
  const config = props.config as BandleConfig;
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
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    return () => {
      audioRef.current?.pause();
    };
  }, []);

  const handleNextShow = () => {
    const audio = audioRef.current;
    if (audio && !audio.paused) {
      const startVolume = audio.volume;
      const steps = 40;
      const interval = 2000 / steps;
      let step = 0;
      const timer = setInterval(() => {
        step++;
        audio.volume = Math.max(0, startVolume * (1 - step / steps));
        if (step >= steps) {
          clearInterval(timer);
          audio.pause();
        }
      }, interval);
    }
    setTimeout(() => music.fadeIn(3000), 500);
  };

  return (
    <BaseGameWrapper
      title={config.title}
      rules={config.rules || [
        'Ihr hört einen Song Schicht für Schicht.',
        'Zuerst nur ein Instrument, dann kommen nach und nach weitere dazu.',
        'Wer den Song mit weniger Hinweisen erkennt, gewinnt.',
      ]}
      totalQuestions={totalQuestions}
      pointSystemEnabled={props.pointSystemEnabled}
      pointValue={props.currentIndex + 1}
      onRulesShow={() => music.fadeOut(2000)}
      onNextShow={handleNextShow}
      onAwardPoints={props.onAwardPoints}
      onNextGame={props.onNextGame}
    >
      {({ onGameComplete, setNavHandler, setBackNavHandler }) => (
        <BandleInner
          questions={questions}
          audioRef={audioRef}
          onGameComplete={onGameComplete}
          setNavHandler={setNavHandler}
          setBackNavHandler={setBackNavHandler}
        />
      )}
    </BaseGameWrapper>
  );
}

interface InnerProps {
  questions: BandleQuestion[];
  audioRef: React.RefObject<HTMLAudioElement | null>;
  onGameComplete: () => void;
  setNavHandler: (fn: (() => void) | null) => void;
  setBackNavHandler: (fn: (() => void) | null) => void;
}

function BandleInner({ questions, audioRef, onGameComplete, setNavHandler, setBackNavHandler }: InnerProps) {
  const [qIdx, setQIdx] = useState(0);
  const [revealedCount, setRevealedCount] = useState(1);
  const [showHint, setShowHint] = useState(false);
  const [showAnswer, setShowAnswer] = useState(false);
  const [audioCurrentTime, setAudioCurrentTime] = useState(0);
  const [audioDuration, setAudioDuration] = useState(0);
  const [audioPlaying, setAudioPlaying] = useState(false);
  const [activeTrackIndex, setActiveTrackIndex] = useState(0);

  const q = questions[qIdx];
  const isExample = q?.isExample || qIdx === 0;
  const questionLabel = isExample ? 'Beispiel' : `Song ${qIdx} von ${questions.length - 1}`;
  const tracks = q?.tracks ?? [];
  const totalTracks = tracks.length;
  const hasHint = !!q?.hint;

  const formatTime = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2, '0')}`;
  };

  // Audio event listeners for timeline
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const onTimeUpdate = () => setAudioCurrentTime(audio.currentTime);
    const onDuration = () => setAudioDuration(audio.duration || 0);
    const onPlay = () => setAudioPlaying(true);
    const onPause = () => setAudioPlaying(false);
    audio.addEventListener('timeupdate', onTimeUpdate);
    audio.addEventListener('loadedmetadata', onDuration);
    audio.addEventListener('durationchange', onDuration);
    audio.addEventListener('play', onPlay);
    audio.addEventListener('pause', onPause);
    return () => {
      audio.removeEventListener('timeupdate', onTimeUpdate);
      audio.removeEventListener('loadedmetadata', onDuration);
      audio.removeEventListener('durationchange', onDuration);
      audio.removeEventListener('play', onPlay);
      audio.removeEventListener('pause', onPause);
    };
  }, [audioRef]);

  // Play audio for a specific track
  const playTrack = useCallback((trackIndex: number) => {
    const audio = audioRef.current;
    if (!audio || !tracks[trackIndex]) return;
    audio.pause();
    audio.src = tracks[trackIndex].audio;
    audio.load();
    audio.play().catch(() => {});
    setAudioCurrentTime(0);
    setAudioDuration(0);
  }, [audioRef, tracks]);

  // Play/pause toggle
  const handlePlayPause = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) {
      audio.play().catch(() => {});
    } else {
      audio.pause();
    }
  }, [audioRef]);

  // Restart current track
  const handleRestart = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.currentTime = 0;
    audio.play().catch(() => {});
  }, [audioRef]);

  // Click on a track pill
  const handleTrackClick = useCallback((index: number) => {
    if ((showAnswer || showHint) && index >= revealedCount) return;
    if (index < revealedCount) {
      // Revealed track: replay it
      playTrack(index);
      setActiveTrackIndex(index);
    } else {
      // Unrevealed track: reveal up to and including it
      setRevealedCount(index + 1);
      setActiveTrackIndex(index);
      playTrack(index);
    }
  }, [showAnswer, showHint, revealedCount, playTrack]);

  // Seek on progress bar click — must not bubble to track pills
  const handleProgressClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    e.stopPropagation();
    const audio = audioRef.current;
    if (!audio || !audioDuration || audioDuration !== audioDuration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    audio.currentTime = ratio * audioDuration;
  }, [audioRef, audioDuration]);

  // When question changes: reset state and autoplay first track
  useEffect(() => {
    if (!q) return;
    setActiveTrackIndex(0);
    playTrack(0);
    return () => {
      audioRef.current?.pause();
    };
  }, [qIdx]); // eslint-disable-line react-hooks/exhaustive-deps

  // Reveal answer: play last track and show answer (skips hint)
  const revealAnswer = useCallback(() => {
    setShowHint(false);
    setShowAnswer(true);
    setRevealedCount(totalTracks);
    setActiveTrackIndex(-2);
    playTrack(totalTracks - 1);
  }, [totalTracks, playTrack]);

  const handleNext = useCallback(() => {
    if (!showAnswer && !showHint && revealedCount < totalTracks) {
      // Reveal next track
      const next = revealedCount;
      setRevealedCount(prev => prev + 1);
      setActiveTrackIndex(next);
      playTrack(next);
    } else if (!showAnswer && !showHint && hasHint) {
      // All tracks revealed and hint exists: show hint
      setShowHint(true);
      setActiveTrackIndex(-1);
    } else if (!showAnswer) {
      // Hint shown (or no hint): show answer
      setShowHint(false);
      setShowAnswer(true);
      setActiveTrackIndex(-2);
    } else {
      // Answer shown, move to next question
      if (qIdx < questions.length - 1) {
        audioRef.current?.pause();
        setQIdx(prev => prev + 1);
        setRevealedCount(1);
        setShowHint(false);
        setShowAnswer(false);
      } else {
        onGameComplete();
      }
    }
  }, [showAnswer, showHint, hasHint, revealedCount, totalTracks, qIdx, questions.length, onGameComplete, audioRef, playTrack]);

  const handleBack = useCallback(() => {
    if (showAnswer) {
      // Back from answer: go to hint if it exists, otherwise just hide answer
      setShowAnswer(false);
      if (hasHint) {
        setShowHint(true);
        setActiveTrackIndex(-1);
      } else {
        setActiveTrackIndex(revealedCount - 1);
      }
    } else if (showHint) {
      // Back from hint: go back to all tracks revealed
      setShowHint(false);
      setActiveTrackIndex(revealedCount - 1);
    } else if (revealedCount > 1) {
      const target = revealedCount - 2;
      setRevealedCount(prev => prev - 1);
      setActiveTrackIndex(target);
      playTrack(target);
    } else if (qIdx > 0) {
      // Go back to previous question with answer shown
      audioRef.current?.pause();
      const prevQ = questions[qIdx - 1];
      setQIdx(prev => prev - 1);
      setShowAnswer(true);
      setShowHint(false);
      setRevealedCount(prevQ?.tracks?.length ?? 1);
      setActiveTrackIndex(-2);
    }
  }, [showAnswer, showHint, hasHint, revealedCount, qIdx, questions, audioRef, playTrack]);

  useEffect(() => {
    setNavHandler(handleNext);
    setBackNavHandler(handleBack);
  }, [handleNext, setNavHandler, handleBack, setBackNavHandler]);

  if (!q) return null;

  return (
    <>
      <h2 className="quiz-question-number">{questionLabel}</h2>

      {(q.releaseYear || q.clicks || q.difficulty != null) && (
        <div className="bandle-meta">
          {q.releaseYear && <span className="bandle-meta-item"><span className="bandle-meta-label">Erschienen:</span> {q.releaseYear}</span>}
          {q.clicks && <span className="bandle-meta-item"><span className="bandle-meta-label">Klicks:</span> {q.clicks >= 1000 ? `${(q.clicks / 1000).toFixed(1)} Mrd.` : `${q.clicks} Mio.`}</span>}
          {q.difficulty != null && (
            <span className="bandle-meta-item">
              <span className="bandle-meta-label">Schwierigkeit:</span> {'★'.repeat(q.difficulty)}{'☆'.repeat(5 - q.difficulty)}
            </span>
          )}
        </div>
      )}

      <audio ref={audioRef} />

      {/* Track progress indicators — clickable */}
      <div className="bandle-tracks">
        {tracks.map((track, i) => {
          const isRevealed = i < revealedCount;
          const isCurrent = i === activeTrackIndex;
          return (
            <div
              key={i}
              className={`bandle-track${isRevealed ? ' revealed' : ' hidden'}${isCurrent ? ' active' : ''}${!showAnswer && !showHint ? ' clickable' : ''}`}
              onClick={() => handleTrackClick(i)}
              role="button"
              tabIndex={showAnswer || showHint ? -1 : 0}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') handleTrackClick(i); }}
            >
              <span className="bandle-track-number">Stufe {i + 1}</span>
              {isRevealed ? track.label : '?'}
            </div>
          );
        })}
        {hasHint && (
          <div
            className={`bandle-track bandle-track-hint${showHint || showAnswer ? ` revealed${activeTrackIndex === -1 ? ' active' : ''}` : ' hidden'}`}
            onClick={() => { if (showHint || showAnswer) setActiveTrackIndex(-1); }}
            role="button"
            style={{ cursor: showHint || showAnswer ? 'pointer' : undefined }}
          >
            <span className="bandle-track-number">Stufe {totalTracks + 1}</span>
            Hinweis
            {(showHint || showAnswer) && q?.hint && (
              <div className="bandle-hint-text">{q.hint}</div>
            )}
          </div>
        )}
        <div
          className={`bandle-track bandle-track-answer${showAnswer ? ` revealed${activeTrackIndex === -2 ? ' active' : ''}` : ' hidden'}`}
          onClick={() => { if (showAnswer) setActiveTrackIndex(-2); else revealAnswer(); }}
          role="button"
          style={{ cursor: 'pointer' }}
          aria-label="Auflösen"
          tabIndex={showAnswer ? -1 : 0}
          onKeyDown={(e) => { if ((e.key === 'Enter' || e.key === ' ') && !showAnswer) revealAnswer(); }}
        >
          Auflösung
        </div>
      </div>

      {/* Audio timeline + controls */}
      <div className="bandle-player">
          <div className="bandle-progress" onClick={handleProgressClick}>
            <div
              className="bandle-progress-fill"
              style={{ width: audioDuration > 0 ? `${(audioCurrentTime / audioDuration) * 100}%` : '0%' }}
            />
          </div>
          <div className="audio-controls">
            <button
              className="audio-ctrl-btn"
              onClick={handlePlayPause}
              title={audioPlaying ? 'Pause' : 'Abspielen'}
              aria-label={audioPlaying ? 'Pause' : 'Abspielen'}
            >
              {audioPlaying ? (
                <svg width="8" height="10" viewBox="0 0 12 14" fill="currentColor">
                  <rect x="0" y="0" width="4" height="14" rx="1" />
                  <rect x="8" y="0" width="4" height="14" rx="1" />
                </svg>
              ) : (
                <svg width="8" height="10" viewBox="0 0 12 14" fill="currentColor">
                  <polygon points="0,0 12,7 0,14" />
                </svg>
              )}
            </button>
            <button
              className="audio-ctrl-btn"
              onClick={handleRestart}
              title="Von vorne"
              aria-label="Von vorne abspielen"
            >
              <svg width="10" height="10" viewBox="0 0 14 14" fill="currentColor">
                <rect x="0" y="0" width="2.5" height="14" rx="1" />
                <polygon points="14,0 3,7 14,14" />
              </svg>
            </button>
            <span className="audio-ctrl-divider" />
            <span className="audio-timestamp">
              {formatTime(audioCurrentTime)} / {formatTime(audioDuration)}
            </span>
          </div>
        </div>

      {showAnswer && (
        <div className="quiz-answer">
          <p>{q.answer}</p>
          {q.answerImage && (
            <img src={q.answerImage} alt="" className="quiz-image" />
          )}
        </div>
      )}
    </>
  );
}
