import { useMemo, useCallback, useEffect } from 'react';
import { createPortal } from 'react-dom';
import type { SimpleQuizQuestion } from '@/types/config';
import Timer from '@/components/common/Timer';
import { Lightbox, useLightbox } from '@/components/layout/Lightbox';

interface Props {
  question: SimpleQuizQuestion;
  questionLabel: string;
  showAnswer: boolean;
  timerKey: number;
  timerRunning: boolean;
  onTimerComplete: () => void;
  audioCurrentTime: number;
  audioDuration: number;
  audioPlaying: boolean;
  onAudioPlayPause: () => void;
  onAudioRestart: () => void;
}

function formatTime(s: number) {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, '0')}`;
}

export default function QuizQuestionView({
  question: q,
  questionLabel,
  showAnswer,
  timerKey,
  timerRunning,
  onTimerComplete,
  audioCurrentTime,
  audioDuration,
  audioPlaying,
  onAudioPlayPause,
  onAudioRestart,
}: Props) {
  const { lightboxSrc, openLightbox, closeLightbox } = useLightbox();

  const isEmojiOnly = useMemo(() => {
    const stripped = q.question.replace(/[\s\uFE0F]/g, '');
    const emojiRegex = /^[\p{Emoji_Presentation}\p{Extended_Pictographic}]+$/u;
    return emojiRegex.test(stripped);
  }, [q.question]);

  const scrollToBottom = useCallback(() => {
    window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
  }, []);

  useEffect(() => {
    if (showAnswer) setTimeout(scrollToBottom, 100);
  }, [showAnswer, scrollToBottom]);

  return (
    <>
      <h2 className="quiz-question-number">{questionLabel}</h2>

      {q.info && <div className="quiz-question-info">{q.info}</div>}

      {q.timer && !showAnswer && createPortal(
        <div style={{ position: 'fixed', bottom: '1.5rem', left: '1.5rem', zIndex: 9999 }}>
          <Timer
            key={timerKey}
            seconds={q.timer}
            running={timerRunning}
            onComplete={onTimerComplete}
          />
        </div>,
        document.body
      )}

      {q.question && (
        <div
          className="quiz-question"
          style={isEmojiOnly ? { fontSize: '6em', lineHeight: 1.2 } : undefined}
        >
          {q.question}
        </div>
      )}

      {q.questionAudio && audioDuration > 0 && (
        <div className="audio-controls">
          <span className="audio-timestamp">
            {formatTime(Math.max(0, audioCurrentTime - (q.questionAudioStart ?? 0)))} / {formatTime(Math.max(0, (q.questionAudioEnd ?? audioDuration) - (q.questionAudioStart ?? 0)))}
          </span>
          <span className="audio-ctrl-divider" />
          <button
            className="audio-ctrl-btn"
            onClick={onAudioPlayPause}
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
            onClick={onAudioRestart}
            title="Von vorne"
            aria-label="Von vorne abspielen"
          >
            <svg width="10" height="10" viewBox="0 0 14 14" fill="currentColor">
              <rect x="0" y="0" width="2.5" height="14" rx="1" />
              <polygon points="14,0 3,7 14,14" />
            </svg>
          </button>
        </div>
      )}

      {q.questionColors && q.questionColors.length > 0 && (
        <div className="color-swatches">
          {q.questionColors.map((color, idx) => (
            <div
              key={idx}
              className="color-swatch"
              style={{ background: color }}
              title={color}
            />
          ))}
        </div>
      )}

      {q.questionImage && (
        <img
          src={showAnswer && q.replaceImage && q.answerImage ? q.answerImage : q.questionImage}
          alt=""
          className="quiz-image"
          onClick={() => openLightbox((showAnswer && q.replaceImage && q.answerImage ? q.answerImage : q.questionImage)!)}
        />
      )}

      {showAnswer && !(q.replaceImage && !q.answer && !q.answerList) && (
        <div className="quiz-answer">
          {!q.answerList && q.answer && <p>{q.answer}</p>}
          {q.answerList && (
            <div className={q.answerImage && !q.replaceImage ? 'answer-list-with-image' : undefined}>
              <ul className="answer-list">
                {q.answerList.map((item, i) => {
                  const itemWithoutNumber = item.replace(/^\d+\.\s*/, '');
                  const isCorrect = item === q.answer || itemWithoutNumber === q.answer || item.includes(q.answer);
                  return (
                    <li key={i} className={isCorrect ? 'correct' : ''}>
                      {item}
                    </li>
                  );
                })}
              </ul>
              {q.answerImage && !q.replaceImage && (
                <img
                  src={q.answerImage}
                  alt=""
                  className="quiz-image"
                  onClick={() => openLightbox(q.answerImage!)}
                  onLoad={scrollToBottom}
                />
              )}
            </div>
          )}
          {!q.answerList && q.answerImage && !q.replaceImage && (
            <img
              src={q.answerImage}
              alt=""
              className="quiz-image"
              onClick={() => openLightbox(q.answerImage!)}
              onLoad={scrollToBottom}
            />
          )}
        </div>
      )}

      <Lightbox src={lightboxSrc} onClose={closeLightbox} />
    </>
  );
}
