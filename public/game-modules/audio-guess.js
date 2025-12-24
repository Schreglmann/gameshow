/**
 * Music Game Module (Type: music)
 * Music recognition quiz game
 */
class MusicGame extends BaseGame {
    constructor(config, gameId, currentGameIndex, totalGames) {
        super(config, gameId, currentGameIndex, totalGames);
    }

    init() {
        super.init();
        console.log('Music game initialized');
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

        // Build audio file paths
        const shortAudioPath = `/music/${encodeURIComponent(question.folder)}/short.wav`;
        const longAudioPath = `/music/${encodeURIComponent(question.folder)}/long.wav`;
        
        // Display question with playback controls
        questionElement.innerHTML = `
            <strong>Welcher Song ist das?</strong><br><br>
            <audio id="musicAudio" autoplay style="display: none;">
                <source src="${shortAudioPath}" type="audio/wav">
                <source src="${shortAudioPath.replace('.wav', '.mp3')}" type="audio/mpeg">
            </audio>
            <div style="display: flex; gap: 10px; justify-content: center; flex-wrap: wrap; margin-top: 20px;">
                <button class="music-control-button" onclick="document.getElementById('musicAudio').currentTime = 0; document.getElementById('musicAudio').play();">
                    Ausschnitt wiederholen
                </button>
                <button class="music-control-button" onclick="var audio = document.getElementById('musicAudio'); audio.src = '${longAudioPath}'; audio.play();">
                    Ganzer Song
                </button>
            </div>
        `;
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
