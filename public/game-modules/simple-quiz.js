/**
 * Quiz Game Module (Type: quiz)
 * Standard quiz game where teams answer questions
 */
class QuizGame extends BaseGame {
    constructor(config, gameId, currentGameIndex, totalGames) {
        super(config, gameId, currentGameIndex, totalGames);
        this.timerInterval = null;
        this.timerElement = null;
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
                // Stop timer when showing answer
                this.stopTimer();
                
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

    handleBackNavigation() {
        if (this.isVisible('rulesScreen')) {
            this.showLanding();
        } else if (this.isVisible('gameScreen')) {
            const answerElement = document.getElementById('quizAnswer');
            
            if (!answerElement.classList.contains('hidden')) {
                // Hide answer if it's showing
                answerElement.classList.add('hidden');
            } else if (this.currentQuestionIndex > 0) {
                // Go back to previous question
                this.currentQuestionIndex--;
                this.showQuestion();
            } else {
                // Go back to rules from first question
                this.showRules();
            }
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

        // Reset any inline styles from previous games
        questionElement.style.fontSize = '';
        questionElement.style.lineHeight = '';
        
        // Build question content
        let questionContent = question.question;
        
        // Add question image if provided
        if (question.questionImage) {
            questionContent += `<div style="margin-top: 20px;"><img src="${question.questionImage}" alt="Question Image" style="max-width: 600px; max-height: 400px; border-radius: 15px; object-fit: contain; cursor: pointer;" onclick="event.stopPropagation(); openImageLightbox('${question.questionImage}');"></div>`;
        }
        
        questionElement.innerHTML = questionContent;
        
        // Check if question text contains actual words (2+ letter sequences) vs just emojis/symbols
        const hasWords = /[a-zA-Z]{2,}/.test(question.question);
        if (!hasWords && question.question.trim().length > 0) {
            questionElement.style.fontSize = '120px';
            questionElement.style.lineHeight = '1.2';
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
        
        // Handle timer if specified
        this.stopTimer();
        if (question.timer && question.timer > 0) {
            this.startTimer(question.timer);
        } else {
            this.hideTimer();
        }
    }
    
    startTimer(seconds) {
        // Clear any existing timer
        this.stopTimer();
        
        // Remove existing timer element to start fresh
        if (this.timerElement && this.timerElement.parentNode) {
            this.timerElement.parentNode.removeChild(this.timerElement);
            this.timerElement = null;
        }
        
        // Create new timer element
        const timerContainer = document.createElement('div');
        timerContainer.id = 'questionTimer';
        timerContainer.style.cssText = 'position: fixed; bottom: 30px; left: 30px; background: rgba(76, 217, 100, 0.95); color: white; padding: 20px 30px; border-radius: 15px; font-size: 48px; font-weight: bold; z-index: 1000; box-shadow: 0 8px 32px rgba(76, 217, 100, 0.5); border: 2px solid rgba(255, 255, 255, 0.3); transition: background 0.3s ease, box-shadow 0.3s ease;';
        document.body.appendChild(timerContainer);
        
        this.timerElement = timerContainer;
        let timeLeft = seconds;
        const totalTime = seconds;
        
        // Update display immediately with green color
        this.timerElement.textContent = timeLeft;
        this.timerElement.style.display = 'block';
        this.timerElement.style.background = 'rgba(76, 217, 100, 0.95)';
        this.timerElement.style.boxShadow = '0 8px 32px rgba(76, 217, 100, 0.5)';
        this.timerElement.style.animation = 'none';
        
        // Start countdown
        this.timerInterval = setInterval(() => {
            timeLeft--;
            this.timerElement.textContent = timeLeft;
            
            // Calculate color transition from green to red (only in last 30% of time)
            const timeProgress = 1 - (timeLeft / totalTime); // 0 to 1
            let red, green, blue;
            
            if (timeProgress < 0.7) {
                // Stay green for first 70% of time
                red = 76;
                green = 217;
                blue = 100;
            } else {
                // Transition to red in last 30%
                const colorProgress = (timeProgress - 0.7) / 0.3; // 0 to 1 in last 30%
                red = Math.floor(76 + (255 - 76) * colorProgress);
                green = Math.floor(217 - (217 - 59) * colorProgress);
                blue = Math.floor(100 - (100 - 48) * colorProgress);
            }
            
            this.timerElement.style.background = `rgba(${red}, ${green}, ${blue}, 0.95)`;
            this.timerElement.style.boxShadow = `0 8px 32px rgba(${red}, ${green}, ${blue}, 0.5)`;
            
            // Add pulse animation when time is running low
            if (timeLeft <= 10 && timeLeft > 0) {
                this.timerElement.style.animation = 'pulse 1s infinite';
            }
            
            // Timer finished
            if (timeLeft <= 0) {
                // Play sound at full volume
                const audio = new Audio('/audio/timer-end.mp3');
                audio.volume = 1.0;
                audio.play().catch(err => console.log('Audio play failed:', err));
                
                // Show final animation and message
                this.timerElement.style.animation = 'timerShake 0.5s ease-in-out';
                this.timerElement.textContent = 'ZEIT ABGELAUFEN!';
                this.timerElement.style.fontSize = '36px';
                this.timerElement.style.background = 'rgba(255, 59, 48, 0.95)';
                this.timerElement.style.boxShadow = '0 8px 48px rgba(255, 59, 48, 0.8)';
                
                // Stop interval but keep message visible
                this.stopTimer();
            }
        }, 1000);
    }
    
    stopTimer() {
        if (this.timerInterval) {
            clearInterval(this.timerInterval);
            this.timerInterval = null;
        }
    }
    
    hideTimer() {
        this.stopTimer();
        if (this.timerElement && this.timerElement.parentNode) {
            this.timerElement.parentNode.removeChild(this.timerElement);
            this.timerElement = null;
        }
    }
    
    cleanup() {
        this.stopTimer();
        if (this.timerElement && this.timerElement.parentNode) {
            this.timerElement.parentNode.removeChild(this.timerElement);
            this.timerElement = null;
        }
    }

    showAwardPoints() {
        super.showAwardPoints();

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
