from flask import Flask, request, jsonify
from flask_cors import CORS
import json
import csv
import os
from datetime import datetime
import logging
import threading
import time
from functools import wraps
import gzip
from werkzeug.exceptions import RequestEntityTooLarge

app = Flask(__name__)

# Configure CORS with specific settings for ngrok
CORS(app, 
     origins=["*"],
     methods=["GET", "POST", "OPTIONS"],
     allow_headers=["Content-Type", "ngrok-skip-browser-warning", "Authorization"],
     supports_credentials=True)

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[
        logging.FileHandler('bitbets_server.log'),
        logging.StreamHandler()
    ]
)
logger = logging.getLogger(__name__)

# Configuration
DATA_DIR = 'bitbets_data'
USERS_FILE = os.path.join(DATA_DIR, 'users.json')
GUESSES_FILE = os.path.join(DATA_DIR, 'guesses.json')
RESULTS_FILE = os.path.join(DATA_DIR, 'actual_results.json')
BACKUP_DIR = os.path.join(DATA_DIR, 'backups')

# Request limits
app.config['MAX_CONTENT_LENGTH'] = 16 * 1024 * 1024  # 16MB max request size

# In-memory cache to reduce file I/O
data_cache = {
    'users': {},
    'guesses': {},
    'actual_results': {},
    'last_modified': {
        'users': 0,
        'guesses': 0,
        'actual_results': 0
    }
}

# Thread lock for data operations
data_lock = threading.RLock()

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

def rate_limit(max_requests=30, per_seconds=60):
    """Simple rate limiting decorator"""
    requests = {}
    lock = threading.Lock()
    
    def decorator(f):
        @wraps(f)
        def decorated_function(*args, **kwargs):
            with lock:
                client_ip = request.environ.get('HTTP_X_FORWARDED_FOR', request.remote_addr)
                now = time.time()
                
                # Clean old requests
                if client_ip in requests:
                    requests[client_ip] = [req_time for req_time in requests[client_ip] 
                                         if now - req_time < per_seconds]
                else:
                    requests[client_ip] = []
                
                # Check rate limit
                if len(requests[client_ip]) >= max_requests:
                    logger.warning(f"Rate limit exceeded for {client_ip}")
                    return jsonify({
                        'status': 'error', 
                        'message': 'Rate limit exceeded. Please try again later.'
                    }), 429
                
                requests[client_ip].append(now)
            
            return f(*args, **kwargs)
        return decorated_function
    return decorator

def handle_errors(f):
    """Error handling decorator"""
    @wraps(f)
    def decorated_function(*args, **kwargs):
        try:
            return f(*args, **kwargs)
        except RequestEntityTooLarge:
            logger.error("Request too large")
            return jsonify({
                'status': 'error',
                'message': 'Request too large. Please reduce the data size.'
            }), 413
        except json.JSONDecodeError as e:
            logger.error(f"JSON decode error: {e}")
            return jsonify({
                'status': 'error',
                'message': 'Invalid JSON format'
            }), 400
        except Exception as e:
            logger.error(f"Unexpected error in {f.__name__}: {e}", exc_info=True)
            return jsonify({
                'status': 'error',
                'message': 'Internal server error'
            }), 500
    return decorated_function

def ensure_directories():
    """Create necessary directories if they don't exist"""
    try:
        os.makedirs(DATA_DIR, exist_ok=True)
        os.makedirs(BACKUP_DIR, exist_ok=True)
        logger.info(f"Directories created/verified: {DATA_DIR}, {BACKUP_DIR}")
    except Exception as e:
        logger.error(f"Error creating directories: {e}")
        raise

