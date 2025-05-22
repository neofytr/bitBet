// Configuration - Set your admin credentials here
const ADMIN_CONFIG = {
  username: "admin",
  password: "admin123",
};

const SERVER_CONFIG = {
  host: "localhost",
  port: "5000",
  get baseUrl() {
    return `http://${this.host}:${this.port}/api`;
  },
};

// Data storage
let users = {};
let guesses = {};
let actualResults = {};
let currentUser = null;
let isAdmin = false;

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

// Course categories for filtering
const courseCategories = {
  "bio-f111": "science",
  "chem-f111": "science",
  "phy-f111": "science",
  "bits-f111": "science",
  "math-f111": "math",
  "math-f112": "math",
  "math-f113": "math",
  "bits-f110": "engineering",
  "me-f112": "engineering",
  "cs-f111": "engineering",
  "eee-f111": "engineering",
  "bits-f112": "engineering",
};

// Initialize page
document.addEventListener("DOMContentLoaded", async function () {
  await loadDataFromServer();
  updateStats();
  calculateAndShowResults();
  setupEventListeners();
});

async function loadDataFromServer() {
  try {
    // Load users
    const usersResponse = await fetch(`${SERVER_CONFIG.baseUrl}/users`);
    if (usersResponse.ok) {
      users = await usersResponse.json();
    }

    // Load guesses
    const guessesResponse = await fetch(`${SERVER_CONFIG.baseUrl}/guesses`);
    if (guessesResponse.ok) {
      guesses = await guessesResponse.json();
    }

    // Load results
    const resultsResponse = await fetch(`${SERVER_CONFIG.baseUrl}/results`);
    if (resultsResponse.ok) {
      actualResults = await resultsResponse.json();
    }

    console.log("Data loaded from server successfully");
  } catch (error) {
    console.error("Error loading data from server:", error);
    showNotification("⚠️ Server connection failed. Using offline mode.");
    // Fall back to localStorage if server is unavailable
    users = JSON.parse(localStorage.getItem("users") || "{}");
    guesses = JSON.parse(localStorage.getItem("guesses") || "{}");
    actualResults = JSON.parse(localStorage.getItem("actualResults") || "{}");
  }
}

async function saveUsersToServer() {
  try {
    const response = await fetch(`${SERVER_CONFIG.baseUrl}/users`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(users),
    });

    if (!response.ok) {
      throw new Error("Failed to save users to server");
    }

    // Also save to localStorage as backup
    localStorage.setItem("users", JSON.stringify(users));
  } catch (error) {
    console.error("Error saving users to server:", error);
    // Fall back to localStorage
    localStorage.setItem("users", JSON.stringify(users));
  }
}

async function saveGuessesToServer() {
  try {
    const response = await fetch(`${SERVER_CONFIG.baseUrl}/guesses`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(guesses),
    });

    if (!response.ok) {
      throw new Error("Failed to save guesses to server");
    }

    // Also save to localStorage as backup
    localStorage.setItem("guesses", JSON.stringify(guesses));
  } catch (error) {
    console.error("Error saving guesses to server:", error);
    // Fall back to localStorage
    localStorage.setItem("guesses", JSON.stringify(guesses));
  }
}

async function saveResultsToServer() {
  try {
    const response = await fetch(`${SERVER_CONFIG.baseUrl}/results`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(actualResults),
    });

    if (!response.ok) {
      throw new Error("Failed to save results to server");
    }

    // Also save to localStorage as backup
    localStorage.setItem("actualResults", JSON.stringify(actualResults));
  } catch (error) {
    console.error("Error saving results to server:", error);
    // Fall back to localStorage
    localStorage.setItem("actualResults", JSON.stringify(actualResults));
  }
}

function setupEventListeners() {
  // Enter key handling
  document
    .getElementById("username")
    .addEventListener("keypress", function (e) {
      if (e.key === "Enter") login();
    });

  document
    .getElementById("password")
    .addEventListener("keypress", function (e) {
      if (e.key === "Enter") login();
    });

  // Auto-save functionality for predictions
  const inputs = document.querySelectorAll('input[type="number"]');
  inputs.forEach((input) => {
    input.addEventListener("blur", function () {
      const courseId = this.id.replace("-midsem", "").replace("-compre", "");
      if (currentUser && !isAdmin) {
        autoSaveGuess(courseId);
      }
    });
  });
}

