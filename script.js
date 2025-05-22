let users = JSON.parse(localStorage.getItem("users") || "{}");
let guesses = JSON.parse(localStorage.getItem("guesses") || "{}");
let actualResults = JSON.parse(localStorage.getItem("actualResults") || "{}");
let currentUser = null;

// Course mapping for display names
const courseNames = {
  "bio-f111": "BIO F111 - General Biology",
  "chem-f111": "CHEM F111 - General Chemistry",
  "math-f111": "MATH F111 - Mathematics I",
  "phy-f111": "PHY F111 - Mechanics, Oscillations & Waves",
  "bits-f110": "BITS F110 - Engineering Graphics",
  "math-f112": "MATH F112 - Mathematics II",
  "me-f112": "ME F112 - Workshop Practice",
  "cs-f111": "CS F111 - Computer Programming",
  "eee-f111": "EEE F111 - Electrical Sciences",
  "bits-f112": "BITS F112 - Technical Report Writing",
  "math-f113": "MATH F113 - Probability and Statistics",
  "bits-f111": "BITS F111 - Thermodynamics",
};

function login() {
  const username = document.getElementById("username").value.trim();
  const password = document.getElementById("password").value.trim();

  if (!username || !password) {
    showMessage(
      "loginMessage",
      "Please enter both username and password",
      "error"
    );
    return;
  }

  if (!users[username]) {
    users[username] = password;
    localStorage.setItem("users", JSON.stringify(users));
    showMessage(
      "loginMessage",
      "Account created successfully! Welcome to the competition! 🎉",
      "success"
    );
  } else if (users[username] !== password) {
    showMessage(
      "loginMessage",
      "Incorrect password. Please try again.",
      "error"
    );
    return;
  } else {
    showMessage("loginMessage", "Welcome back! 👋", "success");
  }

  setTimeout(() => {
    currentUser = username;
    document.getElementById("currentUser").textContent = username;
    document.getElementById("loginSection").classList.add("hidden");
    document.getElementById("mainContent").classList.remove("hidden");
    loadUserGuesses();
  }, 1000);
}

function logout() {
  currentUser = null;
  document.getElementById("loginSection").classList.remove("hidden");
  document.getElementById("mainContent").classList.add("hidden");
  document.getElementById("username").value = "";
  document.getElementById("password").value = "";
  hideMessage("loginMessage");
}

function saveGuess(course) {
  const midsemValue = document.getElementById(`${course}-midsem`).value;
  const compreValue = document.getElementById(`${course}-compre`).value;

  if (!midsemValue && !compreValue) {
    showMessage(
      "loginMessage",
      "Please enter at least one prediction for " + courseNames[course],
      "error"
    );
    setTimeout(() => hideMessage("loginMessage"), 3000);
    return;
  }

  if (!guesses[currentUser]) {
    guesses[currentUser] = {};
  }

  guesses[currentUser][course] = {
    midsem: midsemValue ? parseFloat(midsemValue) : null,
    compre: compreValue ? parseFloat(compreValue) : null,
    timestamp: new Date().toISOString(),
  };

  localStorage.setItem("guesses", JSON.stringify(guesses));

  updateCurrentGuessDisplay(course);
  showMessage(
    "loginMessage",
    `Prediction saved for ${courseNames[course]}! 🎯`,
    "success"
  );
  setTimeout(() => hideMessage("loginMessage"), 2000);
}

function loadUserGuesses() {
  if (!guesses[currentUser]) return;

  for (const course in guesses[currentUser]) {
    const guess = guesses[currentUser][course];
    if (guess.midsem !== null) {
      const midsemInput = document.getElementById(`${course}-midsem`);
      if (midsemInput) midsemInput.value = guess.midsem;
    }
    if (guess.compre !== null) {
      const compreInput = document.getElementById(`${course}-compre`);
      if (compreInput) compreInput.value = guess.compre;
    }
    updateCurrentGuessDisplay(course);
  }
}

function updateCurrentGuessDisplay(course) {
  const currentDiv = document.getElementById(`${course}-current`);
  const guess = guesses[currentUser] && guesses[currentUser][course];

  if (guess && currentDiv) {
    let text = "✅ Your predictions: ";
    const predictions = [];
    if (guess.midsem !== null) predictions.push(`Midsem: ${guess.midsem}`);
    if (guess.compre !== null) predictions.push(`Compre: ${guess.compre}`);
    text += predictions.join(", ");

    currentDiv.textContent = text;
    currentDiv.classList.remove("hidden");
  }
}

