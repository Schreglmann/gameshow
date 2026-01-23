/**
 * Odd One Out Game Module (Type: oddoneout)
 * Find the odd statement game
 */
class OddOneOutGame extends BaseGame {
    constructor(config, gameId, currentGameIndex, totalGames) {
        super(config, gameId, currentGameIndex, totalGames);
        this.currentShuffledStatements = null;
        this.revealedStatementsCount = 0;
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
            const answerElement = document.getElementById('quizAnswer');
            
            // Check if all statements have been revealed
            if (this.revealedStatementsCount < this.currentShuffledStatements.length) {
                // Reveal next statement
                this.revealNextStatement();
            } else if (answerElement.classList.contains('hidden')) {
                // All statements shown, now show answer
                this.revealAnswer();
                answerElement.classList.remove('hidden');
            } else {
                // Next question
                this.currentQuestionIndex++;
                if (this.currentQuestionIndex < this.config.questions.length) {
                    this.showQuestion();
                } else {
                    // Skip award points screen if point system is disabled
                    if (this.isPointSystemEnabled()) {
                        this.showAwardPoints();
                    } else {
                        this.showNextGameScreen();
                    }
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

        // Reset any inline styles from previous games
        questionElement.style.fontSize = '';
        questionElement.style.lineHeight = '';

        // Build question display with all statements
        const allStatements = [...question.trueStatements, question.wrongStatement];
        // Shuffle statements
        allStatements.sort(() => Math.random() - 0.5);
        this.currentShuffledStatements = allStatements;
        this.revealedStatementsCount = 0;
        
        let questionHTML = `<strong>${question.Frage}</strong><br>`;
        allStatements.forEach((statement, idx) => {
            questionHTML += `<div id="statement-${idx}" style="margin: 5px 0; padding: 10px; border-radius: 8px; font-size: 0.9em; display: none;">${statement}</div>`;
        });

        questionElement.innerHTML = questionHTML;
        answerElement.textContent = question.answer;
        answerElement.classList.add('hidden');

        if (this.currentQuestionIndex === 0) {
            questionNumberElement.textContent = 'Beispiel Frage';
        } else {
            const totalQuestions = this.config.questions.length - 1;
            questionNumberElement.textContent = `Frage ${this.currentQuestionIndex} von ${totalQuestions}`;
        }
    }

    revealNextStatement() {
        const statementElement = document.getElementById(`statement-${this.revealedStatementsCount}`);
        if (statementElement) {
            statementElement.style.display = 'block';
            statementElement.style.transition = 'opacity 0.3s ease';
            statementElement.style.opacity = '0';
            setTimeout(() => {
                statementElement.style.opacity = '1';
            }, 10);
        }
        this.revealedStatementsCount++;
    }

    revealAnswer() {
        const question = this.config.questions[this.currentQuestionIndex];
        
        // Update each statement element with styling
        this.currentShuffledStatements.forEach((statement, idx) => {
            const statementElement = document.getElementById(`statement-${idx}`);
            if (statementElement) {
                const isWrong = statement === question.wrongStatement;
                if (isWrong) {
                    statementElement.style.background = 'rgba(255, 59, 48, 0.3)';
                    statementElement.style.borderLeft = '4px solid #ff3b30';
                    statementElement.style.fontWeight = 'bold';
                    statementElement.innerHTML = statement;
                } else {
                    statementElement.style.background = 'rgba(76, 217, 100, 0.2)';
                    statementElement.style.borderLeft = '4px solid #4cd964';
                    statementElement.innerHTML = statement;
                }
                statementElement.style.transition = 'all 0.3s ease';
            }
        });
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
        
        const nextGameBtn = document.getElementById('nextGameButton');
        nextGameBtn.onclick = (e) => {
            e.stopPropagation();
            this.nextGame();
        };
    }
}
