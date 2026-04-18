import { lazy, Suspense } from 'react';
import type { GameComponentProps } from './types';

const SimpleQuiz = lazy(() => import('./SimpleQuiz'));
const BetQuiz = lazy(() => import('./BetQuiz'));
const GuessingGame = lazy(() => import('./GuessingGame'));
const FinalQuiz = lazy(() => import('./FinalQuiz'));
const AudioGuess = lazy(() => import('./AudioGuess'));
const VideoGuess = lazy(() => import('./VideoGuess'));
const FourStatements = lazy(() => import('./FourStatements'));
const FactOrFake = lazy(() => import('./FactOrFake'));
const Quizjagd = lazy(() => import('./Quizjagd'));
const Bandle = lazy(() => import('./Bandle'));
const ImageGuess = lazy(() => import('./ImageGuess'));

function renderGame(props: GameComponentProps) {
  switch (props.config.type) {
    case 'simple-quiz':
      return <SimpleQuiz {...props} />;
    case 'bet-quiz':
      return <BetQuiz {...props} />;
    case 'guessing-game':
      return <GuessingGame {...props} />;
    case 'final-quiz':
      return <FinalQuiz {...props} />;
    case 'audio-guess':
      return <AudioGuess {...props} />;
    case 'video-guess':
      return <VideoGuess {...props} />;
    case 'four-statements':
      return <FourStatements {...props} />;
    case 'fact-or-fake':
      return <FactOrFake {...props} />;
    case 'quizjagd':
      return <Quizjagd {...props} />;
    case 'bandle':
      return <Bandle {...props} />;
    case 'image-guess':
      return <ImageGuess {...props} />;
    default:
      return (
        <div className="quiz-container">
          <h2>Unknown game type: {(props.config as { type: string }).type}</h2>
        </div>
      );
  }
}

export default function GameFactory(props: GameComponentProps) {
  return <Suspense fallback={null}>{renderGame(props)}</Suspense>;
}
