/**
 * Quizjagd Game Module (Type: quizjagd)
 * Teams take turns betting 3, 5, or 7 points on questions of varying difficulty
 */
class QuizjagdGame extends BaseGame {
    constructor(config, gameId, currentGameIndex, totalGames) {
        super(config, gameId, currentGameIndex, totalGames);
        this.currentTeam = 'team1'; // Start with team1
        this.currentBet = 0;
        this.questionsByDifficulty = this.organizeQuestions();
        this.usedQuestions = { 3: 0, 5: 0, 7: 0 }; // Track which questions have been used
        this.exampleShown = false; // Track if the example has been shown
        this.team1QuestionsAnswered = 0; // Track questions per team
        this.team2QuestionsAnswered = 0;
        this.questionsPerTeam = 7; // Each team gets 7 questions
    }

    init() {
        super.init();
        this.showLanding();
    }

    organizeQuestions() {
        // Organize questions by difficulty (3, 5, 7) and separate example questions
        const organized = { 3: [], 5: [], 7: [] };
        const examples = { 3: [], 5: [], 7: [] };
        
        if (this.config.questions) {
            this.config.questions.forEach(q => {
                if (q.difficulty && organized[q.difficulty]) {
                    if (q.isExample) {
                        // Separate example questions
                        examples[q.difficulty].push(q);
                    } else {
                        // Regular questions
                        organized[q.difficulty].push(q);
                    }
                }
            });
        }
        
        // Shuffle only regular questions for each difficulty level
        Object.keys(organized).forEach(difficulty => {
            organized[difficulty] = this.shuffleArray(organized[difficulty]);
            // Put example questions at the beginning
            organized[difficulty] = [...examples[difficulty], ...organized[difficulty]];
        });
        
        return organized;
    }

    shuffleArray(array) {
        // Fisher-Yates shuffle algorithm
        const shuffled = [...array];
        for (let i = shuffled.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
        }
        return shuffled;
    }

    handleNavigation() {
        if (this.isVisible('landingScreen')) {
            this.showRules();
        } else if (this.isVisible('rulesScreen')) {
            this.startGame();
            this.showBettingScreen();
        } else if (this.isVisible('gameScreen')) {
            const quizjagdBetting = document.getElementById('quizjagdBetting');
            const quizjagdQuestion = document.getElementById('quizjagdQuestion');
            const quizjagdAnswer = document.getElementById('quizjagdAnswer');
            const quizjagdCorrectButtons = document.getElementById('quizjagdCorrectButtons');
            
            // If betting is visible, do nothing (buttons handle it)
            if (quizjagdBetting && quizjagdBetting.style.display !== 'none') {
                return;
            }
            
            // If question is visible but answer is hidden, show answer
            if (quizjagdQuestion && quizjagdQuestion.style.display !== 'none' && 
                quizjagdAnswer && quizjagdAnswer.classList.contains('hidden')) {
                quizjagdAnswer.classList.remove('hidden');
                quizjagdCorrectButtons.style.display = 'block';
                return;
            }
            
            // If correct buttons are visible, do nothing (buttons handle team switch)
            if (quizjagdCorrectButtons && quizjagdCorrectButtons.style.display !== 'none') {
                return;
            }
        } else if (this.isVisible('nextGameScreen')) {
            this.nextGame();
        }
    }

    showRules() {
        super.showRules();
    }

