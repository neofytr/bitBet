const express = require("express");
const cors = require("cors");
const fs = require("fs").promises;
const fsSync = require("fs");
const path = require("path");
const zlib = require("zlib");
const { promisify } = require("util");
const gzip = promisify(zlib.gzip);

const app = express();
const PORT = process.env.PORT || 5000;

app.use(
  cors({
    origin: "https://bit-bet-1mcw.vercel.app/",
    methods: ["GET", "POST", "OPTIONS"],
    credentials: false,
  })
);

app.use(express.json({ limit: "16mb" }));

const DATA_DIR = "bitbets_data";
const USERS_FILE = path.join(DATA_DIR, "users.json");
const GUESSES_FILE = path.join(DATA_DIR, "guesses.json");
const RESULTS_FILE = path.join(DATA_DIR, "actual_results.json");
const BACKUP_DIR = path.join(DATA_DIR, "backups");

const dataCache = {
  users: {},
  guesses: {},
  actual_results: {},
  last_modified: {
    users: 0,
    guesses: 0,
    actual_results: 0,
  },
};

const COURSE_NAMES = {
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

const rateLimiter = (maxRequests = 30, perSeconds = 60) => {
  const requests = new Map();

  return (req, res, next) => {
    const clientIp =
      req.headers["x-forwarded-for"] || req.connection.remoteAddress;
    const now = Date.now();

    if (!requests.has(clientIp)) {
      requests.set(clientIp, []);
    }

    const clientRequests = requests.get(clientIp);
    const validRequests = clientRequests.filter(
      (time) => now - time < perSeconds * 1000
    );

    if (validRequests.length >= maxRequests) {
      console.warn(`Rate limit exceeded for ${clientIp}`);
      return res.status(429).json({
        status: "error",
        message: "Rate limit exceeded. Please try again later.",
      });
    }

    validRequests.push(now);
    requests.set(clientIp, validRequests);
    next();
  };
};

const errorHandler = (fn) => {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch((err) => {
      console.error(`Error in ${fn.name}:`, err);

      if (err.type === "entity.too.large") {
        res.status(413).json({
          status: "error",
          message: "Request too large. Please reduce the data size.",
        });
      } else if (err instanceof SyntaxError && err.status === 400) {
        res.status(400).json({
          status: "error",
          message: "Invalid JSON format",
        });
      } else {
        res.status(500).json({
          status: "error",
          message: "Internal server error",
        });
      }
    });
  };
};

const ensureDirectories = async () => {
  try {
    await fs.mkdir(DATA_DIR, { recursive: true });
    await fs.mkdir(BACKUP_DIR, { recursive: true });
    console.log(`Directories created/verified: ${DATA_DIR}, ${BACKUP_DIR}`);
  } catch (error) {
    console.error("Error creating directories:", error);
    throw error;
  }
};

const loadJsonFile = async (filepath, defaultValue = {}) => {
  try {
    if (!fsSync.existsSync(filepath)) {
      console.log(`File ${filepath} doesn't exist, returning default`);
      return defaultValue;
    }

    const stats = await fs.stat(filepath);
    const fileModTime = stats.mtimeMs;
    const cacheKey = path.basename(filepath).replace(".json", "");

    if (
      dataCache.last_modified[cacheKey] &&
      fileModTime <= dataCache.last_modified[cacheKey] &&
      dataCache[cacheKey]
    ) {
      console.log(`Using cached data for ${filepath}`);
      return dataCache[cacheKey];
    }

    const data = await fs.readFile(filepath, "utf8");
    const parsedData = JSON.parse(data);

    dataCache[cacheKey] = parsedData;
    dataCache.last_modified[cacheKey] = fileModTime;

    console.log(`Loaded ${filepath} successfully`);
    return parsedData;
  } catch (error) {
    console.error(`Error loading ${filepath}:`, error);
    return defaultValue;
  }
};

const saveJsonFile = async (filepath, data) => {
  try {
    const tempFilepath = filepath + ".tmp";

    await fs.writeFile(tempFilepath, JSON.stringify(data, null, 2), "utf8");
    await fs.rename(tempFilepath, filepath);

    const cacheKey = path.basename(filepath).replace(".json", "");
    dataCache[cacheKey] = typeof data === "object" ? { ...data } : data;
    dataCache.last_modified[cacheKey] = Date.now();

    console.log(`Saved ${filepath} successfully`);
    return true;
  } catch (error) {
    console.error(`Error saving ${filepath}:`, error);
    try {
      await fs.unlink(filepath + ".tmp");
    } catch {}
    return false;
  }
};

