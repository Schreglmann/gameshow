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
                // Show answer and play full song
                answerElement.classList.remove('hidden');
                
                // Get the current question and play the full song
                const question = this.config.questions[this.currentQuestionIndex];
                const longAudioPath = `/audio-guess/${encodeURIComponent(question.folder)}/long.wav`;
                const audio = document.getElementById('musicAudio');
                if (audio) {
                    // Pause current audio first
                    audio.pause();
                    audio.currentTime = 0;
                    // Change source and wait for it to be ready
                    audio.src = longAudioPath;
                    audio.load();
                    audio.play().catch(err => console.log('Audio play prevented:', err));
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
        const totalQuestions = this.config.questions.length - 1;
        document.getElementById('totalQuestions').textContent = totalQuestions;
    }

    showQuestion() {
        const question = this.config.questions[this.currentQuestionIndex];
        const questionElement = document.getElementById('quizQuestion');
        const answerElement = document.getElementById('quizAnswer');
        const questionNumberElement = document.getElementById('questionNumber');

        // Stop and cleanup any existing audio before creating new one
        const existingAudio = document.getElementById('musicAudio');
        if (existingAudio) {
            existingAudio.pause();
            existingAudio.src = '';
            existingAudio.load();
        }

        // Build audio file paths - try multiple formats
        const shortAudioPath = `/audio-guess/${encodeURIComponent(question.folder)}/short`;
        const longAudioPath = `/audio-guess/${encodeURIComponent(question.folder)}/long`;
        
        // Display question with playback controls
        questionElement.innerHTML = `
            <strong>Welcher Song ist das?</strong><br><br>
            <audio id="musicAudio" style="display: none;">
                <source src="${shortAudioPath}.wav" type="audio/wav">
                <source src="${shortAudioPath}.mp3" type="audio/mpeg">
                <source src="${shortAudioPath}.opus" type="audio/opus">
            </audio>
            <div style="display: flex; gap: 10px; justify-content: center; flex-wrap: wrap; margin-top: 20px;">
                <button class="music-control-button" onclick="var audio = document.getElementById('musicAudio'); audio.pause(); audio.currentTime = 0; audio.load(); audio.play().catch(err => console.log('Play error:', err));">
                    Ausschnitt wiederholen
                </button>
                <button class="music-control-button" onclick="var audio = document.getElementById('musicAudio'); audio.pause(); audio.innerHTML = '<source src=\\'${longAudioPath}.wav\\' type=\\'audio/wav\\'><source src=\\'${longAudioPath}.mp3\\' type=\\'audio/mpeg\\'><source src=\\'${longAudioPath}.opus\\' type=\\'audio/opus\\'>'; audio.load(); audio.play().catch(err => console.log('Play error:', err));">
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
        
        // Manually play the audio after the element is created
        setTimeout(() => {
            const audio = document.getElementById('musicAudio');
            if (audio) {
                audio.play().catch(err => console.log('Autoplay error:', err));
            }
        }, 100);
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