    showBettingScreen() {
        this.hideAllScreens();
        document.getElementById('gameScreen').style.display = 'block';
        
        const quizjagdHeader = document.getElementById('quizjagdHeader');
        const quizjagdBetting = document.getElementById('quizjagdBetting');
        const quizjagdQuestion = document.getElementById('quizjagdQuestion');
        const quizjagdAnswer = document.getElementById('quizjagdAnswer');
        const quizjagdCorrectButtons = document.getElementById('quizjagdCorrectButtons');
        const quizjagdQuestionNumber = document.getElementById('quizjagdQuestionNumber');
        const quizjagdHeaderText = document.getElementById('quizjagdHeaderText');
        const quizjagdPointsDisplay = document.getElementById('quizjagdPointsDisplay');
        
        // Hide standard question number element (used by other games)
        document.getElementById('questionNumber').style.display = 'none';
        document.getElementById('quizQuestion').style.display = 'none';
        document.getElementById('quizAnswer').style.display = 'none';
        
        // Hide other elements
        quizjagdQuestion.style.display = 'none';
        quizjagdAnswer.classList.add('hidden');
        quizjagdCorrectButtons.style.display = 'none';
        quizjagdPointsDisplay.style.display = 'none'; // Hide points on betting screen
        
        // Show header and betting screen
        quizjagdHeader.style.display = 'block';
        quizjagdBetting.style.display = 'block';
        
        // Update header with team and question count
        let teamName = localStorage.getItem(this.currentTeam);
        
        // Parse if it's stored as JSON array
        try {
            const parsed = JSON.parse(teamName);
            if (Array.isArray(parsed) && parsed.length > 0) {
                teamName = parsed.join(', ');
            }
        } catch (e) {
            // Not JSON, use as is
        }
        
        // Fallback to default team name
        if (!teamName) {
            teamName = this.currentTeam === 'team1' ? 'Team 1' : 'Team 2';
        }
        
        // Get current question count for this team
        const currentQuestionCount = this.currentTeam === 'team1' ? 
            this.team1QuestionsAnswered + 1 : 
            this.team2QuestionsAnswered + 1;
        
        // Update header - question number and team name on separate lines
        const teamNumber = this.currentTeam === 'team1' ? 'Team 1' : 'Team 2';
        
        // Show "Beispiel" for the first question (example), otherwise show question number
        if (!this.exampleShown) {
            quizjagdQuestionNumber.textContent = 'Beispiel';
            quizjagdQuestionNumber.style.fontSize = '2.5em'; // Make Beispiel bigger
            quizjagdHeaderText.style.display = 'none'; // Hide team name for example
        } else {
            quizjagdQuestionNumber.textContent = `Frage ${currentQuestionCount} von ${this.questionsPerTeam}`;
            quizjagdQuestionNumber.style.fontSize = ''; // Reset to default size
            quizjagdHeaderText.textContent = `${teamNumber} (${teamName})`;
            quizjagdHeaderText.style.display = 'block'; // Show team name on betting screen
        }
        
        // Setup betting buttons and disable if no questions available
        const bet3Button = document.getElementById('quizjagdBet3');
        const bet5Button = document.getElementById('quizjagdBet5');
        const bet7Button = document.getElementById('quizjagdBet7');
        
        // Check availability and disable buttons if no questions left
        const questions3Available = this.usedQuestions[3] < this.questionsByDifficulty[3].length;
        const questions5Available = this.usedQuestions[5] < this.questionsByDifficulty[5].length;
        const questions7Available = this.usedQuestions[7] < this.questionsByDifficulty[7].length;
        
        bet3Button.disabled = !questions3Available;
        bet5Button.disabled = !questions5Available;
        bet7Button.disabled = !questions7Available;
        
        bet3Button.style.opacity = questions3Available ? '1' : '0.5';
        bet5Button.style.opacity = questions5Available ? '1' : '0.5';
        bet7Button.style.opacity = questions7Available ? '1' : '0.5';
        
        bet3Button.onclick = (e) => {
            e.stopPropagation();
            if (!bet3Button.disabled) {
                this.selectBet(3);
            }
        };
        bet5Button.onclick = (e) => {
            e.stopPropagation();
            if (!bet5Button.disabled) {
                this.selectBet(5);
            }
        };
        bet7Button.onclick = (e) => {
            e.stopPropagation();
            if (!bet7Button.disabled) {
                this.selectBet(7);
            }
        };
    }

    selectBet(points) {
        this.currentBet = points;
        
        // Check if there are questions available for this difficulty
        if (this.usedQuestions[points] >= this.questionsByDifficulty[points].length) {
            alert(`Keine ${points}-Punkte Fragen mehr verfügbar!`);
            return;
        }
        
        this.showQuestion(points);
    }

