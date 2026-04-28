import { useState, useEffect, useCallback, useMemo } from 'react';
import type { GameComponentProps } from './types';
import type { FinalQuizConfig, FinalQuizQuestion } from '@/types/config';
import type { GamemasterAnswerData, GamemasterControl, GamemasterCommand } from '@/types/game';
import BaseGameWrapper from './BaseGameWrapper';

export default function FinalQuiz(props: GameComponentProps) {
  const config = props.config as FinalQuizConfig;
  const questions = useMemo(
    () => [config.questions[0], ...config.questions.slice(1).filter(q => !q.disabled)],
    [config.questions]
  );

  return (
    <BaseGameWrapper
      title={config.title}
      rules={config.rules || ['Beide Teams setzen Punkte und beantworten die Frage.']}
      totalQuestions={questions.length - 1}
      pointSystemEnabled={props.pointSystemEnabled}
      pointValue={props.currentIndex + 1}
      currentIndex={props.currentIndex}
      requiresPoints
      skipPointsScreen
      hideCorrectTracker
      onAwardPoints={props.onAwardPoints}
      onNextGame={props.onNextGame}
    >
      {({ onGameComplete, setNavHandler, setGamemasterData, setGamemasterControls, setCommandHandler }) => (
        <FinalQuizInner
          questions={questions}
          gameTitle={config.title}
          onGameComplete={onGameComplete}
          setNavHandler={setNavHandler}
          onAwardPoints={props.onAwardPoints}
          setGamemasterData={setGamemasterData}
          setGamemasterControls={setGamemasterControls}
          setCommandHandler={setCommandHandler}
        />
      )}
    </BaseGameWrapper>
  );
}

interface InnerProps {
  questions: FinalQuizQuestion[];
  gameTitle: string;
  onGameComplete: () => void;
  setNavHandler: (fn: (() => void) | null) => void;
  onAwardPoints: (team: 'team1' | 'team2', points: number) => void;
  setGamemasterData: (data: GamemasterAnswerData | null) => void;
  setGamemasterControls: (controls: GamemasterControl[]) => void;
  setCommandHandler: (fn: ((cmd: GamemasterCommand) => void) | null) => void;
}