const createBackup = async () => {
  try {
    const timestamp =
      new Date().toISOString().replace(/[:.]/g, "-").split("T")[0] +
      "_" +
      new Date().toTimeString().split(" ")[0].replace(/:/g, "");
    const backupFile = path.join(BACKUP_DIR, `backup_${timestamp}.json`);

    const allData = {
      users: await loadJsonFile(USERS_FILE),
      guesses: await loadJsonFile(GUESSES_FILE),
      actual_results: await loadJsonFile(RESULTS_FILE),
      backup_time: new Date().toISOString(),
      version: "2.0",
    };

    const compressed = await gzip(JSON.stringify(allData, null, 2));
    await fs.writeFile(backupFile + ".gz", compressed);
    await saveJsonFile(backupFile, allData);

    console.log(`Backup created: ${backupFile}`);
    await cleanupOldBackups();
  } catch (error) {
    console.error("Error creating backup:", error);
  }
};

const cleanupOldBackups = async (keepCount = 10) => {
  try {
    const files = await fs.readdir(BACKUP_DIR);
    const backupFiles = [];

    for (const filename of files) {
      if (filename.startsWith("backup_") && filename.endsWith(".json")) {
        const filepath = path.join(BACKUP_DIR, filename);
        const stats = await fs.stat(filepath);
        backupFiles.push({ filepath, mtime: stats.mtimeMs });
      }
    }

    backupFiles.sort((a, b) => b.mtime - a.mtime);

    for (let i = keepCount; i < backupFiles.length; i++) {
      try {
        await fs.unlink(backupFiles[i].filepath);
        const gzFile = backupFiles[i].filepath + ".gz";
        if (fsSync.existsSync(gzFile)) {
          await fs.unlink(gzFile);
        }
        console.log(`Removed old backup: ${backupFiles[i].filepath}`);
      } catch (error) {
        console.error(
          `Error removing backup ${backupFiles[i].filepath}:`,
          error
        );
      }
    }
  } catch (error) {
    console.error("Error cleaning up backups:", error);
  }
};

const exportToCsv = async () => {
  try {
    const users = await loadJsonFile(USERS_FILE);
    const guesses = await loadJsonFile(GUESSES_FILE);
    const results = await loadJsonFile(RESULTS_FILE);

    const timestamp =
      new Date().toISOString().replace(/[:.]/g, "-").split("T")[0] +
      "_" +
      new Date().toTimeString().split(" ")[0].replace(/:/g, "");

    const guessesRows = [
      "Username,Course,Course Name,Midsem Guess,Compre Guess,Timestamp",
    ];
    for (const [username, userGuesses] of Object.entries(guesses)) {
      for (const [course, guessData] of Object.entries(userGuesses)) {
        const row = [
          username,
          course,
          COURSE_NAMES[course] || course,
          guessData.midsem || "",
          guessData.compre || "",
          guessData.timestamp || "",
        ]
          .map((field) => `"${field}"`)
          .join(",");
        guessesRows.push(row);
      }
    }

    const guessesCsvFile = path.join(
      DATA_DIR,
      `guesses_export_${timestamp}.csv`
    );
    await fs.writeFile(guessesCsvFile, guessesRows.join("\n"));
    console.log(`Guesses exported to: ${guessesCsvFile}`);

    const resultsRows = ["Course,Course Name,Exam Type,Average"];
    for (const [course, courseResults] of Object.entries(results)) {
      for (const [examType, average] of Object.entries(courseResults)) {
        const row = [course, COURSE_NAMES[course] || course, examType, average]
          .map((field) => `"${field}"`)
          .join(",");
        resultsRows.push(row);
      }
    }

    const resultsCsvFile = path.join(
      DATA_DIR,
      `results_export_${timestamp}.csv`
    );
    await fs.writeFile(resultsCsvFile, resultsRows.join("\n"));
    console.log(`Results exported to: ${resultsCsvFile}`);

    const analysisRows = [
      "Course,Course Name,Exam Type,Username,User Guess,Actual Average,Difference,Is Winner",
    ];
    for (const [course, courseResults] of Object.entries(results)) {
      for (const [examType, actualAvg] of Object.entries(courseResults)) {
        for (const [username, userGuesses] of Object.entries(guesses)) {
          if (
            userGuesses[course] &&
            userGuesses[course][examType] !== undefined
          ) {
            const userGuess = userGuesses[course][examType];
            const difference = Math.abs(actualAvg - userGuess);
            const isWinner = difference <= 1;

            const row = [
              course,
              COURSE_NAMES[course] || course,
              examType,
              username,
              userGuess,
              actualAvg,
              Math.round(difference * 100) / 100,
              isWinner ? "Yes" : "No",
            ]
              .map((field) => `"${field}"`)
              .join(",");
            analysisRows.push(row);
          }
        }
      }
    }

    const analysisCsvFile = path.join(
      DATA_DIR,
      `detailed_analysis_${timestamp}.csv`
    );
    await fs.writeFile(analysisCsvFile, analysisRows.join("\n"));
    console.log(`Detailed analysis exported to: ${analysisCsvFile}`);

    return true;
  } catch (error) {
    console.error("Error exporting to CSV:", error);
    return false;
  }
};

