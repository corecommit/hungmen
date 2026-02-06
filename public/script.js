// ═══════════════════════════════════════════════════════════════════════
// HANGMAN MULTIPLAYER GAME - CLIENT (CUSTOM WORD MODE) - BUG FIXES
// Fixed: Turn management, hint count initialization, word display updates
// ═══════════════════════════════════════════════════════════════════════

// ── Configuration ──
const CONFIG = {
    SERVER_URL: window.location.hostname === 'localhost' ? 'http://localhost:3000' : '', // Auto-detect for production
    MAX_WRONG_GUESSES: 6,
    MAX_USERNAME_LENGTH: 20,
    MAX_ROOM_NAME_LENGTH: 30,
    MAX_MESSAGE_LENGTH: 200,
    MAX_AVATAR_SIZE: 5 * 1024 * 1024, // 5MB
    RECONNECTION_ATTEMPTS: 5,
    DEBUG: false // Set to false in production to hide console logs
};

// ── Global State ──
let socket = null;
let currentUser = null;
let currentRoom = null;
let gameState = null;
let isHost = false;
let selectedRoomId = null;
let mySocketId = null;
let currentChatType = 'global';
let isWordSetter = false;
let isOnWordSetterTeam = false;
let hintsRemaining = 5;
let playerTeamMap = {};
let currentGameMode = 'medium';
let currentHintCount = 5;
let unreadCounts = {
    room: {
        global: 0,
        team: 0
    },
    game: {
        global: 0,
        team: 0
    }
};

// NEW: Track player indices for turn management
let myPlayerIndex = -1;
let activePlayers = []; // Players who can guess (excluding word setter's team)

// ── User Stats (Cookie-based) ──
let userStats = {
    wins: 0,
    losses: 0,
    totalGames: 0
};

// ── User Avatar (LocalStorage) ──
let userAvatar = null;

// ── DOM Elements ──
let authScreen, gameScreen, authError;
let lobbyView, roomView, gameView;

// ═══════════════════════════════════════════════════════════════════════
// UTILITY FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════

