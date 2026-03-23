import { useState } from 'react';
import type { GameType, SimpleQuizQuestion, GuessingGameQuestion, FinalQuizQuestion, FourStatementsQuestion, FactOrFakeQuestion, QuizjagdFlatQuestion } from '@/types/config';
import SimpleQuizForm from './questions/SimpleQuizForm';
import GuessingGameForm from './questions/GuessingGameForm';
import FinalQuizForm from './questions/FinalQuizForm';
import FourStatementsForm from './questions/FourStatementsForm';
import FactOrFakeForm from './questions/FactOrFakeForm';
import QuizjagdForm from './questions/QuizjagdForm';
import AudioGuessInfo from './questions/AudioGuessInfo';
import RulesEditor from './RulesEditor';

interface Props {
  gameType: GameType;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  instance: Record<string, any>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onChange: (instance: Record<string, any>) => void;
  onGoToAssets: () => void;
}

export default function InstanceEditor({ gameType, instance, onChange, onGoToAssets }: Props) {
  const [showMeta, setShowMeta] = useState(false);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const set = (key: string, value: any) => onChange({ ...instance, [key]: value });

  const quizjagdQuestions: QuizjagdFlatQuestion[] = Array.isArray(instance.questions)
    ? instance.questions
    : [];

  const hasMetaValues = instance._players || instance.title || (instance.rules && instance.rules.length > 0);

  return (
    <div>
      {/* Collapsible meta section */}
      <button
        className="be-icon-btn"
        style={{ fontSize: 11, marginBottom: 12 }}
        onClick={() => setShowMeta(s => !s)}
      >
        {showMeta ? '▲' : '▶'} Spieler & Einstellungen
      </button>

      {showMeta && (
        <div style={{ marginBottom: 16, paddingBottom: 14, borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
          <label className="be-label" style={{ marginTop: 0 }}>Spieler (kommagetrennt, optional)</label>
          <input
            className="be-input"
            value={instance._players ?? ''}
            placeholder="Alice, Bob, Clara, ..."
            onChange={e => set('_players', e.target.value || undefined)}
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

      {/* Questions by game type */}
      <label className="be-label" style={{ marginTop: 0, marginBottom: 8 }}>Fragen</label>

      {gameType === 'simple-quiz' && (
        <SimpleQuizForm
          questions={(instance.questions ?? []) as SimpleQuizQuestion[]}
          onChange={q => set('questions', q)}
        />
      )}
      {gameType === 'guessing-game' && (
        <GuessingGameForm
          questions={(instance.questions ?? []) as GuessingGameQuestion[]}
          onChange={q => set('questions', q)}
        />
      )}
      {gameType === 'final-quiz' && (
        <FinalQuizForm
          questions={(instance.questions ?? []) as FinalQuizQuestion[]}
          onChange={q => set('questions', q)}
        />
      )}
      {gameType === 'four-statements' && (
        <FourStatementsForm
          questions={(instance.questions ?? []) as FourStatementsQuestion[]}
          onChange={q => set('questions', q)}
        />
      )}
      {gameType === 'fact-or-fake' && (
        <FactOrFakeForm
          questions={(instance.questions ?? []) as FactOrFakeQuestion[]}
          onChange={q => set('questions', q)}
        />
      )}
      {gameType === 'quizjagd' && (
        <QuizjagdForm
          questions={quizjagdQuestions}
          questionsPerTeam={instance.questionsPerTeam ?? 10}
          onChange={q => set('questions', q)}
          onChangeQuestionsPerTeam={n => set('questionsPerTeam', n)}
        />
      )}
      {gameType === 'audio-guess' && <AudioGuessInfo onGoToAssets={onGoToAssets} />}
    </div>
  );
}
