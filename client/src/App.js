import React, { useState, useEffect } from 'react';
import { io } from 'socket.io-client';
import './App.css';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL || 'http://localhost:5000';
const socket = io(BACKEND_URL);

function App() {
  const [courses, setCourses] = useState([]);
  const [courseData, setCourseData] = useState({});
  const [filter, setFilter] = useState('All');
  const [isAdmin, setIsAdmin] = useState(false);
  const [adminPassword, setAdminPassword] = useState('');

  useEffect(() => {
    fetch(`${BACKEND_URL}/api/courses`)
      .then(res => res.json())
      .then(data => setCourses(data))
      .catch(err => console.error('Error fetching courses:', err));

    fetch(`${BACKEND_URL}/api/course-data`)
      .then(res => res.json())
      .then(data => setCourseData(data))
      .catch(err => console.error('Error fetching course data:', err));

    socket.on('predictedAverageUpdated', ({ courseCode, examType, average }) => {
      setCourseData(prevData => ({
        ...prevData,
        [courseCode]: {
          ...prevData[courseCode],
          [examType]: {
            ...prevData[courseCode][examType],
            predicted: parseFloat(average)
          }
        }
      }));
    });

    socket.on('actualAverageUpdated', ({ courseCode, examType, average }) => {
      setCourseData(prevData => ({
        ...prevData,
        [courseCode]: {
          ...prevData[courseCode],
          [examType]: {
            ...prevData[courseCode][examType],
            actual: parseFloat(average)
          }
        }
      }));
    });

    socket.on('predictionUpdated', ({ courseCode, examType, higherCount, lowerCount }) => {
      setCourseData(prevData => ({
        ...prevData,
        [courseCode]: {
          ...prevData[courseCode],
          userPredictions: {
            ...prevData[courseCode].userPredictions,
            [examType]: {
              higher: higherCount,
              lower: lowerCount
            }
          }
        }
      }));
    });

    return () => {
      socket.off('predictedAverageUpdated');
      socket.off('actualAverageUpdated');
      socket.off('predictionUpdated');
    };
  }, []);

  const categories = ['All', ...new Set(courses.flatMap(course => course.categories))];

  const filteredCourses = filter === 'All' 
    ? courses 
    : courses.filter(course => course.categories.includes(filter));

  const submitPrediction = (courseCode, examType, prediction) => {
    fetch(`${BACKEND_URL}/api/submit-prediction`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ courseCode, examType, prediction }),
    })
      .then(response => response.json())
      .catch(error => console.error('Error submitting prediction:', error));
  };

  const handleAdminLogin = (e) => {
    e.preventDefault();
    if (adminPassword === 'admin123') {
      setIsAdmin(true);
    } else {
      alert('Invalid password');
    }
  };

  const updateAverage = (courseCode, examType, isActual, value) => {
    const endpoint = isActual ? 'update-actual-average' : 'update-predicted-average';
    
    fetch(`${BACKEND_URL}/api/${endpoint}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ 
        courseCode, 
        examType, 
        average: parseFloat(value) 
      }),
    })
      .then(response => response.json())
      .catch(error => console.error(`Error updating ${isActual ? 'actual' : 'predicted'} average:`, error));
  };

  return (
    <div className="min-h-screen bg-gray-900 text-gray-100">
      <header className="bg-gray-800 py-4 px-6 shadow">
        <div className="container mx-auto flex justify-between items-center">
          <h1 className="text-2xl font-bold text-indigo-400">BITS Average Predictor</h1>
          {!isAdmin && (
            <button 
              onClick={() => document.getElementById('admin-modal').classList.remove('hidden')}
              className="px-4 py-2 bg-indigo-600 text-white rounded hover:bg-indigo-700"
            >
              Admin Login
            </button>
          )}
          {isAdmin && <span className="bg-green-700 px-3 py-1 rounded">Admin Mode</span>}
        </div>
      </header>
      
      <div className="container mx-auto p-6">
        <div className="mb-6">
          <h2 className="text-xl mb-3">Filter by Category:</h2>
          <div className="flex flex-wrap gap-2">
            {categories.map(category => (
              <button
                key={category}
                onClick={() => setFilter(category)}
                className={`px-3 py-1 rounded ${
                  filter === category ? 'bg-indigo-600' : 'bg-gray-700 hover:bg-gray-600'
                }`}
              >
                {category}
              </button>
            ))}
          </div>
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredCourses.map(course => (
            <div key={course.code} className="bg-gray-800 rounded-lg shadow p-6">
              <h2 className="text-xl font-bold mb-1 text-indigo-300">{course.code}</h2>
              <h3 className="text-lg mb-4">{course.name}</h3>
              
              {courseData[course.code] && (
                <>
                  <div className="mb-4">
                    <h4 className="font-semibold mb-2 text-gray-300">Midsem Exam</h4>
                    {isAdmin && (
                      <div className="mb-3 flex flex-col gap-2">
                        <div className="flex items-center">
                          <label className="mr-2">Predicted:</label>
                          <input 
                            type="number" 
                            className="bg-gray-700 text-white px-2 py-1 rounded w-20"
                            value={courseData[course.code].midsem.predicted || ''}
                            onChange={(e) => {
                              const newValue = e.target.value;
                              setCourseData(prev => ({
                                ...prev,
                                [course.code]: {
                                  ...prev[course.code],
                                  midsem: {
                                    ...prev[course.code].midsem,
                                    predicted: newValue ? parseFloat(newValue) : null
                                  }
                                }
                              }));
                            }}
                            onBlur={(e) => updateAverage(course.code, 'midsem', false, e.target.value)}
                          />
                        </div>
                        <div className="flex items-center">
                          <label className="mr-2">Actual:</label>
                          <input 
                            type="number" 
                            className="bg-gray-700 text-white px-2 py-1 rounded w-20"
                            value={courseData[course.code].midsem.actual || ''}
                            onChange={(e) => {
                              const newValue = e.target.value;
                              setCourseData(prev => ({
                                ...prev,
                                [course.code]: {
                                  ...prev[course.code],
                                  midsem: {
                                    ...prev[course.code].midsem,
                                    actual: newValue ? parseFloat(newValue) : null
                                  }
                                }
                              }));
                            }}
                            onBlur={(e) => updateAverage(course.code, 'midsem', true, e.target.value)}
                          />
                        </div>
                      </div>
                    )}
                    
                    {!isAdmin && (
                      <>
                        {courseData[course.code].midsem.predicted ? (
                          <div className="mb-2">
                            <p>Predicted Average: <span className="font-bold text-yellow-300">{courseData[course.code].midsem.predicted}</span></p>
                            
                            {courseData[course.code].midsem.actual ? (
                              <p>Actual Average: <span className="font-bold text-green-400">{courseData[course.code].midsem.actual}</span></p>
                            ) : (
                              <div className="mt-2">
                                <p className="mb-2">What's your prediction?</p>
                                <div className="flex gap-2">
                                  <button
                                    onClick={() => submitPrediction(course.code, 'midsem', 'higher')}
                                    className="px-3 py-1 bg-blue-600 rounded hover:bg-blue-700"
                                  >
                                    Higher
                                  </button>
                                  <button
                                    onClick={() => submitPrediction(course.code, 'midsem', 'lower')}
                                    className="px-3 py-1 bg-red-600 rounded hover:bg-red-700"
                                  >
                                    Lower
                                  </button>
                                </div>
                              </div>
                            )}
                          </div>
                        ) : (
                          <p className="italic text-gray-400">Predicted average not yet available</p>
                        )}
                        
                        {/* Display prediction stats */}
                        {(courseData[course.code].userPredictions.midsem.higher > 0 || 
                         courseData[course.code].userPredictions.midsem.lower > 0) && (
                          <div className="mt-2 text-sm">
                            <p>Community predictions:</p>
                            <div className="flex justify-between">
                              <span>Higher: {courseData[course.code].userPredictions.midsem.higher}</span>
                              <span>Lower: {courseData[course.code].userPredictions.midsem.lower}</span>
                            </div>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                  
                  <div>
                    <h4 className="font-semibold mb-2 text-gray-300">Comprehensive Exam</h4>
                    {isAdmin && (
                      <div className="mb-3 flex flex-col gap-2">
                        <div className="flex items-center">
                          <label className="mr-2">Predicted:</label>
                          <input 
                            type="number" 
                            className="bg-gray-700 text-white px-2 py-1 rounded w-20"
                            value={courseData[course.code].comprehensive.predicted || ''}
                            onChange={(e) => {
                              const newValue = e.target.value;
                              setCourseData(prev => ({
                                ...prev,
                                [course.code]: {
                                  ...prev[course.code],
                                  comprehensive: {
                                    ...prev[course.code].comprehensive,
                                    predicted: newValue ? parseFloat(newValue) : null
                                  }
                                }
                              }));
                            }}
                            onBlur={(e) => updateAverage(course.code, 'comprehensive', false, e.target.value)}
                          />
                        </div>
                        <div className="flex items-center">
                          <label className="mr-2">Actual:</label>
                          <input 
                            type="number" 
                            className="bg-gray-700 text-white px-2 py-1 rounded w-20"
                            value={courseData[course.code].comprehensive.actual || ''}
                            onChange={(e) => {
                              const newValue = e.target.value;
                              setCourseData(prev => ({
                                ...prev,
                                [course.code]: {
                                  ...prev[course.code],
                                  comprehensive: {
                                    ...prev[course.code].comprehensive,
                                    actual: newValue ? parseFloat(newValue) : null
                                  }
                                }
                              }));
                            }}
                            onBlur={(e) => updateAverage(course.code, 'comprehensive', true, e.target.value)}
                          />
                        </div>
                      </div>
                    )}
                    
                    {!isAdmin && (
                      <>
                        {courseData[course.code].comprehensive.predicted ? (
                          <div>
                            <p>Predicted Average: <span className="font-bold text-yellow-300">{courseData[course.code].comprehensive.predicted}</span></p>
                            
                            {courseData[course.code].comprehensive.actual ? (
                              <p>Actual Average: <span className="font-bold text-green-400">{courseData[course.code].comprehensive.actual}</span></p>
                            ) : (
                              <div className="mt-2">
                                <p className="mb-2">What's your prediction?</p>
                                <div className="flex gap-2">
                                  <button
                                    onClick={() => submitPrediction(course.code, 'comprehensive', 'higher')}
                                    className="px-3 py-1 bg-blue-600 rounded hover:bg-blue-700"
                                  >
                                    Higher
                                  </button>
                                  <button
                                    onClick={() => submitPrediction(course.code, 'comprehensive', 'lower')}
                                    className="px-3 py-1 bg-red-600 rounded hover:bg-red-700"
                                  >
                                    Lower
                                  </button>
                                </div>
                              </div>
                            )}
                          </div>
                        ) : (
                          <p className="italic text-gray-400">Predicted average not yet available</p>
                        )}
                        
                        {/* Display prediction stats */}
                        {(courseData[course.code].userPredictions.comprehensive.higher > 0 || 
                         courseData[course.code].userPredictions.comprehensive.lower > 0) && (
                          <div className="mt-2 text-sm">
                            <p>Community predictions:</p>
                            <div className="flex justify-between">
                              <span>Higher: {courseData[course.code].userPredictions.comprehensive.higher}</span>
                              <span>Lower: {courseData[course.code].userPredictions.comprehensive.lower}</span>
                            </div>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                </>
              )}
            </div>
          ))}
        </div>
      </div>
      
      {/* Admin Login Modal */}
      <div id="admin-modal" className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center hidden">
        <div className="bg-gray-800 p-6 rounded-lg shadow-lg w-80">
          <h2 className="text-xl font-bold mb-4">Admin Login</h2>
          <form onSubmit={handleAdminLogin}>
            <div className="mb-4">
              <label className="block mb-1">Password</label>
              <input
                type="password"
                value={adminPassword}
                onChange={(e) => setAdminPassword(e.target.value)}
                className="w-full bg-gray-700 text-white px-3 py-2 rounded"
                required
              />
            </div>
            <div className="flex justify-between">
              <button
                type="submit"
                className="px-4 py-2 bg-indigo-600 text-white rounded hover:bg-indigo-700"
              >
                Login
              </button>
              <button
                type="button"
                onClick={() => {
                  document.getElementById('admin-modal').classList.add('hidden');
                  setAdminPassword('');
                }}
                className="px-4 py-2 bg-gray-600 text-white rounded hover:bg-gray-700"
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}

export default App;