function log(...args) {
    if (CONFIG.DEBUG) {
        console.log('[HANGMAN]', new Date().toISOString(), ...args);
    }
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function showNotification(message, type = 'info') {
    const toast = document.getElementById('notificationToast');
    const messageEl = document.getElementById('notificationMessage');
    
    toast.className = `notification-toast ${type}`;
    messageEl.textContent = message;
    toast.classList.remove('hidden');
    
    setTimeout(() => {
        toast.classList.add('hidden');
    }, 3000);
}

// ═══════════════════════════════════════════════════════════════════════
// SESSION STORAGE FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════

function saveSession(username) {
    sessionStorage.setItem('hangman_username', username);
}

function getSession() {
    return sessionStorage.getItem('hangman_username');
}

function clearSession() {
    sessionStorage.removeItem('hangman_username');
}

// ═══════════════════════════════════════════════════════════════════════
// COOKIE HELPER FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════

function setCookie(name, value, days) {
    let expires = '';
    if (days) {
        const date = new Date();
        date.setTime(date.getTime() + (days * 24 * 60 * 60 * 1000));
        expires = '; expires=' + date.toUTCString();
    }
    document.cookie = name + '=' + encodeURIComponent(value) + expires + '; path=/; SameSite=Strict';
}

function getCookie(name) {
    const nameEQ = name + '=';
    const ca = document.cookie.split(';');
    for (let i = 0; i < ca.length; i++) {
        let c = ca[i];
        while (c.charAt(0) === ' ') c = c.substring(1, c.length);
        if (c.indexOf(nameEQ) === 0) {
            return decodeURIComponent(c.substring(nameEQ.length, c.length));
        }
    }
    return null;
}

function deleteCookie(name) {
    document.cookie = name + '=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;';
}

// ═══════════════════════════════════════════════════════════════════════
// DEVICE ID MANAGEMENT
// ═══════════════════════════════════════════════════════════════════════

function getDeviceId() {
    let deviceId = getCookie('hangman_device_id');
    if (!deviceId) {
        deviceId = 'device_' + Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
        setCookie('hangman_device_id', deviceId, 365);
    }
    return deviceId;
}

// ═══════════════════════════════════════════════════════════════════════
// STATS MANAGEMENT FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════

function getStatsCookieName() {
    const deviceId = getDeviceId();
    return 'hangman_stats_' + deviceId;
}

function loadUserStats() {
    const cookieName = getStatsCookieName();
    const savedStats = getCookie(cookieName);
    
    if (savedStats) {
        try {
            const parsed = JSON.parse(savedStats);
            userStats = {
                wins: parsed.wins || 0,
                losses: parsed.losses || 0,
                totalGames: parsed.totalGames || 0
            };
        } catch (e) {
            userStats = { wins: 0, losses: 0, totalGames: 0 };
        }
    } else {
        userStats = { wins: 0, losses: 0, totalGames: 0 };
    }
}

function saveUserStats() {
    const cookieName = getStatsCookieName();
    const statsJson = JSON.stringify(userStats);
    setCookie(cookieName, statsJson, 365);
}

function updateStats(result) {
    userStats.totalGames++;
    
    if (result === 'win') {
        userStats.wins++;
    } else if (result === 'loss') {
        userStats.losses++;
    }
    
    saveUserStats();
    displayUserStats();
}

function displayUserStats() {
    let statsContainer = document.getElementById('userStatsContainer');
    
    if (statsContainer) {
        const winRate = userStats.totalGames > 0 
            ? Math.round((userStats.wins / userStats.totalGames) * 100) 
            : 0;
        
        statsContainer.innerHTML = `
            <div class="user-stats-card">
                <h3>Your Stats</h3>
                <div class="stats-grid">
                    <div class="stat-item">
                        <span class="stat-value">${userStats.wins}</span>
                        <span class="stat-label">Wins</span>
                    </div>
                    <div class="stat-item">
                        <span class="stat-value">${userStats.losses}</span>
                        <span class="stat-label">Losses</span>
                    </div>
                    <div class="stat-item">
                        <span class="stat-value">${userStats.totalGames}</span>
                        <span class="stat-label">Games</span>
                    </div>
                    <div class="stat-item">
                        <span class="stat-value">${winRate}%</span>
                        <span class="stat-label">Win Rate</span>
                    </div>
                </div>
            </div>
        `;
    }
}

// ═══════════════════════════════════════════════════════════════════════
// AVATAR MANAGEMENT FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════

function getAvatarStorageKey() {
    const deviceId = getDeviceId();
    return 'hangman_avatar_' + deviceId;
}

function loadUserAvatar() {
    const storageKey = getAvatarStorageKey();
    const savedAvatar = localStorage.getItem(storageKey);
    
    if (savedAvatar && savedAvatar !== 'null' && savedAvatar !== '') {
        userAvatar = savedAvatar;
    } else {
        userAvatar = null;
    }
}

function saveUserAvatar(avatar) {
    const storageKey = getAvatarStorageKey();
    localStorage.setItem(storageKey, avatar);
    userAvatar = avatar;
}

function displayUserAvatar() {
    const avatarDisplay = document.getElementById('userAvatarDisplay');
    if (!avatarDisplay) return;
    
    if (userAvatar) {
        avatarDisplay.innerHTML = `
            <img src="${userAvatar}" alt="User Avatar" class="avatar-image" style="width: 40px; height: 40px; border-radius: 50%; object-fit: cover;">
        `;
    } else {
        avatarDisplay.innerHTML = `
            <span class="avatar-emoji">👤</span>
        `;
    }
}

function updateAvatarPreview() {
    const avatarPreviewImg = document.getElementById('avatarPreviewImg');
    const avatarPlaceholder = document.getElementById('avatarPlaceholder');
    
    if (!avatarPreviewImg || !avatarPlaceholder) return;
    
    if (userAvatar) {
        avatarPreviewImg.src = userAvatar;
        avatarPreviewImg.style.display = 'block';
        avatarPlaceholder.style.display = 'none';
    } else {
        avatarPreviewImg.style.display = 'none';
        avatarPlaceholder.style.display = 'block';
    }
}

function compressImage(file, maxSizeKB, callback) {
    const reader = new FileReader();
    
    reader.onload = function(e) {
        const img = new Image();
        
        img.onload = function() {
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            
            let width = img.width;
            let height = img.height;
            const maxDim = 200;
            
            if (width > height) {
                if (width > maxDim) {
                    height = (height * maxDim) / width;
                    width = maxDim;
                }
            } else {
                if (height > maxDim) {
                    width = (width * maxDim) / height;
                    height = maxDim;
                }
            }
            
            canvas.width = width;
            canvas.height = height;
            ctx.drawImage(img, 0, 0, width, height);
            
            let quality = 0.8;
            let base64 = canvas.toDataURL('image/jpeg', quality);
            
            while (base64.length > maxSizeKB * 1024 && quality > 0.1) {
                quality -= 0.1;
                base64 = canvas.toDataURL('image/jpeg', quality);
            }
            
            callback(base64);
        };
        
        img.onerror = function() {
            showNotification('Error loading image', 'error');
        };
        
        img.src = e.target.result;
    };
    
    reader.onerror = function() {
        showNotification('Error reading file', 'error');
    };
    
    reader.readAsDataURL(file);
}

function handleAvatarUpload(file) {
    if (!file) return;
    
    // Only allow JPG, JPEG, and PNG - explicitly block GIF
    const validTypes = ['image/jpeg', 'image/jpg', 'image/png'];
    if (!validTypes.includes(file.type)) {
        showNotification('Please select a valid image file (JPG, PNG only)', 'error');
        return;
    }
    
    const maxSize = CONFIG.MAX_AVATAR_SIZE;
    
    if (file.size > CONFIG.MAX_AVATAR_SIZE) {
        showNotification('Image file is too large. Maximum size is 5MB.', 'error');
        return;
    }
    
    compressImage(file, 100, (base64Image) => {
        saveUserAvatar(base64Image);
        displayUserAvatar();
        updateAvatarPreview();
        showNotification('Avatar updated successfully!', 'success');
    });
}

// ═══════════════════════════════════════════════════════════════════════
// SHARED AVATAR HELPER
// ═══════════════════════════════════════════════════════════════════════

function buildAvatarHTML(avatar, username, size = 28) {
    if (avatar) {
        return `<img src="${avatar}" alt="${escapeHtml(username)}" style="width:${size}px;height:${size}px;border-radius:50%;object-fit:cover;flex-shrink:0;">`;
    }
    const initial = username.charAt(0).toUpperCase();
    return `<div class="player-avatar" style="width:${size}px;height:${size}px;font-size:${size * 0.4}px;margin:0;flex-shrink:0;">${initial}</div>`;
}

// ═══════════════════════════════════════════════════════════════════════
// INITIALIZATION
// ═══════════════════════════════════════════════════════════════════════

document.addEventListener('DOMContentLoaded', () => {
    authScreen = document.getElementById('authScreen');
    gameScreen = document.getElementById('gameScreen');
    authError = document.getElementById('authError');
    lobbyView = document.getElementById('lobbyView');
    roomView = document.getElementById('roomView');
    gameView = document.getElementById('gameView');

    loadUserAvatar();
    
    // FIX: Set default active state on hint count button
    document.querySelectorAll('.hint-count-btn').forEach(btn => {
        if (parseInt(btn.dataset.hintCount) === currentHintCount) {
            btn.classList.add('active');
        }
    });

    const savedUsername = getSession();
    if (savedUsername) {
        currentUser = { username: savedUsername };
        connectSocket(savedUsername);
    } else {
        initAuth();
    }
    
    initEventListeners();
});

// ═══════════════════════════════════════════════════════════════════════
// SERVER CONNECTION
// ═══════════════════════════════════════════════════════════════════════

function isServerConnected() {
    return socket && socket.connected;
}

function showServerDownMessage() {
    const existingModal = document.getElementById('serverDownModal');
    if (existingModal) return;
    
    const modal = document.createElement('div');
    modal.id = 'serverDownModal';
    modal.className = 'modal show';
    modal.style.zIndex = '9999';
    modal.innerHTML = `
        <div class="modal-content" style="text-align: center;">
            <div class="modal-icon" style="font-size: 4rem; margin-bottom: 20px;">🔌</div>
            <h2 class="modal-title">Server Connection Lost</h2>
            <p class="modal-message">The server is down or you have been disconnected.</p>
            <p style="color: var(--text-secondary); margin-top: 10px;">Please refresh the page to try again.</p>
            <div class="modal-actions" style="margin-top: 30px;">
                <button class="btn btn-primary" onclick="location.reload()">Refresh Page</button>
            </div>
        </div>
    `;
    document.body.appendChild(modal);
}

function checkServerAndShowError() {
    if (!isServerConnected()) {
        showServerDownMessage();
        return false;
    }
    return true;
}

function connectSocket(username) {
    let connectionTimeout;
    
    if (socket) {
        socket.off();
        socket.disconnect();
    }
    
    socket = io(CONFIG.SERVER_URL, {
        timeout: 5000,
        reconnection: true,
        reconnectionAttempts: CONFIG.RECONNECTION_ATTEMPTS,
        reconnectionDelay: 1000,
        transports: ['websocket', 'polling']
    });
    
    connectionTimeout = setTimeout(() => {
        if (!socket || !socket.connected) {
            showNotification('Server is down. Please try again later.', 'error');
            if (socket) {
                socket.disconnect();
            }
            socket = null;
            clearSession();
        }
    }, 5000);
    
    setupSocketListeners(username, connectionTimeout);
}

function setupSocketListeners(username, connectionTimeout) {
    socket.on('connect', () => {
        clearTimeout(connectionTimeout);
        mySocketId = socket.id;
        log('Connected to server:', socket.id);
        socket.emit('authenticate', { username });
    });
    
    socket.on('connect_error', (error) => {
        clearTimeout(connectionTimeout);
        log('Connection error:', error);
        showNotification('Server is down. Please try again later.', 'error');
        if (socket) {
            socket.disconnect();
            socket = null;
        }
        clearSession();
    });
    
    socket.on('disconnect', (reason) => {
        log('Disconnected:', reason);
        if (reason === 'io server disconnect' || reason === 'transport close') {
            showServerDownMessage();
        }
    });
    
    socket.on('reconnect', (attemptNumber) => {
        log('Reconnected after', attemptNumber, 'attempts');
        showNotification('Reconnected to server!', 'success');
    });
    
    socket.on('authenticated', () => {
        log('Authenticated successfully');
        saveSession(username);
        showGameScreen();
        loadLobby();
        socket.emit('getLobbyChat');
    });
    
    socket.on('authError', (data) => {
        log('Auth error:', data.message);
        showAuthError(data.message);
        if (socket) {
            socket.disconnect();
            socket = null;
        }
        clearSession();
    });
    
    // Handle username change responses
    socket.on('usernameChanged', (data) => {
        log('Username changed to:', data.username);
        currentUser.username = data.username;
        
        // Update UI
        const currentUsernameEl = document.getElementById('currentUsername');
        if (currentUsernameEl) {
            currentUsernameEl.textContent = data.username;
        }
        
        // Update session
        saveSession(data.username);
        
        // Clear input and show success
        const newUsernameInput = document.getElementById('newUsernameInput');
        const usernameError = document.getElementById('usernameError');
        if (newUsernameInput) {
            newUsernameInput.value = '';
        }
        if (usernameError) {
            usernameError.style.display = 'none';
        }
        
        showNotification('Username changed successfully!', 'success');
    });
    
    socket.on('usernameChangeError', (data) => {
        log('Username change error:', data.message);
        const usernameError = document.getElementById('usernameError');
        if (usernameError) {
            usernameError.textContent = data.message;
            usernameError.style.display = 'block';
        }
    });
    
    socket.on('onlineCount', (count) => {
        document.getElementById('onlineCount').textContent = count;
        const globalChatOnline = document.getElementById('globalChatOnline');
        if (globalChatOnline) {
            globalChatOnline.textContent = count;
        }
    });
    
    socket.on('lobbyChatUpdate', (data) => {
        if (data.messages && Array.isArray(data.messages)) {
            const lobbyChatMessages = document.getElementById('lobbyChatMessages');
            if (lobbyChatMessages) {
                lobbyChatMessages.innerHTML = '';
                data.messages.forEach(message => addLobbyChatMessage(message));
            }
        } else {
            addLobbyChatMessage(data);
        }
    });
    
    socket.on('roomList', (rooms) => {
        updateRoomsList(rooms);
    });
    
    socket.on('roomCreated', (data) => {
        hideModal('createRoomModal');
        joinRoom(data.roomId, '');
    });
    
    socket.on('joinedRoom', (data) => {
        log('Joined room:', data.roomId);
        currentRoom = data;
        isHost = data.isHost;
        showRoomView(data);
    });
    
    socket.on('joinError', (data) => {
        showNotification(data.message, 'error');
    });
    
    socket.on('createRoomError', (data) => {
        showModalError('createRoomError', data.message);
    });
    
    socket.on('playerJoined', (player) => {
        log('Player joined:', player.username);
        addPlayerToRoom(player);
    });
    
    socket.on('playerLeft', (data) => {
        removePlayerFromRoom(data.id);
    });
    
    socket.on('hostChanged', (data) => {
        if (data.newHostId === mySocketId) {
            isHost = true;
            updateRoomControls();
            showNotification('You are now the host!', 'info');
        }
    });
    
    // Word selection phase for custom word mode
    socket.on('wordSelectionPhase', (data) => {
        isWordSetter = (data.wordSetter.id === mySocketId);
        hintsRemaining = data.hintCount || 5;
        
        if (isWordSetter) {
            // Reset the word input and submit button for a fresh modal
            const wordInput = document.getElementById('customWord');
            const submitBtn = document.getElementById('submitWordBtn');
            if (wordInput) wordInput.value = '';
            if (submitBtn) {
                submitBtn.disabled = false;
                submitBtn.innerHTML = '<i class="fas fa-check"></i> Submit Word';
            }
            const wordError = document.getElementById('wordSelectionError');
            if (wordError) { wordError.textContent = ''; wordError.style.display = 'none'; }
            
            showModal('wordSelectionModal');
        } else {
            showWaitingForWordModal(data.wordSetter.username);
        }
    });
    
    // Word was accepted
    socket.on('wordAccepted', () => {
        hideModal('wordSelectionModal');
        showNotification('Word submitted successfully!', 'success');
    });
    
    // Word submission error
    socket.on('wordSubmitError', (data) => {
        showModalError('wordSelectionError', data.message);
        const submitBtn = document.getElementById('submitWordBtn');
        if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.innerHTML = '<i class="fas fa-check"></i> Submit Word';
        }
    });
    
    socket.on('gameStarted', (data) => {
        hideModal('waitingForWordModal');
        gameState = data.gameState;
        
        // Store players array for turn lookups
        // IMPORTANT: Must use the full players array from server, not filtered activePlayers
        gameState.players = data.players;
        
        // Initialize word for tracking
        if (!gameState.word && gameState.wordLength) {
            gameState.word = '';
        }
        
        isWordSetter = (data.gameState.wordSetter === mySocketId);
        hintsRemaining = (data.gameState.hintsRemaining != null) ? data.gameState.hintsRemaining : 0;

        // Build player team map
        playerTeamMap = {};
        isOnWordSetterTeam = false;
        
        if (data.players) {
            data.players.forEach(p => {
                playerTeamMap[p.id] = p.team;
            });
        }
        
        // FIX: Determine if on word setter's team
        // Only check team membership in actual team modes (2v2, 3v3, 4v4)
        // In 1v1 mode, both players have team: null, so we must NOT check team equality
        const myTeam = playerTeamMap[mySocketId];
        const isTeamMode = data.mode === '2v2' || data.mode === '3v3' || data.mode === '4v4';
        
        if (isTeamMode && gameState.wordSetterTeam) {
            isOnWordSetterTeam = (myTeam === gameState.wordSetterTeam);
        } else {
            // In 1v1 or when there's no wordSetterTeam, only the word setter is blocked
            isOnWordSetterTeam = false;
        }
        
        // Build active players list (excluding word setter's team in custom mode)
        // This is for display purposes only - server manages turns using full players array
        activePlayers = [];
        if (gameState.isCustomWord && gameState.wordSetterTeam) {
            // Only include players NOT on word setter's team
            data.players.forEach((p) => {
                if (p.team !== gameState.wordSetterTeam) {
                    activePlayers.push(p);
                }
            });
        } else {
            // All players can play
            activePlayers = [...data.players];
        }

        showGameView(data);
    });
    
    socket.on('guessResult', (data) => {
        updateGameState(data);
    });
    
    // Hint request received (for word setter)
    socket.on('hintRequested', (data) => {
        showHintRequestModal(data.requesterName);
    });
    
    // Hint provided (for all players)
    socket.on('hintProvided', (data) => {
        displayReceivedHint(data.hint, data.hintNumber);
        hintsRemaining = data.hintsRemaining;
        updateHintsDisplay();

        if (data.requesterId !== mySocketId) {
            showNotification('A hint has been revealed!', 'info');
        }
    });

    // Hint dismissed by word setter
    socket.on('hintDismissed', (data) => {
        const askHintBtn = document.getElementById('askHintBtn');
        if (askHintBtn && hintsRemaining > 0) {
            askHintBtn.disabled = false;
            askHintBtn.innerHTML = '<i class="fas fa-question-circle"></i> Ask for Hint';
        }
        if (data && data.requesterId === mySocketId) {
            showNotification('Your hint request was ignored.', 'info');
        }
    });
    
    socket.on('hintError', (data) => {
        showNotification(data.message, 'error');
        const askHintBtn = document.getElementById('askHintBtn');
        if (askHintBtn) {
            askHintBtn.disabled = false;
            askHintBtn.innerHTML = '<i class="fas fa-question-circle"></i> Ask for Hint';
        }
    });

    socket.on('guessError', (data) => {
        showNotification(data.message, 'error');
    });

    socket.on('gameEnded', (data) => {
        showGameOverModal(data);
    });
    
    socket.on('newMessage', (message) => {
        addChatMessage(message);
    });
    
    socket.on('roomPlayersUpdate', (data) => {
        if (data.players) {
            updatePlayersList(data.players);
            if (currentRoom && currentRoom.mode !== 'solo' && currentRoom.mode !== '1v1') {
                updateTeams(data.players);
            }
        }
    });

    socket.on('playerTeamChanged', (data) => {
        updatePlayerTeams(data.players);
    });
    
    socket.on('teamChanged', (data) => {
        updateTeamSelectionButtons(data.team);
    });
    
    socket.on('teamChangeError', (data) => {
        showNotification(data.message, 'error');
    });
}

