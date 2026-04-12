import type { GameComponentProps } from './types';
import SimpleQuiz from './SimpleQuiz';
import GuessingGame from './GuessingGame';
import FinalQuiz from './FinalQuiz';
import AudioGuess from './AudioGuess';
import VideoGuess from './VideoGuess';
import FourStatements from './FourStatements';
import FactOrFake from './FactOrFake';
import Quizjagd from './Quizjagd';
import Bandle from './Bandle';
import ImageGuess from './ImageGuess';

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
