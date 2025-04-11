const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'build')));

const courseData = {};

const courses = [
  { code: "MATH F111", name: "Mathematics I", categories: ["First Year"] },
  { code: "PHY F111", name: "Mechanics, Oscillations and Waves", categories: ["First Year"] },
  { code: "CHEM F111", name: "General Chemistry", categories: ["First Year"] },
  { code: "BIO F111", name: "General Biology", categories: ["First Year"] },
  { code: "BITS F110", name: "Engineering Graphics", categories: ["First Year"] },
  { code: "MATH F112", name: "Mathematics II", categories: ["First Year"] },
  { code: "ME F112", name: "Workshop Practice", categories: ["First Year"] },
  { code: "CS F111", name: "Computer Programming", categories: ["First Year"] },
  { code: "EEE F111", name: "Electrical Sciences", categories: ["First Year"] },
  { code: "BITS F112", name: "Technical Report Writing", categories: ["First Year"] },
  { code: "MATH F113", name: "Probability and Statistics", categories: ["First Year"] },
  { code: "BITS F111", name: "Thermodynamics", categories: ["First Year"] }
];

courses.forEach(course => {
  courseData[course.code] = {
    name: course.name,
    categories: course.categories,
    midsem: {
      predicted: null,
      actual: null
    },
    comprehensive: {
      predicted: null,
      actual: null
    },
    userPredictions: {
      midsem: { higher: 0, lower: 0 },
      comprehensive: { higher: 0, lower: 0 }
    }
  };
});

app.get('/api/courses', (req, res) => {
  res.json(courses);
});

app.get('/api/course-data', (req, res) => {
  res.json(courseData);
});

app.post('/api/update-predicted-average', (req, res) => {
  const { courseCode, examType, average } = req.body;
  
  if (!courseData[courseCode]) {
    return res.status(404).json({ error: 'Course not found' });
  }
  
  if (examType !== 'midsem' && examType !== 'comprehensive') {
    return res.status(400).json({ error: 'Invalid exam type' });
  }
  
  courseData[courseCode][examType].predicted = parseFloat(average);
  
  io.emit('predictedAverageUpdated', { courseCode, examType, average });
  
  res.json({ success: true });
});

app.post('/api/update-actual-average', (req, res) => {
  const { courseCode, examType, average } = req.body;
  
  if (!courseData[courseCode]) {
    return res.status(404).json({ error: 'Course not found' });
  }
  
  if (examType !== 'midsem' && examType !== 'comprehensive') {
    return res.status(400).json({ error: 'Invalid exam type' });
  }
  
  courseData[courseCode][examType].actual = parseFloat(average);
  
  io.emit('actualAverageUpdated', { courseCode, examType, average });
  
  res.json({ success: true });
});

app.post('/api/submit-prediction', (req, res) => {
  const { courseCode, examType, prediction } = req.body;
  
  if (!courseData[courseCode]) {
    return res.status(404).json({ error: 'Course not found' });
  }
  
  if (examType !== 'midsem' && examType !== 'comprehensive') {
    return res.status(400).json({ error: 'Invalid exam type' });
  }
  
  if (prediction !== 'higher' && prediction !== 'lower') {
    return res.status(400).json({ error: 'Prediction must be either higher or lower' });
  }
  
  courseData[courseCode].userPredictions[examType][prediction]++;
  
  io.emit('predictionUpdated', { 
    courseCode, 
    examType, 
    higherCount: courseData[courseCode].userPredictions[examType].higher,
    lowerCount: courseData[courseCode].userPredictions[examType].lower
  });
  
  res.json({ success: true });
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'build', 'index.html'));
});

io.on('connection', (socket) => {
  console.log('New client connected');
  
  socket.on('disconnect', () => {
    console.log('Client disconnected');
  });
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});