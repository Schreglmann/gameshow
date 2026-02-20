import type { GameComponentProps } from './types';
import SimpleQuiz from './SimpleQuiz';
import GuessingGame from './GuessingGame';
import FinalQuiz from './FinalQuiz';
import AudioGuess from './AudioGuess';
import ImageGame from './ImageGame';
import FourStatements from './FourStatements';
import FactOrFake from './FactOrFake';
import Quizjagd from './Quizjagd';

export default function GameFactory(props: GameComponentProps) {
  switch (props.config.type) {
    case 'simple-quiz':
      return <SimpleQuiz {...props} />;
    case 'guessing-game':
      return <GuessingGame {...props} />;
    case 'final-quiz':
      return <FinalQuiz {...props} />;
    case 'audio-guess':
      return <AudioGuess {...props} />;
    case 'image-game':
      return <ImageGame {...props} />;
    case 'four-statements':
      return <FourStatements {...props} />;
    case 'fact-or-fake':
      return <FactOrFake {...props} />;
    case 'quizjagd':
      return <Quizjagd {...props} />;
    default:
      return (
        <div className="quiz-container">
          <h2>Unknown game type: {(props.config as { type: string }).type}</h2>
        </div>
      );
  }
}
