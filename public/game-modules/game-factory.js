/**
 * Game Module Factory
 * Creates the appropriate game module based on game type
 */
class GameFactory {
    static createGame(gameType, config, gameId, currentGameIndex, totalGames) {
        switch (gameType) {
            case 'simple-quiz':
                return new QuizGame(config, gameId, currentGameIndex, totalGames);
            case 'guessing-game':
                return new GuessingGame(config, gameId, currentGameIndex, totalGames);
            case 'final-quiz':
                return new BuzzerGame(config, gameId, currentGameIndex, totalGames);
            case 'audio-guess':
                return new MusicGame(config, gameId, currentGameIndex, totalGames);
            case 'image-game':
                return new ImageGame(config, gameId, currentGameIndex, totalGames);
            case 'four-statements':
                return new OddOneOutGame(config, gameId, currentGameIndex, totalGames);
            case 'fact-or-fake':
                return new FactOrFakeGame(config, gameId, currentGameIndex, totalGames);
            case 'quizjagd':
                return new QuizjagdGame(config, gameId, currentGameIndex, totalGames);
            default:
                throw new Error(`Unknown game type: ${gameType}`);
        }
    }

    static getAvailableGameTypes() {
        return ['simple-quiz', 'guessing-game', 'final-quiz', 'audio-guess', 'image-game', 'four-statements', 'fact-or-fake', 'quizjagd'];
    }
}