async function login() {
  const username = document.getElementById("username").value.trim();
  const password = document.getElementById("password").value.trim();
  const adminMode = document.getElementById("adminMode").checked;

  if (!username || !password) {
    showMessage(
      "loginMessage",
      "Please enter both username and password",
      "error"
    );
    return;
  }

  // Check admin login
  if (adminMode) {
    if (
      username === ADMIN_CONFIG.username &&
      password === ADMIN_CONFIG.password
    ) {
      currentUser = username;
      isAdmin = true;
      showLoginSuccess(
        "Admin login successful! Welcome to the control panel! 👑"
      );
    } else {
      showMessage(
        "loginMessage",
        "Invalid admin credentials. Please check your username and password.",
        "error"
      );
      return;
    }
  } else {
    // Regular user login
    if (!users[username]) {
      users[username] = password;
      await saveUsersToServer(); // Use server save instead of localStorage
      showMessage(
        "loginMessage",
        "Account created successfully! Welcome to bitBETS! 🎉",
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

    currentUser = username;
    isAdmin = false;
  }

  setTimeout(() => {
    document.getElementById("currentUser").textContent = username;
    document.getElementById("userRole").textContent = isAdmin
      ? "Administrator"
      : "Student";

    if (isAdmin) {
      document.getElementById("adminBadge").classList.remove("hidden");
      document.getElementById("adminPanel").classList.remove("hidden");
      document.getElementById("userContent").classList.add("hidden");
    } else {
      document.getElementById("adminBadge").classList.add("hidden");
      document.getElementById("adminPanel").classList.add("hidden");
      document.getElementById("userContent").classList.remove("hidden");
      loadUserGuesses();
    }

    document.getElementById("loginSection").classList.add("hidden");
    document.getElementById("mainContent").classList.remove("hidden");
    updateStats();
    updateAdminStats();
  }, 1000);
}

function showLoginSuccess(message) {
  showMessage("loginMessage", message, "success");
  showNotification(message);
}

function logout() {
  currentUser = null;
  isAdmin = false;
  document.getElementById("loginSection").classList.remove("hidden");
  document.getElementById("mainContent").classList.add("hidden");
  document.getElementById("username").value = "";
  document.getElementById("password").value = "";
  document.getElementById("adminMode").checked = false;
  hideMessage("loginMessage");
  showNotification("Logged out successfully! See you next time! 👋");
}

async function saveGuess(course) {
  if (!currentUser || isAdmin) return;

  const midsemValue = document.getElementById(`${course}-midsem`).value;
  const compreValue = document.getElementById(`${course}-compre`).value;

  if (!midsemValue && !compreValue) {
    showMessage(
      "loginMessage",
      `Please enter at least one prediction for ${courseNames[course]}`,
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

  await saveGuessesToServer(); // Use server save instead of localStorage
  saveToFile();

  updateCurrentGuessDisplay(course);
  showMessage(
    "loginMessage",
    `Prediction saved for ${courseNames[course]}! 🎯`,
    "success"
  );
  showNotification(`Prediction saved for ${courseNames[course]}! 🎯`);
  setTimeout(() => hideMessage("loginMessage"), 2000);

  updateStats();
}

async function autoSaveGuess(course) {
  if (!currentUser || isAdmin) return;

  const midsemValue = document.getElementById(`${course}-midsem`).value;
  const compreValue = document.getElementById(`${course}-compre`).value;

  if (!midsemValue && !compreValue) return;

  if (!guesses[currentUser]) {
    guesses[currentUser] = {};
  }

  guesses[currentUser][course] = {
    midsem: midsemValue ? parseFloat(midsemValue) : null,
    compre: compreValue ? parseFloat(compreValue) : null,
    timestamp: new Date().toISOString(),
  };

  await saveGuessesToServer(); // Use server save instead of localStorage
  saveToFile();
  updateCurrentGuessDisplay(course);
}

// Modify the setActualResult function:
async function setActualResult() {
  if (!isAdmin) return;

  const course = document.getElementById("admin-course").value;
  const examType = document.getElementById("admin-exam").value;
  const average = document.getElementById("admin-average").value;

  if (!average || isNaN(average) || average < 0 || average > 100) {
    showMessage(
      "loginMessage",
      "Please enter a valid average between 0 and 100",
      "error"
    );
    setTimeout(() => hideMessage("loginMessage"), 3000);
    return;
  }

  if (!actualResults[course]) {
    actualResults[course] = {};
  }

  actualResults[course][examType] = parseFloat(average);
  await saveResultsToServer(); // Use server save instead of localStorage
  saveToFile();

  document.getElementById("admin-average").value = "";
  calculateAndShowResults();
  updateAdminStats();

  const message = `Result set for ${courseNames[course]} ${examType}: ${average}`;
  showMessage("loginMessage", `✅ ${message}`, "success");
  showNotification(message);
  setTimeout(() => hideMessage("loginMessage"), 3000);
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
    let text = "Your predictions: ";
    const predictions = [];
    if (guess.midsem !== null) predictions.push(`Midsem: ${guess.midsem}`);
    if (guess.compre !== null) predictions.push(`Compre: ${guess.compre}`);
    text += predictions.join(", ");

    currentDiv.textContent = text;
    currentDiv.classList.remove("hidden");
  }
}

function setActualResult() {
  if (!isAdmin) return;

  const course = document.getElementById("admin-course").value;
  const examType = document.getElementById("admin-exam").value;
  const average = document.getElementById("admin-average").value;

  if (!average || isNaN(average) || average < 0 || average > 100) {
    showMessage(
      "loginMessage",
      "Please enter a valid average between 0 and 100",
      "error"
    );
    setTimeout(() => hideMessage("loginMessage"), 3000);
    return;
  }

  if (!actualResults[course]) {
    actualResults[course] = {};
  }

  actualResults[course][examType] = parseFloat(average);
  localStorage.setItem("actualResults", JSON.stringify(actualResults));
  saveToFile();

  document.getElementById("admin-average").value = "";
  calculateAndShowResults();
  updateAdminStats();

  const message = `Result set for ${courseNames[course]} ${examType}: ${average}`;
  showMessage("loginMessage", `✅ ${message}`, "success");
  showNotification(message);
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
            isWinner: difference <= 1, // Winner criteria: within ±1 mark
          });
        }
      }

      if (participants.length > 0) {
        participants.sort((a, b) => a.difference - b.difference);

        const courseDiv = document.createElement("div");
        courseDiv.style.marginBottom = "40px";
        courseDiv.innerHTML = `
                    <h4 style="color: #f1f5f9; margin: 30px 0 20px 0; font-size: 1.5em; font-weight: 700;">
                        ${courseNames[course]} - ${
          examType.charAt(0).toUpperCase() + examType.slice(1)
        }
                    </h4>
                    <p style="margin-bottom: 25px; font-weight: 600; color: #22c55e; font-size: 1.2em;">
                        🎯 Actual Average: ${actualAvg}
                    </p>
                `;

        participants.forEach((participant, index) => {
          const participantDiv = document.createElement("div");
          participantDiv.className = participant.isWinner
            ? "winner-card"
            : "participant-card";

          const rank = index + 1;
          const medal =
            rank === 1
              ? "🥇"
              : rank === 2
              ? "🥈"
              : rank === 3
              ? "🥉"
              : `#${rank}`;
          const winnerBadge = participant.isWinner ? " 🏆 WINNER" : "";

          participantDiv.innerHTML = `
                        <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 15px;">
                            <div style="font-weight: 700; font-size: 1.2em; color: ${
                              participant.isWinner ? "#10b981" : "#e2e8f0"
                            };">
                                ${medal} ${participant.username}${winnerBadge}
                            </div>
                            <div style="font-size: 1em; color: ${
                              participant.isWinner ? "#6ee7b7" : "#94a3b8"
                            }; font-weight: 500;">
                                Guessed: ${
                                  participant.guess
                                } | Difference: ${participant.difference.toFixed(
            2
          )}
                                ${participant.isWinner ? " ✨" : ""}
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

function viewAllSubmissions() {
  if (!isAdmin) return;

  const container = document.getElementById("allSubmissions");
  container.innerHTML = "";

  if (Object.keys(guesses).length === 0) {
    container.innerHTML =
      "<p style='color: #94a3b8; text-align: center; padding: 20px;'>No submissions yet.</p>";
    return;
  }

  for (const username in guesses) {
    const userDiv = document.createElement("div");
    userDiv.className = "submission-item";

    const userGuesses = guesses[username];
    const totalPredictions = Object.keys(userGuesses).reduce(
      (total, course) => {
        const guess = userGuesses[course];
        return (
          total +
          (guess.midsem !== null ? 1 : 0) +
          (guess.compre !== null ? 1 : 0)
        );
      },
      0
    );

    userDiv.innerHTML = `
            <div class="submission-header">
                <div class="submission-user">👤 ${username}</div>
                <div class="submission-time">${totalPredictions} predictions made</div>
            </div>
            <div class="submission-predictions" id="predictions-${username}"></div>
        `;

    const predictionsDiv = userDiv.querySelector(`#predictions-${username}`);

    for (const course in userGuesses) {
      const guess = userGuesses[course];
      const predictionDiv = document.createElement("div");
      predictionDiv.className = "prediction-item";

      predictionDiv.innerHTML = `
                <div class="prediction-course">${courseNames[course]}</div>
                <div class="prediction-values">
                    ${
                      guess.midsem !== null
                        ? `<span>Midsem: ${guess.midsem}</span>`
                        : ""
                    }
                    ${
                      guess.compre !== null
                        ? `<span>Compre: ${guess.compre}</span>`
                        : ""
                    }
                    <span style="color: #64748b;">• ${new Date(
                      guess.timestamp
                    ).toLocaleString()}</span>
                </div>
            `;

      predictionsDiv.appendChild(predictionDiv);
    }

    container.appendChild(userDiv);
  }
}

function downloadSubmissions() {
  if (!isAdmin) return;

  const data = {
    users: users,
    guesses: guesses,
    actualResults: actualResults,
    exported: new Date().toISOString(),
    totalUsers: Object.keys(users).length,
    totalPredictions: Object.keys(guesses).reduce((total, user) => {
      return (
        total +
        Object.keys(guesses[user]).reduce((userTotal, course) => {
          const guess = guesses[user][course];
          return (
            userTotal +
            (guess.midsem !== null ? 1 : 0) +
            (guess.compre !== null ? 1 : 0)
          );
        }, 0)
      );
    }, 0),
  };

  const blob = new Blob([JSON.stringify(data, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `bitbets-submissions-${
    new Date().toISOString().split("T")[0]
  }.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);

  showNotification("Submissions downloaded successfully! 📥");
}

function exportToCSV() {
  if (!isAdmin) return;

  let csvContent =
    "Username,Course,Course Name,Midsem Guess,Compre Guess,Timestamp\n";

  for (const username in guesses) {
    for (const course in guesses[username]) {
      const guess = guesses[username][course];
      csvContent += `"${username}","${course}","${courseNames[course]}",`;
      csvContent += `"${guess.midsem || ""}","${guess.compre || ""}","${
        guess.timestamp
      }"\n`;
    }
  }

  const blob = new Blob([csvContent], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `bitbets-submissions-${
    new Date().toISOString().split("T")[0]
  }.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);

  showNotification("CSV exported successfully! 📊");
}

function exportResults() {
  if (!isAdmin) return;

  const resultsData = {
    actualResults: actualResults,
    detailedResults: {},
    summary: {
      totalCourses: Object.keys(courseNames).length,
      resultsSet: Object.keys(actualResults).length,
      totalParticipants: Object.keys(guesses).length,
      exportDate: new Date().toISOString(),
    },
  };

  // Generate detailed results
  for (const course in actualResults) {
    for (const examType in actualResults[course]) {
      const key = `${course}-${examType}`;
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
            isWinner: difference <= 1,
          });
        }
      }

      participants.sort((a, b) => a.difference - b.difference);

      resultsData.detailedResults[key] = {
        course: courseNames[course],
        examType: examType,
        actualAverage: actualAvg,
        participants: participants,
        winners: participants.filter((p) => p.isWinner),
        totalParticipants: participants.length,
      };
    }
  }

  const blob = new Blob([JSON.stringify(resultsData, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `bitbets-results-${new Date().toISOString().split("T")[0]}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);

  showNotification("Results exported successfully! 📊");
}

async function restartCompetition() {
  if (!isAdmin) return;

  const confirmed = confirm(
    "Are you sure you want to restart the competition? This will:\n\n" +
      "✅ Keep all user accounts\n" +
      "🗑️ Clear all predictions\n" +
      "🗑️ Clear all results\n\n" +
      "This action cannot be undone!"
  );

  if (confirmed) {
    const secondConfirm = confirm(
      "This is your final warning! All competition data will be lost. Continue?"
    );

    if (secondConfirm) {
      try {
        const response = await fetch(
          `${SERVER_CONFIG.baseUrl}/restart-competition`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
          }
        );

        if (response.ok) {
          // Update local data
          guesses = {};
          actualResults = {};

          // Also clear localStorage as backup
          localStorage.setItem("guesses", JSON.stringify(guesses));
          localStorage.setItem("actualResults", JSON.stringify(actualResults));

          saveToFile();

          // Clear all input fields
          const inputs = document.querySelectorAll('input[type="number"]');
          inputs.forEach((input) => (input.value = ""));

          // Hide current guess displays
          const currentGuesses = document.querySelectorAll(".current-guess");
          currentGuesses.forEach((elem) => elem.classList.add("hidden"));

          // Clear admin displays
          document.getElementById("allSubmissions").innerHTML = "";
          document.getElementById("resultsContent").innerHTML = "";
          document.getElementById("resultsSection").classList.add("hidden");

          updateStats();
          updateAdminStats();

          showMessage(
            "loginMessage",
            "Competition restarted successfully! All predictions and results cleared. 🔄",
            "success"
          );
          showNotification(
            "Competition restarted! Fresh start for everyone! 🚀"
          );
          setTimeout(() => hideMessage("loginMessage"), 4000);
        } else {
          throw new Error("Server request failed");
        }
      } catch (error) {
        console.error("Error restarting competition:", error);
        showNotification("⚠️ Server error. Please try again.");
      }
    }
  }
}