function FinalQuizInner({ questions, gameTitle, onGameComplete, setNavHandler, onAwardPoints, setGamemasterData, setGamemasterControls, setCommandHandler }: InnerProps) {
  const [qIdx, setQIdx] = useState(0);
  const [phase, setPhase] = useState<'question' | 'betting' | 'answer' | 'judging'>('question');
  const [team1Bet, setTeam1Bet] = useState('');
  const [team2Bet, setTeam2Bet] = useState('');
  const [team1Result, setTeam1Result] = useState<'correct' | 'incorrect' | null>(null);
  const [team2Result, setTeam2Result] = useState<'correct' | 'incorrect' | null>(null);

  const q = questions[qIdx];
  const isExample = qIdx === 0;
  const questionLabel = isExample ? 'Beispiel' : `Frage ${qIdx} von ${questions.length - 1}`;

  useEffect(() => {
    if (!q) return;
    setGamemasterData({
      gameTitle,
      questionNumber: qIdx,
      totalQuestions: questions.length - 1,
      answer: q.answer,
      answerImage: q.answerImage,
    });
  }, [qIdx, gameTitle, questions, setGamemasterData]);

  const handleNext = useCallback(() => {
    if (phase === 'question') {
      setPhase('betting');
    } else if (phase === 'judging') {
      if (qIdx < questions.length - 1) {
        setQIdx(prev => prev + 1);
        setPhase('question');
        setTeam1Bet('');
        setTeam2Bet('');
        setTeam1Result(null);
        setTeam2Result(null);
      } else {
        onGameComplete();
      }
    }
  }, [phase, qIdx, questions.length, onGameComplete]);

  useEffect(() => {
    setNavHandler(handleNext);
  }, [handleNext, setNavHandler]);

  const showAnswerFn = useCallback(() => {
    setPhase('answer');
    setTimeout(() => setPhase('judging'), 100);
  }, []);

  const judgeTeam = useCallback((team: 'team1' | 'team2', correct: boolean) => {
    const bet = parseInt(team === 'team1' ? team1Bet : team2Bet, 10) || 0;
    const prevResult = team === 'team1' ? team1Result : team2Result;

    if (!isExample) {
      // Reverse previous judgment if changing answer
      if (prevResult !== null) {
        const prevPoints = prevResult === 'correct' ? -bet : bet;
        onAwardPoints(team, prevPoints);
      }
      // Apply new judgment
      onAwardPoints(team, correct ? bet : -bet);
    }

    if (team === 'team1') setTeam1Result(correct ? 'correct' : 'incorrect');
    else setTeam2Result(correct ? 'correct' : 'incorrect');
  }, [team1Bet, team2Bet, team1Result, team2Result, isExample, onAwardPoints]);

  // Broadcast gamemaster controls
  useEffect(() => {
    const controls: GamemasterControl[] = [];
    if (phase === 'betting') {
      controls.push({
        type: 'input-group',
        id: 'betting-submit',
        inputs: [
          { id: 'team1Bet', label: 'Team 1', inputType: 'number', placeholder: 'Punkte Team 1', value: team1Bet, emitOnChange: true },
          { id: 'team2Bet', label: 'Team 2', inputType: 'number', placeholder: 'Punkte Team 2', value: team2Bet, emitOnChange: true },
        ],
        submitLabel: 'Antwort anzeigen',
      });
    }
    if (phase === 'judging') {
      controls.push({
        type: 'button-group',
        id: 'team1-judgment',
        label: 'Team 1',
        buttons: [
          { id: 'team1-correct', label: 'Richtig', variant: 'success', active: team1Result === 'correct' },
          { id: 'team1-incorrect', label: 'Falsch', variant: 'danger', active: team1Result === 'incorrect' },
        ],
      });
      controls.push({
        type: 'button-group',
        id: 'team2-judgment',
        label: 'Team 2',
        buttons: [
          { id: 'team2-correct', label: 'Richtig', variant: 'success', active: team2Result === 'correct' },
          { id: 'team2-incorrect', label: 'Falsch', variant: 'danger', active: team2Result === 'incorrect' },
        ],
      });
      controls.push({
        type: 'button',
        id: 'next-question',
        label: qIdx < questions.length - 1 ? 'Nächste Frage' : 'Weiter',
        variant: 'primary',
        disabled: team1Result === null || team2Result === null,
      });
    }
    setGamemasterControls(controls);
  }, [phase, team1Bet, team2Bet, team1Result, team2Result, qIdx, questions.length, setGamemasterControls]);

  // Handle gamemaster commands
  const commandHandlerFn = useCallback((cmd: GamemasterCommand) => {
    if (cmd.controlId === 'betting-submit:change' && cmd.value && typeof cmd.value === 'object') {
      // Live mirror: every keystroke in the GM input is reflected in the
      // frontend's input fields so spectators can see the bets being typed.
      const vals = cmd.value as Record<string, string>;
      setTeam1Bet(vals.team1Bet ?? '');
      setTeam2Bet(vals.team2Bet ?? '');
    } else if (cmd.controlId === 'betting-submit' && cmd.value && typeof cmd.value === 'object') {
      const vals = cmd.value as Record<string, string>;
      setTeam1Bet(vals.team1Bet ?? '');
      setTeam2Bet(vals.team2Bet ?? '');
      // Use setTimeout to let state update before showing answer
      setTimeout(() => showAnswerFn(), 0);
    } else if (cmd.controlId === 'team1-correct') judgeTeam('team1', true);
    else if (cmd.controlId === 'team1-incorrect') judgeTeam('team1', false);
    else if (cmd.controlId === 'team2-correct') judgeTeam('team2', true);
    else if (cmd.controlId === 'team2-incorrect') judgeTeam('team2', false);
    else if (cmd.controlId === 'next-question') handleNext();
  }, [showAnswerFn, judgeTeam, handleNext]);

  useEffect(() => {
    setCommandHandler(commandHandlerFn);
  }, [commandHandlerFn, setCommandHandler]);

  if (!q) return null;

  return (
    <>
      <h2 className="quiz-question-number">{questionLabel}</h2>
      <div className="quiz-question">{q.question}</div>

      {phase === 'betting' && (
        <div id="bettingForm">
          <input
            type="number"
            placeholder="Gesetzte Punkte Team 1"
            className="guess-input betting-input"
            value={team1Bet}
            onChange={e => setTeam1Bet(e.target.value)}
          />
          <input
            type="number"
            placeholder="Gesetzte Punkte Team 2"
            className="guess-input betting-input"
            value={team2Bet}
            onChange={e => setTeam2Bet(e.target.value)}
          />
          <button className="quiz-button button-centered" onClick={showAnswerFn}>
            Antwort anzeigen
          </button>
        </div>
      )}

      {(phase === 'answer' || phase === 'judging') && (
        <>
          <div className="quiz-answer">
            <p>{q.answer}</p>
          </div>
          {q.answerImage && (
            <img src={q.answerImage} alt="" className="quiz-image" />
          )}
        </>
      )}

      {phase === 'judging' && (
        <div id="correctButtons">
          <div className="judgment-group">
            <h3>Team 1:</h3>
            <button
              className={`quiz-button${team1Result === 'correct' ? ' active' : ''}`}
              onClick={() => judgeTeam('team1', true)}
            >
              Richtig
            </button>
            <button
              className={`quiz-button${team1Result === 'incorrect' ? ' active' : ''}`}
              onClick={() => judgeTeam('team1', false)}
            >
              Falsch
            </button>
          </div>
          <div className="judgment-group">
            <h3>Team 2:</h3>
            <button
              className={`quiz-button${team2Result === 'correct' ? ' active' : ''}`}
              onClick={() => judgeTeam('team2', true)}
            >
              Richtig
            </button>
            <button
              className={`quiz-button${team2Result === 'incorrect' ? ' active' : ''}`}
              onClick={() => judgeTeam('team2', false)}
            >
              Falsch
            </button>
          </div>
          <button
            className="quiz-button button-centered"
            style={{ marginTop: '20px' }}
            onClick={handleNext}
            disabled={team1Result === null || team2Result === null}
          >
            {qIdx < questions.length - 1 ? 'Nächste Frage' : 'Weiter'}
          </button>
        </div>
      )}

    </>
  );
}