// ═══════════════════════════════════════════════════════════════════════
// AUTHENTICATION
// ═══════════════════════════════════════════════════════════════════════

function initAuth() {
    const usernameForm = document.getElementById('usernameForm');
    if (usernameForm) {
        usernameForm.addEventListener('submit', handleJoinGame);
    }
}

function handleJoinGame(e) {
    e.preventDefault();
    const usernameInput = document.getElementById('usernameInput');
    const username = usernameInput.value.trim();
    
    const bannedVariations = ['shreyan', 'shreyn', 'shryn', 'shyn', 'sreyan', 'sreyn', 'sryan', 'sryn', 'shrayan', 'shrayn', 'shriyan', 'shriyn', 'shrian', 'shrien', 'shryen', 'shryan', 'shryon', 'shryun','samarth', 'samart', 'samarthh', 'samarath','samerth', 'samirth', 'somarth', 'sumarth', 'samurth','samrth', 'smarth', 'samarh', 'samath','samarat', 'samrat', 'samraat', 'samrath','samaryh', 'samaryth', 'samarht', 'samarthy','samrath', 'samarht', 'smaarth', 'saamarth','samrt', 'samr', 'samar','samarath', 'samarrth', 'samartht'];
    
    const usernameLower = username.toLowerCase();
    for (const variation of bannedVariations) {
        if (usernameLower.includes(variation)) {
            showAuthError('This username is not accepted');
            return;
        }
    }
    
    if (!username) {
        showAuthError('Please enter a username');
        return;
    }
    
    if (username.includes(' ')) {
        showAuthError('Username cannot contain spaces');
        return;
    }
    
    const validCharsRegex = /^[a-zA-Z0-9._-]+$/;
    if (!validCharsRegex.test(username)) {
        showAuthError('Username can only contain letters, numbers, dots, hyphens, and underscores');
        return;
    }
    
    if (username.length < 2 || username.length > CONFIG.MAX_USERNAME_LENGTH) {
        showAuthError(`Username must be between 2 and ${CONFIG.MAX_USERNAME_LENGTH} characters`);
        return;
    }
    
    currentUser = { username };
    connectSocket(username);
}

function showAuthError(message) {
    authError.textContent = message;
    setTimeout(() => {
        authError.textContent = '';
    }, 5000);
}

function showModalError(elementId, message) {
    const errorElement = document.getElementById(elementId);
    if (errorElement) {
        errorElement.textContent = message;
        errorElement.style.display = 'block';
        setTimeout(() => {
            errorElement.style.display = 'none';
            errorElement.textContent = '';
        }, 5000);
    }
}

// ═══════════════════════════════════════════════════════════════════════
// UI FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════

function showGameScreen() {
    authScreen.classList.add('hidden');
    gameScreen.classList.remove('hidden');
    document.getElementById('currentUsername').textContent = currentUser.username;
    
    loadUserStats();
    displayUserStats();
    displayUserAvatar();
}

function loadLobby(skipConnectionCheck = false) {
    showView('lobbyView');
    if (!skipConnectionCheck && !checkServerAndShowError()) return;
    if (socket && socket.connected) {
        socket.emit('getRooms');
    }
}

function showView(viewId) {
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    document.getElementById(viewId).classList.add('active');
}

function showModal(modalId) { 
    const modal = document.getElementById(modalId);
    if (modal) modal.classList.add('show');
}

function hideModal(modalId) { 
    const modal = document.getElementById(modalId);
    if (modal) modal.classList.remove('show');
}

// ═══════════════════════════════════════════════════════════════════════
// ROOM MANAGEMENT
// ═══════════════════════════════════════════════════════════════════════

function updateRoomsList(rooms) {
    const roomsList = document.getElementById('roomsList');
    const filter = document.getElementById('roomFilter').value;
    
    roomsList.innerHTML = '';
    
    const filteredRooms = rooms.filter(room => {
        if (filter === 'all') return true;
        if (filter === 'waiting') return room.status === 'waiting';
        return room.mode === filter;
    });
    
    if (filteredRooms.length === 0) {
        roomsList.innerHTML = '<div class="no-rooms">No rooms available. Create one!</div>';
        return;
    }
    
    filteredRooms.forEach(room => {
        const roomCard = createRoomCard(room);
        roomsList.appendChild(roomCard);
    });
}

