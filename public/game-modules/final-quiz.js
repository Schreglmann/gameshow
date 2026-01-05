/**
 * Buzzer Game Module (Type: final-quiz)
 * Betting quiz game where teams wager their points
 */
class BuzzerGame extends BaseGame {
    constructor(config, gameId, currentGameIndex, totalGames) {
        super(config, gameId, currentGameIndex, totalGames);
        this.team1Bet = 0;
        this.team2Bet = 0;
        this.team1Answered = false;
        this.team2Answered = false;
        this.team1LastAnswer = null; // Track last answer to handle changes
        this.team2LastAnswer = null;
    }

    init() {
        super.init();
        this.showLanding();
    }

    handleNavigation() {
        if (this.isVisible('landingScreen')) {
            this.showRules();
        } else if (this.isVisible('rulesScreen')) {
            this.startGame();
            this.showQuestion();
        } else if (this.isVisible('gameScreen')) {
            const bettingForm = document.getElementById('bettingForm');
            const correctButtons = document.getElementById('correctButtons');
            
            // If betting form is visible, do nothing (button handles it)
            if (bettingForm && bettingForm.style.display !== 'none') {
                return;
            }
            
            // If correct buttons are visible and both teams answered, show next question button
            if (correctButtons && correctButtons.style.display !== 'none') {
                if (this.team1Answered && this.team2Answered) {
                    this.currentQuestionIndex++;
                    if (this.currentQuestionIndex < this.config.questions.length) {
                        this.showQuestion();
                    } else {
                        this.showNextGameScreen();
                    }
                }
                return;
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
        const bettingForm = document.getElementById('bettingForm');
        const correctButtons = document.getElementById('correctButtons');
        const nextQuestionButton = document.getElementById('nextQuestionButton');

        // Reset any inline styles from previous games
        questionElement.style.fontSize = '';
        questionElement.style.lineHeight = '';

        // Reset state for new question
        this.team1Bet = 0;
        this.team2Bet = 0;
        this.team1Answered = false;
        this.team2Answered = false;
        this.team1LastAnswer = null;
        this.team2LastAnswer = null;

        questionElement.textContent = question.question;
        answerElement.textContent = question.answer;
        answerElement.style.display = 'none';

        // Show betting form
        bettingForm.style.display = 'block';
        correctButtons.style.display = 'none';
        nextQuestionButton.style.display = 'none';

        // Clear previous bets
        document.getElementById('team1Bet').value = '';
        document.getElementById('team2Bet').value = '';

        // Reset buttons
        ['team1Correct', 'team1Incorrect', 'team2Correct', 'team2Incorrect'].forEach(id => {
            const btn = document.getElementById(id);
            btn.disabled = false;
            btn.classList.remove('active', 'no-hover');
        });

        // Setup submit bets button
        const submitBetsButton = document.getElementById('submitBetsButton');
        submitBetsButton.onclick = (e) => {
            e.stopPropagation();
            this.submitBets();
        };

        // Setup correct/incorrect buttons
        document.getElementById('team1Correct').onclick = (e) => {
            e.stopPropagation();
            this.markCorrect('team1', true);
        };
        document.getElementById('team1Incorrect').onclick = (e) => {
            e.stopPropagation();
            this.markCorrect('team1', false);
        };
        document.getElementById('team2Correct').onclick = (e) => {
            e.stopPropagation();
            this.markCorrect('team2', true);
        };
        document.getElementById('team2Incorrect').onclick = (e) => {
            e.stopPropagation();
            this.markCorrect('team2', false);
        };

        if (this.currentQuestionIndex === 0) {
            questionNumberElement.textContent = 'Beispiel Frage';
        } else {
            const totalQuestions = this.config.questions.length - 1;
            questionNumberElement.textContent = `Frage ${this.currentQuestionIndex} von ${totalQuestions}`;
        }
    }

    submitBets() {
        const question = this.config.questions[this.currentQuestionIndex];
        const team1BetInput = document.getElementById('team1Bet');
        const team2BetInput = document.getElementById('team2Bet');
        
        this.team1Bet = parseInt(team1BetInput.value) || 0;
        this.team2Bet = parseInt(team2BetInput.value) || 0;

        // Show answer and correct/incorrect buttons
        const answerElement = document.getElementById('quizAnswer');
        answerElement.style.display = 'block';
        
        document.getElementById('bettingForm').style.display = 'none';
        document.getElementById('correctButtons').style.display = 'block';
    }

    markCorrect(team, isCorrect) {
        const question = this.config.questions[this.currentQuestionIndex];
        
        // Get button elements for this team
        const correctButton = document.getElementById(`${team}Correct`);
        const incorrectButton = document.getElementById(`${team}Incorrect`);
        
        // If clicking the already active button, don't do anything
        if ((isCorrect && correctButton.classList.contains('active')) ||
            (!isCorrect && incorrectButton.classList.contains('active'))) {
            return;
        }
        
        // Only adjust points if not example question
        if (!question.isExample && this.currentQuestionIndex !== 0) {
            const bet = team === 'team1' ? this.team1Bet : this.team2Bet;
            let currentPoints = parseInt(localStorage.getItem(`${team}Points`)) || 0;
            const lastAnswer = team === 'team1' ? this.team1LastAnswer : this.team2LastAnswer;
            
            // Reverse previous answer's effect if there was one
            if (lastAnswer !== null) {
                if (lastAnswer === true) {
                    currentPoints -= bet; // Remove previously added points
                } else {
                    currentPoints += bet; // Remove previously subtracted points
                }
            }
            
            // Apply new answer
            if (isCorrect) {
                currentPoints += bet;
            } else {
                currentPoints -= bet;
            }
            
            localStorage.setItem(`${team}Points`, currentPoints);
            document.getElementById(`${team}Points`).textContent = currentPoints;
        }
        
        // Store the current answer
        if (team === 'team1') {
            this.team1LastAnswer = isCorrect;
            this.team1Answered = true;
        } else {
            this.team2LastAnswer = isCorrect;
            this.team2Answered = true;
        }
        
        // Remove active state from both buttons first (to allow changing selection)
        correctButton.classList.remove('active');
        incorrectButton.classList.remove('active');
        
        // Add active state to clicked button
        if (isCorrect) {
            correctButton.classList.add('active');
        } else {
            incorrectButton.classList.add('active');
        }

        // If both teams have answered, show next question button
        if (this.team1Answered && this.team2Answered) {
            const nextQuestionButton = document.getElementById('nextQuestionButton');
            nextQuestionButton.style.display = 'block';
            nextQuestionButton.onclick = (e) => {
                e.stopPropagation();
                this.currentQuestionIndex++;
                if (this.currentQuestionIndex < this.config.questions.length) {
                    this.showQuestion();
                } else {
                    this.showNextGameScreen();
                }
            };
        }
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
