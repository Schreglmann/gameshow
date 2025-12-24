/**
 * Game Module Factory
 * Creates the appropriate game module based on game type
 */
class GameFactory {
    static createGame(gameType, config, gameId, currentGameIndex, totalGames) {
        switch (gameType) {
            case 'quiz':
                return new QuizGame(config, gameId, currentGameIndex, totalGames);
            case 'guessing':
                return new GuessingGame(config, gameId, currentGameIndex, totalGames);
            case 'buzzer':
                return new BuzzerGame(config, gameId, currentGameIndex, totalGames);
            case 'music':
                return new MusicGame(config, gameId, currentGameIndex, totalGames);
            case 'image':
                return new ImageGame(config, gameId, currentGameIndex, totalGames);
            case 'oddoneout':
                return new OddOneOutGame(config, gameId, currentGameIndex, totalGames);
            case 'factorfake':
                return new FactOrFakeGame(config, gameId, currentGameIndex, totalGames);
            default:
                throw new Error(`Unknown game type: ${gameType}`);
        }
    }

    static getAvailableGameTypes() {
        return ['quiz', 'guessing', 'buzzer', 'music', 'image', 'oddoneout', 'factorfake'];
    }
}