async function clearAllData() {
  if (!isAdmin) return;

  const confirmed = confirm(
    "⚠️ DANGER ZONE ⚠️\n\n" +
      "This will permanently delete:\n" +
      "🗑️ All user accounts\n" +
      "🗑️ All predictions\n" +
      "🗑️ All results\n" +
      "🗑️ Everything!\n\n" +
      "Are you absolutely sure?"
  );

  if (confirmed) {
    const finalConfirm = confirm(
      "LAST CHANCE!\nThis will wipe everything clean. Type 'DELETE' in the next prompt to confirm."
    );

    if (finalConfirm) {
      const userInput = prompt("Type 'DELETE' to confirm complete data wipe:");

      if (userInput === "DELETE") {
        try {
          const response = await fetch(`${SERVER_CONFIG.baseUrl}/clear-all`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
          });

          if (response.ok) {
            users = {};
            guesses = {};
            actualResults = {};

            localStorage.clear();
            saveToFile();

            showMessage(
              "loginMessage",
              "All data cleared successfully! Starting fresh. 🗑️",
              "warning"
            );
            showNotification("All data wiped clean! Fresh start! 🔄");

            setTimeout(() => {
              logout();
              location.reload();
            }, 2000);
          } else {
            throw new Error("Server request failed");
          }
        } catch (error) {
          console.error("Error clearing data:", error);
          showNotification("⚠️ Server error. Please try again.");
        }
      } else {
        showNotification("Data wipe cancelled. Phew! 😅");
      }
    }
  }
}

