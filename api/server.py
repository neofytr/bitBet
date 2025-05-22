from flask import Flask, request, jsonify
from flask_cors import CORS
import json
import csv
import os
from datetime import datetime
import logging
import tempfile
import io

# Initialize Flask app
app = Flask(__name__)

# Configure CORS to allow all origins for now (you can restrict this later)
CORS(app, origins=["*"])

# Configure logging for Vercel
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Vercel serverless environment considerations
# We'll use environment variables for persistent storage or external storage
# For now, we'll use temporary files that reset on each deployment

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

# Global variables to store data in memory (resets on each cold start)
users_data = {}
guesses_data = {}
results_data = {}

def get_data_from_env():
    """Load data from environment variables if available"""
    global users_data, guesses_data, results_data
    
    try:
        users_env = os.environ.get('BITBETS_USERS', '{}')
        guesses_env = os.environ.get('BITBETS_GUESSES', '{}')
        results_env = os.environ.get('BITBETS_RESULTS', '{}')
        
        users_data = json.loads(users_env)
        guesses_data = json.loads(guesses_env)
        results_data = json.loads(results_env)
        
        logger.info("Data loaded from environment variables")
    except Exception as e:
        logger.warning(f"Could not load from environment variables: {e}")
        users_data = {}
        guesses_data = {}
        results_data = {}

def export_to_csv_memory():
    """Export all data to CSV in memory and return as downloadable content"""
    try:
        # Create CSV content in memory
        csv_data = {}
        
        # Export guesses to CSV
        guesses_output = io.StringIO()
        fieldnames = ['Username', 'Course', 'Course Name', 'Midsem Guess', 'Compre Guess', 'Timestamp']
        writer = csv.DictWriter(guesses_output, fieldnames=fieldnames)
        writer.writeheader()
        
        for username, user_guesses in guesses_data.items():
            for course, guess_data in user_guesses.items():
                writer.writerow({
                    'Username': username,
                    'Course': course,
                    'Course Name': COURSE_NAMES.get(course, course),
                    'Midsem Guess': guess_data.get('midsem', ''),
                    'Compre Guess': guess_data.get('compre', ''),
                    'Timestamp': guess_data.get('timestamp', '')
                })
        
        csv_data['guesses'] = guesses_output.getvalue()
        guesses_output.close()
        
        # Export results to CSV
        results_output = io.StringIO()
        fieldnames = ['Course', 'Course Name', 'Exam Type', 'Average']
        writer = csv.DictWriter(results_output, fieldnames=fieldnames)
        writer.writeheader()
        
        for course, course_results in results_data.items():
            for exam_type, average in course_results.items():
                writer.writerow({
                    'Course': course,
                    'Course Name': COURSE_NAMES.get(course, course),
                    'Exam Type': exam_type,
                    'Average': average
                })
        
        csv_data['results'] = results_output.getvalue()
        results_output.close()
        
        # Export detailed analysis CSV
        analysis_output = io.StringIO()
        fieldnames = ['Course', 'Course Name', 'Exam Type', 'Username', 'User Guess', 'Actual Average', 'Difference', 'Is Winner']
        writer = csv.DictWriter(analysis_output, fieldnames=fieldnames)
        writer.writeheader()
        
        for course, course_results in results_data.items():
            for exam_type, actual_avg in course_results.items():
                # Find all users who made guesses for this course/exam
                for username, user_guesses in guesses_data.items():
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
        
        csv_data['analysis'] = analysis_output.getvalue()
        analysis_output.close()
        
        logger.info("CSV export generated in memory")
        return csv_data
            
    except Exception as e:
        logger.error(f"Error exporting to CSV: {e}")
        return None

@app.route('/', methods=['GET'])
def root():
    return jsonify({
        'message': 'BitBets API Server is running on Vercel!',
        'status': 'healthy',
        'timestamp': datetime.now().isoformat(),
        'platform': 'Vercel Serverless',
        'endpoints': [
            'GET/POST /api/users',
            'GET/POST /api/guesses',
            'GET/POST /api/results',
            'GET /health',
            'GET /api/stats',
            'POST /api/backup',
            'GET /api/export-csv',
            'POST /api/clear-all',
            'POST /api/restart-competition'
        ]
    })