function createRoomCard(room) {
    const card = document.createElement('div');
    card.className = `room-card ${room.players >= room.maxPlayers ? 'full' : ''} ${room.status === 'playing' ? 'playing' : ''}`;
    
    const lockIcon = room.hasPassword ? '<i class="fas fa-lock room-lock"></i>' : '';
    
    // Show selected game mode in waiting rooms with color coding
    let gameModeDisplay = '';
    if (room.status === 'waiting' && room.selectedGameMode) {
        const modeClass = `mode-${room.selectedGameMode.toLowerCase()}`;
        let modeText = room.selectedGameMode;
        
        // Show hint count for custom mode
        if (room.selectedGameMode === 'custom' && room.selectedHintCount) {
            modeText += ` • ${room.selectedHintCount} hints`;
        }
        
        gameModeDisplay = `<span class="room-game-mode ${modeClass}">${modeText}</span>`;
    }
    
    card.innerHTML = `
        <div class="room-header-info">
            <span class="room-name">${escapeHtml(room.name)}</span>
            ${lockIcon}
        </div>
        <div class="room-meta">
            <span class="room-mode-badge">${room.mode}</span>
            <span class="room-players">
                <i class="fas fa-users"></i> ${room.players}/${room.maxPlayers}
            </span>
        </div>
        <div class="room-status ${room.status}">
            ${room.status === 'waiting' ? `⏳ Waiting ${gameModeDisplay}` : '🎮 Playing'}
        </div>
    `;
    
    if (room.players < room.maxPlayers && room.status === 'waiting') {
        card.addEventListener('click', () => {
            if (room.hasPassword) {
                showJoinRoomModal(room.id);
            } else {
                joinRoom(room.id, '');
            }
        });
    }
    
    return card;
}

function showJoinRoomModal(roomId) {
    selectedRoomId = roomId;
    showModal('joinRoomModal');
}

function createRoom(name, mode, password, difficulty, hintCount) {
    if (!checkServerAndShowError()) return;
    socket.emit('createRoom', { name, mode, password, username: currentUser.username, difficulty, hintCount });
}

function joinRoom(roomId, password) {
    if (!checkServerAndShowError()) return;
    log('Joining room with avatar:', userAvatar ? 'present' : 'null');
    socket.emit('joinRoom', { roomId, password, username: currentUser.username, avatar: userAvatar || null });
}

function leaveRoom() {
    if (socket && socket.connected) socket.emit('leaveRoom');
    currentRoom = null;
    isHost = false;
    isWordSetter = false;
    loadLobby(true);
}

function startGame() {
    if (!isHost || !currentRoom) return;
    if (!checkServerAndShowError()) return;
    
    const mode = currentRoom.mode;
    const isSoloMode = mode === 'solo';
    const isTeamMode = mode === '2v2' || mode === '3v3' || mode === '4v4';
    const playerCount = parseInt(document.getElementById('playerCount').textContent) || 0;
    
    if (!isSoloMode && playerCount < 2) { 
        showNotification('Need at least 2 players to start the game', 'error');
        return;
    }
    
    if (isTeamMode) {
        const team1Count = parseInt(document.getElementById('team1Count').textContent) || 0;
        const team2Count = parseInt(document.getElementById('team2Count').textContent) || 0;
        if (team1Count + team2Count < playerCount) { 
            showNotification('All players must join a team before starting', 'error');
            return;
        }
        if (team1Count === 0 || team2Count === 0) { 
            showNotification('Both teams must have at least one player', 'error');
            return;
        }
    }
    
    // Server will use stored difficulty and hint count from room creation
    socket.emit('startGame', { 
        roomId: currentRoom.roomId
    });
}

// ═══════════════════════════════════════════════════════════════════════
// ROOM VIEW
// ═══════════════════════════════════════════════════════════════════════

function showRoomView(data) {
    showView('roomView');
    
    document.getElementById('roomName').textContent = data.roomName;
    document.getElementById('roomMode').textContent = data.mode;
    document.getElementById('playerCount').textContent = data.players.length;
    document.getElementById('maxPlayers').textContent = 
        data.mode === 'solo' ? 1 :
        data.mode === '1v1' ? 2 : 
        data.mode === '2v2' ? 4 :
        data.mode === '3v3' ? 6 : 8;
    
    const teamsSection = document.getElementById('teamsSection');
    const teamSelection = document.getElementById('teamSelection');
    const chatTabs = document.getElementById('chatTabs');
    
    if (data.mode === 'solo' || data.mode === '1v1') {
        teamsSection.classList.add('hidden');
        if (chatTabs) {
            const teamTab = chatTabs.querySelector('[data-chat-type="team"]');
            if (teamTab) teamTab.style.display = 'none';
            currentChatType = 'global';
            const globalTab = chatTabs.querySelector('[data-chat-type="global"]');
            if (globalTab) {
                chatTabs.querySelectorAll('.chat-tab').forEach(t => t.classList.remove('active'));
                globalTab.classList.add('active');
            }
        }
    } else {
        teamsSection.classList.remove('hidden');
        teamSelection.classList.remove('hidden');
        updateTeams(data.players);
        updateTeamSelectionButtons(data.team);
        if (chatTabs) {
            const teamTab = chatTabs.querySelector('[data-chat-type="team"]');
            if (teamTab) teamTab.style.display = 'inline-block';
        }
    }
    
    updatePlayersList(data.players);
    updateRoomControls();
    
    document.getElementById('chatMessages').innerHTML = '';
    filterChatMessages('chatMessages', currentChatType);
    resetChatNotifications('room', 'global');
    resetChatNotifications('room', 'team');
}

function updatePlayersList(players) {
    const playersList = document.getElementById('playersList');
    playersList.innerHTML = '';
    
    players.forEach(player => {
        const playerCard = document.createElement('div');
        playerCard.className = `player-card ${player.id === mySocketId ? 'me' : ''} ${currentRoom && player.id === currentRoom.hostId ? 'host' : ''}`;
        playerCard.id = `player-${player.id}`;
        
        const avatarSrc = (player.id === mySocketId) ? userAvatar : (player.avatar || null);
        
        playerCard.innerHTML = `
            <div class="player-avatar-wrap" style="display:flex;justify-content:center;margin-bottom:10px;">
                ${buildAvatarHTML(avatarSrc, player.username, 50)}
            </div>
            <div class="player-name">${escapeHtml(player.username)}</div>
            ${player.team ? '<small>' + (player.team === 'team1' ? 'Team 1' : 'Team 2') + '</small>' : ''}
        `;
        
        playersList.appendChild(playerCard);
    });
    
    document.getElementById('playerCount').textContent = players.length;
}

function updateTeams(players) {
    const team1Container = document.getElementById('team1Players');
    const team2Container = document.getElementById('team2Players');
    
    team1Container.innerHTML = '';
    team2Container.innerHTML = '';
    
    players.forEach(player => {
        const playerDiv = document.createElement('div');
        playerDiv.className = `player-card ${player.id === mySocketId ? 'me' : ''}`;
        playerDiv.id = `team-player-${player.id}`;
        
        const avatarSrc = (player.id === mySocketId) ? userAvatar : (player.avatar || null);
        
        playerDiv.innerHTML = `
            <div style="display:flex;align-items:center;gap:10px;">
                ${buildAvatarHTML(avatarSrc, player.username, 30)}
                <div class="player-name">${escapeHtml(player.username)}</div>
            </div>
        `;
        
        if (player.team === 'team1') team1Container.appendChild(playerDiv);
        else if (player.team === 'team2') team2Container.appendChild(playerDiv);
    });
    
    document.getElementById('team1Count').textContent = players.filter(p => p.team === 'team1').length;
    document.getElementById('team2Count').textContent = players.filter(p => p.team === 'team2').length;
}

function updatePlayerTeams(players) {
    updateTeams(players);
    updatePlayersList(players);
    
    const myPlayer = players.find(p => p.id === mySocketId);
    if (myPlayer) {
        updateTeamSelectionButtons(myPlayer.team);
    } else {
        updateTeamSelectionButtons(null);
    }
}

function updateTeamSelectionButtons(myTeam) {
    const joinTeam1Btn = document.getElementById('joinTeam1');
    const joinTeam2Btn = document.getElementById('joinTeam2');
    
    if (joinTeam1Btn && joinTeam2Btn) {
        if (myTeam === 'team1') {
            joinTeam1Btn.classList.add('active');    joinTeam1Btn.disabled = true;
            joinTeam2Btn.classList.remove('active'); joinTeam2Btn.disabled = false;
        } else if (myTeam === 'team2') {
            joinTeam1Btn.classList.remove('active'); joinTeam1Btn.disabled = false;
            joinTeam2Btn.classList.add('active');    joinTeam2Btn.disabled = true;
        } else {
            joinTeam1Btn.classList.remove('active'); joinTeam1Btn.disabled = false;
            joinTeam2Btn.classList.remove('active'); joinTeam2Btn.disabled = false;
        }
    }
}

function addPlayerToRoom(player) {
    const playersList = document.getElementById('playersList');
    
    const playerCard = document.createElement('div');
    playerCard.className = 'player-card';
    playerCard.id = `player-${player.id}`;
    
    const avatarSrc = player.avatar || null;
    
    playerCard.innerHTML = `
        <div class="player-avatar-wrap" style="display:flex;justify-content:center;margin-bottom:10px;">
            ${buildAvatarHTML(avatarSrc, player.username, 50)}
        </div>
        <div class="player-name">${escapeHtml(player.username)}</div>
        ${player.team ? '<small>' + (player.team === 'team1' ? 'Team 1' : 'Team 2') + '</small>' : ''}
    `;
    
    playersList.appendChild(playerCard);
    
    const currentCount = parseInt(document.getElementById('playerCount').textContent);
    document.getElementById('playerCount').textContent = currentCount + 1;

    if (currentRoom && currentRoom.mode !== 'solo' && currentRoom.mode !== '1v1') {
        socket.emit('getRoomPlayers', { roomId: currentRoom.roomId });
    }
    
    addChatMessage({ type: 'system', message: `${player.username} joined the room` });
}

