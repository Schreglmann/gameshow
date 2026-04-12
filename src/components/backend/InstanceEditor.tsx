import { useState, useEffect, useRef } from 'react';
import type { GameType, SimpleQuizQuestion, GuessingGameQuestion, FinalQuizQuestion, FourStatementsQuestion, FactOrFakeQuestion, QuizjagdFlatQuestion, AudioGuessQuestion, VideoGuessQuestion, BandleQuestion, ImageGuessQuestion } from '@/types/config';
import SimpleQuizForm from './questions/SimpleQuizForm';
import GuessingGameForm from './questions/GuessingGameForm';
import FinalQuizForm from './questions/FinalQuizForm';
import FourStatementsForm from './questions/FourStatementsForm';
import FactOrFakeForm from './questions/FactOrFakeForm';
import QuizjagdForm from './questions/QuizjagdForm';
import AudioGuessForm from './questions/AudioGuessForm';
import VideoGuessForm from './questions/VideoGuessForm';
import BandleForm from './questions/BandleForm';
import ImageGuessForm from './questions/ImageGuessForm';
import RulesEditor from './RulesEditor';

interface Props {
  gameType: GameType;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  instance: Record<string, any>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onChange: (instance: Record<string, any>) => void;
  onGoToAssets: () => void;
  otherInstances?: string[];
  onMoveQuestion?: (questionIndex: number, targetInstance: string) => void;
  isArchive?: boolean;
  initialQuestion?: number;
}