async function refreshData() {
  try {
    await loadDataFromServer();

    if (isAdmin) {
      updateAdminStats();
      viewAllSubmissions();
    } else {
      loadUserGuesses();
    }
    calculateAndShowResults();
    updateStats();
    showNotification("Data refreshed from server! 🔄");
  } catch (error) {
    console.error("Error refreshing data:", error);
    showNotification("⚠️ Could not refresh from server. Using local data.");
  }
}

function updateStats() {
  const totalUsers = Object.keys(users).length;
  const totalPredictions = Object.keys(guesses).reduce((total, user) => {
    return (
      total +
      Object.keys(guesses[user]).reduce((userTotal, course) => {
        const guess = guesses[user][course];
        return (
          userTotal +
          (guess.midsem !== null ? 1 : 0) +
          (guess.compre !== null ? 1 : 0)
        );
      }, 0)
    );
  }, 0);

  document.getElementById("totalUsers").textContent = totalUsers;
  document.getElementById("totalPredictions").textContent = totalPredictions;
}

function updateAdminStats() {
  if (!isAdmin) return;

  const totalUsers = Object.keys(users).length;
  const totalPredictions = Object.keys(guesses).reduce((total, user) => {
    return (
      total +
      Object.keys(guesses[user]).reduce((userTotal, course) => {
        const guess = guesses[user][course];
        return (
          userTotal +
          (guess.midsem !== null ? 1 : 0) +
          (guess.compre !== null ? 1 : 0)
        );
      }, 0)
    );
  }, 0);
  const resultsSet = Object.keys(actualResults).reduce((total, course) => {
    return total + Object.keys(actualResults[course]).length;
  }, 0);

  document.getElementById("adminTotalUsers").textContent = totalUsers;
  document.getElementById("adminTotalPredictions").textContent =
    totalPredictions;
  document.getElementById("adminResultsSet").textContent = resultsSet;
}

