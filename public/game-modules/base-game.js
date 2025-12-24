/**
 * Base Game Module
 * All game modules should extend this class
 */
class BaseGame {
    constructor(config, gameId, currentGameIndex, totalGames) {
        this.config = config;
        this.gameId = gameId;
        this.currentGameIndex = currentGameIndex;
        this.totalGames = totalGames;
        this.currentQuestionIndex = 0;
        this.isNavigating = false; // Prevent double-firing
    }

    /**
     * Initialize the game - to be overridden by child classes
     */
    init() {
        this.setupNavigation();
        this.loadTeamPoints();
    }

    /**
     * Setup navigation handlers
     */
    setupNavigation() {
        // Remove existing listeners to prevent duplicates
        if (window.currentGameNavigationHandler) {
            document.removeEventListener('keydown', window.currentGameNavigationHandler.keyHandler);
            document.body.removeEventListener('click', window.currentGameNavigationHandler.clickHandler);
        }

        // Create bound handlers
        const keyHandler = (event) => {
            if (event.key === 'ArrowRight') {
                this.handleNavigation();
            }
        };

        const clickHandler = (e) => {
            // Don't trigger navigation on button clicks
            if (!e.target.closest('button') && !e.target.closest('input')) {
                // Prevent double-firing
                if (this.isNavigating) return;
                this.isNavigating = true;
                
                this.handleNavigation();
                
                // Reset flag after a short delay
                setTimeout(() => {
                    this.isNavigating = false;
                }, 100);
            }
        };

        // Store handlers so we can remove them later
        window.currentGameNavigationHandler = { keyHandler, clickHandler };

        // Add new listeners
        document.addEventListener('keydown', keyHandler);
        document.body.addEventListener('click', clickHandler);
    }

    /**
     * Handle navigation between game states - to be overridden by child classes
     */
    handleNavigation() {
        console.warn('handleNavigation() should be implemented by child class');
    }

    /**
     * Load team points from localStorage
     */
    loadTeamPoints() {
        const team1Points = localStorage.getItem('team1Points') || 0;
        const team2Points = localStorage.getItem('team2Points') || 0;
        document.getElementById('team1Points').textContent = team1Points;
        document.getElementById('team2Points').textContent = team2Points;
    }

    /**
     * Award points to a team
     */
    awardPoints(team, points = 1) {
        const currentPoints = parseInt(localStorage.getItem(`${team}Points`)) || 0;
        const newPoints = currentPoints + points;
        localStorage.setItem(`${team}Points`, newPoints);
        document.getElementById(`${team}Points`).textContent = newPoints;
    }

    /**
     * Show the rules screen
     */
    showRules() {
        this.hideAllScreens();
        document.getElementById('rulesScreen').style.display = 'block';
    }

    /**
     * Start the game
     */
    startGame() {
        this.hideAllScreens();
        document.getElementById('gameScreen').style.display = 'block';
    }

    /**
     * Show landing screen
     */
    showLanding() {
        this.hideAllScreens();
        document.getElementById('landingScreen').style.display = 'block';
    }

    /**
     * Hide all screens
     */
    hideAllScreens() {
        const screens = ['landingScreen', 'rulesScreen', 'gameScreen', 'awardPointsContainer', 'nextGameScreen'];
        screens.forEach(screen => {
            const element = document.getElementById(screen);
            if (element) {
                element.style.display = 'none';
            }
        });
    }

    /**
     * Navigate to next game
     */
    nextGame() {
        const nextIndex = this.currentGameIndex + 1;
        if (nextIndex < this.totalGames) {
            window.location.href = `/game?index=${nextIndex}`;
        } else {
            window.location.href = '/summary.html';
        }
    }

    /**
     * Check if element is visible
     */
    isVisible(elementId) {
        const element = document.getElementById(elementId);
        return element && element.offsetParent !== null;
    }
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = BaseGame;
}
