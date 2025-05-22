const ADMIN_CONFIG = {
  username: "admin",
  password: "admin123",
};

const SERVER_CONFIG = {
  host: "https://dca6-13-48-194-145.ngrok-free.app",
  port: "", // no port needed
  protocol: "https",
  get baseUrl() {
    return `${this.protocol}://${this.host}/api`;
  },
  timeout: 10000, // 10 second timeout
  retries: 3, // number of retries for failed requests
};

// Global state
let users = {};
let guesses = {};
let actualResults = {};
let currentUser = null;
let isAdmin = false;
let isLoading = false;
let requestQueue = [];
let processingQueue = false;

// Request queue system to prevent concurrent requests
async function queueRequest(requestFunction) {
  return new Promise((resolve, reject) => {
    requestQueue.push({ requestFunction, resolve, reject });
    processQueue();
  });
}

async function processQueue() {
  if (processingQueue || requestQueue.length === 0) return;

  processingQueue = true;

  while (requestQueue.length > 0) {
    const { requestFunction, resolve, reject } = requestQueue.shift();
    try {
      const result = await requestFunction();
      resolve(result);
    } catch (error) {
      reject(error);
    }
    // Small delay between requests to prevent overwhelming the server
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  processingQueue = false;
}

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

// Loading state management
function setLoading(loading) {
  isLoading = loading;
  const loadingElements = document.querySelectorAll(".loading-overlay");
  loadingElements.forEach((el) => {
    if (loading) {
      el.classList.remove("hidden");
    } else {
      el.classList.add("hidden");
    }
  });

  // Disable/enable buttons during loading
  const buttons = document.querySelectorAll("button");
  buttons.forEach((btn) => {
    btn.disabled = loading;
  });
}

// Improved server request with retry logic and timeout
async function makeServerRequest(url, options = {}) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), SERVER_CONFIG.timeout);

  const requestOptions = {
    ...options,
    signal: controller.signal,
    headers: {
      "Content-Type": "application/json",
      "ngrok-skip-browser-warning": "true", // Skip ngrok browser warning
      ...options.headers,
    },
  };

  let lastError;

  for (let attempt = 1; attempt <= SERVER_CONFIG.retries; attempt++) {
    try {
      console.log(`Making request to: ${url} (attempt ${attempt})`);

      const response = await fetch(url, requestOptions);
      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      return response;
    } catch (error) {
      lastError = error;
      console.error(
        `Request failed (attempt ${attempt}/${SERVER_CONFIG.retries}):`,
        error
      );

      // Don't retry on abort (timeout) or non-network errors
      if (error.name === "AbortError" || attempt === SERVER_CONFIG.retries) {
        break;
      }

      // Exponential backoff for retries
      await new Promise((resolve) =>
        setTimeout(resolve, Math.pow(2, attempt) * 1000)
      );
    }
  }

  clearTimeout(timeoutId);

  // Handle different types of errors
  if (lastError.name === "AbortError") {
    throw new Error("Request timed out. Please check your connection.");
  } else if (
    lastError.message.includes("Failed to fetch") ||
    lastError.message.includes("NetworkError")
  ) {
    throw new Error(
      `Cannot connect to server. Please check if server is running at ${SERVER_CONFIG.baseUrl}`
    );
  } else {
    throw new Error(`Server error: ${lastError.message}`);
  }
}

// Debounced auto-save function
const debouncedAutoSave = debounce(async (courseId) => {
  if (currentUser && !isAdmin && !isLoading) {
    try {
      await autoSaveGuess(courseId);
    } catch (error) {
      console.error("Auto-save failed:", error);
    }
  }
}, 1000);

function debounce(func, wait) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

document.addEventListener("DOMContentLoaded", async function () {
  try {
    setLoading(true);
    await loadDataFromServer();
    updateStats();
    calculateAndShowResults();
    setupEventListeners();
  } catch (error) {
    console.error("Initialization error:", error);
    showNotification("⚠️ Failed to initialize. Some features may not work.");
  } finally {
    setLoading(false);
  }
});

