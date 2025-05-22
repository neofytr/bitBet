from flask import Flask, request, jsonify
from flask_cors import CORS
import json
import csv
import os
from datetime import datetime
import logging

app = Flask(__name__)

# Configure CORS to allow all origins for now (you can restrict this later)
CORS(app, origins=["*"])

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Configuration
DATA_DIR = 'bitbets_data'
USERS_FILE = os.path.join(DATA_DIR, 'users.json')
GUESSES_FILE = os.path.join(DATA_DIR, 'guesses.json')
RESULTS_FILE = os.path.join(DATA_DIR, 'actual_results.json')
BACKUP_DIR = os.path.join(DATA_DIR, 'backups')

# Course names for CSV export
COURSE_NAMES = {
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
}

def ensure_directories():
    """Create necessary directories if they don't exist"""
    try:
        os.makedirs(DATA_DIR, exist_ok=True)
        os.makedirs(BACKUP_DIR, exist_ok=True)
        logger.info(f"Directories created/verified: {DATA_DIR}, {BACKUP_DIR}")
    except Exception as e:
        logger.error(f"Error creating directories: {e}")

def load_json_file(filepath, default=None):
    """Load JSON file, return default if file doesn't exist"""
    if default is None:
        default = {}
    try:
        if os.path.exists(filepath):
            with open(filepath, 'r') as f:
                data = json.load(f)
                logger.info(f"Loaded {filepath} successfully")
                return data
        logger.info(f"File {filepath} doesn't exist, returning default")
        return default
    except Exception as e:
        logger.error(f"Error loading {filepath}: {e}")
        return default

def save_json_file(filepath, data):
    """Save data to JSON file"""
    try:
        with open(filepath, 'w') as f:
            json.dump(data, f, indent=2)
        logger.info(f"Saved {filepath} successfully")
        return True
    except Exception as e:
        logger.error(f"Error saving {filepath}: {e}")
        return False

def create_backup():
    """Create a backup of all data"""
    try:
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        backup_file = os.path.join(BACKUP_DIR, f'backup_{timestamp}.json')
        
        all_data = {
            'users': load_json_file(USERS_FILE),
            'guesses': load_json_file(GUESSES_FILE),
            'actual_results': load_json_file(RESULTS_FILE),
            'backup_time': datetime.now().isoformat()
        }
        
        save_json_file(backup_file, all_data)
        logger.info(f"Backup created: {backup_file}")
    except Exception as e:
        logger.error(f"Error creating backup: {e}")

def export_to_csv():
    """Export all data to CSV files using built-in csv module"""
    try:
        users = load_json_file(USERS_FILE)
        guesses = load_json_file(GUESSES_FILE)
        results = load_json_file(RESULTS_FILE)
        
        # Export guesses to CSV
        guesses_csv_file = os.path.join(DATA_DIR, 'guesses_export.csv')
        with open(guesses_csv_file, 'w', newline='', encoding='utf-8') as csvfile:
            fieldnames = ['Username', 'Course', 'Course Name', 'Midsem Guess', 'Compre Guess', 'Timestamp']
            writer = csv.DictWriter(csvfile, fieldnames=fieldnames)
            writer.writeheader()
            
            for username, user_guesses in guesses.items():
                for course, guess_data in user_guesses.items():
                    writer.writerow({
                        'Username': username,
                        'Course': course,
                        'Course Name': COURSE_NAMES.get(course, course),
                        'Midsem Guess': guess_data.get('midsem', ''),
                        'Compre Guess': guess_data.get('compre', ''),
                        'Timestamp': guess_data.get('timestamp', '')
                    })
        
        logger.info(f"Guesses exported to: {guesses_csv_file}")
        
        # Export results to CSV
        results_csv_file = os.path.join(DATA_DIR, 'results_export.csv')
        with open(results_csv_file, 'w', newline='', encoding='utf-8') as csvfile:
            fieldnames = ['Course', 'Course Name', 'Exam Type', 'Average']
            writer = csv.DictWriter(csvfile, fieldnames=fieldnames)
            writer.writeheader()
            
            for course, course_results in results.items():
                for exam_type, average in course_results.items():
                    writer.writerow({
                        'Course': course,
                        'Course Name': COURSE_NAMES.get(course, course),
                        'Exam Type': exam_type,
                        'Average': average
                    })
        
        logger.info(f"Results exported to: {results_csv_file}")
        
        # Export detailed analysis CSV
        analysis_csv_file = os.path.join(DATA_DIR, 'detailed_analysis.csv')
        with open(analysis_csv_file, 'w', newline='', encoding='utf-8') as csvfile:
            fieldnames = ['Course', 'Course Name', 'Exam Type', 'Username', 'User Guess', 'Actual Average', 'Difference', 'Is Winner']
            writer = csv.DictWriter(csvfile, fieldnames=fieldnames)
            writer.writeheader()
            
            for course, course_results in results.items():
                for exam_type, actual_avg in course_results.items():
                    # Find all users who made guesses for this course/exam
                    for username, user_guesses in guesses.items():
                        if course in user_guesses and user_guesses[course].get(exam_type) is not None:
                            user_guess = user_guesses[course][exam_type]
                            difference = abs(actual_avg - user_guess)
                            is_winner = difference <= 1
                            
                            writer.writerow({
                                'Course': course,
                                'Course Name': COURSE_NAMES.get(course, course),
                                'Exam Type': exam_type,
                                'Username': username,
                                'User Guess': user_guess,
                                'Actual Average': actual_avg,
                                'Difference': round(difference, 2),
                                'Is Winner': 'Yes' if is_winner else 'No'
                            })
        
        logger.info(f"Detailed analysis exported to: {analysis_csv_file}")
            
    except Exception as e:
        logger.error(f"Error exporting to CSV: {e}")