export default function InstanceEditor({ gameType, instance, onChange, onGoToAssets, otherInstances, onMoveQuestion, isArchive, initialQuestion }: Props) {
  const [showMeta, setShowMeta] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Scroll to a specific question when navigating from asset usages
  useEffect(() => {
    if (initialQuestion == null) return;
    let cancelled = false;
    let attempts = 0;
    const tryScroll = () => {
      if (cancelled) return;
      attempts++;
      const el = containerRef.current?.querySelector(`[data-question-index="${initialQuestion}"]`) as HTMLElement | null;
      if (!el) {
        if (attempts < 20) requestAnimationFrame(tryScroll);
        return;
      }
      const scroller = el.closest('.admin-tab-pane');
      if (scroller) {
        const elRect = el.getBoundingClientRect();
        const scrollerRect = scroller.getBoundingClientRect();
        const offset = elRect.top - scrollerRect.top + scroller.scrollTop - scroller.clientHeight / 2 + elRect.height / 2;
        scroller.scrollTo({ top: Math.max(0, offset), behavior: 'smooth' });
      } else {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
      el.classList.add('question-block--highlight');
      setTimeout(() => el.classList.remove('question-block--highlight'), 4500);
    };
    requestAnimationFrame(tryScroll);
    return () => { cancelled = true; };
  }, [initialQuestion]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const set = (key: string, value: any) => onChange({ ...instance, [key]: value });

  const quizjagdQuestions: QuizjagdFlatQuestion[] = Array.isArray(instance.questions)
    ? instance.questions
    : [];

  // _players is stored as string[] in JSON but edited as comma-separated string
  const playersDisplay = Array.isArray(instance._players)
    ? instance._players.join(', ')
    : (instance._players ?? '');

  const hasMetaValues = instance._players || instance.title || (instance.rules && instance.rules.length > 0);

  return (
    <div ref={containerRef}>
      {/* Collapsible meta section (not for archive) */}
      {!isArchive && (
        <>
          <button
            className="be-icon-btn"
            style={{ fontSize: 11, marginBottom: 12 }}
            onClick={() => setShowMeta(s => !s)}
          >
            {showMeta ? '▲' : '▶'} Spieler & Einstellungen{hasMetaValues ? ' ●' : ''}
          </button>

          {showMeta && (
            <div style={{ marginBottom: 16, paddingBottom: 14, borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
              <label className="be-label" style={{ marginTop: 0 }}>Spieler (kommagetrennt, optional)</label>
              <input
                className="be-input"
                value={playersDisplay}
                placeholder="Alice, Bob, Clara, ..."
                onChange={e => set('_players', e.target.value ? [e.target.value] : undefined)}
              />

              <label className="be-label">Titel-Überschreibung (optional)</label>
              <input
                className="be-input"
                value={instance.title ?? ''}
                placeholder="Leer lassen für Standard-Titel"
                onChange={e => set('title', e.target.value || undefined)}
              />

              <label className="be-label">Regeln (Überschreibung, optional)</label>
              <RulesEditor
                rules={instance.rules ?? []}
                onChange={rules => set('rules', rules.length > 0 ? rules : undefined)}
                placeholder="Instanz-spezifische Regel..."
              />
            </div>
          )}
        </>
      )}

      {/* Questions by game type */}
      {!isArchive && <label className="be-label" style={{ marginTop: 0, marginBottom: 8 }}>Fragen</label>}

      {gameType === 'simple-quiz' && (
        <SimpleQuizForm
          questions={(instance.questions ?? []) as SimpleQuizQuestion[]}
          onChange={q => set('questions', q)}
          otherInstances={otherInstances}
          onMoveQuestion={onMoveQuestion}
        />
      )}
      {gameType === 'guessing-game' && (
        <GuessingGameForm
          questions={(instance.questions ?? []) as GuessingGameQuestion[]}
          onChange={q => set('questions', q)}
          otherInstances={otherInstances}
          onMoveQuestion={onMoveQuestion}
        />
      )}
      {gameType === 'final-quiz' && (
        <FinalQuizForm
          questions={(instance.questions ?? []) as FinalQuizQuestion[]}
          onChange={q => set('questions', q)}
          otherInstances={otherInstances}
          onMoveQuestion={onMoveQuestion}
        />
      )}
      {gameType === 'four-statements' && (
        <FourStatementsForm
          questions={(instance.questions ?? []) as FourStatementsQuestion[]}
          onChange={q => set('questions', q)}
          otherInstances={otherInstances}
          onMoveQuestion={onMoveQuestion}
        />
      )}
      {gameType === 'fact-or-fake' && (
        <FactOrFakeForm
          questions={(instance.questions ?? []) as FactOrFakeQuestion[]}
          onChange={q => set('questions', q)}
          otherInstances={otherInstances}
          onMoveQuestion={onMoveQuestion}
        />
      )}
      {gameType === 'quizjagd' && (
        <QuizjagdForm
          questions={quizjagdQuestions}
          questionsPerTeam={instance.questionsPerTeam ?? 10}
          onChange={q => set('questions', q)}
          onChangeQuestionsPerTeam={n => set('questionsPerTeam', n)}
          otherInstances={otherInstances}
          onMoveQuestion={onMoveQuestion}
        />
      )}
      {gameType === 'audio-guess' && (
        <AudioGuessForm
          questions={(instance.questions ?? []) as AudioGuessQuestion[]}
          onChange={q => set('questions', q)}
          otherInstances={otherInstances}
          onMoveQuestion={onMoveQuestion}
        />
      )}
      {gameType === 'video-guess' && (
        <VideoGuessForm
          questions={(instance.questions ?? []) as VideoGuessQuestion[]}
          onChange={q => set('questions', q)}
          otherInstances={otherInstances}
          onMoveQuestion={onMoveQuestion}
        />
      )}
      {gameType === 'bandle' && (
        <BandleForm
          questions={(instance.questions ?? []) as BandleQuestion[]}
          onChange={q => set('questions', q)}
          otherInstances={otherInstances}
          onMoveQuestion={onMoveQuestion}
        />
      )}
      {gameType === 'image-guess' && (
        <ImageGuessForm
          questions={(instance.questions ?? []) as ImageGuessQuestion[]}
          onChange={q => set('questions', q)}
          otherInstances={otherInstances}
          onMoveQuestion={onMoveQuestion}
        />
      )}
    </div>
  );
}