async function loadDataFromServer() {
  try {
    console.log(`Attempting to connect to server at: ${SERVER_CONFIG.baseUrl}`);

    // Check server health first
    await queueRequest(() =>
      makeServerRequest(`${SERVER_CONFIG.baseUrl.replace("/api", "")}/health`)
    );
    console.log("Server health check passed");

    // Load all data concurrently with queue system
    const [usersResponse, guessesResponse, resultsResponse] = await Promise.all(
      [
        queueRequest(() => makeServerRequest(`${SERVER_CONFIG.baseUrl}/users`)),
        queueRequest(() =>
          makeServerRequest(`${SERVER_CONFIG.baseUrl}/guesses`)
        ),
        queueRequest(() =>
          makeServerRequest(`${SERVER_CONFIG.baseUrl}/results`)
        ),
      ]
    );

    users = await usersResponse.json();
    guesses = await guessesResponse.json();
    actualResults = await resultsResponse.json();

    console.log("Data loaded from server successfully");
    showNotification("✅ Connected to server successfully!");

    // Cache data locally as backup
    localStorage.setItem("users_backup", JSON.stringify(users));
    localStorage.setItem("guesses_backup", JSON.stringify(guesses));
    localStorage.setItem("actualResults_backup", JSON.stringify(actualResults));
  } catch (error) {
    console.error("Error loading data from server:", error);
    showNotification("⚠️ Server connection failed. Using offline mode.");

    // Try to load from localStorage backup first, then fall back to empty objects
    users = JSON.parse(
      localStorage.getItem("users_backup") ||
        localStorage.getItem("users") ||
        "{}"
    );
    guesses = JSON.parse(
      localStorage.getItem("guesses_backup") ||
        localStorage.getItem("guesses") ||
        "{}"
    );
    actualResults = JSON.parse(
      localStorage.getItem("actualResults_backup") ||
        localStorage.getItem("actualResults") ||
        "{}"
    );
  }
}

async function saveUsersToServer() {
  try {
    await queueRequest(() =>
      makeServerRequest(`${SERVER_CONFIG.baseUrl}/users`, {
        method: "POST",
        body: JSON.stringify(users),
      })
    );

    localStorage.setItem("users_backup", JSON.stringify(users));
    localStorage.setItem("users", JSON.stringify(users));
  } catch (error) {
    console.error("Error saving users to server:", error);
    localStorage.setItem("users", JSON.stringify(users));
    throw error; // Re-throw to handle in calling function
  }
}

async function saveGuessesToServer() {
  try {
    await queueRequest(() =>
      makeServerRequest(`${SERVER_CONFIG.baseUrl}/guesses`, {
        method: "POST",
        body: JSON.stringify(guesses),
      })
    );

    localStorage.setItem("guesses_backup", JSON.stringify(guesses));
    localStorage.setItem("guesses", JSON.stringify(guesses));
  } catch (error) {
    console.error("Error saving guesses to server:", error);
    localStorage.setItem("guesses", JSON.stringify(guesses));
    throw error;
  }
}

async function saveResultsToServer() {
  try {
    await queueRequest(() =>
      makeServerRequest(`${SERVER_CONFIG.baseUrl}/results`, {
        method: "POST",
        body: JSON.stringify(actualResults),
      })
    );

    localStorage.setItem("actualResults_backup", JSON.stringify(actualResults));
    localStorage.setItem("actualResults", JSON.stringify(actualResults));
  } catch (error) {
    console.error("Error saving results to server:", error);
    localStorage.setItem("actualResults", JSON.stringify(actualResults));
    throw error;
  }
}

function setupEventListeners() {
  document
    .getElementById("username")
    ?.addEventListener("keypress", function (e) {
      if (e.key === "Enter" && !isLoading) login();
    });

  document
    .getElementById("password")
    ?.addEventListener("keypress", function (e) {
      if (e.key === "Enter" && !isLoading) login();
    });

  const inputs = document.querySelectorAll('input[type="number"]');
  inputs.forEach((input) => {
    input.addEventListener("input", function () {
      const courseId = this.id.replace("-midsem", "").replace("-compre", "");
      if (currentUser && !isAdmin) {
        debouncedAutoSave(courseId);
      }
    });

    // Also handle blur event for immediate save when user leaves field
    input.addEventListener("blur", function () {
      const courseId = this.id.replace("-midsem", "").replace("-compre", "");
      if (currentUser && !isAdmin) {
        autoSaveGuess(courseId);
      }
    });
  });
}

