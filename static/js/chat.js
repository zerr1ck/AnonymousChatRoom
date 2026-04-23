document.addEventListener('DOMContentLoaded', function() {
    const socket = io();
    let currentUserId = null;
    let typingTimeout = null;
    let currentChatMode = 'public';
    let currentPrivateChatUser = null;
    let pendingFileInfo = null;
    
    let rsaKeyPair = null;
    let encryptionKeys = {};
    let encryptionStatus = {};
    
    const messagesContainer = document.getElementById('messages');
    const messageInput = document.getElementById('message-input');
    const sendBtn = document.getElementById('send-btn');
    const onlineCount = document.getElementById('online-count');
    const onlineUsersList = document.getElementById('online-users');
    const typingIndicator = document.getElementById('typing-indicator');
    const privateChatsList = document.getElementById('private-chats');
    const noPrivateChats = document.getElementById('no-private-chats');
    
    const fileInput = document.getElementById('file-input');
    const uploadBtn = document.getElementById('upload-btn');
    const uploadProgress = document.getElementById('upload-progress');
    const progressBar = uploadProgress.querySelector('.progress-bar');
    const progressText = uploadProgress.querySelector('.progress-text');
    
    const filePreviewModal = document.getElementById('file-preview-modal');
    const previewContent = document.getElementById('preview-content');
    const downloadFileBtn = document.getElementById('download-file');
    const closePreviewBtn = document.getElementById('close-preview');
    const closeModalBtn = document.getElementById('close-modal');
    
    const privateChatModal = document.getElementById('private-chat-modal');
    const privateChatUsers = document.getElementById('private-chat-users');
    const closePrivateModalBtn = document.getElementById('close-private-modal');
    const cancelPrivateChatBtn = document.getElementById('cancel-private-chat');
    
    const privateChatTab = document.getElementById('private-chat-tab');
    const publicChatTab = document.querySelector('.chat-tab[data-chat="public"]');
    
    const panelTabs = document.querySelectorAll('.tab-btn');
    const chatTabs = document.querySelectorAll('.chat-tab');
    
    const encryptionStatusIndicator = document.createElement('div');
    encryptionStatusIndicator.className = 'encryption-status';
    encryptionStatusIndicator.textContent = '🔐 ENCRYPTION: INITIALIZING';
    
    let currentPreviewFile = null;
    
    async function initEncryption() {
        try {
            rsaKeyPair = await generateRSAKeyPair();
            console.log('[ENCRYPTION] RSA key pair generated successfully');
            showNotification('Encryption initialized', 'success');
        } catch (error) {
            showNotification('Encryption initialization failed', 'error');
            console.error('[ENCRYPTION] Init error:', error);
        }
    }
    
    async function generateRSAKeyPair() {
        const keyPair = await window.crypto.subtle.generateKey(
            {
                name: 'RSA-OAEP',
                modulusLength: 2048,
                publicExponent: new Uint8Array([0x01, 0x00, 0x01]),
                hash: 'SHA-256'
            },
            true,
            ['encrypt', 'decrypt']
        );
        return keyPair;
    }
    
    async function exportPublicKey(key) {
        const exported = await window.crypto.subtle.exportKey('spki', key);
        return btoa(String.fromCharCode(...new Uint8Array(exported)));
    }
    
    async function importPublicKey(pemKey) {
        const binary = atob(pemKey);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) {
            bytes[i] = binary.charCodeAt(i);
        }
        return await window.crypto.subtle.importKey(
            'spki',
            bytes.buffer,
            { name: 'RSA-OAEP', hash: 'SHA-256' },
            true,
            ['encrypt']
        );
    }
    
    function generateAESKey() {
        return window.crypto.subtle.generateKey(
            { name: 'AES-GCM', length: 256 },
            true,
            ['encrypt', 'decrypt']
        );
    }
    
    async function encryptMessage(message, aesKey, iv) {
        const encoder = new TextEncoder();
        const data = encoder.encode(message);
        const encrypted = await window.crypto.subtle.encrypt(
            { name: 'AES-GCM', iv: iv },
            aesKey,
            data
        );
        return btoa(String.fromCharCode(...new Uint8Array(encrypted)));
    }
    
    async function decryptMessage(encryptedData, aesKey, iv) {
        const binary = atob(encryptedData);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) {
            bytes[i] = binary.charCodeAt(i);
        }
        const decrypted = await window.crypto.subtle.decrypt(
            { name: 'AES-GCM', iv: iv },
            aesKey,
            bytes.buffer
        );
        const decoder = new TextDecoder();
        return decoder.decode(decrypted);
    }
    
    function generateIV() {
        return window.crypto.getRandomValues(new Uint8Array(12));
    }
    
    async function encryptAESKey(aesKey, publicKey) {
        const exported = await window.crypto.subtle.exportKey('raw', aesKey);
        const encrypted = await window.crypto.subtle.encrypt(
            { name: 'RSA-OAEP' },
            publicKey,
            exported
        );
        return btoa(String.fromCharCode(...new Uint8Array(encrypted)));
    }
    
    async function decryptAESKey(encryptedKey) {
        const binary = atob(encryptedKey);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) {
            bytes[i] = binary.charCodeAt(i);
        }
        const decrypted = await window.crypto.subtle.decrypt(
            { name: 'RSA-OAEP' },
            rsaKeyPair.privateKey,
            bytes.buffer
        );
        return await window.crypto.subtle.importKey(
            'raw',
            decrypted,
            { name: 'AES-GCM', length: 256 },
            true,
            ['encrypt', 'decrypt']
        );
    }
    
    async function initializeChatEncryption(targetUserId) {
        if (!rsaKeyPair) {
            await initEncryption();
        }
        
        encryptionStatus[targetUserId] = 'pending';
        updateEncryptionStatus();
        
        try {
            const publicKey = await exportPublicKey(rsaKeyPair.publicKey);
            console.log('[ENCRYPTION] Sending public key to:', targetUserId);
            
            socket.emit('send_public_key', {
                user_id: currentUserId,
                target_user_id: targetUserId,
                public_key: publicKey
            });
        } catch (error) {
            showNotification('Failed to send public key', 'error');
            encryptionStatus[targetUserId] = 'failed';
            updateEncryptionStatus();
            console.error('[ENCRYPTION] Failed to send public key:', error);
        }
    }
    
    function updateEncryptionStatus() {
        if (currentPrivateChatUser && encryptionStatus[currentPrivateChatUser]) {
            const status = encryptionStatus[currentPrivateChatUser];
            switch (status) {
                case 'encrypted':
                    encryptionStatusIndicator.textContent = '🔐 ENCRYPTED';
                    encryptionStatusIndicator.classList.remove('pending', 'failed');
                    encryptionStatusIndicator.classList.add('encrypted');
                    break;
                case 'pending':
                    encryptionStatusIndicator.textContent = '🔐 INITIALIZING...';
                    encryptionStatusIndicator.classList.remove('encrypted', 'failed');
                    encryptionStatusIndicator.classList.add('pending');
                    break;
                case 'failed':
                    encryptionStatusIndicator.textContent = '⚠️ ENCRYPTION FAILED';
                    encryptionStatusIndicator.classList.remove('encrypted', 'pending');
                    encryptionStatusIndicator.classList.add('failed');
                    break;
                default:
                    encryptionStatusIndicator.textContent = '🔓 NOT ENCRYPTED';
                    encryptionStatusIndicator.classList.remove('encrypted', 'pending', 'failed');
            }
        } else {
            encryptionStatusIndicator.textContent = '';
            encryptionStatusIndicator.classList.remove('encrypted', 'pending', 'failed');
        }
    }
    
    panelTabs.forEach(tab => {
        tab.addEventListener('click', function() {
            panelTabs.forEach(t => t.classList.remove('active'));
            this.classList.add('active');
            
            const tabId = this.dataset.tab;
            document.querySelectorAll('.tab-content').forEach(content => {
                content.classList.add('hidden');
            });
            document.getElementById(`${tabId}-tab`).classList.remove('hidden');
            
            if (tabId === 'private') {
                socket.emit('get_private_chats', { user_id: currentUserId });
            }
        });
    });
    
    chatTabs.forEach(tab => {
        tab.addEventListener('click', function() {
            const chatMode = this.dataset.chat;
            if (chatMode === 'public') {
                switchToPublicChat();
            }
        });
    });
    
    uploadBtn.addEventListener('click', function() {
        fileInput.click();
    });
    
    fileInput.addEventListener('change', function(e) {
        const files = e.target.files;
        if (files.length > 0) {
            uploadFiles(files);
        }
    });
    
    closePreviewBtn.addEventListener('click', closePreviewModal);
    closeModalBtn.addEventListener('click', closePreviewModal);
    
    closePrivateModalBtn.addEventListener('click', closePrivateChatModal);
    cancelPrivateChatBtn.addEventListener('click', closePrivateChatModal);
    
    downloadFileBtn.addEventListener('click', function() {
        if (currentPreviewFile) {
            window.open(currentPreviewFile.url, '_blank');
        }
    });
    
    socket.on('user_id', async function(data) {
        currentUserId = data.user_id;
        console.log('Connected as:', currentUserId);
        await initEncryption();
    });
    
    socket.on('user_join', function(data) {
        if (currentChatMode === 'public') {
            addSystemMessage(`${data.user_id} joined the chat`);
        }
    });
    
    socket.on('user_leave', function(data) {
        if (currentChatMode === 'public') {
            addSystemMessage(`${data.user_id} left the chat`);
        }
    });
    
    socket.on('online_users', function(data) {
        onlineCount.textContent = data.count;
        updateOnlineUsers(data.users);
    });
    
    socket.on('load_messages', function(data) {
        if (currentChatMode === 'public') {
            messagesContainer.innerHTML = '';
            data.messages.forEach(function(msg) {
                addMessage(msg);
            });
            scrollToBottom();
        }
    });
    
    socket.on('new_message', function(data) {
        if (currentChatMode === 'public') {
            addMessage(data);
            scrollToBottom();
        }
    });
    
    socket.on('user_typing', function(data) {
        if (data.user_id !== currentUserId && currentChatMode === 'public') {
            typingIndicator.textContent = `${data.user_id} is typing...`;
        }
    });
    
    socket.on('user_stop_typing', function(data) {
        typingIndicator.textContent = '';
    });
    
    socket.on('error', function(data) {
        showNotification(data.message, 'error');
    });
    
    socket.on('private_chat_started', async function(data) {
        currentPrivateChatUser = data.target_user_id;
        currentChatMode = 'private';
        
        messagesContainer.innerHTML = '';
        data.messages.forEach(function(msg) {
            addPrivateMessage(msg);
        });
        
        privateChatTab.textContent = `PRIVATE: ${data.target_user_id}`;
        privateChatTab.style.display = 'block';
        privateChatTab.classList.add('active');
        publicChatTab.classList.remove('active');
        
        document.querySelector('.chat-tabs').style.display = 'flex';
        
        if (!document.querySelector('.encryption-status')) {
            document.querySelector('.chat-tabs').appendChild(encryptionStatusIndicator);
        }
        
        await initializeChatEncryption(data.target_user_id);
        
        socket.emit('mark_private_messages_read', {
            user_id: currentUserId,
            target_user_id: currentPrivateChatUser
        });
        
        scrollToBottom();
        closePrivateChatModal();
    });
    
    socket.on('new_private_message', async function(data) {
        const senderId = data.message.user_id;
        const targetUserId = data.chat_id.replace(currentUserId, '').replace('-', '');
        
        if (currentChatMode === 'private' && 
            (data.chat_id.includes(currentUserId) && data.chat_id.includes(currentPrivateChatUser))) {
            
            let messageData = data.message;
            
            if (messageData.user_id === currentUserId) {
                return;
            }
            
            if (messageData.encrypted && messageData.iv) {
                try {
                    const keyInfo = encryptionKeys[senderId] || encryptionKeys[targetUserId];
                    console.log('[ENCRYPTION] Decrypting message from:', senderId, 'has key:', !!keyInfo);
                    
                    if (keyInfo && keyInfo.aesKey) {
                        const iv = new Uint8Array(atob(messageData.iv).split('').map(c => c.charCodeAt(0)));
                        messageData.message = await decryptMessage(messageData.message, keyInfo.aesKey, iv);
                        messageData.encrypted = false;
                        console.log('[ENCRYPTION] Message decrypted successfully');
                    } else {
                        messageData.message = '[Encrypted message - decryption key not available]';
                        console.warn('[ENCRYPTION] No decryption key for:', senderId);
                    }
                } catch (error) {
                    messageData.message = '[Decryption failed]';
                    showNotification('Message decryption failed', 'error');
                    console.error('[ENCRYPTION] Decryption error:', error);
                }
            }
            
            addPrivateMessage(messageData);
            scrollToBottom();
            
            socket.emit('mark_private_messages_read', {
                user_id: currentUserId,
                target_user_id: currentPrivateChatUser
            });
        } else {
            socket.emit('get_private_chats', { user_id: currentUserId });
        }
    });
    
    socket.on('receive_public_key', async function(data) {
        const fromUserId = data.from_user_id;
        const publicKey = data.public_key;
        
        console.log('[ENCRYPTION] Received public key from:', fromUserId);
        
        try {
            const importedKey = await importPublicKey(publicKey);
            const aesKey = await generateAESKey();
            const iv = generateIV();
            
            const encryptedAesKey = await encryptAESKey(aesKey, importedKey);
            
            if (!encryptionKeys[fromUserId]) {
                encryptionKeys[fromUserId] = {};
            }
            encryptionKeys[fromUserId].aesKey = aesKey;
            encryptionKeys[fromUserId].iv = iv;
            
            console.log('[ENCRYPTION] Generated AES key for:', fromUserId);
            
            socket.emit('send_encrypted_aes_key', {
                user_id: currentUserId,
                target_user_id: fromUserId,
                encrypted_aes_key: encryptedAesKey,
                iv: btoa(String.fromCharCode(...iv))
            });
            
            encryptionStatus[fromUserId] = 'encrypted';
            updateEncryptionStatus();
            showNotification(`Secure connection established with ${fromUserId}`, 'success');
        } catch (error) {
            showNotification('Failed to establish secure connection', 'error');
            encryptionStatus[fromUserId] = 'failed';
            updateEncryptionStatus();
            console.error('[ENCRYPTION] Error receiving public key:', error);
        }
    });
    
    socket.on('receive_encrypted_aes_key', async function(data) {
        const fromUserId = data.from_user_id;
        const encryptedAesKey = data.encrypted_aes_key;
        const iv = data.iv;
        
        console.log('[ENCRYPTION] Received encrypted AES key from:', fromUserId);
        
        try {
            const aesKey = await decryptAESKey(encryptedAesKey);
            const ivBytes = new Uint8Array(atob(iv).split('').map(c => c.charCodeAt(0)));
            
            if (!encryptionKeys[fromUserId]) {
                encryptionKeys[fromUserId] = {};
            }
            encryptionKeys[fromUserId].aesKey = aesKey;
            encryptionKeys[fromUserId].iv = ivBytes;
            
            console.log('[ENCRYPTION] Decrypted AES key for:', fromUserId);
            
            encryptionStatus[fromUserId] = 'encrypted';
            updateEncryptionStatus();
            showNotification(`Secure connection established with ${fromUserId}`, 'success');
        } catch (error) {
            showNotification('Failed to establish secure connection', 'error');
            encryptionStatus[fromUserId] = 'failed';
            updateEncryptionStatus();
            console.error('[ENCRYPTION] Error receiving encrypted AES key:', error);
        }
    });
    
    socket.on('private_chat_update', function(data) {
        socket.emit('get_private_chats', { user_id: currentUserId });
    });
    
    socket.on('private_chats_list', function(data) {
        updatePrivateChats(data.chats);
    });
    
    socket.on('private_messages_read', function(data) {
        socket.emit('get_private_chats', { user_id: currentUserId });
    });
    
    sendBtn.addEventListener('click', function() {
        sendMessage();
    });
    
    messageInput.addEventListener('keypress', function(e) {
        if (e.key === 'Enter') {
            sendMessage();
        }
    });
    
    messageInput.addEventListener('input', function() {
        if (messageInput.value.trim() && currentChatMode === 'public') {
            socket.emit('typing', { user_id: currentUserId });
        }
        
        if (typingTimeout) {
            clearTimeout(typingTimeout);
        }
        
        typingTimeout = setTimeout(function() {
            socket.emit('stop_typing', { user_id: currentUserId });
        }, 1000);
    });
    
    async function sendMessage() {
        const message = messageInput.value.trim();
        
        if (!message && !pendingFileInfo) return;
        if (!currentUserId) return;
        
        let encryptedMessage = message;
        let iv = null;
        let isEncrypted = false;
        
        if (currentChatMode === 'private' && currentPrivateChatUser) {
            const keyInfo = encryptionKeys[currentPrivateChatUser];
            console.log('[ENCRYPTION] Sending message to:', currentPrivateChatUser, 'has key:', !!keyInfo);
            
            if (keyInfo && keyInfo.aesKey) {
                try {
                    const newIv = generateIV();
                    encryptedMessage = await encryptMessage(message, keyInfo.aesKey, newIv);
                    iv = btoa(String.fromCharCode(...newIv));
                    isEncrypted = true;
                    console.log('[ENCRYPTION] Message encrypted successfully');
                } catch (error) {
                    showNotification('Encryption failed, sending unencrypted', 'error');
                    console.error('[ENCRYPTION] Encryption error:', error);
                }
            } else {
                showNotification('Sending unencrypted - secure connection not established', 'warning');
                console.warn('[ENCRYPTION] No encryption key available for:', currentPrivateChatUser);
            }
        }
        
        const currentPendingFile = pendingFileInfo;
        
        if (currentChatMode === 'public') {
            socket.emit('send_message', {
                user_id: currentUserId,
                message: encryptedMessage,
                file_info: pendingFileInfo
            });
            
            addMessage({
                user_id: currentUserId,
                message: message,
                timestamp: Date.now() / 1000,
                file_info: currentPendingFile
            });
            scrollToBottom();
        } else {
            socket.emit('send_private_message', {
                user_id: currentUserId,
                target_user_id: currentPrivateChatUser,
                message: encryptedMessage,
                file_info: pendingFileInfo,
                encrypted: isEncrypted,
                iv: iv
            });
            
            addPrivateMessage({
                user_id: currentUserId,
                message: message,
                timestamp: Date.now() / 1000,
                file_info: currentPendingFile,
                read: true
            });
            scrollToBottom();
        }
        
        messageInput.value = '';
        pendingFileInfo = null;
        socket.emit('stop_typing', { user_id: currentUserId });
    }
    
    function addMessage(data) {
        const messageDiv = document.createElement('div');
        messageDiv.className = 'message';
        
        if (data.user_id === currentUserId) {
            messageDiv.classList.add('user');
        }
        
        const userIdDiv = document.createElement('div');
        userIdDiv.className = 'user-id';
        userIdDiv.textContent = data.user_id;
        
        const contentDiv = document.createElement('div');
        contentDiv.className = 'content';
        contentDiv.textContent = data.message;
        
        const timestampDiv = document.createElement('div');
        timestampDiv.className = 'timestamp';
        const date = new Date(data.timestamp * 1000);
        timestampDiv.textContent = date.toLocaleTimeString('zh-CN');
        
        messageDiv.appendChild(userIdDiv);
        messageDiv.appendChild(contentDiv);
        
        if (data.file_info) {
            const fileAttachment = createFileAttachment(data.file_info);
            messageDiv.appendChild(fileAttachment);
        }
        
        messageDiv.appendChild(timestampDiv);
        
        messagesContainer.appendChild(messageDiv);
    }
    
    function addPrivateMessage(data) {
        const messageDiv = document.createElement('div');
        messageDiv.className = 'message private';
        
        if (data.user_id === currentUserId) {
            messageDiv.classList.add('user');
        }
        
        if (data.encrypted) {
            messageDiv.classList.add('encrypted');
        }
        
        const userIdDiv = document.createElement('div');
        userIdDiv.className = 'user-id';
        userIdDiv.textContent = data.user_id;
        
        const contentDiv = document.createElement('div');
        contentDiv.className = 'content';
        contentDiv.textContent = data.message;
        
        const timestampDiv = document.createElement('div');
        timestampDiv.className = 'timestamp';
        const date = new Date(data.timestamp * 1000);
        timestampDiv.textContent = date.toLocaleTimeString('zh-CN');
        
        messageDiv.appendChild(userIdDiv);
        messageDiv.appendChild(contentDiv);
        
        if (data.file_info) {
            const fileAttachment = createFileAttachment(data.file_info);
            messageDiv.appendChild(fileAttachment);
        }
        
        messageDiv.appendChild(timestampDiv);
        
        if (data.read) {
            const readStatus = document.createElement('div');
            readStatus.className = 'read-status';
            readStatus.textContent = 'READ';
            messageDiv.appendChild(readStatus);
        }
        
        messagesContainer.appendChild(messageDiv);
    }
    
    function createFileAttachment(fileInfo) {
        const attachmentDiv = document.createElement('div');
        attachmentDiv.className = 'file-attachment';
        
        if (fileInfo.file_type === 'image') {
            const img = document.createElement('img');
            img.src = fileInfo.url;
            img.alt = fileInfo.original_name;
            img.addEventListener('click', function() {
                openFilePreview(fileInfo);
            });
            attachmentDiv.appendChild(img);
        }
        
        const fileInfoDiv = document.createElement('div');
        fileInfoDiv.className = 'file-info';
        
        const fileNameDiv = document.createElement('div');
        fileNameDiv.className = 'file-name';
        fileNameDiv.textContent = fileInfo.original_name;
        
        const fileSizeDiv = document.createElement('div');
        fileSizeDiv.className = 'file-size';
        fileSizeDiv.textContent = formatFileSize(fileInfo.size);
        
        fileInfoDiv.appendChild(fileNameDiv);
        fileInfoDiv.appendChild(fileSizeDiv);
        
        const downloadLink = document.createElement('div');
        downloadLink.className = 'download-link';
        downloadLink.textContent = 'DOWNLOAD';
        downloadLink.addEventListener('click', function() {
            window.open(fileInfo.url, '_blank');
        });
        
        attachmentDiv.appendChild(fileInfoDiv);
        attachmentDiv.appendChild(downloadLink);
        
        return attachmentDiv;
    }
    
    function addSystemMessage(text) {
        const messageDiv = document.createElement('div');
        messageDiv.className = 'message system';
        
        const contentDiv = document.createElement('div');
        contentDiv.className = 'content';
        contentDiv.textContent = text;
        
        messageDiv.appendChild(contentDiv);
        messagesContainer.appendChild(messageDiv);
    }
    
    function updateOnlineUsers(users) {
        onlineUsersList.innerHTML = '';
        
        users.forEach(function(user) {
            const li = document.createElement('li');
            li.textContent = user;
            
            if (user === currentUserId) {
                li.classList.add('current-user');
            } else {
                li.addEventListener('click', function() {
                    startPrivateChat(user);
                });
            }
            
            onlineUsersList.appendChild(li);
        });
    }
    
    function updatePrivateChats(chats) {
        privateChatsList.innerHTML = '';
        
        if (chats.length === 0) {
            noPrivateChats.style.display = 'block';
        } else {
            noPrivateChats.style.display = 'none';
            
            chats.forEach(function(chat) {
                const li = document.createElement('li');
                li.textContent = chat.other_user_id;
                
                if (chat.unread_count > 0) {
                    li.classList.add('unread');
                }
                
                li.addEventListener('click', function() {
                    startPrivateChat(chat.other_user_id);
                });
                
                privateChatsList.appendChild(li);
            });
        }
    }
    
    function startPrivateChat(targetUserId) {
        if (targetUserId === currentUserId) return;
        
        socket.emit('start_private_chat', {
            user_id: currentUserId,
            target_user_id: targetUserId
        });
    }
    
    function switchToPublicChat() {
        currentChatMode = 'public';
        currentPrivateChatUser = null;
        
        privateChatTab.style.display = 'none';
        privateChatTab.classList.remove('active');
        publicChatTab.classList.add('active');
        
        messagesContainer.innerHTML = '';
        socket.emit('get_private_chats', { user_id: currentUserId });
        
        updateEncryptionStatus();
    }
    
    function uploadFiles(files) {
        const file = files[0];
        
        if (file.size > 20 * 1024 * 1024) {
            showNotification('File size exceeds 20MB limit', 'error');
            return;
        }
        
        const formData = new FormData();
        formData.append('file', file);
        formData.append('user_id', currentUserId);
        
        uploadProgress.classList.remove('hidden');
        progressBar.style.width = '0%';
        progressText.textContent = '0%';
        
        const xhr = new XMLHttpRequest();
        
        xhr.upload.addEventListener('progress', function(e) {
            if (e.lengthComputable) {
                const percent = Math.round((e.loaded / e.total) * 100);
                progressBar.style.width = `${percent}%`;
                progressText.textContent = `${percent}%`;
            }
        });
        
        xhr.addEventListener('load', function() {
            uploadProgress.classList.add('hidden');
            fileInput.value = '';
            
            if (xhr.status === 200) {
                const response = JSON.parse(xhr.responseText);
                pendingFileInfo = response;
                showNotification(`File ready to send: ${response.original_name}`, 'success');
            } else {
                const response = JSON.parse(xhr.responseText);
                showNotification('Upload failed: ' + response.error, 'error');
            }
        });
        
        xhr.addEventListener('error', function() {
            uploadProgress.classList.add('hidden');
            fileInput.value = '';
            showNotification('Upload failed: Network error', 'error');
        });
        
        xhr.open('POST', '/api/upload');
        xhr.send(formData);
    }
    
    function openFilePreview(fileInfo) {
        currentPreviewFile = fileInfo;
        previewContent.innerHTML = '';
        
        if (fileInfo.file_type === 'image') {
            const img = document.createElement('img');
            img.src = fileInfo.url;
            img.alt = fileInfo.original_name;
            previewContent.appendChild(img);
        } else {
            const infoDiv = document.createElement('div');
            infoDiv.innerHTML = `
                <p><strong>File:</strong> ${fileInfo.original_name}</p>
                <p><strong>Size:</strong> ${formatFileSize(fileInfo.size)}</p>
                <p><strong>Type:</strong> ${fileInfo.file_type}</p>
            `;
            previewContent.appendChild(infoDiv);
        }
        
        filePreviewModal.classList.add('active');
    }
    
    function closePreviewModal() {
        filePreviewModal.classList.remove('active');
        currentPreviewFile = null;
    }
    
    function closePrivateChatModal() {
        privateChatModal.classList.remove('active');
    }
    
    function formatFileSize(bytes) {
        if (bytes < 1024) return bytes + ' B';
        if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
        return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    }
    
    function scrollToBottom() {
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }
    
    function showNotification(message, type) {
        const notification = document.createElement('div');
        notification.className = `notification ${type}`;
        notification.textContent = message;
        
        document.body.appendChild(notification);
        
        setTimeout(function() {
            notification.classList.add('fade-out');
            setTimeout(function() {
                document.body.removeChild(notification);
            }, 300);
        }, 3000);
    }
});