def load_json_file(filepath, default=None):
    """Load JSON file with caching, return default if file doesn't exist"""
    if default is None:
        default = {}
    
    try:
        if not os.path.exists(filepath):
            logger.info(f"File {filepath} doesn't exist, returning default")
            return default
            
        # Check if file has been modified since last load
        file_stat = os.path.getmtime(filepath)
        cache_key = os.path.basename(filepath).replace('.json', '')
        
        with data_lock:
            if (cache_key in data_cache['last_modified'] and 
                file_stat <= data_cache['last_modified'][cache_key] and
                cache_key in data_cache):
                logger.debug(f"Using cached data for {filepath}")
                return data_cache[cache_key]
        
        # Load from file
        with open(filepath, 'r', encoding='utf-8') as f:
            data = json.load(f)
        
        # Update cache
        with data_lock:
            data_cache[cache_key] = data
            data_cache['last_modified'][cache_key] = file_stat
            
        logger.info(f"Loaded {filepath} successfully")
        return data
        
    except json.JSONDecodeError as e:
        logger.error(f"JSON decode error in {filepath}: {e}")
        return default
    except Exception as e:
        logger.error(f"Error loading {filepath}: {e}")
        return default

def save_json_file(filepath, data):
    """Save data to JSON file with atomic writes and caching"""
    try:
        # Create temporary file first for atomic writes
        temp_filepath = filepath + '.tmp'
        
        with open(temp_filepath, 'w', encoding='utf-8') as f:
            json.dump(data, f, indent=2, ensure_ascii=False)
        
        # Atomic rename
        os.replace(temp_filepath, filepath)
        
        # Update cache
        cache_key = os.path.basename(filepath).replace('.json', '')
        with data_lock:
            data_cache[cache_key] = data.copy() if isinstance(data, dict) else data
            data_cache['last_modified'][cache_key] = time.time()
        
        logger.info(f"Saved {filepath} successfully")
        return True
        
    except Exception as e:
        logger.error(f"Error saving {filepath}: {e}")
        # Clean up temp file if it exists
        temp_filepath = filepath + '.tmp'
        if os.path.exists(temp_filepath):
            try:
                os.remove(temp_filepath)
            except:
                pass
        return False

def create_backup():
    """Create a backup of all data with compression"""
    try:
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        backup_file = os.path.join(BACKUP_DIR, f'backup_{timestamp}.json')
        
        all_data = {
            'users': load_json_file(USERS_FILE),
            'guesses': load_json_file(GUESSES_FILE),
            'actual_results': load_json_file(RESULTS_FILE),
            'backup_time': datetime.now().isoformat(),
            'version': '2.0'
        }
        
        # Save compressed backup
        with gzip.open(backup_file + '.gz', 'wt', encoding='utf-8') as f:
            json.dump(all_data, f, indent=2)
        
        # Also save uncompressed for compatibility
        save_json_file(backup_file, all_data)
        
        logger.info(f"Backup created: {backup_file}")
        
        # Clean old backups (keep last 10)
        cleanup_old_backups()
        
    except Exception as e:
        logger.error(f"Error creating backup: {e}")

def cleanup_old_backups(keep_count=10):
    """Remove old backup files, keeping only the most recent ones"""
    try:
        backup_files = []
        for filename in os.listdir(BACKUP_DIR):
            if filename.startswith('backup_') and filename.endswith('.json'):
                filepath = os.path.join(BACKUP_DIR, filename)
                backup_files.append((filepath, os.path.getmtime(filepath)))
        
        # Sort by modification time (newest first)
        backup_files.sort(key=lambda x: x[1], reverse=True)
        
        # Remove old backups
        for filepath, _ in backup_files[keep_count:]:
            try:
                os.remove(filepath)
                # Also remove compressed version if it exists
                gz_file = filepath + '.gz'
                if os.path.exists(gz_file):
                    os.remove(gz_file)
                logger.info(f"Removed old backup: {filepath}")
            except Exception as e:
                logger.error(f"Error removing backup {filepath}: {e}")
                
    except Exception as e:
        logger.error(f"Error cleaning up backups: {e}")

