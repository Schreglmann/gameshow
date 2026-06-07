import { Suspense } from 'react';
import { lazyWithRetry } from '@/utils/lazyWithRetry';
import type { GameComponentProps } from './types';

const SimpleQuiz = lazyWithRetry(() => import('./SimpleQuiz'));
const BetQuiz = lazyWithRetry(() => import('./BetQuiz'));
const GuessingGame = lazyWithRetry(() => import('./GuessingGame'));
const FinalQuiz = lazyWithRetry(() => import('./FinalQuiz'));
const AudioGuess = lazyWithRetry(() => import('./AudioGuess'));
const VideoGuess = lazyWithRetry(() => import('./VideoGuess'));
const Q1 = lazyWithRetry(() => import('./Q1'));
const FourStatements = lazyWithRetry(() => import('./FourStatements'));
const FactOrFake = lazyWithRetry(() => import('./FactOrFake'));
const Quizjagd = lazyWithRetry(() => import('./Quizjagd'));
const Bandle = lazyWithRetry(() => import('./Bandle'));
const ImageGuess = lazyWithRetry(() => import('./ImageGuess'));
const ColorGuess = lazyWithRetry(() => import('./ColorGuess'));
const Ranking = lazyWithRetry(() => import('./Ranking'));
const WerKenntMehr = lazyWithRetry(() => import('./WerKenntMehr'));
const RandomFrame = lazyWithRetry(() => import('./RandomFrame'));

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
    case 'q1':
      return <Q1 {...props} />;
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
    case 'colorguess':
      return <ColorGuess {...props} />;
    case 'ranking':
      return <Ranking {...props} />;
    case 'wer-kennt-mehr':
      return <WerKenntMehr {...props} />;
    case 'random-frame':
      return <RandomFrame {...props} />;
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