@app.route('/', methods=['GET'])
def root():
    return jsonify({
        'message': 'BitBets API Server is running!',
        'status': 'healthy',
        'timestamp': datetime.now().isoformat(),
        'endpoints': [
            'GET/POST /api/users',
            'GET/POST /api/guesses',
            'GET/POST /api/results',
            'GET /health',
            'GET /api/stats',
            'POST /api/backup',
            'POST /api/export-csv',
            'POST /api/clear-all',
            'POST /api/restart-competition'
        ]
    })

@app.route('/health', methods=['GET'])
def health_check():
    return jsonify({
        'status': 'healthy', 
        'timestamp': datetime.now().isoformat(),
        'data_directory': DATA_DIR,
        'files_exist': {
            'users': os.path.exists(USERS_FILE),
            'guesses': os.path.exists(GUESSES_FILE),
            'results': os.path.exists(RESULTS_FILE)
        }
    })

@app.route('/api/users', methods=['GET', 'POST'])
def handle_users():
    try:
        if request.method == 'GET':
            users = load_json_file(USERS_FILE)
            logger.info(f"GET /api/users - returning {len(users)} users")
            return jsonify(users)
        
        elif request.method == 'POST':
            data = request.get_json()
            if not data:
                return jsonify({'status': 'error', 'message': 'No data provided'}), 400
                
            users = load_json_file(USERS_FILE)
            users.update(data)
            
            if save_json_file(USERS_FILE, users):
                logger.info(f"POST /api/users - updated users successfully")
                return jsonify({'status': 'success', 'message': 'Users updated'})
            else:
                return jsonify({'status': 'error', 'message': 'Failed to save users'}), 500
    except Exception as e:
        logger.error(f"Error in handle_users: {e}")
        return jsonify({'status': 'error', 'message': str(e)}), 500

@app.route('/api/guesses', methods=['GET', 'POST'])
def handle_guesses():
    try:
        if request.method == 'GET':
            guesses = load_json_file(GUESSES_FILE)
            logger.info(f"GET /api/guesses - returning guesses for {len(guesses)} users")
            return jsonify(guesses)
        
        elif request.method == 'POST':
            data = request.get_json()
            if not data:
                return jsonify({'status': 'error', 'message': 'No data provided'}), 400
                
            guesses = load_json_file(GUESSES_FILE)
            guesses.update(data)
            
            if save_json_file(GUESSES_FILE, guesses):
                # Auto-export CSV when guesses are updated
                export_to_csv()
                logger.info(f"POST /api/guesses - updated guesses successfully")
                return jsonify({'status': 'success', 'message': 'Guesses updated'})
            else:
                return jsonify({'status': 'error', 'message': 'Failed to save guesses'}), 500
    except Exception as e:
        logger.error(f"Error in handle_guesses: {e}")
        return jsonify({'status': 'error', 'message': str(e)}), 500