function setActualResult() {
  const course = document.getElementById("admin-course").value;
  const examType = document.getElementById("admin-exam").value;
  const average = document.getElementById("admin-average").value;

  if (!average) {
    showMessage("loginMessage", "Please enter the actual average", "error");
    setTimeout(() => hideMessage("loginMessage"), 3000);
    return;
  }

  if (!actualResults[course]) {
    actualResults[course] = {};
  }

  actualResults[course][examType] = parseFloat(average);
  localStorage.setItem("actualResults", JSON.stringify(actualResults));

  document.getElementById("admin-average").value = "";
  calculateAndShowResults();

  showMessage(
    "loginMessage",
    `✅ Result set for ${courseNames[course]} ${examType}: ${average}`,
    "success"
  );
  setTimeout(() => hideMessage("loginMessage"), 3000);
}

function calculateAndShowResults() {
  const resultsSection = document.getElementById("resultsSection");
  const resultsContent = document.getElementById("resultsContent");

  if (Object.keys(actualResults).length === 0) {
    resultsSection.classList.add("hidden");
    return;
  }

  resultsSection.classList.remove("hidden");
  resultsContent.innerHTML = "";

  for (const course in actualResults) {
    for (const examType in actualResults[course]) {
      const actualAvg = actualResults[course][examType];
      const participants = [];

      for (const username in guesses) {
        if (
          guesses[username][course] &&
          guesses[username][course][examType] !== null
        ) {
          const userGuess = guesses[username][course][examType];
          const difference = Math.abs(actualAvg - userGuess);
          participants.push({
            username: username,
            guess: userGuess,
            difference: difference,
          });
        }
      }

      if (participants.length > 0) {
        participants.sort((a, b) => a.difference - b.difference);

        const courseDiv = document.createElement("div");
        courseDiv.style.marginBottom = "30px";
        courseDiv.innerHTML = `
                            <h4 style="color: #f1f5f9; margin: 20px 0 15px 0; font-size: 1.3em; font-weight: 600;">
                                ${courseNames[course]} - ${
          examType.charAt(0).toUpperCase() + examType.slice(1)
        }
                            </h4>
                            <p style="margin-bottom: 20px; font-weight: 600; color: #22c55e; font-size: 1.1em;">
                                🎯 Actual Average: ${actualAvg}
                            </p>
                        `;

        participants.forEach((participant, index) => {
          const participantDiv = document.createElement("div");
          participantDiv.className =
            index === 0 ? "winner-card" : "participant-card";

          const rank = index + 1;
          const medal =
            rank === 1
              ? "🥇"
              : rank === 2
              ? "�"
              : rank === 3
              ? "🥉"
              : `#${rank}`;

          participantDiv.innerHTML = `
                                <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 10px;">
                                    <div style="font-weight: 600; font-size: 1.1em;">
                                        ${medal} ${participant.username}
                                    </div>
                                    <div style="font-size: 0.95em; color: ${
                                      index === 0 ? "#6ee7b7" : "#94a3b8"
                                    };">
                                        Guessed: ${
                                          participant.guess
                                        } | Difference: ${participant.difference.toFixed(
            2
          )}
                                        ${index === 0 ? " 🏆" : ""}
                                    </div>
                                </div>
                            `;
          courseDiv.appendChild(participantDiv);
        });

        resultsContent.appendChild(courseDiv);
      }
    }
  }
}

function showMessage(elementId, message, type) {
  const msgElement = document.getElementById(elementId);
  msgElement.textContent = message;
  msgElement.className = `status-message status-${type}`;
  msgElement.classList.remove("hidden");
}

function hideMessage(elementId) {
  document.getElementById(elementId).classList.add("hidden");
}

// Handle enter key in login form
document.getElementById("username").addEventListener("keypress", function (e) {
  if (e.key === "Enter") login();
});

document.getElementById("password").addEventListener("keypress", function (e) {
  if (e.key === "Enter") login();
});

// Load results on page load
calculateAndShowResults();
