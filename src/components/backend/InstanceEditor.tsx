import { useState, useEffect, useRef, Fragment } from 'react';
import type { GameType, SimpleQuizQuestion, GuessingGameQuestion, FinalQuizQuestion, Q1Question, FourStatementsQuestion, FactOrFakeQuestion, QuizjagdFlatQuestion, AudioGuessQuestion, VideoGuessQuestion, BandleQuestion, ImageGuessQuestion, ColorGuessQuestion, RankingQuestion, WerKenntMehrQuestion, RandomFrameQuestion } from '@/types/config';
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
import WerKenntMehrForm from './questions/WerKenntMehrForm';
import RandomFrameForm from './questions/RandomFrameForm';
import RulesEditor from './RulesEditor';
import type { InstanceUsage } from '@/utils/playerStats';

interface Props {
  gameType: GameType;

  instance: Record<string, any>;

  onChange: (instance: Record<string, any>) => void;
  onGoToAssets: () => void;
  otherInstances?: string[];
  onMoveQuestion?: (questionIndex: number, targetInstance: string) => void;
  isArchive?: boolean;
  initialQuestion?: number;
  /** Gameshows that played (or have queued) this instance — derived, read-only. */
  instanceUsage?: InstanceUsage[];
  /** Open a player's profile (stats modal). When set, player names are clickable. */
  onPlayerClick?: (player: string) => void;
}

export default function InstanceEditor({ gameType, instance, onChange, otherInstances, onMoveQuestion, isArchive, initialQuestion, instanceUsage = [], onPlayerClick }: Props) {
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
   
  const set = (key: string, value: any) => onChange({ ...instance, [key]: value });

  const quizjagdQuestions: QuizjagdFlatQuestion[] = Array.isArray(instance.questions)
    ? instance.questions
    : [];

  const hasMetaValues = instance.title || (instance.rules && instance.rules.length > 0);

  // Which players already played this instance vs. have it queued — derived from
  // gameshow membership (read-only). See specs/game-planning.md.
  const playedUsage = instanceUsage.filter(u => !u.planned);
  const plannedUsage = instanceUsage.filter(u => u.planned);

  const renderPlayers = (players: string[]) => {
    if (players.length === 0) return '—';
    return players.map((p, i) => (
      <Fragment key={p}>
        {onPlayerClick
          ? <button type="button" className="instance-usage-player" onClick={() => onPlayerClick(p)} title={`Profil von ${p}`}>{p}</button>
          : <span>{p}</span>}
        {i < players.length - 1 ? ', ' : ''}
      </Fragment>
    ));
  };

  const renderUsageRow = (u: InstanceUsage) => (
    <span key={u.gameshowId} className={`instance-usage-show${u.planned ? ' planned' : ''}`}>
      {u.gameshowName}: {renderPlayers(u.players)}
    </span>
  );

  return (
    <div ref={containerRef}>
      {instanceUsage.length > 0 && (
        <div className="instance-usage">
          {playedUsage.length > 0 && (
            <div className="instance-usage-row">
              <span className="instance-usage-label">Bereits gespielt</span>
              {playedUsage.map(renderUsageRow)}
            </div>
          )}
          {plannedUsage.length > 0 && (
            <div className="instance-usage-row">
              <span className="instance-usage-label planned">Eingeplant</span>
              {plannedUsage.map(renderUsageRow)}
            </div>
          )}
        </div>
      )}

      {/* Collapsible meta section (not for archive) */}
      {!isArchive && (
        <>
          <button
            className="be-icon-btn"
            style={{ fontSize: 'var(--admin-sz-11, 11px)', marginBottom: 12 }}
            onClick={() => setShowMeta(s => !s)}
          >
            {showMeta ? '▲' : '▶'} Einstellungen{hasMetaValues ? ' ●' : ''}
          </button>

          {showMeta && (
            <div style={{ marginBottom: 16, paddingBottom: 14, borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
              <label className="be-label" style={{ marginTop: 0 }}>Titel-Überschreibung (optional)</label>
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
      {gameType === 'wer-kennt-mehr' && (
        <WerKenntMehrForm
          questions={(instance.questions ?? []) as WerKenntMehrQuestion[]}
          onChange={q => set('questions', q)}
          otherInstances={otherInstances}
          onMoveQuestion={onMoveQuestion}
        />
      )}
      {gameType === 'random-frame' && (
        <RandomFrameForm
          questions={(instance.questions ?? []) as RandomFrameQuestion[]}
          onChange={q => set('questions', q)}
          otherInstances={otherInstances}
          onMoveQuestion={onMoveQuestion}
        />
      )}
    </div>
  );
}