function refreshData() {
  if (isAdmin) {
    updateAdminStats();
    viewAllSubmissions();
  } else {
    loadUserGuesses();
  }
  calculateAndShowResults();
  updateStats();
  showNotification("Data refreshed! 🔄");
}

function filterCourses(category) {
  const cards = document.querySelectorAll(".course-card");
  const buttons = document.querySelectorAll(".filter-btn");

  // Update button states
  buttons.forEach((btn) => btn.classList.remove("active"));
  event.target.classList.add("active");

  // Filter cards
  cards.forEach((card) => {
    if (category === "all" || card.dataset.category === category) {
      card.style.display = "block";
      card.style.animation = "fadeIn 0.3s ease";
    } else {
      card.style.display = "none";
    }
  });
}

function switchTab(tabName) {
  // Hide all tab contents
  document.querySelectorAll(".admin-tab-content").forEach((tab) => {
    tab.classList.add("hidden");
  });

  // Remove active class from all buttons
  document.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.classList.remove("active");
  });

  // Show selected tab and activate button
  document.getElementById(`${tabName}Tab`).classList.remove("hidden");
  event.target.classList.add("active");

  // Load data for specific tabs
  if (tabName === "submissions") {
    viewAllSubmissions();
  } else if (tabName === "management") {
    updateAdminStats();
  }
}

function saveToFile() {
  // In a real implementation, this would save to a server
  // For now, we'll use localStorage as the persistent storage
  try {
    const data = {
      users: users,
      guesses: guesses,
      actualResults: actualResults,
      lastUpdated: new Date().toISOString(),
    };

    // Simulate file saving by storing in a special localStorage key
    localStorage.setItem("bitbets_file_backup", JSON.stringify(data));
  } catch (error) {
    console.error("Error saving to file:", error);
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

function showNotification(message) {
  const notification = document.getElementById("notification");
  const notificationText = document.querySelector(".notification-text");

  notificationText.textContent = message;
  notification.classList.remove("hidden");
  notification.classList.add("show");

  setTimeout(() => {
    notification.classList.remove("show");
    setTimeout(() => {
      notification.classList.add("hidden");
    }, 400);
  }, 3000);
}

// Load data on page load
window.addEventListener("load", async function () {
  await loadDataFromServer();
  updateStats();
  calculateAndShowResults();
});