@app.route('/health', methods=['GET'])
def health_check():
    return jsonify({
        'status': 'healthy', 
        'timestamp': datetime.now().isoformat(),
        'platform': 'Vercel Serverless',
        'data_loaded': {
            'users': len(users_data) > 0,
            'guesses': len(guesses_data) > 0,
            'results': len(results_data) > 0
        },
        'memory_storage': True
    })

@app.route('/api/users', methods=['GET', 'POST'])
def handle_users():
    try:
        if request.method == 'GET':
            logger.info(f"GET /api/users - returning {len(users_data)} users")
            return jsonify(users_data)
        
        elif request.method == 'POST':
            data = request.get_json()
            if not data:
                return jsonify({'status': 'error', 'message': 'No data provided'}), 400
                
            users_data.update(data)
            logger.info(f"POST /api/users - updated users successfully")
            return jsonify({'status': 'success', 'message': 'Users updated', 'note': 'Data stored in memory - will reset on deployment'})
            
    except Exception as e:
        logger.error(f"Error in handle_users: {e}")
        return jsonify({'status': 'error', 'message': str(e)}), 500

@app.route('/api/guesses', methods=['GET', 'POST'])
def handle_guesses():
    try:
        if request.method == 'GET':
            logger.info(f"GET /api/guesses - returning guesses for {len(guesses_data)} users")
            return jsonify(guesses_data)
        
        elif request.method == 'POST':
            data = request.get_json()
            if not data:
                return jsonify({'status': 'error', 'message': 'No data provided'}), 400
                
            guesses_data.update(data)
            logger.info(f"POST /api/guesses - updated guesses successfully")
            return jsonify({'status': 'success', 'message': 'Guesses updated', 'note': 'Data stored in memory - will reset on deployment'})
            
    except Exception as e:
        logger.error(f"Error in handle_guesses: {e}")
        return jsonify({'status': 'error', 'message': str(e)}), 500

@app.route('/api/results', methods=['GET', 'POST'])
def handle_results():
    try:
        if request.method == 'GET':
            logger.info(f"GET /api/results - returning results for {len(results_data)} courses")
            return jsonify(results_data)
        
        elif request.method == 'POST':
            data = request.get_json()
            if not data:
                return jsonify({'status': 'error', 'message': 'No data provided'}), 400
                
            results_data.update(data)
            logger.info(f"POST /api/results - updated results successfully")
            return jsonify({'status': 'success', 'message': 'Results updated', 'note': 'Data stored in memory - will reset on deployment'})
            
    except Exception as e:
        logger.error(f"Error in handle_results: {e}")
        return jsonify({'status': 'error', 'message': str(e)}), 500

@app.route('/api/backup', methods=['POST'])
def create_manual_backup():
    try:
        # In serverless environment, we'll return the data as JSON for backup
        backup_data = {
            'users': users_data,
            'guesses': guesses_data,
            'results': results_data,
            'backup_time': datetime.now().isoformat(),
            'platform': 'Vercel Serverless'
        }
        
        return jsonify({
            'status': 'success', 
            'message': 'Backup data generated',
            'backup_data': backup_data,
            'note': 'Save this JSON data externally for persistence'
        })
    except Exception as e:
        logger.error(f"Error creating backup: {e}")
        return jsonify({'status': 'error', 'message': str(e)}), 500

@app.route('/api/export-csv', methods=['GET'])
def manual_csv_export():
    try:
        csv_data = export_to_csv_memory()
        if csv_data:
            return jsonify({
                'status': 'success', 
                'message': 'CSV data generated',
                'csv_data': csv_data,
                'note': 'Use the CSV content to create downloadable files'
            })
        else:
            return jsonify({'status': 'error', 'message': 'Failed to generate CSV data'}), 500
    except Exception as e:
        logger.error(f"Error exporting CSV: {e}")
        return jsonify({'status': 'error', 'message': str(e)}), 500

