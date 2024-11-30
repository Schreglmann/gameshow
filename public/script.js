document.getElementById('nameForm').addEventListener('submit', function(event) {
    event.preventDefault();
    const nameInput = document.getElementById('nameInput');
    const names = nameInput.value.split(',').map(name => name.trim()).filter(name => name);
    if (names.length > 0) {
        assignToTeams(names);
        nameInput.value = '';
    }
});

function assignToTeams(names) {
    const team1List = document.getElementById('team1List');
    const team2List = document.getElementById('team2List');
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

// Load teams and points from localStorage on page load
window.addEventListener('load', function() {
    const team1 = JSON.parse(localStorage.getItem('team1')) || [];
    const team2 = JSON.parse(localStorage.getItem('team2')) || [];

    const team1List = document.getElementById('team1List');
    const team2List = document.getElementById('team2List');

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

    // Load points from localStorage
    document.getElementById('team1Points').textContent = localStorage.getItem('team1Points') || 0;
    document.getElementById('team2Points').textContent = localStorage.getItem('team2Points') || 0;
});

// Function to update points
function updatePoints(team, points) {
    const currentPoints = parseInt(localStorage.getItem(`${team}Points`)) || 0;
    const newPoints = currentPoints + points;
    localStorage.setItem(`${team}Points`, newPoints);
    document.getElementById(`${team}Points`).textContent = newPoints;
}