@app.route('/api/results', methods=['GET', 'POST'])
def handle_results():
    try:
        if request.method == 'GET':
            results = load_json_file(RESULTS_FILE)
            logger.info(f"GET /api/results - returning results for {len(results)} courses")
            return jsonify(results)
        
        elif request.method == 'POST':
            data = request.get_json()
            if not data:
                return jsonify({'status': 'error', 'message': 'No data provided'}), 400
                
            results = load_json_file(RESULTS_FILE)
            results.update(data)
            
            if save_json_file(RESULTS_FILE, results):
                # Auto-export CSV when results are updated
                export_to_csv()
                logger.info(f"POST /api/results - updated results successfully")
                return jsonify({'status': 'success', 'message': 'Results updated'})
            else:
                return jsonify({'status': 'error', 'message': 'Failed to save results'}), 500
    except Exception as e:
        logger.error(f"Error in handle_results: {e}")
        return jsonify({'status': 'error', 'message': str(e)}), 500

@app.route('/api/backup', methods=['POST'])
def create_manual_backup():
    try:
        create_backup()
        return jsonify({'status': 'success', 'message': 'Backup created'})
    except Exception as e:
        logger.error(f"Error creating backup: {e}")
        return jsonify({'status': 'error', 'message': str(e)}), 500

@app.route('/api/export-csv', methods=['POST'])
def manual_csv_export():
    try:
        export_to_csv()
        return jsonify({'status': 'success', 'message': 'Data exported to CSV'})
    except Exception as e:
        logger.error(f"Error exporting CSV: {e}")
        return jsonify({'status': 'error', 'message': str(e)}), 500

@app.route('/api/clear-all', methods=['POST'])
def clear_all_data():
    try:
        # Create backup before clearing
        create_backup()
        
        # Clear all files
        save_json_file(USERS_FILE, {})
        save_json_file(GUESSES_FILE, {})
        save_json_file(RESULTS_FILE, {})
        
        logger.info("All data cleared successfully")
        return jsonify({'status': 'success', 'message': 'All data cleared'})
    except Exception as e:
        logger.error(f"Error clearing data: {e}")
        return jsonify({'status': 'error', 'message': f'Failed to clear data: {str(e)}'}), 500

@app.route('/api/restart-competition', methods=['POST'])
def restart_competition():
    try:
        # Create backup before restarting
        create_backup()
        
        # Keep users but clear guesses and results
        save_json_file(GUESSES_FILE, {})
        save_json_file(RESULTS_FILE, {})
        
        logger.info("Competition restarted successfully")
        return jsonify({'status': 'success', 'message': 'Competition restarted'})
    except Exception as e:
        logger.error(f"Error restarting competition: {e}")
        return jsonify({'status': 'error', 'message': f'Failed to restart competition: {str(e)}'}), 500

@app.route('/api/stats', methods=['GET'])
def get_stats():
    try:
        users = load_json_file(USERS_FILE)
        guesses = load_json_file(GUESSES_FILE)
        results = load_json_file(RESULTS_FILE)
        
        total_users = len(users)
        total_predictions = 0
        
        for user_guesses in guesses.values():
            for guess in user_guesses.values():
                if guess.get('midsem') is not None:
                    total_predictions += 1
                if guess.get('compre') is not None:
                    total_predictions += 1
        
        results_set = sum(len(course_results) for course_results in results.values())
        
        return jsonify({
            'total_users': total_users,
            'total_predictions': total_predictions,
            'results_set': results_set
        })
    except Exception as e:
        logger.error(f"Error getting stats: {e}")
        return jsonify({'status': 'error', 'message': str(e)}), 500

@app.errorhandler(404)
def not_found(error):
    return jsonify({'status': 'error', 'message': 'Endpoint not found'}), 404

@app.errorhandler(500)
def internal_error(error):
    return jsonify({'status': 'error', 'message': 'Internal server error'}), 500

if __name__ == '__main__':
    ensure_directories()
    logger.info("BitBets Server Starting...")
    logger.info(f"Data directory: {DATA_DIR}")
    logger.info("Server will run on http://0.0.0.0:5000")
    logger.info("API endpoints:")
    logger.info("  GET/POST /api/users")
    logger.info("  GET/POST /api/guesses") 
    logger.info("  GET/POST /api/results")
    logger.info("  POST /api/backup")
    logger.info("  POST /api/export-csv")
    logger.info("  GET /api/stats")
    logger.info("  GET /health")
    
    # Create initial backup on startup
    create_backup()
    
    # Run the server
    app.run(host="0.0.0.0", port=5000, debug=False)