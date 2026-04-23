from flask import Flask, render_template, request, jsonify, send_from_directory
from flask_socketio import SocketIO, emit, join_room, leave_room
import uuid
import html
import time
import os
import shutil

app = Flask(__name__)
app.config['SECRET_KEY'] = 'secret!'
app.config['MAX_CONTENT_LENGTH'] = 20 * 1024 * 1024
app.config['UPLOAD_FOLDER'] = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'uploads')

os.makedirs(app.config['UPLOAD_FOLDER'], exist_ok=True)

socketio = SocketIO(app, cors_allowed_origins="*")

online_users = {}
messages = []
private_chats = {}
files = {}

ALLOWED_IMAGE_EXTENSIONS = {'jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp'}
ALLOWED_DOC_EXTENSIONS = {'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt'}
ALLOWED_EXTENSIONS = ALLOWED_IMAGE_EXTENSIONS | ALLOWED_DOC_EXTENSIONS

def generate_user_id():
    return str(uuid.uuid4())[:8]

def generate_file_id():
    return str(uuid.uuid4())

def sanitize_message(message):
    return html.escape(message)

def allowed_file(filename):
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS

def get_file_type(filename):
    ext = filename.rsplit('.', 1)[1].lower()
    if ext in ALLOWED_IMAGE_EXTENSIONS:
        return 'image'
    elif ext in ALLOWED_DOC_EXTENSIONS:
        return 'document'
    return 'other'

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/uploads/<file_id>')
def uploaded_file(file_id):
    if file_id in files:
        return send_from_directory(app.config['UPLOAD_FOLDER'], files[file_id]['filename'])
    return jsonify({'error': 'File not found'}), 404

@app.route('/api/upload', methods=['POST'])
def upload_file():
    if 'file' not in request.files:
        return jsonify({'error': 'No file part'}), 400
    
    file = request.files['file']
    user_id = request.form.get('user_id')
    
    if not user_id or user_id not in online_users:
        return jsonify({'error': 'Invalid user ID'}), 400
    
    if file.filename == '':
        return jsonify({'error': 'No selected file'}), 400
    
    if file and allowed_file(file.filename):
        file_id = generate_file_id()
        filename = f"{file_id}_{file.filename}"
        filepath = os.path.join(app.config['UPLOAD_FOLDER'], filename)
        
        try:
            file.save(filepath)
            
            file_info = {
                'file_id': file_id,
                'filename': filename,
                'original_name': file.filename,
                'user_id': user_id,
                'file_type': get_file_type(file.filename),
                'size': os.path.getsize(filepath),
                'upload_time': time.time(),
                'url': f'/uploads/{file_id}'
            }
            
            files[file_id] = file_info
            return jsonify(file_info)
        
        except Exception as e:
            return jsonify({'error': str(e)}), 500
    else:
        return jsonify({'error': 'File type not allowed'}), 400

@app.route('/api/files', methods=['GET'])
def get_files():
    user_id = request.args.get('user_id')
    if not user_id or user_id not in online_users:
        return jsonify({'error': 'Invalid user ID'}), 400
    
    user_files = [f for f in files.values() if f['user_id'] == user_id]
    return jsonify({'files': user_files})

@app.route('/api/files/<file_id>', methods=['DELETE'])
def delete_file(file_id):
    user_id = request.args.get('user_id')
    if not user_id or user_id not in online_users:
        return jsonify({'error': 'Invalid user ID'}), 400
    
    if file_id not in files:
        return jsonify({'error': 'File not found'}), 404
    
    if files[file_id]['user_id'] != user_id:
        return jsonify({'error': 'Access denied'}), 403
    
    try:
        filepath = os.path.join(app.config['UPLOAD_FOLDER'], files[file_id]['filename'])
        os.remove(filepath)
        del files[file_id]
        return jsonify({'success': True})
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@socketio.on('connect')
def handle_connect():
    user_id = generate_user_id()
    online_users[user_id] = {'sid': request.sid}
    join_room('chat')
    
    emit('user_id', {'user_id': user_id}, room=request.sid)
    emit('user_join', {'user_id': user_id}, room='chat')
    emit('online_users', {'count': len(online_users), 'users': list(online_users.keys())}, room='chat')
    
    if messages:
        emit('load_messages', {'messages': messages}, room=request.sid)

