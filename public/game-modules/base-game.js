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
        
        // Randomize questions if flag is explicitly set to true and not audio-guess or image-game
        if (config.randomizeQuestions === true && 
            config.type !== 'audio-guess' && 
            config.type !== 'image-game' && 
            config.questions && 
            config.questions.length > 0) {
            this.randomizeQuestions();
        }
    }
    
    /**
     * Check if the point system is enabled globally
     * Games that inherently require points (final-quiz, quizjagd) should override this
     */
    isPointSystemEnabled() {
        return window.pointSystemEnabled !== false;
    }
    
    /**
     * Check if this game type requires the point system to function
     * Override in game modules that need points (e.g., betting games)
     */
    requiresPointSystem() {
        const pointRequiredTypes = ['final-quiz', 'quizjagd'];
        return pointRequiredTypes.includes(this.config.type);
    }
    
    /**
     * Check if points should be shown/awarded for this game
     * Returns true if either points are globally enabled OR this game requires points
     */
    shouldShowPoints() {
        return this.isPointSystemEnabled() || this.requiresPointSystem();
    }
    
    /**
     * Check if this game has audio content
     */
    hasAudioContent() {
        if (this.config.type === 'audio-guess') {
            return true;
        }
        // Check if simple-quiz has audio answers
        if (this.config.type === 'simple-quiz' && this.config.questions) {
            return this.config.questions.some(q => q.answerAudio);
        }
        return false;
    }
    
    /**
     * Fade out all game audio elements
     */
    fadeOutGameAudio(duration = 2000) {
        // Find all audio elements in the game screens
        const audioElements = document.querySelectorAll('audio');
        let fadedCount = 0;
        
        audioElements.forEach(audio => {
            // Skip background music player's audio elements
            if (window.backgroundMusicPlayer && 
                window.backgroundMusicPlayer.audioElements.includes(audio)) {
                return;
            }
            
            if (!audio.paused && audio.duration > 0) {
                fadedCount++;
                console.log('Fading out game audio:', audio.src);
                const startVolume = audio.volume || 1;
                const steps = 20;
                const stepDuration = duration / steps;
                let step = 0;
                
                const interval = setInterval(() => {
                    step++;
                    const progress = step / steps;
                    audio.volume = Math.max(0, startVolume * (1 - progress));
                    
                    if (step >= steps) {
                        clearInterval(interval);
                        audio.pause();
                        audio.currentTime = 0;
                        audio.volume = startVolume; // Reset for next use
                        console.log('Game audio faded out and stopped');
                    }
                }, stepDuration);
            }
        });
        
        console.log(`Fading out ${fadedCount} game audio elements`);
        return fadedCount;
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
            } else if (event.key === 'ArrowLeft') {
                this.handleBackNavigation();
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
     * Handle back navigation - to be overridden by child classes
     */
    handleBackNavigation() {
        // Default: do nothing, child classes can override
    }

    /**
     * Load team points from localStorage
     */
    loadTeamPoints() {
        if (!this.shouldShowPoints()) {
            return; // Don't load points if point system is disabled
        }
        const team1Points = localStorage.getItem('team1Points') || 0;
        const team2Points = localStorage.getItem('team2Points') || 0;
        document.getElementById('team1Points').textContent = team1Points;
        document.getElementById('team2Points').textContent = team2Points;
    }

    /**
     * Randomize questions array (Fisher-Yates shuffle)
     * Keeps the first question (example) in place and only shuffles the rest
     */
    randomizeQuestions() {
        const questions = this.config.questions;
        // Only shuffle from index 1 onwards, keeping the first question as example
        for (let i = questions.length - 1; i > 1; i--) {
            const j = Math.floor(Math.random() * (i - 1 + 1)) + 1; // Random index from 1 to i
            [questions[i], questions[j]] = [questions[j], questions[i]];
        }
    }

    /**
     * Award points to a team
     */
    awardPoints(team, points = 1) {
        if (!this.shouldShowPoints()) {
            return; // Don't award points if point system is disabled
        }
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
        
        // Fade out background music for audio games
        if (this.hasAudioContent() && window.backgroundMusicPlayer && window.backgroundMusicPlayer.isPlaying) {
            window.backgroundMusicPlayer.fadeOut(2000);
        }
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
     * Show award points screen
     */
    showAwardPoints() {
        this.hideAllScreens();
        const container = document.getElementById('awardPointsContainer');
        if (container) {
            container.style.display = 'block';
        }
    }

    /**
     * Navigate to next game
     */
    nextGame() {
        const nextIndex = this.currentGameIndex + 1;
        if (nextIndex < this.totalGames) {
            // Use SPA-style navigation instead of page reload
            this.navigateToGame(nextIndex);
        } else {
            // Navigate to summary using SPA routing
            history.pushState({}, '', '/summary');
            if (window.loadSummary) {
                window.loadSummary();
            } else {
                window.location.href = '/summary';
            }
        }
    }
    
    /**
     * Navigate to a game without page reload
     */
    navigateToGame(index) {
        // Update URL without reload
        const url = new URL(window.location);
        url.searchParams.set('index', index);
        window.history.pushState({ gameIndex: index }, '', url);
        
        // Trigger game load
        if (window.loadGame) {
            window.loadGame();
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
