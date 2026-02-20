import { useState, useEffect, useCallback } from 'react';
import type { GameComponentProps } from './types';
import type { FinalQuizConfig, FinalQuizQuestion } from '@/types/config';
import BaseGameWrapper from './BaseGameWrapper';

export default function FinalQuiz(props: GameComponentProps) {
  const config = props.config as FinalQuizConfig;

  return (
    <BaseGameWrapper
      title={config.title}
      rules={config.rules || ['Beide Teams setzen Punkte und beantworten die Frage.']}
      totalQuestions={config.questions.length}
      pointSystemEnabled={props.pointSystemEnabled}
      requiresPoints
      onAwardPoints={props.onAwardPoints}
      onNextGame={props.onNextGame}
    >
      {({ onGameComplete, setNavHandler }) => (
        <FinalQuizInner
          questions={config.questions}
          onGameComplete={onGameComplete}
          setNavHandler={setNavHandler}
          onAwardPoints={props.onAwardPoints}
        />
      )}
    </BaseGameWrapper>
  );
}

interface InnerProps {
  questions: FinalQuizQuestion[];
  onGameComplete: () => void;
  setNavHandler: (fn: (() => void) | null) => void;
  onAwardPoints: (team: 'team1' | 'team2', points: number) => void;
}

function FinalQuizInner({ questions, onGameComplete, setNavHandler, onAwardPoints }: InnerProps) {
  const [qIdx, setQIdx] = useState(0);
  const [phase, setPhase] = useState<'question' | 'betting' | 'answer' | 'judging'>('question');
  const [team1Bet, setTeam1Bet] = useState('');
  const [team2Bet, setTeam2Bet] = useState('');
  const [team1Result, setTeam1Result] = useState<'correct' | 'incorrect' | null>(null);
  const [team2Result, setTeam2Result] = useState<'correct' | 'incorrect' | null>(null);

  const q = questions[qIdx];

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

  const showAnswer = () => {
    setPhase('answer');
    setTimeout(() => setPhase('judging'), 100);
  };

  const judgeTeam = (team: 'team1' | 'team2', correct: boolean) => {
    const bet = parseInt(team === 'team1' ? team1Bet : team2Bet, 10) || 0;
    const prevResult = team === 'team1' ? team1Result : team2Result;

    // Reverse previous judgment if changing answer
    if (prevResult !== null) {
      const prevPoints = prevResult === 'correct' ? -bet : bet;
      onAwardPoints(team, prevPoints);
    }

    // Apply new judgment
    onAwardPoints(team, correct ? bet : -bet);

    if (team === 'team1') setTeam1Result(correct ? 'correct' : 'incorrect');
    else setTeam2Result(correct ? 'correct' : 'incorrect');
  };

  if (!q) return null;

  return (
    <>
      <h2 className="quiz-question-number">Frage {qIdx + 1} von {questions.length}</h2>
      <div className="quiz-question">{q.question}</div>

      {phase === 'betting' && (
        <div id="bettingForm">
          <input
            type="number"
            placeholder="Gesetzte Punkte Team 1"
            className="guess-input"
            style={{ margin: '10px auto', width: 300, display: 'block' }}
            value={team1Bet}
            onChange={e => setTeam1Bet(e.target.value)}
          />
          <input
            type="number"
            placeholder="Gesetzte Punkte Team 2"
            className="guess-input"
            style={{ margin: '10px auto', width: 300, display: 'block' }}
            value={team2Bet}
            onChange={e => setTeam2Bet(e.target.value)}
          />
          <button className="quiz-button button-centered" onClick={showAnswer}>
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
            <img src={q.answerImage} alt="" className="quiz-image" style={{ marginTop: 20 }} />
          )}
        </>
      )}

      {phase === 'judging' && (
        <div id="correctButtons" style={{ marginTop: 20 }}>
          <div style={{ margin: '20px 0' }}>
            <h3>Team 1:</h3>
            <button
              className={`quiz-button${team1Result === 'correct' ? ' active' : ''}`}
              style={{ margin: 10 }}
              onClick={() => judgeTeam('team1', true)}
            >
              Richtig
            </button>
            <button
              className={`quiz-button${team1Result === 'incorrect' ? ' active' : ''}`}
              style={{ margin: 10 }}
              onClick={() => judgeTeam('team1', false)}
            >
              Falsch
            </button>
          </div>
          <div style={{ margin: '20px 0' }}>
            <h3>Team 2:</h3>
            <button
              className={`quiz-button${team2Result === 'correct' ? ' active' : ''}`}
              style={{ margin: 10 }}
              onClick={() => judgeTeam('team2', true)}
            >
              Richtig
            </button>
            <button
              className={`quiz-button${team2Result === 'incorrect' ? ' active' : ''}`}
              style={{ margin: 10 }}
              onClick={() => judgeTeam('team2', false)}
            >
              Falsch
            </button>
          </div>
        </div>
      )}
    </>
  );
}