@socketio.on('disconnect')
def handle_disconnect():
    user_id = None
    for uid, data in online_users.items():
        if data['sid'] == request.sid:
            user_id = uid
            break
    
    if user_id:
        del online_users[user_id]
        emit('user_leave', {'user_id': user_id}, room='chat')
        emit('online_users', {'count': len(online_users), 'users': list(online_users.keys())}, room='chat')
        
        for chat_id in list(private_chats.keys()):
            if user_id in chat_id:
                del private_chats[chat_id]

@socketio.on('send_message')
def handle_send_message(data):
    user_id = data.get('user_id')
    message = data.get('message', '')
    file_info = data.get('file_info')
    
    if not user_id or user_id not in online_users:
        emit('error', {'message': 'Invalid user ID'}, room=request.sid)
        return
    
    if not message.strip() and not file_info:
        emit('error', {'message': 'Message cannot be empty'}, room=request.sid)
        return
    
    if len(message) > 500:
        emit('error', {'message': 'Message too long (max 500 characters)'}, room=request.sid)
        return
    
    sanitized_message = sanitize_message(message)
    
    message_data = {
        'user_id': user_id,
        'message': sanitized_message,
        'timestamp': time.time(),
        'file_info': file_info
    }
    
    messages.append(message_data)
    if len(messages) > 100:
        messages.pop(0)
    
    emit('new_message', message_data, room='chat')

@socketio.on('typing')
def handle_typing(data):
    user_id = data.get('user_id')
    if user_id and user_id in online_users:
        emit('user_typing', {'user_id': user_id}, room='chat')

@socketio.on('stop_typing')
def handle_stop_typing(data):
    user_id = data.get('user_id')
    if user_id and user_id in online_users:
        emit('user_stop_typing', {'user_id': user_id}, room='chat')

@socketio.on('start_private_chat')
def handle_start_private_chat(data):
    user_id = data.get('user_id')
    target_user_id = data.get('target_user_id')
    
    if not user_id or user_id not in online_users:
        emit('error', {'message': 'Invalid user ID'}, room=request.sid)
        return
    
    if not target_user_id or target_user_id not in online_users:
        emit('error', {'message': 'Target user not found'}, room=request.sid)
        return
    
    if user_id == target_user_id:
        emit('error', {'message': 'Cannot chat with yourself'}, room=request.sid)
        return
    
    chat_id_str = '-'.join(sorted([user_id, target_user_id]))
    chat_id = tuple(sorted([user_id, target_user_id]))
    
    if chat_id not in private_chats:
        private_chats[chat_id] = {
            'messages': [],
            'users': [user_id, target_user_id],
            'unread': {user_id: 0, target_user_id: 0}
        }
    
    join_room(chat_id_str)
    
    if online_users[target_user_id]['sid'] != request.sid:
        join_room(chat_id_str, sid=online_users[target_user_id]['sid'])
    
    emit('private_chat_started', {
        'chat_id': chat_id_str,
        'target_user_id': target_user_id,
        'messages': private_chats[chat_id]['messages']
    }, room=request.sid)
    
    private_chats[chat_id]['unread'][user_id] = 0
    emit('private_chat_update', {
        'chat_id': chat_id_str,
        'unread_count': private_chats[chat_id]['unread'][target_user_id]
    }, room=online_users[target_user_id]['sid'])