function removePlayerFromRoom(playerId) {
    const playerCard = document.getElementById(`player-${playerId}`);
    if (playerCard) {
        const playerName = playerCard.querySelector('.player-name').textContent;
        playerCard.remove();
        
        const currentCount = parseInt(document.getElementById('playerCount').textContent);
        document.getElementById('playerCount').textContent = Math.max(0, currentCount - 1);
        
        addChatMessage({ type: 'system', message: `${playerName} left the room` });
    }
    
    const teamPlayerCard = document.getElementById(`team-player-${playerId}`);
    if (teamPlayerCard) {
        teamPlayerCard.remove();
    }
    
    updateTeamCounts();
}

function updateTeamCounts() {
    const team1Count = document.querySelectorAll('#team1Players .player-card').length;
    const team2Count = document.querySelectorAll('#team2Players .player-card').length;
    
    const team1CountEl = document.getElementById('team1Count');
    const team2CountEl = document.getElementById('team2Count');
    
    if (team1CountEl) team1CountEl.textContent = team1Count;
    if (team2CountEl) team2CountEl.textContent = team2Count;
}

function updateRoomControls() {
    const roomActions = document.getElementById('roomActions');
    const waitingMessage = document.getElementById('waitingMessage');
    
    if (isHost) {
        roomActions.classList.remove('hidden');
        waitingMessage.classList.add('hidden');
    } else {
        roomActions.classList.add('hidden');
        waitingMessage.classList.remove('hidden');
    }
}

// ═══════════════════════════════════════════════════════════════════════
// WORD SELECTION MODAL (CUSTOM WORD MODE)
// ═══════════════════════════════════════════════════════════════════════

function showWaitingForWordModal(wordSetterName) {
    const modal = document.getElementById('waitingForWordModal');
    const message = document.getElementById('waitingForWordMessage');
    
    if (message) {
        message.textContent = `Waiting for ${wordSetterName} to choose a word...`;
    }
    
    showModal('waitingForWordModal');
}

function submitCustomWord() {
    const wordInput = document.getElementById('customWord');
    const submitBtn = document.getElementById('submitWordBtn');
    
    submitBtn.disabled = false;
    submitBtn.innerHTML = '<i class="fas fa-check"></i> Submit Word';
    
    const word = wordInput.value.trim();
    
    if (!word) {
        showModalError('wordSelectionError', 'Please enter a word');
        return;
    }
    
    if (word.length < 3) {
        showModalError('wordSelectionError', 'Word must be at least 3 characters long');
        return;
    }
    
    if (word.length > 20) {
        showModalError('wordSelectionError', 'Word is too long (maximum 20 characters)');
        return;
    }
    
    const wordRegex = /^[A-Za-z]+$/;
    if (!wordRegex.test(word)) {
        showModalError('wordSelectionError', 'Word can only contain letters (no spaces or numbers)');
        return;
    }
    
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Submitting...';
    
    socket.emit('submitCustomWord', {
        roomId: currentRoom.roomId,
        word: word
    });
}

// ═══════════════════════════════════════════════════════════════════════
// HINT SYSTEM
// ═══════════════════════════════════════════════════════════════════════

function requestHint() {
    if (!currentRoom || !socket) return;
    if (!checkServerAndShowError()) return;
    
    if (isOnWordSetterTeam) {
        showNotification('Your team is setting the word — you cannot request hints!', 'warning');
        return;
    } else if (gameState.isCustomWord && gameState.wordSetter === mySocketId) {
        showNotification('You are the word setter — you cannot request hints!', 'warning');
        return;
    }
    
    if (hintsRemaining <= 0) {
        showNotification('No hints remaining!', 'error');
        return;
    }
    
    const askHintBtn = document.getElementById('askHintBtn');
    if (askHintBtn) {
        askHintBtn.disabled = true;
        askHintBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Requesting...';
    }
    
    socket.emit('requestHint', { roomId: currentRoom.roomId });
}

function showHintRequestModal(requesterName) {
    const modal = document.getElementById('hintRequestModal');
    const message = document.getElementById('hintRequestPlayer');
    const hintInput = document.getElementById('hintInput');
    
    if (message) {
        message.textContent = `${requesterName} has requested a hint!`;
    }
    
    if (hintInput) {
        hintInput.value = '';
    }
    
    showModal('hintRequestModal');
}

function provideHint() {
    const hintInput = document.getElementById('hintInput');
    const hint = hintInput.value.trim();
    
    if (!hint) {
        showNotification('Please enter a hint', 'error');
        return;
    }
    
    if (!checkServerAndShowError()) return;
    
    socket.emit('provideHint', {
        roomId: currentRoom.roomId,
        hint: hint
    });
    
    hideModal('hintRequestModal');
}

function displayReceivedHint(hint, hintNumber) {
    const receivedHints = document.getElementById('receivedHints');
    const hintsList = document.getElementById('hintsList');
    
    receivedHints.classList.remove('hidden');
    
    const hintItem = document.createElement('div');
    hintItem.className = 'hint-item';
    hintItem.innerHTML = `
        <span class="hint-number">Hint ${hintNumber}</span>
        <span class="hint-text">${escapeHtml(hint)}</span>
    `;
    
    hintsList.appendChild(hintItem);
}

function updateHintsDisplay() {
    const hintsRemainingEl = document.getElementById('hintsRemaining');
    if (hintsRemainingEl) {
        hintsRemainingEl.textContent = hintsRemaining;
    }
    
    const askHintBtn = document.getElementById('askHintBtn');
    if (askHintBtn) {
        if (hintsRemaining <= 0) {
            askHintBtn.disabled = true;
            askHintBtn.innerHTML = '<i class="fas fa-ban"></i> No Hints Left';
        } else {
            askHintBtn.disabled = false;
            askHintBtn.innerHTML = '<i class="fas fa-question-circle"></i> Ask for Hint';
        }
    }
}

// ═══════════════════════════════════════════════════════════════════════
// GAME VIEW
// ═══════════════════════════════════════════════════════════════════════

function showGameView(data) {
    showView('gameView');
    setupGameUI(data);
    
    const miniChatTabs = document.getElementById('miniChatTabs');
    if (miniChatTabs && data.mode) {
        const teamTab = miniChatTabs.querySelector('[data-chat-type="team"]');
        if (teamTab) {
            if (data.mode === 'solo' || data.mode === '1v1') {
                teamTab.style.display = 'none';
                currentChatType = 'global';
                const globalTab = miniChatTabs.querySelector('[data-chat-type="global"]');
                if (globalTab) {
                    miniChatTabs.querySelectorAll('.chat-tab').forEach(t => t.classList.remove('active'));
                    globalTab.classList.add('active');
                }
            } else {
                teamTab.style.display = 'inline-block';
            }
        }
    }
    
    document.getElementById('miniChatMessages').innerHTML = '';
    filterChatMessages('miniChatMessages', currentChatType);

    resetChatNotifications('game', 'global');
    resetChatNotifications('game', 'team');
}

function setupGameUI(data) {
    document.querySelectorAll('.man-part').forEach(part => part.classList.remove('show'));
    
    const wordDisplay = document.getElementById('wordDisplay');
    wordDisplay.innerHTML = '';
    
    for (let i = 0; i < data.gameState.wordLength; i++) {
        const box = document.createElement('div');
        box.className = 'letter-box';
        box.dataset.index = i;
        wordDisplay.appendChild(box);
    }
    
    const wordHint = document.getElementById('wordHint');
    if (data.gameState.hint) {
        wordHint.textContent = `Hint: ${data.gameState.hint}`;
    } else if (data.gameState.isCustomWord) {
        if (isOnWordSetterTeam || data.gameState.wordSetter === mySocketId) {
            wordHint.textContent = '';
            wordHint.style.display = 'none';
        } else {
            wordHint.textContent = 'Hint: Ask for hints using the button below';
            wordHint.style.display = '';
        }
    } else {
        wordHint.textContent = 'Hint: Loading...';
    }
    
    const askHintSection = document.getElementById('askHintSection');
    const hintsContainer = document.getElementById('hintsContainer');
    const receivedHints = document.getElementById('receivedHints');
    
    if (data.gameState.isCustomWord) {
        if (isOnWordSetterTeam || data.gameState.wordSetter === mySocketId) {
            askHintSection.classList.add('hidden');
            hintsContainer.classList.add('hidden');
            receivedHints.classList.add('hidden');

            const keyboard = document.getElementById('keyboard');
            if (keyboard) {
                keyboard.style.opacity = '0.3';
                keyboard.style.pointerEvents = 'none';
            }
        } else {
            askHintSection.classList.remove('hidden');
            hintsContainer.classList.remove('hidden');
            receivedHints.classList.remove('hidden');
            updateHintsDisplay();

            const keyboard = document.getElementById('keyboard');
            if (keyboard) {
                keyboard.style.opacity = '';
                keyboard.style.pointerEvents = '';
            }
        }
    } else {
        askHintSection.classList.add('hidden');
        hintsContainer.classList.add('hidden');
        receivedHints.classList.add('hidden');

        const keyboard = document.getElementById('keyboard');
        if (keyboard) {
            keyboard.style.opacity = '';
            keyboard.style.pointerEvents = '';
        }
    }
    
    createKeyboard();
    
    const scoreboard = document.getElementById('scoreboard');

    if (scoreboard) {
        if (data.gameState.isCustomWord) {
            scoreboard.classList.add('hidden');
        } else {
            scoreboard.classList.remove('hidden');
            updateScores(data.players);
        }
    }
    
    // FIX: Use player lookup for initial turn indicator
    const initialPlayers = data.players || activePlayers;
    const currentPlayer = initialPlayers[data.gameState.currentTurn];
    updateTurnIndicator(currentPlayer || data.players[0]);
    
    document.getElementById('wrongLetters').innerHTML = '';
    
    const hintsList = document.getElementById('hintsList');
    if (hintsList) {
        hintsList.innerHTML = '';
    }
}

