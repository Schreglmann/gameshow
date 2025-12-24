/**
 * Image Game Module (Type: image)
 * Image-based quiz game
 */
class ImageGame extends BaseGame {
    constructor(config, gameId, currentGameIndex, totalGames) {
        super(config, gameId, currentGameIndex, totalGames);
    }

    init() {
        super.init();
        console.log('Image game initialized');
    }

    handleNavigation() {
        if (this.isVisible('landingScreen')) {
            this.showRules();
        } else if (this.isVisible('rulesScreen')) {
            this.startGame();
            this.showQuestion();
        } else if (this.isVisible('gameScreen')) {
            const answerElement = document.getElementById('quizAnswer');
            
            if (answerElement.classList.contains('hidden')) {
                // Show answer
                answerElement.classList.remove('hidden');
            } else {
                // Next question
                this.currentQuestionIndex++;
                if (this.currentQuestionIndex < this.config.questions.length) {
                    this.showQuestion();
                } else {
                    this.showAwardPoints();
                }
            }
        } else if (this.isVisible('nextGameScreen')) {
            this.nextGame();
        }
    }

    showRules() {
        super.showRules();
        const totalQuestions = this.config.questions.length - 1;
        document.getElementById('totalQuestions').textContent = totalQuestions;
    }

    showQuestion() {
        const question = this.config.questions[this.currentQuestionIndex];
        const questionElement = document.getElementById('quizQuestion');
        const answerElement = document.getElementById('quizAnswer');
        const questionNumberElement = document.getElementById('questionNumber');

        // Display image
        questionElement.innerHTML = `<img src="${question.image}" alt="Quiz Image" style="max-width: 80%; max-height: 400px; margin: 20px auto; display: block;">`;
        answerElement.innerHTML = `<strong>${question.answer}</strong>`;
        answerElement.classList.add('hidden');

        if (this.currentQuestionIndex === 0) {
            questionNumberElement.textContent = 'Beispiel Frage';
        } else {
            const totalQuestions = this.config.questions.length - 1;
            questionNumberElement.textContent = `Frage ${this.currentQuestionIndex} von ${totalQuestions}`;
        }
    }

    showAwardPoints() {
        this.hideAllScreens();
        document.getElementById('awardPointsContainer').style.display = 'block';

        // Setup award buttons
        const team1Btn = document.querySelector('#awardPointsContainer button:nth-of-type(1)');
        const team2Btn = document.querySelector('#awardPointsContainer button:nth-of-type(2)');

        team1Btn.onclick = (e) => {
            e.stopPropagation();
            this.awardPoints('team1', 1);
            this.showNextGameScreen();
        };

        team2Btn.onclick = (e) => {
            e.stopPropagation();
            this.awardPoints('team2', 1);
            this.showNextGameScreen();
        };
    }

    showNextGameScreen() {
        this.hideAllScreens();
        document.getElementById('nextGameScreen').style.display = 'block';
        
        // Setup next game button
        const nextGameBtn = document.getElementById('nextGameButton');
        nextGameBtn.onclick = (e) => {
            e.stopPropagation();
            this.nextGame();
        };
    }
}