@socketio.on('send_private_message')
def handle_send_private_message(data):
    user_id = data.get('user_id')
    target_user_id = data.get('target_user_id')
    message = data.get('message', '')
    file_info = data.get('file_info')
    encrypted = data.get('encrypted', False)
    iv = data.get('iv')
    
    if not user_id or user_id not in online_users:
        emit('error', {'message': 'Invalid user ID'}, room=request.sid)
        return
    
    if not target_user_id or target_user_id not in online_users:
        emit('error', {'message': 'Target user not found'}, room=request.sid)
        return
    
    if not message.strip() and not file_info:
        emit('error', {'message': 'Message cannot be empty'}, room=request.sid)
        return
    
    if len(message) > 500:
        emit('error', {'message': 'Message too long (max 500 characters)'}, room=request.sid)
        return
    
    chat_id_str = '-'.join(sorted([user_id, target_user_id]))
    chat_id = tuple(sorted([user_id, target_user_id]))
    
    if chat_id not in private_chats:
        private_chats[chat_id] = {
            'messages': [],
            'users': [user_id, target_user_id],
            'unread': {user_id: 0, target_user_id: 0}
        }
    
    message_data = {
        'user_id': user_id,
        'message': message,
        'timestamp': time.time(),
        'file_info': file_info,
        'read': False,
        'encrypted': encrypted,
        'iv': iv
    }
    
    private_chats[chat_id]['messages'].append(message_data)
    if len(private_chats[chat_id]['messages']) > 200:
        private_chats[chat_id]['messages'].pop(0)
    
    private_chats[chat_id]['unread'][target_user_id] += 1
    
    emit('new_private_message', {
        'chat_id': chat_id_str,
        'message': message_data
    }, room=chat_id_str)
    
    emit('private_chat_update', {
        'chat_id': chat_id_str,
        'unread_count': private_chats[chat_id]['unread'][target_user_id]
    }, room=online_users[target_user_id]['sid'])

@socketio.on('mark_private_messages_read')
def handle_mark_private_messages_read(data):
    user_id = data.get('user_id')
    target_user_id = data.get('target_user_id')
    
    if not user_id or user_id not in online_users:
        emit('error', {'message': 'Invalid user ID'}, room=request.sid)
        return
    
    chat_id = tuple(sorted([user_id, target_user_id]))
    
    if chat_id in private_chats:
        private_chats[chat_id]['unread'][user_id] = 0
        
        for msg in private_chats[chat_id]['messages']:
            if not msg['read'] and msg['user_id'] != user_id:
                msg['read'] = True
        
        emit('private_messages_read', {
            'chat_id': '-'.join(chat_id)
        }, room=chat_id)

@socketio.on('get_private_chats')
def handle_get_private_chats(data):
    user_id = data.get('user_id')
    
    if not user_id or user_id not in online_users:
        emit('error', {'message': 'Invalid user ID'}, room=request.sid)
        return
    
    user_chats = []
    for chat_id, chat_data in private_chats.items():
        if user_id in chat_data['users']:
            other_user = chat_data['users'][0] if chat_data['users'][1] == user_id else chat_data['users'][1]
            user_chats.append({
                'chat_id': '-'.join(chat_id),
                'other_user_id': other_user,
                'unread_count': chat_data['unread'].get(user_id, 0),
                'last_message': chat_data['messages'][-1] if chat_data['messages'] else None
            })
    
    emit('private_chats_list', {'chats': user_chats}, room=request.sid)

@socketio.on('send_public_key')
def handle_send_public_key(data):
    user_id = data.get('user_id')
    target_user_id = data.get('target_user_id')
    public_key = data.get('public_key')
    
    if not user_id or user_id not in online_users:
        emit('error', {'message': 'Invalid user ID'}, room=request.sid)
        return
    
    if not target_user_id or target_user_id not in online_users:
        emit('error', {'message': 'Target user not found'}, room=request.sid)
        return
    
    emit('receive_public_key', {
        'from_user_id': user_id,
        'public_key': public_key
    }, room=online_users[target_user_id]['sid'])

@socketio.on('send_encrypted_aes_key')
def handle_send_encrypted_aes_key(data):
    user_id = data.get('user_id')
    target_user_id = data.get('target_user_id')
    encrypted_aes_key = data.get('encrypted_aes_key')
    iv = data.get('iv')
    
    if not user_id or user_id not in online_users:
        emit('error', {'message': 'Invalid user ID'}, room=request.sid)
        return
    
    if not target_user_id or target_user_id not in online_users:
        emit('error', {'message': 'Target user not found'}, room=request.sid)
        return
    
    emit('receive_encrypted_aes_key', {
        'from_user_id': user_id,
        'encrypted_aes_key': encrypted_aes_key,
        'iv': iv
    }, room=online_users[target_user_id]['sid'])

if __name__ == '__main__':
    socketio.run(app, host='0.0.0.0', port=5000, debug=True)