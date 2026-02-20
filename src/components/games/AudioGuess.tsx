import { useState, useEffect, useCallback, useRef } from 'react';
import type { GameComponentProps } from './types';
import type { AudioGuessConfig, AudioGuessQuestion } from '@/types/config';
import BaseGameWrapper from './BaseGameWrapper';

export default function AudioGuess(props: GameComponentProps) {
  const config = props.config as AudioGuessConfig;
  const questions = config.questions || [];
  const totalQuestions = questions.length > 0 ? questions.length - 1 : 0;

  return (
    <BaseGameWrapper
      title={config.title}
      rules={config.rules || ['Erkennt den Song anhand eines kurzen Ausschnittes.']}
      totalQuestions={totalQuestions}
      pointSystemEnabled={props.pointSystemEnabled}
      onAwardPoints={props.onAwardPoints}
      onNextGame={props.onNextGame}
    >
      {({ onGameComplete, setNavHandler }) => (
        <AudioInner
          questions={questions}
          onGameComplete={onGameComplete}
          setNavHandler={setNavHandler}
        />
      )}
    </BaseGameWrapper>
  );
}

interface InnerProps {
  questions: AudioGuessQuestion[];
  onGameComplete: () => void;
  setNavHandler: (fn: (() => void) | null) => void;
}

function getAudioSources(folder: string, file: string) {
  const base = `/audio-guess/${encodeURIComponent(folder)}/${encodeURIComponent(file)}`;
  const ext = file.split('.').pop()?.toLowerCase();
  // Provide fallback formats
  const sources = [base];
  if (ext === 'wav') {
    sources.push(base.replace(/\.wav$/i, '.mp3'));
    sources.push(base.replace(/\.wav$/i, '.opus'));
  }
  return sources;
}

function AudioInner({ questions, onGameComplete, setNavHandler }: InnerProps) {
  const [qIdx, setQIdx] = useState(0);
  const [showAnswer, setShowAnswer] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const longAudioRef = useRef<HTMLAudioElement | null>(null);

  const q = questions[qIdx];
  const isExample = qIdx === 0;
  const questionLabel = isExample ? 'Beispiel' : `Song ${qIdx} von ${questions.length - 1}`;

  // Cleanup audio on unmount or question change
  useEffect(() => {
    return () => {
      audioRef.current?.pause();
      longAudioRef.current?.pause();
    };
  }, [qIdx]);

  const handleNext = useCallback(() => {
    if (!showAnswer) {
      setShowAnswer(true);
      // Stop short clip, potentially play full song
      audioRef.current?.pause();
    } else {
      longAudioRef.current?.pause();
      audioRef.current?.pause();
      if (qIdx < questions.length - 1) {
        setQIdx(prev => prev + 1);
        setShowAnswer(false);
      } else {
        onGameComplete();
      }
    }
  }, [showAnswer, qIdx, questions.length, onGameComplete]);

  useEffect(() => {
    setNavHandler(handleNext);
  }, [handleNext, setNavHandler]);

  if (!q) return null;

  const shortSources = getAudioSources(q.folder, q.audioFile);
  // Try to find a long version
  const longFile = q.audioFile.replace(/^short\./, 'long.');
  const longSources = getAudioSources(q.folder, longFile);

  const playShort = () => {
    if (audioRef.current) {
      audioRef.current.currentTime = 0;
      audioRef.current.play().catch(() => {});
    }
  };

  const playLong = () => {
    if (longAudioRef.current) {
      longAudioRef.current.currentTime = 0;
      longAudioRef.current.play().catch(() => {});
    }
  };

  return (
    <>
      <h2 className="quiz-question-number">{questionLabel}</h2>

      {/* Hidden audio elements */}
      <audio ref={audioRef}>
        {shortSources.map((src, i) => (
          <source key={i} src={src} />
        ))}
      </audio>
      <audio ref={longAudioRef}>
        {longSources.map((src, i) => (
          <source key={i} src={src} />
        ))}
      </audio>

      {!showAnswer && (
        <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', justifyContent: 'center' }}>
          <button className="music-control-button" onClick={playShort}>
            ▶ Ausschnitt abspielen
          </button>
          <button className="music-control-button" onClick={playShort}>
            🔄 Ausschnitt wiederholen
          </button>
        </div>
      )}

      {showAnswer && (
        <>
          <div className="quiz-answer">
            <p style={{ fontWeight: 700 }}>{q.answer}</p>
          </div>
          <div style={{ marginTop: 20, display: 'flex', gap: 20, justifyContent: 'center' }}>
            <button className="music-control-button" onClick={playLong}>
              🎵 Ganzer Song
            </button>
            <button className="music-control-button" onClick={playShort}>
              🔄 Ausschnitt wiederholen
            </button>
          </div>
        </>
      )}
    </>
  );
}
