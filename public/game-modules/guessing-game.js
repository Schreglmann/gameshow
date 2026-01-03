/**
 * Guessing Game Module (Type: guessing)
 * Teams guess numerical answers, closest team wins
 */
class GuessingGame extends BaseGame {
    constructor(config, gameId, currentGameIndex, totalGames) {
        super(config, gameId, currentGameIndex, totalGames);
    }

    init() {
        super.init();
        this.showLanding();
        this.setupGuessForm();
    }

    setupGuessForm() {
        const form = document.getElementById('guessForm');
        if (form) {
            form.addEventListener('submit', (e) => {
                e.preventDefault();
                this.handleGuessSubmit();
            });
        }
    }

    handleNavigation() {
        if (this.isVisible('landingScreen')) {
            this.showRules();
        } else if (this.isVisible('rulesScreen')) {
            this.startGame();
            this.showQuestion();
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
        const questionNumberElement = document.getElementById('questionNumber');
        const answerElement = document.getElementById('quizAnswer');
        const form = document.getElementById('guessForm');
        const nextBtn = document.getElementById('nextQuestionButton');

        questionElement.textContent = question.question;
        answerElement.style.display = 'none';
        form.style.display = 'block';
        nextBtn.style.display = 'none';

        if (this.currentQuestionIndex === 0) {
            questionNumberElement.textContent = 'Beispiel Frage';
        } else {
            const totalQuestions = this.config.questions.length - 1;
            questionNumberElement.textContent = `Frage ${this.currentQuestionIndex} von ${totalQuestions}`;
        }

        // Reset inputs
        document.getElementById('team1Guess').value = '';
        document.getElementById('team2Guess').value = '';
    }

    handleGuessSubmit() {
        const team1Guess = parseInt(document.getElementById('team1Guess').value);
        const team2Guess = parseInt(document.getElementById('team2Guess').value);
        const correctAnswer = this.config.questions[this.currentQuestionIndex].answer;
        const team1Difference = Math.abs(team1Guess - correctAnswer);
        const team2Difference = Math.abs(team2Guess - correctAnswer);

        // Format numbers with dots for thousands separator
        const formatNumber = (num) => {
            return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");
        };

        let resultMessage = `
            <div class="result-row"><strong>Richtige Antwort:</strong> ${formatNumber(correctAnswer)}</div>
            <div class="result-row"><strong>Tipp Team 1:</strong> ${formatNumber(team1Guess)}</div>
            <div class="result-row"><strong>Tipp Team 2:</strong> ${formatNumber(team2Guess)}</div>
        `;

        if (team1Difference < team2Difference) {
            resultMessage += "<div class='result-row winner centered'><strong>Team 1 war näher dran!</strong></div>";
        } else if (team2Difference < team1Difference) {
            resultMessage += "<div class='result-row winner centered'><strong>Team 2 war näher dran!</strong></div>";
        } else {
            resultMessage += "<div class='result-row winner centered'><strong>Beide Teams waren gleich nah dran!</strong></div>";
        }

        const answerElement = document.getElementById('quizAnswer');
        answerElement.innerHTML = resultMessage;
        answerElement.style.display = 'block';
        document.getElementById('guessForm').style.display = 'none';
        
        const nextBtn = document.getElementById('nextQuestionButton');
        nextBtn.style.display = 'block';
        nextBtn.onclick = () => this.handleNextQuestion();
    }

    handleNextQuestion() {
        this.currentQuestionIndex++;
        if (this.currentQuestionIndex < this.config.questions.length) {
            this.showQuestion();
        } else {
            this.showAwardPoints();
        }
    }

    showAwardPoints() {
        this.hideAllScreens();
        document.getElementById('awardPointsContainer').style.display = 'block';

        const team1Btn = document.querySelector('#awardPointsContainer button:nth-of-type(1)');
        const team2Btn = document.querySelector('#awardPointsContainer button:nth-of-type(2)');
        const points = this.currentGameIndex + 1; // Award points based on game position

        team1Btn.onclick = (e) => {
            e.stopPropagation();
            this.awardPoints('team1', points);
            this.showNextGameScreen();
        };

        team2Btn.onclick = (e) => {
            e.stopPropagation();
            this.awardPoints('team2', points);
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