@app.route('/api/clear-all', methods=['POST'])
def clear_all_data():
    try:
        global users_data, guesses_data, results_data
        
        # Store backup before clearing
        backup_data = {
            'users': users_data.copy(),
            'guesses': guesses_data.copy(),
            'results': results_data.copy(),
            'cleared_at': datetime.now().isoformat()
        }
        
        # Clear all data
        users_data = {}
        guesses_data = {}
        results_data = {}
        
        logger.info("All data cleared successfully")
        return jsonify({
            'status': 'success', 
            'message': 'All data cleared',
            'backup_data': backup_data,
            'note': 'Data cleared from memory - backup included in response'
        })
    except Exception as e:
        logger.error(f"Error clearing data: {e}")
        return jsonify({'status': 'error', 'message': f'Failed to clear data: {str(e)}'}), 500

@app.route('/api/restart-competition', methods=['POST'])
def restart_competition():
    try:
        global guesses_data, results_data
        
        # Store backup before restarting
        backup_data = {
            'users': users_data.copy(),
            'guesses': guesses_data.copy(),
            'results': results_data.copy(),
            'restarted_at': datetime.now().isoformat()
        }
        
        # Keep users but clear guesses and results
        guesses_data = {}
        results_data = {}
        
        logger.info("Competition restarted successfully")
        return jsonify({
            'status': 'success', 
            'message': 'Competition restarted',
            'backup_data': backup_data,
            'note': 'Users preserved, guesses and results cleared'
        })
    except Exception as e:
        logger.error(f"Error restarting competition: {e}")
        return jsonify({'status': 'error', 'message': f'Failed to restart competition: {str(e)}'}), 500

@app.route('/api/stats', methods=['GET'])
def get_stats():
    try:
        total_users = len(users_data)
        total_predictions = 0
        
        for user_guesses in guesses_data.values():
            for guess in user_guesses.values():
                if guess.get('midsem') is not None:
                    total_predictions += 1
                if guess.get('compre') is not None:
                    total_predictions += 1
        
        results_set = sum(len(course_results) for course_results in results_data.values())
        
        return jsonify({
            'total_users': total_users,
            'total_predictions': total_predictions,
            'results_set': results_set,
            'platform': 'Vercel Serverless',
            'storage': 'Memory (resets on deployment)'
        })
    except Exception as e:
        logger.error(f"Error getting stats: {e}")
        return jsonify({'status': 'error', 'message': str(e)}), 500

@app.route('/api/restore', methods=['POST'])
def restore_data():
    """New endpoint to restore data from backup"""
    try:
        global users_data, guesses_data, results_data
        
        data = request.get_json()
        if not data:
            return jsonify({'status': 'error', 'message': 'No backup data provided'}), 400
        
        if 'users' in data:
            users_data = data['users']
        if 'guesses' in data:
            guesses_data = data['guesses']
        if 'results' in data:
            results_data = data['results']
            
        return jsonify({
            'status': 'success',
            'message': 'Data restored successfully',
            'restored_at': datetime.now().isoformat()
        })
        
    except Exception as e:
        logger.error(f"Error restoring data: {e}")
        return jsonify({'status': 'error', 'message': str(e)}), 500

@app.errorhandler(404)
def not_found(error):
    return jsonify({'status': 'error', 'message': 'Endpoint not found'}), 404

@app.errorhandler(500)
def internal_error(error):
    return jsonify({'status': 'error', 'message': 'Internal server error'}), 500

# Initialize data on startup
get_data_from_env()

# Vercel serverless function handler
def handler(request):
    return app(request.environ, lambda status, headers: None)

# For local development
if __name__ == '__main__':
    logger.info("BitBets Server Starting (Local Development)...")
    app.run(debug=True)