from flask import Flask, request, jsonify
from flask_cors import CORS
import json
import csv
import os
from datetime import datetime

app = Flask(__name__)
CORS(app, origins=["https://bit-bet-1mcw.vercel.app/", "http://localhost:5000"])  # Add your Vercel domain

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
    os.makedirs(DATA_DIR, exist_ok=True)
    os.makedirs(BACKUP_DIR, exist_ok=True)

def load_json_file(filepath, default=None):
    """Load JSON file, return default if file doesn't exist"""
    if default is None:
        default = {}
    try:
        if os.path.exists(filepath):
            with open(filepath, 'r') as f:
                return json.load(f)
        return default
    except Exception as e:
        print(f"Error loading {filepath}: {e}")
        return default

def save_json_file(filepath, data):
    """Save data to JSON file"""
    try:
        with open(filepath, 'w') as f:
            json.dump(data, f, indent=2)
        return True
    except Exception as e:
        print(f"Error saving {filepath}: {e}")
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
        print(f"Backup created: {backup_file}")
    except Exception as e:
        print(f"Error creating backup: {e}")

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
        
        print(f"Guesses exported to: {guesses_csv_file}")
        
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
        
        print(f"Results exported to: {results_csv_file}")
        
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
        
        print(f"Detailed analysis exported to: {analysis_csv_file}")
            
    except Exception as e:
        print(f"Error exporting to CSV: {e}")

@app.route('/api/users', methods=['GET', 'POST'])
def handle_users():
    if request.method == 'GET':
        users = load_json_file(USERS_FILE)
        return jsonify(users)
    
    elif request.method == 'POST':
        data = request.get_json()
        users = load_json_file(USERS_FILE)
        users.update(data)
        
        if save_json_file(USERS_FILE, users):
            return jsonify({'status': 'success', 'message': 'Users updated'})
        else:
            return jsonify({'status': 'error', 'message': 'Failed to save users'}), 500

@app.route('/api/guesses', methods=['GET', 'POST'])
def handle_guesses():
    if request.method == 'GET':
        guesses = load_json_file(GUESSES_FILE)
        return jsonify(guesses)
    
    elif request.method == 'POST':
        data = request.get_json()
        guesses = load_json_file(GUESSES_FILE)
        guesses.update(data)
        
        if save_json_file(GUESSES_FILE, guesses):
            # Auto-export CSV when guesses are updated
            export_to_csv()
            return jsonify({'status': 'success', 'message': 'Guesses updated'})
        else:
            return jsonify({'status': 'error', 'message': 'Failed to save guesses'}), 500

@app.route('/api/results', methods=['GET', 'POST'])
def handle_results():
    if request.method == 'GET':
        results = load_json_file(RESULTS_FILE)
        return jsonify(results)
    
    elif request.method == 'POST':
        data = request.get_json()
        results = load_json_file(RESULTS_FILE)
        results.update(data)
        
        if save_json_file(RESULTS_FILE, results):
            # Auto-export CSV when results are updated
            export_to_csv()
            return jsonify({'status': 'success', 'message': 'Results updated'})
        else:
            return jsonify({'status': 'error', 'message': 'Failed to save results'}), 500

@app.route('/api/backup', methods=['POST'])
def create_manual_backup():
    create_backup()
    return jsonify({'status': 'success', 'message': 'Backup created'})

@app.route('/api/export-csv', methods=['POST'])
def manual_csv_export():
    export_to_csv()
    return jsonify({'status': 'success', 'message': 'Data exported to CSV'})

@app.route('/api/clear-all', methods=['POST'])
def clear_all_data():
    try:
        # Create backup before clearing
        create_backup()
        
        # Clear all files
        save_json_file(USERS_FILE, {})
        save_json_file(GUESSES_FILE, {})
        save_json_file(RESULTS_FILE, {})
        
        return jsonify({'status': 'success', 'message': 'All data cleared'})
    except Exception as e:
        return jsonify({'status': 'error', 'message': f'Failed to clear data: {str(e)}'}), 500

@app.route('/api/restart-competition', methods=['POST'])
def restart_competition():
    try:
        # Create backup before restarting
        create_backup()
        
        # Keep users but clear guesses and results
        save_json_file(GUESSES_FILE, {})
        save_json_file(RESULTS_FILE, {})
        
        return jsonify({'status': 'success', 'message': 'Competition restarted'})
    except Exception as e:
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
        return jsonify({'status': 'error', 'message': str(e)}), 500

@app.route('/health', methods=['GET'])
def health_check():
    return jsonify({'status': 'healthy', 'timestamp': datetime.now().isoformat()})

if __name__ == '__main__':
    ensure_directories()
    print("BitBets Server Starting...")
    print(f"Data directory: {DATA_DIR}")
    print("Server will run on http://0.0.0.0:5000")  # Changed to listen on all interfaces
    print("API endpoints:")
    print("  GET/POST /api/users")
    print("  GET/POST /api/guesses") 
    print("  GET/POST /api/results")
    print("  POST /api/backup")
    print("  POST /api/export-csv")
    print("  GET /api/stats")
    print("  GET /health")
    
    # Create initial backup on startup
    create_backup()
    
    app.run(host="0.0.0.0", port=5000, debug=False)  # Changed to listen on all interfaces