app.use((req, res, next) => {
  res.header("X-Content-Type-Options", "nosniff");
  res.header("X-Frame-Options", "DENY");
  res.header("Cache-Control", "no-cache, no-store, must-revalidate");
  next();
});

app.get(
  "/",
  errorHandler(async (req, res) => {
    res.json({
      message: "BitBets API Server is running!",
      status: "healthy",
      timestamp: new Date().toISOString(),
      version: "2.0",
      endpoints: [
        "GET/POST /api/users",
        "GET/POST /api/guesses",
        "GET/POST /api/results",
        "GET /health",
        "GET /api/stats",
        "POST /api/backup",
        "POST /api/export-csv",
        "POST /api/clear-all",
        "POST /api/restart-competition",
      ],
    });
  })
);

app.get(
  "/health",
  errorHandler(async (req, res) => {
    const filesExist = {
      users: fsSync.existsSync(USERS_FILE),
      guesses: fsSync.existsSync(GUESSES_FILE),
      results: fsSync.existsSync(RESULTS_FILE),
    };

    let diskUsage = {};
    try {
      const stats = await fs.statfs(DATA_DIR);
      diskUsage = {
        free_gb: Math.round((stats.free / 1024 ** 3) * 100) / 100,
        total_gb: Math.round((stats.size / 1024 ** 3) * 100) / 100,
      };
    } catch {
      diskUsage = { error: "Cannot check disk usage" };
    }

    const cacheStatus = {
      users_cached: Object.keys(dataCache.users || {}).length,
      guesses_cached: Object.keys(dataCache.guesses || {}).length,
      results_cached: Object.keys(dataCache.actual_results || {}).length,
    };

    res.json({
      status: "healthy",
      timestamp: new Date().toISOString(),
      data_directory: DATA_DIR,
      files_exist: filesExist,
      disk_usage: diskUsage,
      cache_status: cacheStatus,
      version: "2.0",
    });
  })
);

app
  .route("/api/users")
  .get(
    rateLimiter(50, 60),
    errorHandler(async (req, res) => {
      const users = await loadJsonFile(USERS_FILE);
      console.log(
        `GET /api/users - returning ${Object.keys(users).length} users`
      );
      res.json(users);
    })
  )
  .post(
    rateLimiter(50, 60),
    errorHandler(async (req, res) => {
      const data = req.body;
      if (!data || typeof data !== "object") {
        return res.status(400).json({
          status: "error",
          message: "Data must be a JSON object",
        });
      }

      const users = await loadJsonFile(USERS_FILE);
      Object.assign(users, data);

      const success = await saveJsonFile(USERS_FILE, users);
      if (success) {
        console.log("POST /api/users - updated users successfully");
        res.json({ status: "success", message: "Users updated" });
      } else {
        res
          .status(500)
          .json({ status: "error", message: "Failed to save users" });
      }
    })
  );