function createKeyboard() {
    const keyboard = document.getElementById('keyboard');
    keyboard.innerHTML = '';

    const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

    letters.split('').forEach(letter => {
        const key = document.createElement('button');
        key.className = 'key';
        key.textContent = letter;
        key.dataset.letter = letter;
        key.addEventListener('click', () => makeGuess(letter));
        keyboard.appendChild(key);
    });
}

// FIX: Improved turn validation for custom word mode
function makeGuess(letter) {
    if (!gameState || !socket || !currentRoom) return;
    if (!checkServerAndShowError()) return;
    
    // Block word setter and word setter's team from guessing
    if (isWordSetter) {
        showNotification('You are the word setter — you cannot guess!', 'warning');
        return;
    }
    
    if (isOnWordSetterTeam) {
        showNotification('Your team is setting the word — you cannot guess!', 'warning');
        return;
    }

    // FIX: Check turn by looking up current player ID instead of using indices
    // The server sends currentTurn as an index into the full players array
    const allPlayers = gameState.players;
    
    // Safety check - ensure players array exists
    if (!allPlayers || !Array.isArray(allPlayers) || allPlayers.length === 0) {
        showNotification('Game error - please refresh', 'error');
        return;
    }
    
    const currentPlayer = allPlayers[gameState.currentTurn];
    const currentPlayerId = currentPlayer?.id;
    
    if (currentPlayerId !== mySocketId) {
        showNotification('Wait for your turn!', 'warning');
        return;
    }
    
    socket.emit('makeGuess', { roomId: currentRoom.roomId, letter: letter });
}

function updateGameState(data) {
    // FIX: Always update word from server (word is not logged to console for security)
    if (data.word) {
        gameState.word = data.word;
    }
    
    gameState.guessedLetters = data.guessedLetters;
    gameState.currentTurn = data.currentTurn;
    
    // Update players array if sent from server
    if (data.players) {
        gameState.players = data.players;
        log('Updated players array from guessResult, count:', data.players.length);
    }
    
    // Update letter boxes
    if (gameState.word) {
        document.querySelectorAll('.letter-box').forEach((box, index) => {
            const letter = gameState.word[index];
            if (data.guessedLetters.includes(letter) && !box.classList.contains('filled')) {
                box.textContent = letter;
                box.classList.add('filled');
            }
        });
    }
    
    const wrongLettersContainer = document.getElementById('wrongLetters');
    wrongLettersContainer.innerHTML = '';
    
    data.wrongLetters.forEach((letter, index) => {
        const wrongLetter = document.createElement('div');
        wrongLetter.className = 'wrong-letter';
        wrongLetter.textContent = letter;
        wrongLetter.style.animationDelay = `${index * 0.1}s`;
        wrongLettersContainer.appendChild(wrongLetter);
        
        const part = document.querySelector(`.part-${index + 1}`);
        if (part) part.classList.add('show');
    });
    
    data.guessedLetters.forEach(letter => {
        const key = document.querySelector(`.key[data-letter="${letter}"]`);
        if (key) { key.classList.add('correct'); key.disabled = true; }
    });
    
    data.wrongLetters.forEach(letter => {
        const key = document.querySelector(`.key[data-letter="${letter}"]`);
        if (key) { key.classList.add('wrong'); key.disabled = true; }
    });
    
    // Only update scores if not in custom word mode
    if (!gameState.isCustomWord) {
        updateScoresList(data.scores);
    }
    
    // FIX: Update turn indicator using player ID lookup
    const allPlayers = gameState.players || activePlayers;
    const currentPlayer = allPlayers[data.currentTurn];
    if (currentPlayer) {
        updateTurnIndicator(currentPlayer);
    }
}

function updateScores(players) {
    const scoresList = document.getElementById('scoresList');
    scoresList.innerHTML = '';
    
    players.forEach((player, index) => {
        const isWordSetterPlayer = (gameState && gameState.wordSetter === player.id);
        const scoreItem = document.createElement('div');
        scoreItem.className = `score-item ${index === gameState.currentTurn ? 'active' : ''} ${isWordSetterPlayer ? 'word-setter' : ''}`;
        scoreItem.dataset.playerId = player.id;
        if (player.id === mySocketId) scoreItem.dataset.isMe = 'true';
        
        const avatarSrc = (player.id === mySocketId) ? userAvatar : (player.avatar || null);
        
        scoreItem.innerHTML = `
            <div class="score-player">
                ${buildAvatarHTML(avatarSrc, player.username, 30)}
                <span class="score-player-name">${escapeHtml(player.username)}${isWordSetterPlayer ? ' 📝' : ''}</span>
            </div>
            <span class="score-value">0</span>
        `;
        
        scoresList.appendChild(scoreItem);
    });
}

function updateScoresList(scores) {
    document.querySelectorAll('.score-item').forEach(item => {
        const playerId = item.dataset.playerId;
        item.querySelector('.score-value').textContent = scores[playerId] || 0;
    });
}

function updateTurnIndicator(player) {
    const turnIndicator = document.getElementById('turnIndicator');
    const currentPlayerDiv = document.getElementById('currentPlayer');
    
    if (isOnWordSetterTeam) {
        turnIndicator.textContent = isWordSetter ? '📝 You are the Word Setter' : '📝 Your team is setting the word';
        turnIndicator.classList.remove('your-turn');
        turnIndicator.classList.add('word-setter');
    } else if (player.id === mySocketId) {
        turnIndicator.textContent = '🎯 Your Turn!';
        turnIndicator.classList.add('your-turn');
        turnIndicator.classList.remove('word-setter');
    } else {
        turnIndicator.textContent = `⏳ ${player.username}'s Turn`;
        turnIndicator.classList.remove('your-turn');
        turnIndicator.classList.remove('word-setter');
    }
    
    const avatarSrc = (player.id === mySocketId) ? userAvatar : (player.avatar || null);
    currentPlayerDiv.innerHTML = `
        ${buildAvatarHTML(avatarSrc, player.username, 40)}
        <span class="current-player-name">${escapeHtml(player.username)}</span>
    `;
}

// ═══════════════════════════════════════════════════════════════════════
// CHAT FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════

function filterChatMessages(containerId, chatType) {
    const container = document.getElementById(containerId);
    if (!container) return;

    container.querySelectorAll('.chat-message').forEach(msg => {
        if (msg.classList.contains('system')) {
            msg.style.display = '';
            return;
        }
        const msgType = msg.dataset.chatType || 'global';
        msg.style.display = (msgType === chatType) ? '' : 'none';
    });

    container.scrollTop = container.scrollHeight;
}

function updateChatNotifications(view, chatType) {
    const count = unreadCounts[view][chatType];
    const displayCount = count > 99 ? '99+' : count.toString();
    
    if (view === 'room') {
        const badge = document.getElementById(chatType === 'global' ? 'globalChatBadge' : 'teamChatBadge');
        if (badge) {
            if (count > 0) {
                badge.textContent = displayCount;
                badge.style.display = 'block';
            } else {
                badge.style.display = 'none';
            }
        }
    } else if (view === 'game') {
        const badge = document.getElementById(chatType === 'global' ? 'miniGlobalChatBadge' : 'miniTeamChatBadge');
        if (badge) {
            if (count > 0) {
                badge.textContent = displayCount;
                badge.style.display = 'block';
            } else {
                badge.style.display = 'none';
            }
        }
    }
}

function incrementChatNotification(view, chatType) {
    if (unreadCounts[view] && unreadCounts[view][chatType] !== undefined) {
        unreadCounts[view][chatType]++;
        updateChatNotifications(view, chatType);
    }
}

function resetChatNotifications(view, chatType) {
    if (unreadCounts[view] && unreadCounts[view][chatType] !== undefined) {
        unreadCounts[view][chatType] = 0;
        updateChatNotifications(view, chatType);
    }
}

