document.addEventListener('DOMContentLoaded', function() {
    const nameForm = document.getElementById('nameForm');
    if (nameForm) {
        nameForm.addEventListener('submit', function(event) {
            event.preventDefault();
            const nameInput = document.getElementById('nameInput');
            const names = nameInput.value.split(',').map(name => name.trim()).filter(name => name);
            if (names.length > 0) {
                assignToTeams(names);
                nameInput.value = '';
            }
        });
    }

    // Game 1 specific code
    const showAnswerButtonGame1 = document.getElementById('showAnswerButton');
    const nextQuestionButtonGame1 = document.getElementById('nextQuestionButton');
    if (showAnswerButtonGame1 && nextQuestionButtonGame1) {
        let currentQuestionIndexGame1 = 0;
        let configGame1;

        async function showQuestionGame1() {
            if (!configGame1) {
                configGame1 = await loadConfig();
            }
            const questionElement = document.getElementById('quizQuestion');
            const answerElement = document.getElementById('quizAnswer');
            const question = configGame1.game1.questions[currentQuestionIndexGame1];
            questionElement.textContent = question.question;
            answerElement.textContent = question.answer;
            answerElement.style.display = 'none';
            showAnswerButtonGame1.style.display = 'block';
            nextQuestionButtonGame1.style.display = 'none';
            document.getElementById('questionNumber').textContent = `Question ${currentQuestionIndexGame1 + 1}`;
        }

        showAnswerButtonGame1.addEventListener('click', function() {
            document.getElementById('quizAnswer').style.display = 'block';
            showAnswerButtonGame1.style.display = 'none';
            nextQuestionButtonGame1.style.display = 'block';
        });

        nextQuestionButtonGame1.addEventListener('click', function() {
            currentQuestionIndexGame1++;
            if (currentQuestionIndexGame1 < configGame1.game1.questions.length) {
                showQuestionGame1();
            } else {
                document.getElementById('awardPointsContainer').style.display = 'block';
                document.getElementById('gameScreen').style.display = 'none';
            }
        });

        showQuestionGame1();
    }

    // Game 2 specific code
    const showAudioButton = document.getElementById('showAudioButton');
    const repeatAudioButton = document.getElementById('repeatAudioButton');
    const nextAudioButton = document.getElementById('nextAudioButton');
    const revealAnswerButton = document.getElementById('revealAnswerButton');
    const audioQuestionNumberElement = document.getElementById('audioQuestionNumber');
    const audioAnswerElement = document.getElementById('audioAnswer');
    if (showAudioButton && nextAudioButton && repeatAudioButton && revealAnswerButton) {
        let currentAudioIndex = 0;
        let configGame2;

        async function loadQuestionsGame2() {
            const response = await fetch('/api/music-subfolders');
            const subfolders = await response.json();
            configGame2 = { questions: subfolders.map((folder, index) => ({
                shortAudioFile: `music/${folder}/short.wav`,
                longAudioFile: `music/${folder}/long.wav`,
                songName: `Question ${index + 1}`,
                answer: folder
            })) };
        }

        async function showAudio() {
            if (!configGame2) {
                await loadQuestionsGame2();
            }
            const question = configGame2.questions[currentAudioIndex];
            const audioElement = document.getElementById('quizAudio');
            audioElement.src = question.shortAudioFile;
            audioElement.style.display = 'block';
            audioAnswerElement.style.display = 'none';
            showAudioButton.style.display = 'block';
            repeatAudioButton.style.display = 'none';
            nextAudioButton.style.display = 'none';
            revealAnswerButton.style.display = 'none';
            audioQuestionNumberElement.textContent = `Audio Clip ${currentAudioIndex + 1}`;
        }

        showAudioButton.addEventListener('click', function() {
            const audioElement = document.getElementById('quizAudio');
            audioElement.play();
            repeatAudioButton.style.display = 'block';
            revealAnswerButton.style.display = 'block';
            showAudioButton.style.display = 'none';
        });

        repeatAudioButton.addEventListener('click', function() {
            const audioElement = document.getElementById('quizAudio');
            audioElement.currentTime = 0;
            audioElement.play();
        });

        revealAnswerButton.addEventListener('click', function() {
            const question = configGame2.questions[currentAudioIndex];
            audioAnswerElement.textContent = question.answer;
            audioAnswerElement.style.display = 'block';
            repeatAudioButton.style.display = 'none';
            nextAudioButton.style.display = 'block';
            revealAnswerButton.style.display = 'none';
        });

        nextAudioButton.addEventListener('click', function() {
            currentAudioIndex++;
            if (currentAudioIndex < configGame2.questions.length) {
                showAudio();
            } else {
                document.getElementById('awardPointsContainer').style.display = 'block';
                document.getElementById('gameScreen').style.display = 'none';
            }
        });

        showAudio();
    }

    // Game 3 specific code
    const guessFormGame3 = document.getElementById('guessForm');
    const nextQuestionButtonGame3 = document.getElementById('nextQuestionButton');
    if (guessFormGame3 && nextQuestionButtonGame3) {
        let currentQuestionIndexGame3 = 0;
        let configGame3;

        async function showQuestionGame3() {
            if (!configGame3) {
                configGame3 = await loadConfig();
            }
            const questionElement = document.getElementById('quizQuestion');
            const question = configGame3.game3.questions[currentQuestionIndexGame3];
            questionElement.textContent = question.question;
            document.getElementById('quizAnswer').style.display = 'none';
            guessFormGame3.style.display = 'block';
            nextQuestionButtonGame3.style.display = 'none';
            document.getElementById('questionNumber').textContent = `Question ${currentQuestionIndexGame3 + 1}`;
            document.getElementById('team1Guess').value = '';
            document.getElementById('team2Guess').value = '';
        }

        guessFormGame3.addEventListener('submit', function(event) {
            event.preventDefault();
            const team1Guess = parseInt(document.getElementById('team1Guess').value);
            const team2Guess = parseInt(document.getElementById('team2Guess').value);
            const correctAnswer = configGame3.game3.questions[currentQuestionIndexGame3].answer;
            const team1Difference = Math.abs(team1Guess - correctAnswer);
            const team2Difference = Math.abs(team2Guess - correctAnswer);

            let resultMessage = `
                <div class="result-row"><strong>Correct Answer:</strong> ${correctAnswer}</div>
                <div class="result-row"><strong>Team 1 Guess:</strong> ${team1Guess}</div>
                <div class="result-row"><strong>Team 2 Guess:</strong> ${team2Guess}</div>
            `;

            if (team1Difference < team2Difference) {
                team1Points++;
                resultMessage += "<div class='result-row winner centered'><strong>Team 1 was closer!</strong></div>";
            } else if (team2Difference < team1Difference) {
                team2Points++;
                resultMessage += "<div class='result-row winner centered'><strong>Team 2 was closer!</strong></div>";
            } else {
                resultMessage += "<div class='result-row winner centered'><strong>Both teams were equally close!</strong></div>";
            }

            document.getElementById('quizAnswer').innerHTML = resultMessage;
            document.getElementById('quizAnswer').style.display = 'block';
            guessFormGame3.style.display = 'none';
            nextQuestionButtonGame3.style.display = 'block';
        });

        nextQuestionButtonGame3.addEventListener('click', function() {
            currentQuestionIndexGame3++;
            if (currentQuestionIndexGame3 < configGame3.game3.questions.length) {
                showQuestionGame3();
            } else {
                document.getElementById('awardPointsContainer').style.display = 'block';
                document.getElementById('gameScreen').style.display = 'none';
            }
        });

        showQuestionGame3();
    }

    // Game 4 specific code
    const showAnswerButtonGame4 = document.getElementById('showAnswerButton');
    const nextQuestionButtonGame4 = document.getElementById('nextQuestionButton');
    if (showAnswerButtonGame4 && nextQuestionButtonGame4) {
        let currentQuestionIndexGame4 = 0;
        let configGame4;

        async function showQuestionGame4() {
            if (!configGame4) {
                configGame4 = await loadConfig();
            }
            const statementsElement = document.getElementById('quizStatements');
            const question = configGame4.game4.questions[currentQuestionIndexGame4];
            statementsElement.innerHTML = question.statements.map(statement => `<div>${statement}</div>`).join('');
            document.getElementById('quizAnswer').style.display = 'none';
            showAnswerButtonGame4.style.display = 'block';
            nextQuestionButtonGame4.style.display = 'none';
            document.getElementById('questionNumber').textContent = `Question ${currentQuestionIndexGame4 + 1}`;
        }

        showAnswerButtonGame4.addEventListener('click', function() {
            const answerElement = document.getElementById('quizAnswer');
            const question = configGame4.questions[currentQuestionIndexGame4];
            answerElement.textContent = `Answer: ${question.answer}`;
            answerElement.style.display = 'block';

            showAnswerButtonGame4.style.display = 'none';
            nextQuestionButtonGame4.style.display = 'block';
        });

        nextQuestionButtonGame4.addEventListener('click', function() {
            currentQuestionIndexGame4++;
            if (currentQuestionIndexGame4 < configGame4.questions.length) {
                showQuestionGame4();
            } else {
                document.getElementById('awardPointsContainer').style.display = 'block';
                document.getElementById('gameScreen').style.display = 'none';
            }
        });

        showQuestionGame4();
    }

    // Load teams and points from localStorage on page load
    const team1Points = document.getElementById('team1Points');
    const team2Points = document.getElementById('team2Points');
    if (team1Points && team2Points) {
        window.addEventListener('load', function() {
            const team1 = JSON.parse(localStorage.getItem('team1')) || [];
            const team2 = JSON.parse(localStorage.getItem('team2')) || [];

            const team1List = document.getElementById('team1List');
            const team2List = document.getElementById('team2List');

            if (team1List && team2List) {
                team1.forEach(name => {
                    const listItem = document.createElement('li');
                    listItem.textContent = name;
                    team1List.appendChild(listItem);
                });

                team2.forEach(name => {
                    const listItem = document.createElement('li');
                    listItem.textContent = name;
                    team2List.appendChild(listItem);
                });
            }

            // Load points from localStorage
            team1Points.textContent = localStorage.getItem('team1Points') || 0;
            team2Points.textContent = localStorage.getItem('team2Points') || 0;
        });
    }

    // Function to track correct answers
    window.markCorrectAnswer = function(team) {
        if (team === 'team1') {
            team1CorrectAnswers++;
        } else if (team === 'team2') {
            team2CorrectAnswers++;
        }

        // Disable award points buttons
        document.querySelectorAll('#awardPointsContainer button').forEach(button => {
            button.disabled = true;
        });
    };
});