    showQuestion(difficulty) {
        const questionIndex = this.usedQuestions[difficulty];
        const question = this.questionsByDifficulty[difficulty][questionIndex];
        
        if (!question) {
            // No more questions of this difficulty, check if game should end
            this.checkGameEnd();
            return;
        }
        
        // Skip example questions after the first one has been shown
        if (question.isExample && this.exampleShown) {
            this.usedQuestions[difficulty]++;
            this.showQuestion(difficulty);
            return;
        }
        
        // Mark that we've shown an example
        if (question.isExample && !this.exampleShown) {
            this.exampleShown = true;
        }
        
        // Increment used questions counter
        this.usedQuestions[difficulty]++;
        
        const quizjagdBetting = document.getElementById('quizjagdBetting');
        const quizjagdQuestion = document.getElementById('quizjagdQuestion');
        const quizjagdAnswer = document.getElementById('quizjagdAnswer');
        const quizjagdCorrectButtons = document.getElementById('quizjagdCorrectButtons');
        const quizjagdHeaderText = document.getElementById('quizjagdHeaderText');
        const quizjagdQuestionNumber = document.getElementById('quizjagdQuestionNumber');
        const quizjagdPointsDisplay = document.getElementById('quizjagdPointsDisplay');
        
        // Hide betting, show question
        quizjagdBetting.style.display = 'none';
        quizjagdQuestion.style.display = 'block';
        quizjagdHeaderText.style.display = 'none'; // Hide team name on question screen
        
        // Update question number (without points) and show points on separate line
        const currentQuestionCount = this.currentTeam === 'team1' ? 
            this.team1QuestionsAnswered : 
            this.team2QuestionsAnswered;
        
        // Show "Beispiel" for example questions, otherwise show question number
        if (question.isExample) {
            quizjagdQuestionNumber.textContent = 'Beispiel';
        } else {
            quizjagdQuestionNumber.textContent = `Frage ${currentQuestionCount + 1} von ${this.questionsPerTeam}`;
        }
        
        quizjagdPointsDisplay.textContent = `${difficulty} Punkte`;
        quizjagdPointsDisplay.style.display = 'block'; // Show points display
        
        // Set question text
        document.getElementById('quizjagdQuestionText').textContent = question.question;
        
        // Hide the difficulty label (now shown in header)
        document.getElementById('quizjagdDifficulty').style.display = 'none';
        
        // Set answer text
        document.getElementById('quizjagdAnswerText').textContent = question.answer;
        quizjagdAnswer.classList.add('hidden');
        quizjagdCorrectButtons.style.display = 'none';
        
        // Setup correct/incorrect buttons
        const correctButton = document.getElementById('quizjagdCorrectButton');
        const incorrectButton = document.getElementById('quizjagdIncorrectButton');
        
        correctButton.onclick = (e) => {
            e.stopPropagation();
            // Visual feedback
            correctButton.style.transform = 'scale(1.1)';
            correctButton.style.boxShadow = '0 0 30px rgba(67, 233, 123, 0.8)';
            incorrectButton.style.opacity = '0.3';
            // Disable buttons to prevent double-click
            correctButton.disabled = true;
            incorrectButton.disabled = true;
            // Mark answer after visual feedback
            setTimeout(() => {
                this.markAnswer(true, question);
            }, 300);
        };
        
        incorrectButton.onclick = (e) => {
            e.stopPropagation();
            // Visual feedback
            incorrectButton.style.transform = 'scale(1.1)';
            incorrectButton.style.boxShadow = '0 0 30px rgba(245, 87, 108, 0.8)';
            correctButton.style.opacity = '0.3';
            // Disable buttons to prevent double-click
            correctButton.disabled = true;
            incorrectButton.disabled = true;
            // Mark answer after visual feedback
            setTimeout(() => {
                this.markAnswer(false, question);
            }, 300);
        };
        
        // Reset button states
        correctButton.style.transform = 'scale(1)';
        correctButton.style.boxShadow = '';
        correctButton.style.opacity = '1';
        correctButton.disabled = false;
        incorrectButton.style.transform = 'scale(1)';
        incorrectButton.style.boxShadow = '';
        incorrectButton.style.opacity = '1';
        incorrectButton.disabled = false;
    }

    markAnswer(isCorrect, question) {
        // Update points only if not an example question
        if (!question.isExample) {
            let currentPoints = parseInt(localStorage.getItem(`${this.currentTeam}Points`)) || 0;
            
            if (isCorrect) {
                currentPoints += this.currentBet;
            } else {
                currentPoints -= this.currentBet;
                // Don't allow negative points
                if (currentPoints < 0) {
                    currentPoints = 0;
                }
            }
            
            localStorage.setItem(`${this.currentTeam}Points`, currentPoints);
            document.getElementById(`${this.currentTeam}Points`).textContent = currentPoints;
            
            // Increment question count for current team (only for non-example questions)
            if (this.currentTeam === 'team1') {
                this.team1QuestionsAnswered++;
            } else {
                this.team2QuestionsAnswered++;
            }
            
            // Switch teams (only for non-example questions)
            this.currentTeam = this.currentTeam === 'team1' ? 'team2' : 'team1';
        }
        
        // Check if game should continue
        if (this.checkGameEnd()) {
            return;
        }
        
        // Show next betting screen after short delay
        setTimeout(() => {
            this.showBettingScreen();
        }, 1000);
    }

    checkGameEnd() {
        // Check if both teams have answered 5 questions
        if (this.team1QuestionsAnswered >= this.questionsPerTeam && 
            this.team2QuestionsAnswered >= this.questionsPerTeam) {
            this.showNextGameScreen();
            return true;
        }
        
        return false;
    }

    showNextGameScreen() {
        this.hideAllScreens();
        document.getElementById('nextGameScreen').style.display = 'block';
        
        const nextGameBtn = document.getElementById('nextGameButton');
        
        // Check if this is the last game
        if (this.currentGameIndex >= this.totalGames - 1) {
            nextGameBtn.textContent = 'Weiter zum Ergebnis';
        } else {
            nextGameBtn.textContent = 'Weiter zum nächsten Spiel';
        }
        
        nextGameBtn.onclick = (e) => {
            e.stopPropagation();
            this.nextGame();
        };
    }
}