async function login() {
  if (isLoading) return;

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

  try {
    setLoading(true);

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
      if (!users[username]) {
        users[username] = password;
        await saveUsersToServer();
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
        document.getElementById("adminBadge")?.classList.remove("hidden");
        document.getElementById("adminPanel")?.classList.remove("hidden");
        document.getElementById("userContent")?.classList.add("hidden");
        updateAdminStats();
      } else {
        document.getElementById("adminBadge")?.classList.add("hidden");
        document.getElementById("adminPanel")?.classList.add("hidden");
        document.getElementById("userContent")?.classList.remove("hidden");
        loadUserGuesses();
      }

      document.getElementById("loginSection").classList.add("hidden");
      document.getElementById("mainContent").classList.remove("hidden");
      updateStats();
    }, 1000);
  } catch (error) {
    console.error("Login error:", error);
    showMessage("loginMessage", "Login failed. Please try again.", "error");
  } finally {
    setLoading(false);
  }
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
  if (!currentUser || isAdmin || isLoading) return;

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

  try {
    setLoading(true);

    if (!guesses[currentUser]) {
      guesses[currentUser] = {};
    }

    guesses[currentUser][course] = {
      midsem: midsemValue ? parseFloat(midsemValue) : null,
      compre: compreValue ? parseFloat(compreValue) : null,
      timestamp: new Date().toISOString(),
    };

    await saveGuessesToServer();
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
  } catch (error) {
    console.error("Save guess error:", error);
    showMessage(
      "loginMessage",
      "Failed to save prediction. Please try again.",
      "error"
    );
    setTimeout(() => hideMessage("loginMessage"), 3000);
  } finally {
    setLoading(false);
  }
}

async function autoSaveGuess(course) {
  if (!currentUser || isAdmin || isLoading) return;

  const midsemValue = document.getElementById(`${course}-midsem`).value;
  const compreValue = document.getElementById(`${course}-compre`).value;

  if (!midsemValue && !compreValue) return;

  try {
    if (!guesses[currentUser]) {
      guesses[currentUser] = {};
    }

    guesses[currentUser][course] = {
      midsem: midsemValue ? parseFloat(midsemValue) : null,
      compre: compreValue ? parseFloat(compreValue) : null,
      timestamp: new Date().toISOString(),
    };

    await saveGuessesToServer();
    saveToFile();
    updateCurrentGuessDisplay(course);
  } catch (error) {
    console.error("Auto-save failed:", error);
    // Don't show error notification for auto-save failures
  }
}

async function setActualResult() {
  if (!isAdmin || isLoading) return;

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

  try {
    setLoading(true);

    if (!actualResults[course]) {
      actualResults[course] = {};
    }

    actualResults[course][examType] = parseFloat(average);
    await saveResultsToServer();
    saveToFile();

    document.getElementById("admin-average").value = "";
    calculateAndShowResults();
    updateAdminStats();

    const message = `Result set for ${courseNames[course]} ${examType}: ${average}`;
    showMessage("loginMessage", `✅ ${message}`, "success");
    showNotification(message);
    setTimeout(() => hideMessage("loginMessage"), 3000);
  } catch (error) {
    console.error("Set result error:", error);
    showMessage(
      "loginMessage",
      "Failed to set result. Please try again.",
      "error"
    );
    setTimeout(() => hideMessage("loginMessage"), 3000);
  } finally {
    setLoading(false);
  }
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

function calculateAndShowResults() {
  const resultsSection = document.getElementById("resultsSection");
  const resultsContent = document.getElementById("resultsContent");

  if (!resultsSection || !resultsContent) return;

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
            isWinner: difference <= 1,
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
                } | Difference: ${participant.difference.toFixed(2)}
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
  if (!container) return;

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
          ${guess.midsem !== null ? `<span>Midsem: ${guess.midsem}</span>` : ""}
          ${guess.compre !== null ? `<span>Compre: ${guess.compre}</span>` : ""}
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
  if (!isAdmin || isLoading) return;

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
        setLoading(true);

        await queueRequest(() =>
          makeServerRequest(`${SERVER_CONFIG.baseUrl}/restart-competition`, {
            method: "POST",
          })
        );

        guesses = {};
        actualResults = {};

        localStorage.setItem("guesses", JSON.stringify(guesses));
        localStorage.setItem("actualResults", JSON.stringify(actualResults));
        localStorage.setItem("guesses_backup", JSON.stringify(guesses));
        localStorage.setItem(
          "actualResults_backup",
          JSON.stringify(actualResults)
        );

        saveToFile();

        const inputs = document.querySelectorAll('input[type="number"]');
        inputs.forEach((input) => (input.value = ""));

        const currentGuesses = document.querySelectorAll(".current-guess");
        currentGuesses.forEach((elem) => elem.classList.add("hidden"));

        const allSubmissions = document.getElementById("allSubmissions");
        if (allSubmissions) allSubmissions.innerHTML = "";

        const resultsContent = document.getElementById("resultsContent");
        if (resultsContent) resultsContent.innerHTML = "";

        const resultsSection = document.getElementById("resultsSection");
        if (resultsSection) resultsSection.classList.add("hidden");

        updateStats();
        updateAdminStats();

        showMessage(
          "loginMessage",
          "Competition restarted successfully! All predictions and results cleared. 🔄",
          "success"
        );
        showNotification("Competition restarted! Fresh start for everyone! 🚀");
        setTimeout(() => hideMessage("loginMessage"), 4000);
      } catch (error) {
        console.error("Error restarting competition:", error);
        showMessage(
          "loginMessage",
          "Failed to restart competition. Please try again.",
          "error"
        );
        setTimeout(() => hideMessage("loginMessage"), 3000);
      } finally {
        setLoading(false);
      }
    }
  }
}