app
  .route("/api/guesses")
  .get(
    rateLimiter(100, 60),
    errorHandler(async (req, res) => {
      const guesses = await loadJsonFile(GUESSES_FILE);
      console.log(
        `GET /api/guesses - returning guesses for ${
          Object.keys(guesses).length
        } users`
      );
      res.json(guesses);
    })
  )
  .post(
    rateLimiter(100, 60),
    errorHandler(async (req, res) => {
      const data = req.body;
      if (!data || typeof data !== "object") {
        return res.status(400).json({
          status: "error",
          message: "Data must be a JSON object",
        });
      }

      const guesses = await loadJsonFile(GUESSES_FILE);
      Object.assign(guesses, data);

      const success = await saveJsonFile(GUESSES_FILE, guesses);
      if (success) {
        setImmediate(() => exportToCsv());
        console.log("POST /api/guesses - updated guesses successfully");
        res.json({ status: "success", message: "Guesses updated" });
      } else {
        res
          .status(500)
          .json({ status: "error", message: "Failed to save guesses" });
      }
    })
  );

app
  .route("/api/results")
  .get(
    rateLimiter(50, 60),
    errorHandler(async (req, res) => {
      const results = await loadJsonFile(RESULTS_FILE);
      console.log(
        `GET /api/results - returning results for ${
          Object.keys(results).length
        } courses`
      );
      res.json(results);
    })
  )
  .post(
    rateLimiter(50, 60),
    errorHandler(async (req, res) => {
      const data = req.body;
      if (!data || typeof data !== "object") {
        return res.status(400).json({
          status: "error",
          message: "Data must be a JSON object",
        });
      }

      const results = await loadJsonFile(RESULTS_FILE);
      Object.assign(results, data);

      const success = await saveJsonFile(RESULTS_FILE, results);
      if (success) {
        setImmediate(() => exportToCsv());
        console.log("POST /api/results - updated results successfully");
        res.json({ status: "success", message: "Results updated" });
      } else {
        res
          .status(500)
          .json({ status: "error", message: "Failed to save results" });
      }
    })
  );

app.post(
  "/api/backup",
  rateLimiter(5, 300),
  errorHandler(async (req, res) => {
    setImmediate(() => createBackup());
    res.json({ status: "success", message: "Backup creation started" });
  })
);

app.post(
  "/api/export-csv",
  rateLimiter(5, 300),
  errorHandler(async (req, res) => {
    setImmediate(async () => {
      const success = await exportToCsv();
      if (success) {
        console.log("CSV export completed successfully");
      } else {
        console.error("CSV export failed");
      }
    });
    res.json({ status: "success", message: "CSV export started" });
  })
);

app.post(
  "/api/clear-all",
  rateLimiter(2, 3600),
  errorHandler(async (req, res) => {
    await createBackup();

    await saveJsonFile(USERS_FILE, {});
    await saveJsonFile(GUESSES_FILE, {});
    await saveJsonFile(RESULTS_FILE, {});

    dataCache.users = {};
    dataCache.guesses = {};
    dataCache.actual_results = {};

    console.log("All data cleared successfully");
    res.json({ status: "success", message: "All data cleared" });
  })
);

app.post(
  "/api/restart-competition",
  rateLimiter(5, 3600),
  errorHandler(async (req, res) => {
    await createBackup();

    await saveJsonFile(GUESSES_FILE, {});
    await saveJsonFile(RESULTS_FILE, {});

    dataCache.guesses = {};
    dataCache.actual_results = {};

    console.log("Competition restarted successfully");
    res.json({ status: "success", message: "Competition restarted" });
  })
);

app.get(
  "/api/stats",
  rateLimiter(60, 60),
  errorHandler(async (req, res) => {
    const users = await loadJsonFile(USERS_FILE);
    const guesses = await loadJsonFile(GUESSES_FILE);
    const results = await loadJsonFile(RESULTS_FILE);

    const totalUsers = Object.keys(users).length;
    let totalPredictions = 0;

    for (const userGuesses of Object.values(guesses)) {
      for (const guess of Object.values(userGuesses)) {
        if (typeof guess === "object") {
          if (guess.midsem !== undefined && guess.midsem !== null) {
            totalPredictions++;
          }
          if (guess.compre !== undefined && guess.compre !== null) {
            totalPredictions++;
          }
        }
      }
    }

    const resultsSet = Object.values(results).reduce((sum, courseResults) => {
      return (
        sum +
        (typeof courseResults === "object"
          ? Object.keys(courseResults).length
          : 0)
      );
    }, 0);

    const uniqueCoursesPredict = new Set();
    for (const userGuesses of Object.values(guesses)) {
      Object.keys(userGuesses).forEach((course) =>
        uniqueCoursesPredict.add(course)
      );
    }

    res.json({
      total_users: totalUsers,
      total_predictions: totalPredictions,
      results_set: resultsSet,
      unique_courses_predicted: uniqueCoursesPredict.size,
      total_courses_available: Object.keys(COURSE_NAMES).length,
      server_uptime: Math.floor((Date.now() - serverStartTime) / 1000),
      last_updated: new Date().toISOString(),
    });
  })
);