function addLobbyChatMessage(message) {
    const lobbyChatMessages = document.getElementById('lobbyChatMessages');
    if (!lobbyChatMessages) return;
    
    const messageDiv = document.createElement('div');
    
    if (message.type === 'system') {
        messageDiv.className = 'chat-message system';
        messageDiv.innerHTML = `<div class="message-content">${escapeHtml(message.message)}</div>`;
    } else {
        const isOwn = message.username === currentUser.username;
        const avatarSrc = isOwn ? userAvatar : (message.avatar || null);
        
        messageDiv.className = `chat-message ${isOwn ? 'own' : ''}`;
        messageDiv.innerHTML = `
            <div class="message-row" style="display:flex;align-items:flex-end;gap:8px;${isOwn ? 'flex-direction:row-reverse;' : ''}">
                ${buildAvatarHTML(avatarSrc, message.username, 28)}
                <div class="message-bubble">
                    <span class="message-sender">${escapeHtml(message.username)}</span>
                    <div class="message-content">${escapeHtml(message.message)}</div>
                </div>
            </div>
        `;
    }
    
    lobbyChatMessages.appendChild(messageDiv);
    lobbyChatMessages.scrollTop = lobbyChatMessages.scrollHeight;
}

function sendLobbyChatMessage() {
    const input = document.getElementById('lobbyChatInput');
    if (!input) return;
    const message = input.value.trim();
    if (!message) return;
    if (!checkServerAndShowError()) return;
    
    socket.emit('lobbyChatMessage', { message, username: currentUser.username, avatar: userAvatar || null });
    input.value = '';
}

function addChatMessage(message) {
    const chatMessages = document.getElementById('chatMessages');
    const miniChatMessages = document.getElementById('miniChatMessages');
    
    const messageDiv = document.createElement('div');
    const isTeamMessage = message.type === 'team';
    const messageChatType = isTeamMessage ? 'team' : 'global';
    
    if (message.type === 'system') {
        messageDiv.className = 'chat-message system';
        messageDiv.innerHTML = `<div class="message-content">${escapeHtml(message.message)}</div>`;
    } else {
        const isOwn = message.username === currentUser.username;
        const avatarSrc = isOwn ? userAvatar : (message.avatar || null);
        
        messageDiv.className = `chat-message ${isOwn ? 'own' : ''} ${isTeamMessage ? 'team' : ''}`;
        
        messageDiv.innerHTML = `
            <div class="message-row" style="display:flex;align-items:flex-end;gap:8px;${isOwn ? 'flex-direction:row-reverse;' : ''}">
                ${buildAvatarHTML(avatarSrc, message.username, 28)}
                <div class="message-bubble">
                    <span class="message-sender">${escapeHtml(message.username)}</span>
                    <div class="message-content">${escapeHtml(message.message)}</div>
                </div>
            </div>
        `;
    }

    if (chatMessages) {
        const clone = messageDiv.cloneNode(true);
        clone.dataset.chatType = messageChatType;
        chatMessages.appendChild(clone);
        
        const activeRoomTab = document.querySelector('#chatTabs .chat-tab.active');
        const activeRoomType = activeRoomTab ? activeRoomTab.dataset.chatType : 'global';
        
        if (message.type !== 'system' && clone.dataset.chatType !== activeRoomType) {
            clone.style.display = 'none';
            incrementChatNotification('room', messageChatType);
        } else {
            clone.style.display = '';
            chatMessages.scrollTop = chatMessages.scrollHeight;
        }
    }

    if (miniChatMessages) {
        const clone = messageDiv.cloneNode(true);
        clone.dataset.chatType = messageChatType;
        miniChatMessages.appendChild(clone);
        
        const activeGameTab = document.querySelector('#miniChatTabs .chat-tab.active');
        const activeGameType = activeGameTab ? activeGameTab.dataset.chatType : 'global';
        
        if (message.type !== 'system' && clone.dataset.chatType !== activeGameType) {
            clone.style.display = 'none';
            incrementChatNotification('game', messageChatType);
        } else {
            clone.style.display = '';
            miniChatMessages.scrollTop = miniChatMessages.scrollHeight;
        }
    }
}

function sendChatMessage() {
    const input = document.getElementById('chatInput');
    const message = input.value.trim();
    if (!message || !currentRoom) return;
    if (!checkServerAndShowError()) return;
    
    socket.emit('chatMessage', { roomId: currentRoom.roomId, message, username: currentUser.username, chatType: currentChatType, avatar: userAvatar || null });
    input.value = '';
}

function sendMiniChatMessage() {
    const input = document.getElementById('miniChatInput');
    const message = input.value.trim();
    if (!message || !currentRoom) return;
    if (!checkServerAndShowError()) return;
    
    socket.emit('chatMessage', { roomId: currentRoom.roomId, message, username: currentUser.username, chatType: currentChatType, avatar: userAvatar || null });
    input.value = '';
}

// ═══════════════════════════════════════════════════════════════════════
// GAME OVER
// ═══════════════════════════════════════════════════════════════════════

function showGameOverModal(data) {
    const modal = document.getElementById('gameOverModal');
    const modalTitle = document.getElementById('modalTitle');
    const modalMessage = document.getElementById('modalMessage');
    const modalWord = document.getElementById('modalWord');
    const modalIcon = document.getElementById('modalIcon');
    const finalScores = document.getElementById('finalScores');
    
    // Reset word setter states for next game
    isWordSetter = false;
    isOnWordSetterTeam = false;
    
    modalWord.textContent = data.word;
    
    if (data.isWin) {
        modalTitle.textContent = '🎉 Word Guessed!';
        modalMessage.textContent = 'Congratulations! The word was guessed!';
        modalIcon.textContent = '🎉';
        createConfetti();
        updateStats('win');
    } else {
        modalTitle.textContent = '💀 Game Over';
        modalMessage.textContent = 'Nobody guessed the word!';
        modalIcon.textContent = '💀';
        updateStats('loss');
    }
    
    if (gameState && gameState.isCustomWord) {
        finalScores.style.display = 'none';
    } else {
        finalScores.style.display = 'block';
        finalScores.innerHTML = '<h3>Final Scores</h3>';
        Object.entries(data.scores).sort((a, b) => b[1] - a[1]).forEach(([playerId, score], index) => {
            const scoreDiv = document.createElement('div');
            scoreDiv.className = `final-score-item ${index === 0 ? 'winner' : ''}`;
            scoreDiv.innerHTML = `<span>${index === 0 ? '👑 ' : ''}Player</span><span>${score} pts</span>`;
            finalScores.appendChild(scoreDiv);
        });
    }
    
    modal.classList.add('show');
}

function createConfetti() {
    const colors = ['#4ade80', '#60a5fa', '#f472b6', '#fbbf24', '#f87171'];
    for (let i = 0; i < 50; i++) {
        setTimeout(() => {
            const confetti = document.createElement('div');
            confetti.className = 'confetti';
            confetti.style.cssText = `background:${colors[Math.floor(Math.random()*colors.length)]};left:${Math.random()*100}vw;top:-10px;border-radius:50%;`;
            document.body.appendChild(confetti);
            confetti.animate([
                { transform: 'translateY(0) rotate(0deg)', opacity: 1 },
                { transform: `translateY(${window.innerHeight+20}px) translateX(${(Math.random()-0.5)*200}px) rotate(${Math.random()*360}deg)`, opacity: 0 }
            ], { duration: 2000+Math.random()*2000, easing: 'cubic-bezier(0.25,0.46,0.45,0.94)' }).onfinish = () => confetti.remove();
        }, i * 50);
    }
}

// ═══════════════════════════════════════════════════════════════════════
// EVENT LISTENERS
// ═══════════════════════════════════════════════════════════════════════