async function clearAllData() {
  if (!isAdmin || isLoading) return;

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
          setLoading(true);

          await queueRequest(() =>
            makeServerRequest(`${SERVER_CONFIG.baseUrl}/clear-all`, {
              method: "POST",
            })
          );

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
        } catch (error) {
          console.error("Error clearing data:", error);
          showMessage(
            "loginMessage",
            "Failed to clear data. Please try again.",
            "error"
          );
          setTimeout(() => hideMessage("loginMessage"), 3000);
        } finally {
          setLoading(false);
        }
      } else {
        showNotification("Data wipe cancelled. Phew! 😅");
      }
    }
  }
}

async function refreshData() {
  if (isLoading) return;

  try {
    setLoading(true);
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
  } finally {
    setLoading(false);
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

  const totalUsersEl = document.getElementById("totalUsers");
  const totalPredictionsEl = document.getElementById("totalPredictions");

  if (totalUsersEl) totalUsersEl.textContent = totalUsers;
  if (totalPredictionsEl) totalPredictionsEl.textContent = totalPredictions;
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

  const adminTotalUsersEl = document.getElementById("adminTotalUsers");
  const adminTotalPredictionsEl = document.getElementById(
    "adminTotalPredictions"
  );
  const adminResultsSetEl = document.getElementById("adminResultsSet");

  if (adminTotalUsersEl) adminTotalUsersEl.textContent = totalUsers;
  if (adminTotalPredictionsEl)
    adminTotalPredictionsEl.textContent = totalPredictions;
  if (adminResultsSetEl) adminResultsSetEl.textContent = resultsSet;
}

function filterCourses(category) {
  const cards = document.querySelectorAll(".course-card");
  const buttons = document.querySelectorAll(".filter-btn");

  buttons.forEach((btn) => btn.classList.remove("active"));
  event.target.classList.add("active");

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
  document.querySelectorAll(".admin-tab-content").forEach((tab) => {
    tab.classList.add("hidden");
  });

  document.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.classList.remove("active");
  });

  const tabElement = document.getElementById(`${tabName}Tab`);
  if (tabElement) tabElement.classList.remove("hidden");

  if (event && event.target) event.target.classList.add("active");

  if (tabName === "submissions") {
    viewAllSubmissions();
  } else if (tabName === "management") {
    updateAdminStats();
  }
}

function saveToFile() {
  try {
    const data = {
      users: users,
      guesses: guesses,
      actualResults: actualResults,
      lastUpdated: new Date().toISOString(),
    };

    localStorage.setItem("bitbets_file_backup", JSON.stringify(data));
  } catch (error) {
    console.error("Error saving to file:", error);
  }
}

function showMessage(elementId, message, type) {
  const msgElement = document.getElementById(elementId);
  if (msgElement) {
    msgElement.textContent = message;
    msgElement.className = `status-message status-${type}`;
    msgElement.classList.remove("hidden");
  }
}

function hideMessage(elementId) {
  const msgElement = document.getElementById(elementId);
  if (msgElement) msgElement.classList.add("hidden");
}

function showNotification(message) {
  const notification = document.getElementById("notification");
  const notificationText = document.querySelector(".notification-text");

  if (notification && notificationText) {
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
}

// Handle page visibility changes to refresh data when user returns
document.addEventListener("visibilitychange", function () {
  if (!document.hidden && currentUser && !isLoading) {
    // Refresh data when user returns to the page
    setTimeout(refreshData, 1000);
  }
});

// Handle network status changes
window.addEventListener("online", function () {
  showNotification("🌐 Back online! Refreshing data...");
  setTimeout(refreshData, 1000);
});

window.addEventListener("offline", function () {
  showNotification("📡 You are offline. Changes will be saved locally.");
});

// Initialize when page loads
window.addEventListener("load", async function () {
  try {
    setLoading(true);
    await loadDataFromServer();
    updateStats();
    calculateAndShowResults();
  } catch (error) {
    console.error("Page load error:", error);
  } finally {
    setLoading(false);
  }
});

// Prevent form submission on Enter key in number inputs
document.addEventListener("keydown", function (e) {
  if (e.key === "Enter" && e.target.type === "number") {
    e.preventDefault();
    e.target.blur(); // Trigger blur event to save
  }
});
