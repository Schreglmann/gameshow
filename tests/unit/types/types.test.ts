import { describe, it, expect } from 'vitest';
import type {
  GameType,
  AppConfig,
  SimpleQuizConfig,
  GuessingGameConfig,
  FinalQuizConfig,
  AudioGuessConfig,
  ImageGameConfig,
  FourStatementsConfig,
  FactOrFakeConfig,
  QuizjagdConfig,
  GameConfig,
  SimpleQuizQuestion,
  GuessingGameQuestion,
  FinalQuizQuestion,
  AudioGuessQuestion,
  ImageGameQuestion,
  FourStatementsQuestion,
  FactOrFakeQuestion,
  QuizjagdQuestion,
  QuizjagdQuestionSet,
  SettingsResponse,
  GameDataResponse,
} from '@/types/config';
import type { TeamState, GlobalSettings, CurrentGame } from '@/types/game';

describe('Config Types', () => {
  it('GameType accepts all valid game types', () => {
    const types: GameType[] = [
      'simple-quiz',
      'guessing-game',
      'final-quiz',
      'audio-guess',
      'image-game',
      'four-statements',
      'fact-or-fake',
      'quizjagd',
    ];
    expect(types).toHaveLength(8);
  });

  it('SimpleQuizQuestion supports all optional fields', () => {
    const question: SimpleQuizQuestion = {
      question: 'What is 2+2?',
      answer: '4',
      answerImage: '/images/4.jpg',
      answerAudio: '/audio/four.mp3',
      answerList: ['1', '2', '3', '4'],
      questionImage: '/images/question.jpg',
      questionAudio: '/audio/question.mp3',
      replaceImage: true,
      timer: 30,
    };
    expect(question.question).toBe('What is 2+2?');
    expect(question.timer).toBe(30);
    expect(question.questionAudio).toBe('/audio/question.mp3');
    expect(question.replaceImage).toBe(true);
  });

  it('SimpleQuizQuestion works with minimal fields', () => {
    const question: SimpleQuizQuestion = {
      question: 'Test?',
      answer: 'Yes',
    };
    expect(question.answerImage).toBeUndefined();
  });

  it('GuessingGameQuestion has numeric answer', () => {
    const question: GuessingGameQuestion = {
      question: 'How many?',
      answer: 42,
    };
    expect(typeof question.answer).toBe('number');
  });

  it('AudioGuessQuestion has folder, audioFile, answer, and isExample', () => {
    const question: AudioGuessQuestion = {
      folder: 'Test Song - Artist',
      audioFile: 'short.wav',
      answer: 'Test Song - Artist',
      isExample: false,
    };
    expect(question.isExample).toBe(false);
  });

  it('ImageGameQuestion has image, answer, and isExample', () => {
    const question: ImageGameQuestion = {
      image: '/image-guess/test.jpg',
      answer: 'Test',
      isExample: true,
    };
    expect(question.isExample).toBe(true);
  });

  it('FourStatementsQuestion has trueStatements array and wrongStatement', () => {
    const question: FourStatementsQuestion = {
      Frage: 'Which is wrong?',
      trueStatements: ['True 1', 'True 2', 'True 3'],
      wrongStatement: 'This is wrong',
    };
    expect(question.trueStatements).toHaveLength(3);
  });

  it('FactOrFakeQuestion supports both answer and isFact fields', () => {
    const q1: FactOrFakeQuestion = {
      statement: 'The earth is round',
      answer: 'FAKT',
      description: 'Obviously true',
    };
    const q2: FactOrFakeQuestion = {
      statement: 'Bananas are blue',
      isFact: false,
      description: 'They are yellow',
    };
    expect(q1.answer).toBe('FAKT');
    expect(q2.isFact).toBe(false);
  });

  it('QuizjagdQuestionSet has easy, medium, hard arrays', () => {
    const qSet: QuizjagdQuestionSet = {
      easy: [{ question: 'Easy Q', answer: 'A' }],
      medium: [{ question: 'Medium Q', answer: 'B' }],
      hard: [{ question: 'Hard Q', answer: 'C' }],
    };
    expect(qSet.easy).toHaveLength(1);
    expect(qSet.medium).toHaveLength(1);
    expect(qSet.hard).toHaveLength(1);
  });

  it('AppConfig has required fields', () => {
    const config: AppConfig = {
      activeGameshow: 'show1',
      gameshows: {
        show1: { name: 'Show 1', gameOrder: ['game1'] },
      },
    };
    expect(config.gameshows.show1.gameOrder).toHaveLength(1);
    expect(config.pointSystemEnabled).toBeUndefined();
    expect(config.teamRandomizationEnabled).toBeUndefined();
    expect(config.globalRules).toBeUndefined();
  });

  it('AppConfig allows optional fields', () => {
    const config: AppConfig = {
      pointSystemEnabled: true,
      teamRandomizationEnabled: false,
      globalRules: ['Rule 1'],
      activeGameshow: 'show1',
      gameshows: {
        show1: { name: 'Show 1', gameOrder: [] },
      },
    };
    expect(config.pointSystemEnabled).toBe(true);
    expect(config.globalRules).toHaveLength(1);
  });

  it('GameConfig union covers all game types', () => {
    const simpleQuiz: GameConfig = {
      type: 'simple-quiz',
      title: 'Quiz',
      questions: [],
    };
    const guessingGame: GameConfig = {
      type: 'guessing-game',
      title: 'Guess',
      questions: [],
    };
    const finalQuiz: GameConfig = {
      type: 'final-quiz',
      title: 'Final',
      questions: [],
    };
    const audioGuess: GameConfig = {
      type: 'audio-guess',
      title: 'Audio',
    };
    const imageGame: GameConfig = {
      type: 'image-game',
      title: 'Images',
    };
    const fourStatements: GameConfig = {
      type: 'four-statements',
      title: 'Four',
      questions: [],
    };
    const factOrFake: GameConfig = {
      type: 'fact-or-fake',
      title: 'Fact',
      questions: [],
    };
    const quizjagd: GameConfig = {
      type: 'quizjagd',
      title: 'Quizjagd',
      questions: { easy: [], medium: [], hard: [] },
    };

    const allConfigs: GameConfig[] = [
      simpleQuiz,
      guessingGame,
      finalQuiz,
      audioGuess,
      imageGame,
      fourStatements,
      factOrFake,
      quizjagd,
    ];
    expect(allConfigs).toHaveLength(8);
  });

  it('SettingsResponse has all required fields', () => {
    const response: SettingsResponse = {
      pointSystemEnabled: true,
      teamRandomizationEnabled: true,
      globalRules: ['Rule'],
    };
    expect(response.pointSystemEnabled).toBe(true);
  });

  it('GameDataResponse has all required fields', () => {
    const response: GameDataResponse = {
      gameId: 'game1',
      config: { type: 'simple-quiz', title: 'Test', questions: [] },
      currentIndex: 0,
      totalGames: 5,
      pointSystemEnabled: true,
    };
    expect(response.totalGames).toBe(5);
  });
});

describe('Game Types', () => {
  it('TeamState has all point and team fields', () => {
    const teamState: TeamState = {
      team1: ['Alice', 'Bob'],
      team2: ['Charlie', 'Dave'],
      team1Points: 10,
      team2Points: 5,
    };
    expect(teamState.team1).toHaveLength(2);
    expect(teamState.team1Points).toBe(10);
  });

  it('GlobalSettings has all required fields', () => {
    const settings: GlobalSettings = {
      pointSystemEnabled: true,
      teamRandomizationEnabled: false,
      globalRules: ['Rule 1', 'Rule 2'],
    };
    expect(settings.pointSystemEnabled).toBe(true);
    expect(settings.teamRandomizationEnabled).toBe(false);
  });

  it('CurrentGame has currentIndex and totalGames', () => {
    const game: CurrentGame = {
      currentIndex: 2,
      totalGames: 8,
    };
    expect(game.currentIndex).toBe(2);
  });
});