app.get(
  "/api/system-info",
  rateLimiter(10, 60),
  errorHandler(async (req, res) => {
    try {
      const memUsage = process.memoryUsage();

      res.json({
        process: {
          memory_mb: Math.round((memUsage.rss / (1024 * 1024)) * 100) / 100,
          heap_used_mb:
            Math.round((memUsage.heapUsed / (1024 * 1024)) * 100) / 100,
          heap_total_mb:
            Math.round((memUsage.heapTotal / (1024 * 1024)) * 100) / 100,
          external_mb:
            Math.round((memUsage.external / (1024 * 1024)) * 100) / 100,
          uptime_seconds: Math.floor(process.uptime()),
        },
        cache_size: {
          users: Object.keys(dataCache.users || {}).length,
          guesses: Object.keys(dataCache.guesses || {}).length,
          results: Object.keys(dataCache.actual_results || {}).length,
        },
        node_version: process.version,
        platform: process.platform,
      });
    } catch (error) {
      console.error("Error getting system info:", error);
      res.status(500).json({ status: "error", message: error.message });
    }
  })
);

app.use((req, res) => {
  res.status(404).json({ status: "error", message: "Endpoint not found" });
});

app.use((err, req, res, next) => {
  console.error("Unhandled error:", err);

  if (err.type === "entity.too.large") {
    res.status(413).json({ status: "error", message: "Request too large" });
  } else {
    res.status(500).json({ status: "error", message: "Internal server error" });
  }
});

const initializeDataFiles = async () => {
  try {
    if (!fsSync.existsSync(USERS_FILE)) {
      await saveJsonFile(USERS_FILE, {});
      console.log("Initialized users.json");
    }

    if (!fsSync.existsSync(GUESSES_FILE)) {
      await saveJsonFile(GUESSES_FILE, {});
      console.log("Initialized guesses.json");
    }

    if (!fsSync.existsSync(RESULTS_FILE)) {
      await saveJsonFile(RESULTS_FILE, {});
      console.log("Initialized results.json");
    }

    await loadJsonFile(USERS_FILE);
    await loadJsonFile(GUESSES_FILE);
    await loadJsonFile(RESULTS_FILE);

    console.log("Data files initialized and cached");
  } catch (error) {
    console.error("Error initializing data files:", error);
    throw error;
  }
};

const periodicBackup = () => {
  setInterval(async () => {
    try {
      await createBackup();
      console.log("Periodic backup completed");
    } catch (error) {
      console.error("Periodic backup failed:", error);
    }
  }, 3600000);
};

const serverStartTime = Date.now();

const startServer = async () => {
  try {
    await ensureDirectories();
    await initializeDataFiles();

    console.log("BitBets Server Starting...");
    console.log(`Data directory: ${DATA_DIR}`);
    console.log(`Server will run on http://0.0.0.0:${PORT}`);
    console.log("Enhanced features:");
    console.log("  - Request rate limiting");
    console.log("  - Data caching");
    console.log("  - Atomic file writes");
    console.log("  - Automatic backups");
    console.log("  - Background CSV exports");
    console.log("  - Enhanced error handling");
    console.log("API endpoints:");
    console.log("  GET/POST /api/users");
    console.log("  GET/POST /api/guesses");
    console.log("  GET/POST /api/results");
    console.log("  POST /api/backup");
    console.log("  POST /api/export-csv");
    console.log("  GET /api/stats");
    console.log("  GET /api/system-info");
    console.log("  GET /health");

    await createBackup();
    periodicBackup();
    console.log("Periodic backup scheduled");

    app.listen(PORT, "0.0.0.0", () => {
      console.log(`Server running on port ${PORT}`);
    });
  } catch (error) {
    console.error("Failed to start server:", error);
    process.exit(1);
  }
};

startServer();