function initEventListeners() {
    const logoutBtn = document.getElementById('logoutBtn');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', () => { 
            clearSession(); 
            if (socket) socket.disconnect(); 
            location.reload(); 
        });
    }
    
    const settingsBtn = document.getElementById('settingsBtn');
    if (settingsBtn) settingsBtn.addEventListener('click', () => { 
        updateAvatarPreview();
        showModal('settingsModal'); 
    });
    
    const closeSettings = document.getElementById('closeSettings');
    if (closeSettings) closeSettings.addEventListener('click', () => hideModal('settingsModal'));
    
    const uploadAvatarBtn = document.getElementById('uploadAvatarBtn');
    const avatarInput = document.getElementById('avatarInput');
    if (uploadAvatarBtn && avatarInput) {
        uploadAvatarBtn.addEventListener('click', () => avatarInput.click());
        avatarInput.addEventListener('change', (e) => { 
            if (e.target.files[0]) handleAvatarUpload(e.target.files[0]); 
            e.target.value = ''; 
        });
    }
    
    // Username change handler
    const changeUsernameBtn = document.getElementById('changeUsernameBtn');
    const newUsernameInput = document.getElementById('newUsernameInput');
    const usernameError = document.getElementById('usernameError');
    
    if (changeUsernameBtn && newUsernameInput) {
        changeUsernameBtn.addEventListener('click', () => {
            const newUsername = newUsernameInput.value.trim();
            
            if (!newUsername) {
                if (usernameError) {
                    usernameError.textContent = 'Please enter a username';
                    usernameError.style.display = 'block';
                }
                return;
            }
            
            // Validate username format
            if (newUsername.includes(' ')) {
                if (usernameError) {
                    usernameError.textContent = 'Username cannot contain spaces';
                    usernameError.style.display = 'block';
                }
                return;
            }
            
            const validCharsRegex = /^[a-zA-Z0-9._-]+$/;
            if (!validCharsRegex.test(newUsername)) {
                if (usernameError) {
                    usernameError.textContent = 'Username can only contain letters, numbers, dots, hyphens, and underscores';
                    usernameError.style.display = 'block';
                }
                return;
            }
            
            if (newUsername.length < 2 || newUsername.length > 20) {
                if (usernameError) {
                    usernameError.textContent = 'Username must be between 2 and 20 characters';
                    usernameError.style.display = 'block';
                }
                return;
            }
            
            // Check banned variations
            const bannedVariations = ['shreyan', 'shreyn', 'shryn', 'shyn', 'sreyan', 'sreyn', 'sryan', 'sryn', 'shrayan', 'shrayn', 'shriyan', 'shriyn', 'shrian', 'shrien', 'shryen', 'shryan', 'shryon', 'shryun','samarth', 'samart', 'samarthh', 'samarath','samerth', 'samirth', 'somarth', 'sumarth', 'samurth','samrth', 'smarth', 'samarh', 'samath','samarat', 'samrat', 'samraat', 'samrath','samaryh', 'samaryth', 'samarht', 'samarthy','samrath', 'samarht', 'smaarth', 'saamarth','samrt', 'samr', 'samar','samarath', 'samarrth', 'samartht'];
            const usernameLower = newUsername.toLowerCase();
            for (const variation of bannedVariations) {
                if (usernameLower.includes(variation)) {
                    if (usernameError) {
                        usernameError.textContent = 'This username is not accepted';
                        usernameError.style.display = 'block';
                    }
                    return;
                }
            }
            
            // Clear error
            if (usernameError) {
                usernameError.style.display = 'none';
            }
            
            // Send request to server
            if (socket) {
                socket.emit('changeUsername', { newUsername });
            }
        });
        
        // Clear error when typing
        newUsernameInput.addEventListener('input', () => {
            if (usernameError) {
                usernameError.style.display = 'none';
            }
        });
    }
    
    document.querySelectorAll('#chatTabs .chat-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('#chatTabs .chat-tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            const newChatType = tab.dataset.chatType;
            currentChatType = newChatType;
            filterChatMessages('chatMessages', currentChatType);
            resetChatNotifications('room', newChatType);
        });
    });
    
    document.querySelectorAll('#miniChatTabs .chat-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('#miniChatTabs .chat-tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            const newChatType = tab.dataset.chatType;
            currentChatType = newChatType;
            filterChatMessages('miniChatMessages', currentChatType);
            resetChatNotifications('game', newChatType);
        });
    });
    
    document.getElementById('createRoomBtn').addEventListener('click', () => showModal('createRoomModal'));
    
    // Create room form with difficulty and hint count
    let selectedDifficulty = 'easy';
    let selectedHintCount = 5;
    
    document.getElementById('createRoomForm').addEventListener('submit', (e) => {
        e.preventDefault();
        const name = document.getElementById('newRoomName').value.trim();
        const errorElement = document.getElementById('roomNameError');
        if (!name) { errorElement.style.display = 'block'; return; }
        errorElement.style.display = 'none';
        
        const gameMode = document.querySelector('.mode-btn.active').dataset.mode;
        const difficulty = document.querySelector('.difficulty-btn.active').dataset.difficulty;
        const hintCount = difficulty === 'custom' ? selectedHintCount : 5;
        
        createRoom(name, gameMode, document.getElementById('newRoomPassword').value, difficulty, hintCount);
    });
    
    // Game mode selection (solo, 1v1, 2v2, etc.)
    document.querySelectorAll('.mode-btn').forEach(btn => {
        btn.addEventListener('click', () => { 
            document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active')); 
            btn.classList.add('active');
            
            // Show/hide custom difficulty option based on game mode
            const customBtn = document.getElementById('customDifficultyBtn');
            const hintSection = document.getElementById('hintCountSection');
            
            if (btn.dataset.mode === 'solo') {
                // Hide custom option for solo mode
                customBtn.classList.add('hidden');
                // If custom was selected, switch to easy
                if (customBtn.classList.contains('active')) {
                    customBtn.classList.remove('active');
                    document.querySelector('[data-difficulty="easy"]').classList.add('active');
                    selectedDifficulty = 'easy';
                    hintSection.classList.add('hidden');
                }
            } else {
                // Show custom option for other modes
                customBtn.classList.remove('hidden');
            }
        });
    });
    
    // Difficulty mode selection (easy, medium, hard, custom)
    document.querySelectorAll('.difficulty-btn').forEach(btn => {
        btn.addEventListener('click', () => { 
            document.querySelectorAll('.difficulty-btn').forEach(b => b.classList.remove('active')); 
            btn.classList.add('active');
            selectedDifficulty = btn.dataset.difficulty;
            
            // Show/hide hint count section
            const hintSection = document.getElementById('hintCountSection');
            if (btn.dataset.difficulty === 'custom') {
                hintSection.classList.remove('hidden');
            } else {
                hintSection.classList.add('hidden');
            }
        });
    });
    
    // Hint count selection (5 or 7)
    document.querySelectorAll('.hint-btn').forEach(btn => {
        btn.addEventListener('click', () => { 
            document.querySelectorAll('.hint-btn').forEach(b => b.classList.remove('active')); 
            btn.classList.add('active');
            selectedHintCount = parseInt(btn.dataset.hints);
        });
    });
    
    document.getElementById('cancelCreateRoom').addEventListener('click', () => hideModal('createRoomModal'));
    
    document.getElementById('joinRoomForm').addEventListener('submit', (e) => {
        e.preventDefault();
        joinRoom(selectedRoomId, document.getElementById('joinRoomPassword').value);
        hideModal('joinRoomModal');
    });
    
    document.getElementById('cancelJoinRoom').addEventListener('click', () => hideModal('joinRoomModal'));
    
    document.getElementById('leaveRoomBtn').addEventListener('click', leaveRoom);
    document.getElementById('startGameBtn').addEventListener('click', startGame);
    
    document.getElementById('joinTeam1').addEventListener('click', () => { 
        if (currentRoom && checkServerAndShowError()) {
            socket.emit('changeTeam', { roomId: currentRoom.roomId, team: 'team1' });
        }
    });
    
    document.getElementById('joinTeam2').addEventListener('click', () => { 
        if (currentRoom && checkServerAndShowError()) {
            socket.emit('changeTeam', { roomId: currentRoom.roomId, team: 'team2' });
        }
    });
    
    document.getElementById('refreshRooms').addEventListener('click', () => { 
        if (checkServerAndShowError()) socket.emit('getRooms'); 
    });
    
    document.getElementById('roomFilter').addEventListener('change', () => { 
        if (checkServerAndShowError()) socket.emit('getRooms'); 
    });
    
    document.getElementById('sendMessageBtn').addEventListener('click', sendChatMessage);
    document.getElementById('chatInput').addEventListener('keypress', (e) => { 
        if (e.key === 'Enter') sendChatMessage(); 
    });
    
    document.getElementById('sendMiniChatBtn').addEventListener('click', sendMiniChatMessage);
    document.getElementById('miniChatInput').addEventListener('keypress', (e) => { 
        if (e.key === 'Enter') sendMiniChatMessage(); 
    });
    
    const sendLobbyChatBtn = document.getElementById('sendLobbyChatBtn');
    const lobbyChatInput = document.getElementById('lobbyChatInput');
    if (sendLobbyChatBtn) sendLobbyChatBtn.addEventListener('click', sendLobbyChatMessage);
    if (lobbyChatInput) lobbyChatInput.addEventListener('keypress', (e) => { 
        if (e.key === 'Enter') sendLobbyChatMessage(); 
    });
    
    const wordSelectionForm = document.getElementById('wordSelectionForm');
    if (wordSelectionForm) {
        wordSelectionForm.addEventListener('submit', (e) => {
            e.preventDefault();
            submitCustomWord();
        });
    }
    
    const askHintBtn = document.getElementById('askHintBtn');
    if (askHintBtn) {
        askHintBtn.addEventListener('click', requestHint);
    }
    
    const provideHintForm = document.getElementById('provideHintForm');
    if (provideHintForm) {
        provideHintForm.addEventListener('submit', (e) => {
            e.preventDefault();
            provideHint();
        });
    }
    
    const cancelHintBtn = document.getElementById('cancelHint');
    if (cancelHintBtn) {
        cancelHintBtn.addEventListener('click', () => {
            hideModal('hintRequestModal');
            if (currentRoom && socket) {
                socket.emit('dismissHint', { roomId: currentRoom.roomId });
            }
        });
    }
    
    document.getElementById('leaveGameBtn').addEventListener('click', () => { 
        leaveRoom(); 
        hideModal('gameOverModal'); 
    });
    
    document.getElementById('playAgainBtn').addEventListener('click', () => { 
        hideModal('gameOverModal'); 
        if (isHost) startGame(); 
    });
    
    document.getElementById('backToLobby').addEventListener('click', () => { 
        hideModal('gameOverModal'); 
        leaveRoom(); 
    });
    
    document.addEventListener('keydown', (e) => {
        if (gameView.classList.contains('active')) {
            const activeElement = document.activeElement;
            if (activeElement && (activeElement.tagName === 'INPUT' || activeElement.tagName === 'TEXTAREA' || activeElement.isContentEditable)) return;
            const letter = e.key.toUpperCase();
            if (letter.match(/^[A-Z]$/)) makeGuess(letter);
        }
    });
    
    window.addEventListener('beforeunload', () => {
        if (socket) {
            socket.disconnect();
        }
    });
}

log('Hangman client initialized');