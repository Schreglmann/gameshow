/**
 * Quiz Game Module (Type: quiz)
 * Standard quiz game where teams answer questions
 */
class QuizGame extends BaseGame {
    constructor(config, gameId, currentGameIndex, totalGames) {
        super(config, gameId, currentGameIndex, totalGames);
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
            
            if (answerElement.classList.contains('hidden')) {
                // Show answer
                answerElement.classList.remove('hidden');
                
                // Play audio if present
                const audioElement = answerElement.querySelector('audio');
                if (audioElement) {
                    audioElement.play();
                }
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
        const totalQuestions = this.config.questions.length - 1; // Subtract example question
        document.getElementById('totalQuestions').textContent = totalQuestions;
    }

    showQuestion() {
        const question = this.config.questions[this.currentQuestionIndex];
        const questionElement = document.getElementById('quizQuestion');
        const answerElement = document.getElementById('quizAnswer');
        const questionNumberElement = document.getElementById('questionNumber');

        questionElement.textContent = question.question;
        
        // Check if question contains actual words (2+ letter sequences) vs just emojis/symbols
        const hasWords = /[a-zA-Z]{2,}/.test(question.question);
        if (!hasWords && question.question.trim().length > 0) {
            questionElement.style.fontSize = '120px';
            questionElement.style.lineHeight = '1.2';
        } else {
            questionElement.style.fontSize = '';
            questionElement.style.lineHeight = '';
        }
        
        // Check if question has an answerList
        if (question.answerList && Array.isArray(question.answerList)) {
            // Create container with flexbox for list and image side by side
            let containerHTML = '<div style="display: flex; align-items: center; justify-content: space-between; gap: 40px; width: 100%; max-width: 1000px; margin: 0 auto;">';
            
            // Left side: answer list
            containerHTML += '<ul style="text-align: left; list-style: none; padding: 0; margin: 0; flex: 1 1 auto;">';
            question.answerList.forEach(item => {
                // Extract the number and text (e.g., "2. Saturn" -> check if it contains the answer)
                const itemWithoutNumber = item.substring(item.indexOf('.') + 1).trim();
                if (itemWithoutNumber === question.answer || item.includes(question.answer)) {
                    containerHTML += `<li style="margin: 10px 0;"><strong>${item}</strong></li>`;
                } else {
                    containerHTML += `<li style="margin: 10px 0;">${item}</li>`;
                }
            });
            containerHTML += '</ul>';
            
            // Right side: image if provided
            if (question.answerImage) {
                containerHTML += `<img src="${question.answerImage}" alt="Answer Image" style="max-width: 400px; max-height: 300px; border-radius: 15px; object-fit: contain; flex: 0 0 auto; cursor: pointer;" onclick="event.stopPropagation(); openImageLightbox('${question.answerImage}');">`;
            }
            
            containerHTML += '</div>';
            
            // Audio player if provided (hidden, plays on reveal)
            if (question.answerAudio) {
                containerHTML += `<audio style="display: none;"><source src="${question.answerAudio}" type="audio/mpeg">Your browser does not support the audio element.</audio>`;
            }
            
            answerElement.innerHTML = containerHTML;
        } else {
            // Simple text answer - show image below/outside the green box
            let containerHTML = question.answer;
            
            // Audio player if provided (hidden, plays on reveal)
            if (question.answerAudio) {
                containerHTML += `<audio style="display: none;"><source src="${question.answerAudio}" type="audio/mpeg">Your browser does not support the audio element.</audio>`;
            }
            
            // Show image below the answer text (outside green box styling)
            if (question.answerImage) {
                containerHTML += `<div style="margin-top: 30px;"><img src="${question.answerImage}" alt="Answer Image" style="max-width: 600px; max-height: 400px; border-radius: 15px; object-fit: contain; cursor: pointer;" onclick="event.stopPropagation(); openImageLightbox('${question.answerImage}');"></div>`;
            }
            
            answerElement.innerHTML = containerHTML;
        }
        
        answerElement.classList.add('hidden'); // Use class instead of inline style

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
