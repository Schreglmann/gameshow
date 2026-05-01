import { useState, useEffect, useRef } from 'react';
import type { GameType, SimpleQuizQuestion, GuessingGameQuestion, FinalQuizQuestion, Q1Question, FourStatementsQuestion, FactOrFakeQuestion, QuizjagdFlatQuestion, AudioGuessQuestion, VideoGuessQuestion, BandleQuestion, ImageGuessQuestion, ColorGuessQuestion, RankingQuestion } from '@/types/config';
import SimpleQuizForm from './questions/SimpleQuizForm';
import GuessingGameForm from './questions/GuessingGameForm';
import FinalQuizForm from './questions/FinalQuizForm';
import Q1Form from './questions/Q1Form';
import FourStatementsForm from './questions/FourStatementsForm';
import FactOrFakeForm from './questions/FactOrFakeForm';
import QuizjagdForm from './questions/QuizjagdForm';
import AudioGuessForm from './questions/AudioGuessForm';
import VideoGuessForm from './questions/VideoGuessForm';
import BandleForm from './questions/BandleForm';
import ImageGuessForm from './questions/ImageGuessForm';
import ColorGuessForm from './questions/ColorGuessForm';
import RankingForm from './questions/RankingForm';
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

  // _players is `string[]` — one entry per play session, each entry a
  // comma-separated list of player names. The editor uses one line per session
  // so multi-session history is preserved on save.
  const playersDisplay = Array.isArray(instance._players)
    ? instance._players.join('\n')
    : (typeof instance._players === 'string' ? instance._players : '');

  const hasMetaValues = instance._players || instance.title || (instance.rules && instance.rules.length > 0);

  return (
    <div ref={containerRef}>
      {/* Collapsible meta section (not for archive) */}
      {!isArchive && (
        <>
          <button
            className="be-icon-btn"
            style={{ fontSize: 'var(--admin-sz-11, 11px)', marginBottom: 12 }}
            onClick={() => setShowMeta(s => !s)}
          >
            {showMeta ? '▲' : '▶'} Spieler & Einstellungen{hasMetaValues ? ' ●' : ''}
          </button>

          {showMeta && (
            <div style={{ marginBottom: 16, paddingBottom: 14, borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
              <label className="be-label" style={{ marginTop: 0 }}>Spieler (eine Session pro Zeile, kommagetrennt, optional)</label>
              <textarea
                className="be-input"
                rows={Math.max(2, playersDisplay.split('\n').length + 1)}
                value={playersDisplay}
                placeholder={'Alice, Bob, Clara\nDave, Eve, Frank'}
                onChange={e => {
                  const sessions = e.target.value
                    .split('\n')
                    .map(s => s.trim())
                    .filter(Boolean);
                  set('_players', sessions.length > 0 ? sessions : undefined);
                }}
                style={{ resize: 'vertical', minHeight: 56, fontFamily: 'inherit' }}
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
      {gameType === 'bet-quiz' && (
        <SimpleQuizForm
          questions={(instance.questions ?? []) as SimpleQuizQuestion[]}
          onChange={q => set('questions', q)}
          otherInstances={otherInstances}
          onMoveQuestion={onMoveQuestion}
          showCategory
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
      {gameType === 'q1' && (
        <Q1Form
          questions={(instance.questions ?? []) as Q1Question[]}
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
          isArchive={isArchive}
          instanceLanguage={typeof instance.language === 'string' ? instance.language : undefined}
          onInstanceLanguageChange={lang => set('language', lang)}
          locked={instance.locked === true}
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
      {gameType === 'colorguess' && (
        <ColorGuessForm
          questions={(instance.questions ?? []) as ColorGuessQuestion[]}
          onChange={q => set('questions', q)}
          otherInstances={otherInstances}
          onMoveQuestion={onMoveQuestion}
        />
      )}
      {gameType === 'ranking' && (
        <RankingForm
          questions={(instance.questions ?? []) as RankingQuestion[]}
          onChange={q => set('questions', q)}
          otherInstances={otherInstances}
          onMoveQuestion={onMoveQuestion}
        />
      )}
    </div>
  );
}