def export_to_csv():
    """Export all data to CSV files using built-in csv module"""
    try:
        users = load_json_file(USERS_FILE)
        guesses = load_json_file(GUESSES_FILE)
        results = load_json_file(RESULTS_FILE)
        
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        
        # Export guesses to CSV
        guesses_csv_file = os.path.join(DATA_DIR, f'guesses_export_{timestamp}.csv')
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
        results_csv_file = os.path.join(DATA_DIR, f'results_export_{timestamp}.csv')
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
        analysis_csv_file = os.path.join(DATA_DIR, f'detailed_analysis_{timestamp}.csv')
        with open(analysis_csv_file, 'w', newline='', encoding='utf-8') as csvfile:
            fieldnames = ['Course', 'Course Name', 'Exam Type', 'Username', 'User Guess', 'Actual Average', 'Difference', 'Is Winner']
            writer = csv.DictWriter(csvfile, fieldnames=fieldnames)
            writer.writeheader()
            
            for course, course_results in results.items():
                for exam_type, actual_avg in course_results.items():
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
        return True
            
    except Exception as e:
        logger.error(f"Error exporting to CSV: {e}")
        return False

@app.before_request
def before_request():
    """Handle preflight requests and add security headers"""
    if request.method == 'OPTIONS':
        response = jsonify({'status': 'ok'})
        response.headers.add('Access-Control-Allow-Origin', '*')
        response.headers.add('Access-Control-Allow-Headers', 'Content-Type,ngrok-skip-browser-warning')
        response.headers.add('Access-Control-Allow-Methods', 'GET,POST,OPTIONS')
        return response

@app.after_request
def after_request(response):
    """Add security and performance headers"""
    response.headers.add('Access-Control-Allow-Origin', '*')
    response.headers.add('Access-Control-Allow-Headers', 'Content-Type,ngrok-skip-browser-warning')
    response.headers.add('Access-Control-Allow-Methods', 'GET,POST,OPTIONS')
    response.headers.add('X-Content-Type-Options', 'nosniff')
    response.headers.add('X-Frame-Options', 'DENY')
    response.headers.add('Cache-Control', 'no-cache, no-store, must-revalidate')
    return response

