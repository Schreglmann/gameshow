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

    const showAnswerButton = document.getElementById('showAnswerButton');
    const nextQuestionButton = document.getElementById('nextQuestionButton');
    const awardPointsContainer = document.getElementById('awardPointsContainer');
    if (showAnswerButton && nextQuestionButton) {
        const questions = [
            { question: "Question1", answer: "answer1" },
            { question: "question2", answer: "ans2" },
            { question: "question3", answer: "a3" }
        ];

        let currentQuestionIndex = 0;

        function showQuestion() {
            const questionElement = document.getElementById('quizQuestion');
            const answerElement = document.getElementById('quizAnswer');
            questionElement.textContent = questions[currentQuestionIndex].question;
            answerElement.textContent = questions[currentQuestionIndex].answer;
            answerElement.style.display = 'none';
            awardPointsContainer.style.display = 'none';
        }

        showAnswerButton.addEventListener('click', function() {
            document.getElementById('quizAnswer').style.display = 'block';
        });

        nextQuestionButton.addEventListener('click', function() {
            currentQuestionIndex++;
            if (currentQuestionIndex < questions.length) {
                showQuestion();
            } else {
                awardPointsContainer.style.display = 'block';
            }
        });

        showQuestion();
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
function updatePoints(team, points) {
    const currentPoints = parseInt(localStorage.getItem(`${team}Points`)) || 0;
    const newPoints = currentPoints + points;
    localStorage.setItem(`${team}Points`, newPoints);
    document.getElementById(`${team}Points`).textContent = newPoints;

    // Update points in header
    document.querySelectorAll('header div span').forEach(span => {
        if (span.id === `${team}Points`) {
            span.textContent = newPoints;
        }
    });

    // Disable award points buttons
    document.querySelectorAll('#awardPointsContainer button').forEach(button => {
        button.disabled = true;
    });
}