function assignToTeams(names) {
    const team1List = document.getElementById('team1List');
    const team2List = document.getElementById('team2List');
    if (team1List && team2List) {
        team1List.innerHTML = '';
        team2List.innerHTML = '';

        // Shuffle names array
        names.sort(() => Math.random() - 0.5);

        const team1 = [];
        const team2 = [];

        names.forEach((name, index) => {
            const listItem = document.createElement('li');
            listItem.textContent = name;
            if (index % 2 === 0) {
                team1List.appendChild(listItem);
                team1.push(name);
            } else {
                team2List.appendChild(listItem);
                team2.push(name);
            }
        });

        // Save teams to localStorage
        localStorage.setItem('team1', JSON.stringify(team1));
        localStorage.setItem('team2', JSON.stringify(team2));
    }
}

// Function to update points
function updatePoints(team, points, gameNumber) {
    const currentPoints = parseInt(localStorage.getItem(`${team}Points`)) || 0;
    const newPoints = currentPoints + points * gameNumber;
    localStorage.setItem(`${team}Points`, newPoints);
    document.getElementById(`${team}Points`).textContent = newPoints;

    // Update points in header
    document.querySelectorAll('header div span').forEach(span => {
        if (span.id === `${team}Points`) {
            span.textContent = newPoints;
        }
    });
}