@app.route('/', methods=['GET'])
@handle_errors
def root():
    return jsonify({
        'message': 'BitBets API Server is running!',
        'status': 'healthy',
        'timestamp': datetime.now().isoformat(),
        'version': '2.0',
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
@handle_errors
def health_check():
    """Enhanced health check with more details"""
    try:
        # Check file system
        files_exist = {
            'users': os.path.exists(USERS_FILE),
            'guesses': os.path.exists(GUESSES_FILE),
            'results': os.path.exists(RESULTS_FILE)
        }
        
        # Check disk space
        disk_usage = {}
        try:
            stat = os.statvfs(DATA_DIR)
            disk_usage = {
                'free_gb': round((stat.f_frsize * stat.f_available) / (1024**3), 2),
                'total_gb': round((stat.f_frsize * stat.f_blocks) / (1024**3), 2)
            }
        except:
            disk_usage = {'error': 'Cannot check disk usage'}
        
        # Get cache status
        with data_lock:
            cache_status = {
                'users_cached': len(data_cache.get('users', {})),
                'guesses_cached': len(data_cache.get('guesses', {})),
                'results_cached': len(data_cache.get('actual_results', {}))
            }
        
        return jsonify({
            'status': 'healthy',
            'timestamp': datetime.now().isoformat(),
            'data_directory': DATA_DIR,
            'files_exist': files_exist,
            'disk_usage': disk_usage,
            'cache_status': cache_status,
            'version': '2.0'
        })
    except Exception as e:
        logger.error(f"Health check failed: {e}")
        return jsonify({
            'status': 'unhealthy',
            'error': str(e),
            'timestamp': datetime.now().isoformat()
        }), 500

@app.route('/api/users', methods=['GET', 'POST'])
@rate_limit(max_requests=50, per_seconds=60)
@handle_errors
def handle_users():
    if request.method == 'GET':
        users = load_json_file(USERS_FILE)
        logger.info(f"GET /api/users - returning {len(users)} users")
        return jsonify(users)
    
    elif request.method == 'POST':
        data = request.get_json()
        if not data:
            return jsonify({'status': 'error', 'message': 'No data provided'}), 400
        
        if not isinstance(data, dict):
            return jsonify({'status': 'error', 'message': 'Data must be a JSON object'}), 400
            
        results = load_json_file(RESULTS_FILE)
        results.update(data)
        
        if save_json_file(RESULTS_FILE, results):
            # Auto-export CSV in background thread to avoid blocking
            threading.Thread(target=export_to_csv, daemon=True).start()
            logger.info(f"POST /api/results - updated results successfully")
            return jsonify({'status': 'success', 'message': 'Results updated'})
        else:
            return jsonify({'status': 'error', 'message': 'Failed to save results'}), 500

@app.route('/api/backup', methods=['POST'])
@rate_limit(max_requests=5, per_seconds=300)  # Very limited for backup operations
@handle_errors
def create_manual_backup():
    try:
        # Run backup in background thread
        threading.Thread(target=create_backup, daemon=True).start()
        return jsonify({'status': 'success', 'message': 'Backup creation started'})
    except Exception as e:
        logger.error(f"Error creating backup: {e}")
        return jsonify({'status': 'error', 'message': str(e)}), 500

@app.route('/api/export-csv', methods=['POST'])
@rate_limit(max_requests=5, per_seconds=300)  # Limited for export operations
@handle_errors
def manual_csv_export():
    try:
        # Run export in background thread
        def export_with_response():
            success = export_to_csv()
            if success:
                logger.info("CSV export completed successfully")
            else:
                logger.error("CSV export failed")
        
        threading.Thread(target=export_with_response, daemon=True).start()
        return jsonify({'status': 'success', 'message': 'CSV export started'})
    except Exception as e:
        logger.error(f"Error exporting CSV: {e}")
        return jsonify({'status': 'error', 'message': str(e)}), 500

@app.route('/api/clear-all', methods=['POST'])
@rate_limit(max_requests=2, per_seconds=3600)  # Very restrictive for dangerous operations
@handle_errors
def clear_all_data():
    try:
        # Create backup before clearing
        create_backup()
        
        # Clear all files
        save_json_file(USERS_FILE, {})
        save_json_file(GUESSES_FILE, {})
        save_json_file(RESULTS_FILE, {})
        
        # Clear cache
        with data_lock:
            data_cache['users'] = {}
            data_cache['guesses'] = {}
            data_cache['actual_results'] = {}
        
        logger.info("All data cleared successfully")
        return jsonify({'status': 'success', 'message': 'All data cleared'})
    except Exception as e:
        logger.error(f"Error clearing data: {e}")
        return jsonify({'status': 'error', 'message': f'Failed to clear data: {str(e)}'}), 500

@app.route('/api/restart-competition', methods=['POST'])
@rate_limit(max_requests=5, per_seconds=3600)  # Limited for restart operations
@handle_errors
def restart_competition():
    try:
        # Create backup before restarting
        create_backup()
        
        # Keep users but clear guesses and results
        save_json_file(GUESSES_FILE, {})
        save_json_file(RESULTS_FILE, {})
        
        # Update cache
        with data_lock:
            data_cache['guesses'] = {}
            data_cache['actual_results'] = {}
        
        logger.info("Competition restarted successfully")
        return jsonify({'status': 'success', 'message': 'Competition restarted'})
    except Exception as e:
        logger.error(f"Error restarting competition: {e}")
        return jsonify({'status': 'error', 'message': f'Failed to restart competition: {str(e)}'}), 500

@app.route('/api/stats', methods=['GET'])
@rate_limit(max_requests=60, per_seconds=60)
@handle_errors
def get_stats():
    try:
        users = load_json_file(USERS_FILE)
        guesses = load_json_file(GUESSES_FILE)
        results = load_json_file(RESULTS_FILE)
        
        total_users = len(users)
        total_predictions = 0
        
        for user_guesses in guesses.values():
            for guess in user_guesses.values():
                if isinstance(guess, dict):
                    if guess.get('midsem') is not None:
                        total_predictions += 1
                    if guess.get('compre') is not None:
                        total_predictions += 1
        
        results_set = sum(len(course_results) for course_results in results.values() if isinstance(course_results, dict))
        
        # Additional statistics
        unique_courses_predicted = set()
        for user_guesses in guesses.values():
            unique_courses_predicted.update(user_guesses.keys())
        
        return jsonify({
            'total_users': total_users,
            'total_predictions': total_predictions,
            'results_set': results_set,
            'unique_courses_predicted': len(unique_courses_predicted),
            'total_courses_available': len(COURSE_NAMES),
            'server_uptime': time.time() - server_start_time,
            'last_updated': datetime.now().isoformat()
        })
    except Exception as e:
        logger.error(f"Error getting stats: {e}")
        return jsonify({'status': 'error', 'message': str(e)}), 500

@app.route('/api/system-info', methods=['GET'])
@rate_limit(max_requests=10, per_seconds=60)
@handle_errors
def get_system_info():
    """Get system information for monitoring"""
    try:
        import psutil
        
        # Memory usage
        memory = psutil.virtual_memory()
        
        # Disk usage
        disk = psutil.disk_usage(DATA_DIR)
        
        # Process info
        process = psutil.Process()
        
        return jsonify({
            'memory': {
                'total_gb': round(memory.total / (1024**3), 2),
                'available_gb': round(memory.available / (1024**3), 2),
                'percent': memory.percent
            },
            'disk': {
                'total_gb': round(disk.total / (1024**3), 2),
                'free_gb': round(disk.free / (1024**3), 2),
                'percent': round((disk.used / disk.total) * 100, 2)
            },
            'process': {
                'memory_mb': round(process.memory_info().rss / (1024**2), 2),
                'cpu_percent': process.cpu_percent(),
                'threads': process.num_threads()
            },
            'cache_size': {
                'users': len(data_cache.get('users', {})),
                'guesses': len(data_cache.get('guesses', {})),
                'results': len(data_cache.get('actual_results', {}))
            }
        })
    except ImportError:
        return jsonify({
            'error': 'psutil not installed',
            'cache_size': {
                'users': len(data_cache.get('users', {})),
                'guesses': len(data_cache.get('guesses', {})),
                'results': len(data_cache.get('actual_results', {}))
            }
        })
    except Exception as e:
        logger.error(f"Error getting system info: {e}")
        return jsonify({'status': 'error', 'message': str(e)}), 500

@app.errorhandler(404)
def not_found(error):
    return jsonify({'status': 'error', 'message': 'Endpoint not found'}), 404

@app.errorhandler(405)
def method_not_allowed(error):
    return jsonify({'status': 'error', 'message': 'Method not allowed'}), 405

@app.errorhandler(413)
def request_entity_too_large(error):
    return jsonify({'status': 'error', 'message': 'Request too large'}), 413

@app.errorhandler(429)
def rate_limit_exceeded(error):
    return jsonify({'status': 'error', 'message': 'Rate limit exceeded'}), 429

@app.errorhandler(500)
def internal_error(error):
    logger.error(f"Internal server error: {error}")
    return jsonify({'status': 'error', 'message': 'Internal server error'}), 500

def periodic_backup():
    """Create periodic backups every hour"""
    while True:
        try:
            time.sleep(3600)  # Wait 1 hour
            create_backup()
            logger.info("Periodic backup completed")
        except Exception as e:
            logger.error(f"Periodic backup failed: {e}")

def initialize_data_files():
    """Initialize data files if they don't exist"""
    try:
        if not os.path.exists(USERS_FILE):
            save_json_file(USERS_FILE, {})
            logger.info("Initialized users.json")
        
        if not os.path.exists(GUESSES_FILE):
            save_json_file(GUESSES_FILE, {})
            logger.info("Initialized guesses.json")
        
        if not os.path.exists(RESULTS_FILE):
            save_json_file(RESULTS_FILE, {})
            logger.info("Initialized results.json")
            
        # Load initial data into cache
        load_json_file(USERS_FILE)
        load_json_file(GUESSES_FILE)
        load_json_file(RESULTS_FILE)
        
        logger.info("Data files initialized and cached")
        
    except Exception as e:
        logger.error(f"Error initializing data files: {e}")
        raise

if __name__ == '__main__':
    try:
        # Record server start time
        server_start_time = time.time()
        
        # Initialize
        ensure_directories()
        initialize_data_files()
        
        logger.info("BitBets Server Starting...")
        logger.info(f"Data directory: {DATA_DIR}")
        logger.info("Server will run on http://0.0.0.0:5000")
        logger.info("Enhanced features:")
        logger.info("  - Request rate limiting")
        logger.info("  - Data caching")
        logger.info("  - Atomic file writes")
        logger.info("  - Automatic backups")
        logger.info("  - Background CSV exports")
        logger.info("  - Enhanced error handling")
        logger.info("API endpoints:")
        logger.info("  GET/POST /api/users")
        logger.info("  GET/POST /api/guesses") 
        logger.info("  GET/POST /api/results")
        logger.info("  POST /api/backup")
        logger.info("  POST /api/export-csv")
        logger.info("  GET /api/stats")
        logger.info("  GET /api/system-info")
        logger.info("  GET /health")
        
        # Create initial backup on startup
        create_backup()
        
        # Start periodic backup thread
        backup_thread = threading.Thread(target=periodic_backup, daemon=True)
        backup_thread.start()
        logger.info("Periodic backup thread started")
        
        # Run the server with improved configuration
        app.run(
            host="0.0.0.0", 
            port=5000, 
            debug=False,
            threaded=True,  # Enable threading for better concurrent request handling
            use_reloader=False  # Disable reloader in production
        )
        
    except Exception as e:
        logger.error(f"Failed to start server: {e}")
        raise 'Data must be a JSON object'}), 400
            
        users = load_json_file(USERS_FILE)
        users.update(data)
        
        if save_json_file(USERS_FILE, users):
            logger.info(f"POST /api/users - updated users successfully")
            return jsonify({'status': 'success', 'message': 'Users updated'})
        else:
            return jsonify({'status': 'error', 'message': 'Failed to save users'}), 500

@app.route('/api/guesses', methods=['GET', 'POST'])
@rate_limit(max_requests=100, per_seconds=60)
@handle_errors
def handle_guesses():
    if request.method == 'GET':
        guesses = load_json_file(GUESSES_FILE)
        logger.info(f"GET /api/guesses - returning guesses for {len(guesses)} users")
        return jsonify(guesses)
    
    elif request.method == 'POST':
        data = request.get_json()
        if not data:
            return jsonify({'status': 'error', 'message': 'No data provided'}), 400
        
        if not isinstance(data, dict):
            return jsonify({'status': 'error', 'message': 'Data must be a JSON object'}), 400
            
        guesses = load_json_file(GUESSES_FILE)
        guesses.update(data)
        
        if save_json_file(GUESSES_FILE, guesses):
            # Auto-export CSV in background thread to avoid blocking
            threading.Thread(target=export_to_csv, daemon=True).start()
            logger.info(f"POST /api/guesses - updated guesses successfully")
            return jsonify({'status': 'success', 'message': 'Guesses updated'})
        else:
            return jsonify({'status': 'error', 'message': 'Failed to save guesses'}), 500

@app.route('/api/results', methods=['GET', 'POST'])
@rate_limit(max_requests=50, per_seconds=60)
@handle_errors
def handle_results():
    if request.method == 'GET':
        results = load_json_file(RESULTS_FILE)
        logger.info(f"GET /api/results - returning results for {len(results)} courses")
        return jsonify(results)
    
    elif request.method == 'POST':
        data = request.get_json()
        if not data:
            return jsonify({'status': 'error', 'message': 'No data provided'}), 400
        
        if not isinstance(data, dict):
            return jsonify({'status': 'error', 'message':