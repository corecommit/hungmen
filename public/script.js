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

function showNotification(message, type = 'info', duration = 3000) {
    const toast = document.getElementById('notificationToast');
    const messageEl = document.getElementById('notificationMessage');

    toast.className = `notification-toast ${type}`;
    messageEl.textContent = message;
    toast.classList.remove('hidden');

    setTimeout(() => {
        toast.classList.add('hidden');
    }, duration);
}

// ═══════════════════════════════════════════════════════════════════════
// ADMIN FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════

function showAdminIndicator() {
    // Add admin badge to header
    const header = document.querySelector('.header-content');
    if (header) {
        const adminBadge = document.createElement('div');
        adminBadge.className = 'admin-badge';
        adminBadge.innerHTML = '<i class="fas fa-shield-alt"></i> ADMIN';
        adminBadge.style.cssText = 'background: linear-gradient(135deg, #f59e0b, #d97706); color: #000; padding: 6px 12px; border-radius: 20px; font-size: 0.75rem; font-weight: 700; display: flex; align-items: center; gap: 6px; margin-left: 10px;';

        const usernameElement = header.querySelector('.current-user');
        if (usernameElement) {
            usernameElement.appendChild(adminBadge);
        }
    }

    // Show admin panel button for mobile/desktop
    const adminPanelBtn = document.getElementById('adminPanelBtn');
    if (adminPanelBtn) {
        adminPanelBtn.classList.remove('hidden');
    }

    showNotification('Logged in as Admin - Special permissions enabled', 'info');
}

function isAdmin() {
    return currentUser && currentUser.isAdmin;
}

function showAdminPanel() {
    if (!isAdmin()) return;

    // Close existing panel if open
    const existingPanel = document.getElementById('adminPanel');
    if (existingPanel) {
        existingPanel.remove();
        return;
    }

    const panel = document.createElement('div');
    panel.id = 'adminPanel';
    panel.className = 'admin-panel';
    panel.innerHTML = `
        <div class="admin-panel-header">
            <h3><i class="fas fa-shield-alt"></i> Admin Panel</h3>
            <button onclick="closeAdminPanel()" class="close-btn"><i class="fas fa-times"></i></button>
        </div>
        <div class="admin-panel-content">
            <div class="admin-section">
                <h4>Room Management</h4>
                <button onclick="showDeleteRoomModal()" class="admin-btn">
                    <i class="fas fa-trash"></i> Delete Room
                </button>
                <button onclick="showKickPlayerModal()" class="admin-btn">
                    <i class="fas fa-user-times"></i> Kick Player
                </button>
                <button onclick="showBanPlayerModal()" class="admin-btn">
                    <i class="fas fa-ban"></i> Ban Player
                </button>
                <button onclick="showUnbanUserModal()" class="admin-btn" style="background: rgba(74, 222, 128, 0.2); color: #4ade80;">
                    <i class="fas fa-unlock"></i> Unban User
                </button>
                <button onclick="showClearChatModal()" class="admin-btn">
                    <i class="fas fa-broom"></i> Clear Chat
                </button>
            </div>
            <div class="admin-section">
                <h4>Announcements</h4>
                <button onclick="showBroadcastModal()" class="admin-btn">
                    <i class="fas fa-bullhorn"></i> Broadcast Message
                </button>
            </div>
            <div class="admin-section">
                <h4>User Database</h4>
                <button onclick="showUserDatabaseModal()" class="admin-btn">
                    <i class="fas fa-database"></i> View User Database
                </button>
                <button onclick="showDeleteAllUsersModal()" class="admin-btn" style="background: rgba(239, 68, 68, 0.2); color: #ef4444;">
                    <i class="fas fa-trash-alt"></i> Delete All Users
                </button>
            </div>
            <div class="admin-section">
                <h4>Server Tools</h4>
                <button onclick="requestServerInfo()" class="admin-btn">
                    <i class="fas fa-info-circle"></i> Server Info
                </button>
                <button onclick="refreshAllRooms()" class="admin-btn">
                    <i class="fas fa-sync-alt"></i> Refresh All Rooms
                </button>
                <button onclick="showMaintenanceModal()" class="admin-btn" style="background: rgba(251, 191, 36, 0.2); color: #fbbf24;">
                    <i class="fas fa-wrench"></i> Maintenance Mode
                </button>
                <button onclick="showBackupModal()" class="admin-btn">
                    <i class="fas fa-hdd"></i> Database Backup
                </button>
            </div>
        </div>
    `;

    document.body.appendChild(panel);
}

function closeAdminPanel() {
    const panel = document.getElementById('adminPanel');
    if (panel) {
        panel.remove();
    }
}

// Maintenance Mode Modal
function showMaintenanceModal() {
    if (!isAdmin()) return;
    
    const modal = document.createElement('div');
    modal.className = 'modal admin-modal';
    modal.id = 'maintenanceModal';
    modal.innerHTML = `
        <div class="modal-content">
            <div class="modal-icon"><i class="fas fa-wrench" style="color: var(--warning);"></i></div>
            <h2>Maintenance Mode</h2>
            <p style="color: var(--text-secondary); margin-bottom: 20px;">
                When enabled, only admins can login. All other users will see a maintenance message.
            </p>
            
            <div class="form-group">
                <label>Maintenance Message</label>
                <input type="text" id="maintenanceMessageInput" 
                    placeholder="Website is under maintenance. Please try again later."
                    style="width: 100%; padding: 12px; border: 2px solid var(--border-color); border-radius: 8px; background: var(--bg-input); color: var(--text-primary);">
            </div>
            
            <div class="modal-actions">
                <button type="button" class="btn btn-secondary" onclick="hideModal('maintenanceModal')">Cancel</button>
                <button type="button" class="btn btn-warning" onclick="toggleMaintenanceMode(true)">
                    <i class="fas fa-power-off"></i> Enable
                </button>
                <button type="button" class="btn btn-success" onclick="toggleMaintenanceMode(false)">
                    <i class="fas fa-check"></i> Disable
                </button>
            </div>
        </div>
    `;
    
    document.body.appendChild(modal);
    showModal('maintenanceModal');
    
    // Get current status
    socket.emit('adminGetMaintenanceStatus');
}

function toggleMaintenanceMode(enabled) {
    const message = document.getElementById('maintenanceMessageInput')?.value || '';
    socket.emit('adminToggleMaintenance', { enabled, message });
    hideModal('maintenanceModal');
}

// Backup Management Modal
function showBackupModal() {
    if (!isAdmin()) return;
    
    const modal = document.createElement('div');
    modal.className = 'modal admin-modal';
    modal.id = 'backupModal';
    modal.innerHTML = `
        <div class="modal-content" style="max-width: 600px;">
            <div class="modal-icon"><i class="fas fa-hdd" style="color: var(--info);"></i></div>
            <h2>Database Backup</h2>
            <p style="color: var(--text-secondary); margin-bottom: 20px;">
                Create backups of user data before updates. Backups are stored locally.
            </p>
            
            <div class="modal-actions" style="margin-bottom: 20px;">
                <button type="button" class="btn btn-primary" onclick="createBackup()">
                    <i class="fas fa-save"></i> Create New Backup
                </button>
                <button type="button" class="btn btn-secondary" onclick="loadBackupList()">
                    <i class="fas fa-list"></i> Refresh List
                </button>
            </div>
            
            <div id="backupList" style="max-height: 300px; overflow-y: auto;">
                <p style="color: var(--text-secondary); text-align: center;">Loading backups...</p>
            </div>
            
            <div class="modal-actions">
                <button type="button" class="btn btn-secondary" onclick="hideModal('backupModal')">Close</button>
            </div>
        </div>
    `;
    
    document.body.appendChild(modal);
    showModal('backupModal');
    loadBackupList();
}

function createBackup() {
    socket.emit('adminCreateBackup');
}

function loadBackupList() {
    socket.emit('adminListBackups');
}

function displayBackupList(backups) {
    const listDiv = document.getElementById('backupList');
    if (!listDiv) return;
    
    if (backups.length === 0) {
        listDiv.innerHTML = '<p style="color: var(--text-secondary); text-align: center;">No backups found</p>';
        return;
    }
    
    let html = '<div style="display: flex; flex-direction: column; gap: 10px;">';
    backups.forEach(backup => {
        const date = new Date(backup.created).toLocaleString();
        const size = (backup.size / 1024).toFixed(2) + ' KB';
        html += `
            <div style="background: var(--bg-secondary); padding: 15px; border-radius: 8px; display: flex; justify-content: space-between; align-items: center;">
                <div>
                    <strong>${backup.filename}</strong>
                    <br><small style="color: var(--text-secondary);">${date} • ${size}</small>
                </div>
                <div style="display: flex; gap: 8px;">
                    <button class="btn btn-success" style="padding: 8px 16px; font-size: 0.85rem;" onclick="restoreBackup('${backup.filename}')">
                        <i class="fas fa-undo"></i> Restore
                    </button>
                    <button class="btn btn-danger" style="padding: 8px 16px; font-size: 0.85rem;" onclick="deleteBackup('${backup.filename}')">
                        <i class="fas fa-trash"></i>
                    </button>
                </div>
            </div>
        `;
    });
    html += '</div>';
    listDiv.innerHTML = html;
}

function restoreBackup(filename) {
    if (!confirm(`Are you sure you want to restore from ${filename}? Current data will be backed up first.`)) {
        return;
    }
    socket.emit('adminRestoreBackup', { filename });
}

function deleteBackup(filename) {
    if (!confirm(`Are you sure you want to delete ${filename}?`)) {
        return;
    }
    socket.emit('adminDeleteBackup', { filename });
}

function showUserDatabaseModal() {
    if (!isAdmin()) return;
    socket.emit('adminGetUserDatabase');
}

function displayUserDatabase(users, total) {
    // Remove existing modal if it exists to prevent duplicates
    const existingModal = document.getElementById('adminUserDatabaseModal');
    if (existingModal) {
        existingModal.remove();
    }

    const modal = document.createElement('div');
    modal.className = 'modal admin-modal';
    modal.id = 'adminUserDatabaseModal';

    let usersHtml = users.map(user => {
        const isBanned = user.banned;
        const banStatus = isBanned ? (user.isPermanent ? 'PERMANENT' : 'BANNED') : 'Active';
        const banColor = isBanned ? 'var(--error)' : 'var(--success)';
        const borderColor = isBanned ? 'var(--error)' : 'var(--primary)';
        
        return `
        <div class="user-db-item" style="background: var(--bg-secondary); padding: 15px; margin: 10px 0; border-radius: 8px; border-left: 4px solid ${borderColor};">
            <div style="display: flex; justify-content: space-between; align-items: start;">
                <div style="flex: 1;">
                    <strong>${escapeHtml(user.username)}</strong> ${user.hasAvatar ? '🖼️' : ''} 
                    <span style="font-size: 0.75rem; margin-left: 5px; color: ${banColor};">${banStatus}</span><br>
                    <small style="color: var(--text-secondary);">
                        <span style="color: var(--success);">Wins: ${user.stats.wins}</span> | 
                        <span style="color: var(--error);">Losses: ${user.stats.losses}</span> | 
                        <span style="color: var(--info);">Games: ${user.stats.gamesPlayed}</span><br>
                        ${isBanned && user.banReason ? `<span style="color: var(--error);">Reason: ${escapeHtml(user.banReason)}</span><br>` : ''}
                        First Login: ${new Date(user.firstLogin).toLocaleDateString()}<br>
                        Last Login: ${new Date(user.lastLogin).toLocaleDateString()}
                    </small>
                </div>
                <div style="display: flex; gap: 5px; flex-wrap: wrap;">
                    ${isBanned ? 
                        `<button onclick="unbanUserFromDB('${escapeHtml(user.username)}')" class="btn btn-success" style="padding: 5px 10px; font-size: 0.8rem;" title="Unban User"><i class="fas fa-unlock"></i></button>` :
                        `<button onclick="showBanUserModal('${escapeHtml(user.username)}')" class="btn btn-warning" style="padding: 5px 10px; font-size: 0.8rem;" title="Ban User"><i class="fas fa-ban"></i></button>`
                    }
                    <button onclick="showEditUserStatsModal('${escapeHtml(user.username)}', ${user.stats.wins}, ${user.stats.losses}, ${user.stats.gamesPlayed})" class="btn btn-primary" style="padding: 5px 10px; font-size: 0.8rem;" title="Edit Stats"><i class="fas fa-edit"></i></button>
                    <button onclick="deleteUserFromDatabase('${escapeHtml(user.username)}')" class="btn btn-danger" style="padding: 5px 10px; font-size: 0.8rem;" title="Delete User"><i class="fas fa-trash"></i></button>
                </div>
            </div>
        </div>
    `}).join('');

    modal.innerHTML = `
        <div class="modal-content" style="max-width: 700px; max-height: 80vh; overflow-y: auto;">
            <div class="modal-icon"><i class="fas fa-database"></i></div>
            <h2>User Database (${total} users)</h2>
            
            <div style="max-height: 500px; overflow-y: auto; margin: 20px 0;">
                ${usersHtml || '<p style="color: var(--text-secondary); text-align: center;">No users in database</p>'}
            </div>
            
            <div class="modal-actions">
                <button type="button" class="btn btn-secondary" onclick="hideModal('adminUserDatabaseModal')">Close</button>
                <button type="button" class="btn btn-info" onclick="socket.emit('adminReloadUserDatabase')">
                    <i class="fas fa-file-import"></i> Reload from File
                </button>
                <button type="button" class="btn btn-primary" onclick="socket.emit('adminGetUserDatabase')">
                    <i class="fas fa-sync-alt"></i> Refresh View
                </button>
            </div>
        </div>
    `;

    document.body.appendChild(modal);
    showModal('adminUserDatabaseModal');
}

function deleteUserFromDatabase(username) {
    if (!confirm(`Delete user "${username}"? This will erase all their stats and profile picture!`)) {
        return;
    }
    socket.emit('adminDeleteUser', { username });
}

function showBanUserModal(username) {
    if (!isAdmin()) return;

    const modal = document.createElement('div');
    modal.className = 'modal admin-modal';
    modal.id = 'adminBanUserModal';
    modal.innerHTML = `
        <div class="modal-content">
            <div class="modal-icon"><i class="fas fa-ban" style="color: var(--error);"></i></div>
            <h2>Ban User</h2>
            <p style="color: var(--text-secondary); margin-bottom: 20px;">Banning: <strong>${escapeHtml(username)}</strong></p>
            <div class="form-group">
                <label>Ban Duration</label>
                <select id="banDurationInput" style="width: 100%; padding: 12px; background: var(--bg-input); border: 1px solid var(--border-color); border-radius: 8px; color: var(--text-primary);">
                    <option value="1">1 hour</option>
                    <option value="24">24 hours</option>
                    <option value="168">7 days</option>
                    <option value="720">30 days</option>
                    <option value="0">Permanent</option>
                </select>
            </div>
            <div class="form-group">
                <label>Reason</label>
                <input type="text" id="banReasonInput" placeholder="Reason for ban (optional)" style="width: 100%; padding: 12px; background: var(--bg-input); border: 1px solid var(--border-color); border-radius: 8px; color: var(--text-primary);">
            </div>
            <div class="modal-actions">
                <button type="button" class="btn btn-secondary" onclick="hideModal('adminBanUserModal')">Cancel</button>
                <button type="button" class="btn btn-danger" onclick="banUser('${escapeHtml(username)}')">
                    <i class="fas fa-ban"></i> Ban User
                </button>
            </div>
        </div>
    `;

    document.body.appendChild(modal);
    showModal('adminBanUserModal');
}

function banUser(username) {
    const durationInput = document.getElementById('banDurationInput');
    const reasonInput = document.getElementById('banReasonInput');
    const duration = parseInt(durationInput.value);
    const reason = reasonInput.value.trim() || 'Banned by admin';

    socket.emit('adminBanUser', { username, duration, reason });
    hideModal('adminBanUserModal');
}

function unbanUserFromDB(username) {
    if (!isAdmin()) return;
    
    if (!confirm(`Are you sure you want to unban "${username}"?`)) {
        return;
    }
    
    socket.emit('adminUnbanUser', { username });
}

function showEditUserStatsModal(username, currentWins, currentLosses, currentGames) {
    if (!isAdmin()) return;

    const modal = document.createElement('div');
    modal.className = 'modal admin-modal';
    modal.id = 'adminEditUserStatsModal';
    modal.innerHTML = `
        <div class="modal-content">
            <div class="modal-icon"><i class="fas fa-edit" style="color: var(--info);"></i></div>
            <h2>Edit User Stats</h2>
            <p style="color: var(--text-secondary); margin-bottom: 20px;">
                Editing stats for: <strong>${escapeHtml(username)}</strong>
            </p>
            <div class="form-group">
                <label>Wins</label>
                <input type="number" id="editStatsWins" value="${currentWins}" min="0" 
                       style="width: 100%; padding: 12px; background: var(--bg-input); border: 1px solid var(--border-color); border-radius: 8px; color: var(--text-primary);">
            </div>
            <div class="form-group">
                <label>Losses</label>
                <input type="number" id="editStatsLosses" value="${currentLosses}" min="0"
                       style="width: 100%; padding: 12px; background: var(--bg-input); border: 1px solid var(--border-color); border-radius: 8px; color: var(--text-primary);">
            </div>
            <div class="form-group">
                <label>Games Played</label>
                <input type="number" id="editStatsGames" value="${currentGames}" min="0"
                       style="width: 100%; padding: 12px; background: var(--bg-input); border: 1px solid var(--border-color); border-radius: 8px; color: var(--text-primary);">
            </div>
            <div class="modal-actions">
                <button type="button" class="btn btn-secondary" onclick="hideModal('adminEditUserStatsModal')">Cancel</button>
                <button type="button" class="btn btn-primary" onclick="saveUserStatsEdit('${escapeHtml(username)}')">
                    <i class="fas fa-save"></i> Save Changes
                </button>
            </div>
        </div>
    `;

    document.body.appendChild(modal);
    showModal('adminEditUserStatsModal');
}

function saveUserStatsEdit(username) {
    const wins = parseInt(document.getElementById('editStatsWins').value) || 0;
    const losses = parseInt(document.getElementById('editStatsLosses').value) || 0;
    const gamesPlayed = parseInt(document.getElementById('editStatsGames').value) || 0;

    socket.emit('adminEditUserStats', { 
        username, 
        stats: { wins, losses, gamesPlayed } 
    });
    hideModal('adminEditUserStatsModal');
}

function showDeleteAllUsersModal() {
    if (!isAdmin()) return;

    const modal = document.createElement('div');
    modal.className = 'modal admin-modal';
    modal.id = 'adminDeleteAllUsersModal';
    modal.innerHTML = `
        <div class="modal-content">
            <div class="modal-icon" style="color: var(--error); font-size: 4rem;"><i class="fas fa-exclamation-triangle"></i></div>
            <h2 style="color: var(--error);">⚠️ DANGER ZONE ⚠️</h2>
            <p style="color: var(--text-primary); margin: 20px 0; font-size: 1.1rem;">
                This will <strong>PERMANENTLY DELETE ALL USERS</strong> from the database!
            </p>
            <p style="color: var(--text-secondary);">
                This action will:
            </p>
            <ul style="color: var(--text-secondary); text-align: left; margin: 15px 0;">
                <li>Delete all user stats (wins, losses, games played)</li>
                <li>Delete all profile pictures</li>
                <li>Delete all user records</li>
                <li><strong>This CANNOT be undone!</strong></li>
            </ul>
            <div class="modal-actions" style="margin-top: 30px;">
                <button type="button" class="btn btn-secondary" onclick="hideModal('adminDeleteAllUsersModal')">Cancel</button>
                <button type="button" class="btn btn-danger" onclick="confirmDeleteAllUsers()">
                    <i class="fas fa-trash-alt"></i> DELETE ALL USERS
                </button>
            </div>
        </div>
    `;

    document.body.appendChild(modal);
    showModal('adminDeleteAllUsersModal');
}

function confirmDeleteAllUsers() {
    const confirmation = prompt('Type "DELETE ALL USERS" to confirm:');
    if (confirmation === 'DELETE ALL USERS') {
        socket.emit('adminDeleteAllUsers');
        hideModal('adminDeleteAllUsersModal');
    } else {
        showNotification('Deletion cancelled', 'info');
    }
}

function showDeleteRoomModal() {
    if (!isAdmin()) return;

    const modal = document.createElement('div');
    modal.className = 'modal admin-modal';
    modal.id = 'adminDeleteRoomModal';
    modal.innerHTML = `
        <div class="modal-content">
            <div class="modal-icon"><i class="fas fa-trash"></i></div>
            <h2>Delete Room</h2>
            <div class="form-group">
                <label>Room ID or Name</label>
                <input type="text" id="adminDeleteRoomInput" placeholder="Enter room ID or name">
            </div>
            <div class="modal-actions">
                <button type="button" class="btn btn-secondary" onclick="hideModal('adminDeleteRoomModal')">Cancel</button>
                <button type="button" class="btn btn-danger" onclick="adminDeleteRoom()">Delete Room</button>
            </div>
        </div>
    `;

    document.body.appendChild(modal);
    showModal('adminDeleteRoomModal');
}

function adminDeleteRoom() {
    const roomInput = document.getElementById('adminDeleteRoomInput');
    const roomIdOrName = roomInput.value.trim();

    if (!roomIdOrName) {
        showNotification('Please enter a room ID or name', 'error');
        return;
    }

    socket.emit('adminDeleteRoom', { roomIdOrName });
    hideModal('adminDeleteRoomModal');
}

function showKickPlayerModal() {
    if (!isAdmin()) return;

    const modal = document.createElement('div');
    modal.className = 'modal admin-modal';
    modal.id = 'adminKickPlayerModal';
    modal.innerHTML = `
        <div class="modal-content">
            <div class="modal-icon"><i class="fas fa-user-times"></i></div>
            <h2>Kick Player</h2>
            <div class="form-group">
                <label>Username</label>
                <input type="text" id="adminKickUsernameInput" placeholder="Enter username to kick">
            </div>
            <div class="form-group">
                <label>Reason (optional)</label>
                <input type="text" id="adminKickReasonInput" placeholder="Reason for kicking">
            </div>
            <div class="modal-actions">
                <button type="button" class="btn btn-secondary" onclick="hideModal('adminKickPlayerModal')">Cancel</button>
                <button type="button" class="btn btn-warning" onclick="adminKickPlayer()">Kick Player</button>
            </div>
        </div>
    `;

    document.body.appendChild(modal);
    showModal('adminKickPlayerModal');
}

function adminKickPlayer() {
    const usernameInput = document.getElementById('adminKickUsernameInput');
    const reasonInput = document.getElementById('adminKickReasonInput');
    const username = usernameInput.value.trim();
    const reason = reasonInput.value.trim() || 'Kicked by admin';

    if (!username) {
        showNotification('Please enter a username', 'error');
        return;
    }

    socket.emit('adminKickPlayer', { username, reason });
    hideModal('adminKickPlayerModal');
}

function showBanPlayerModal() {
    if (!isAdmin()) return;

    const modal = document.createElement('div');
    modal.className = 'modal admin-modal';
    modal.id = 'adminBanPlayerModal';
    modal.innerHTML = `
        <div class="modal-content">
            <div class="modal-icon"><i class="fas fa-ban" style="color: var(--error);"></i></div>
            <h2>Ban Player</h2>
            <div class="form-group">
                <label>Username</label>
                <input type="text" id="adminBanUsernameInput" placeholder="Enter username to ban">
            </div>
            <div class="form-group">
                <label>Duration (hours)</label>
                <select id="adminBanDurationInput" style="width: 100%; padding: 12px; background: var(--bg-input); border: 1px solid var(--border-color); border-radius: 8px; color: var(--text-primary);">
                    <option value="1">1 hour</option>
                    <option value="24">24 hours</option>
                    <option value="168">7 days</option>
                    <option value="720">30 days</option>
                    <option value="0">Permanent</option>
                </select>
            </div>
            <div class="form-group">
                <label>Reason (optional)</label>
                <input type="text" id="adminBanReasonInput" placeholder="Reason for banning">
            </div>
            <div class="modal-actions">
                <button type="button" class="btn btn-secondary" onclick="hideModal('adminBanPlayerModal')">Cancel</button>
                <button type="button" class="btn btn-danger" onclick="adminBanPlayer()">Ban Player</button>
            </div>
        </div>
    `;

    document.body.appendChild(modal);
    showModal('adminBanPlayerModal');
}

function adminBanPlayer() {
    const usernameInput = document.getElementById('adminBanUsernameInput');
    const durationInput = document.getElementById('adminBanDurationInput');
    const reasonInput = document.getElementById('adminBanReasonInput');
    const username = usernameInput.value.trim();
    const duration = parseInt(durationInput.value);
    const reason = reasonInput.value.trim() || 'Banned by admin';

    if (!username) {
        showNotification('Please enter a username', 'error');
        return;
    }

    socket.emit('adminBanPlayer', { username, duration, reason });
    hideModal('adminBanPlayerModal');
}

function showUnbanUserModal() {
    if (!isAdmin()) return;

    const modal = document.createElement('div');
    modal.className = 'modal admin-modal';
    modal.id = 'adminUnbanUserModal';
    modal.innerHTML = `
        <div class="modal-content">
            <div class="modal-icon"><i class="fas fa-unlock" style="color: var(--success);"></i></div>
            <h2>Unban User</h2>
            <div class="form-group">
                <label>Username</label>
                <input type="text" id="adminUnbanUsernameInput" placeholder="Enter username to unban">
            </div>
            <p style="color: var(--text-secondary); font-size: 0.9rem; margin-top: 10px;">
                This will remove the ban and allow the user to log in and join rooms again.
            </p>
            <div class="modal-actions">
                <button type="button" class="btn btn-secondary" onclick="hideModal('adminUnbanUserModal')">Cancel</button>
                <button type="button" class="btn btn-success" onclick="adminUnbanUserFromPanel()">Unban User</button>
            </div>
        </div>
    `;

    document.body.appendChild(modal);
    showModal('adminUnbanUserModal');
}

function adminUnbanUserFromPanel() {
    const usernameInput = document.getElementById('adminUnbanUsernameInput');
    const username = usernameInput.value.trim();

    if (!username) {
        showNotification('Please enter a username', 'error');
        return;
    }

    socket.emit('adminUnbanUser', { username });
    hideModal('adminUnbanUserModal');
}

// ═══════════════════════════════════════════════════════════════════════
// USER PROFILE INSPECTION
// ═══════════════════════════════════════════════════════════════════════

function displayUserProfileModal(data) {
    // Close existing modal if open
    const existingModal = document.getElementById('userProfileInspectModal');
    if (existingModal) {
        existingModal.remove();
    }

    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.id = 'userProfileInspectModal';
    
    // Format dates
    const firstLogin = data.firstLogin !== 'Hidden' ? new Date(data.firstLogin).toLocaleDateString() : 'Hidden';
    const lastLogin = data.lastLogin !== 'Hidden' ? new Date(data.lastLogin).toLocaleDateString() : 'Hidden';
    
    // Calculate win rate
    const wins = parseInt(data.stats.wins) || 0;
    const losses = parseInt(data.stats.losses) || 0;
    const gamesPlayed = parseInt(data.stats.gamesPlayed) || 0;
    const winRate = gamesPlayed > 0 ? Math.round((wins / gamesPlayed) * 100) : 0;
    
    // Build admin buttons if inspector is admin
    let adminButtons = '';
    if (data.isInspectorAdmin && !data.isAdmin) {
        adminButtons = `
            <div class="admin-actions" style="margin-top: 20px; padding-top: 20px; border-top: 1px solid var(--border-color);">
                <h4 style="color: var(--warning); margin-bottom: 10px;">Admin Actions</h4>
                <div style="display: flex; gap: 10px;">
                    <button onclick="adminClearUserStats('${escapeHtml(data.username)}')" class="btn btn-danger" style="flex: 1;">
                        <i class="fas fa-eraser"></i> Clear All Stats
                    </button>
                    <button onclick="adminEditInspectedUser('${escapeHtml(data.username)}', ${wins}, ${losses}, ${gamesPlayed})" class="btn btn-primary" style="flex: 1;">
                        <i class="fas fa-edit"></i> Edit Stats
                    </button>
                </div>
            </div>
        `;
    }
    
    // Check if this is a normal user inspecting an admin
    const isNormalUserInspectingAdmin = data.isAdmin && !data.isInspectorAdmin;
    
    // Hidden message for admin profiles viewed by non-admins
    const hiddenMessage = isNormalUserInspectingAdmin ? 
        '<p style="color: var(--warning); text-align: center; margin: 10px 0;">🔒 Admin stats are hidden</p>' : '';
    
    // Hide win rate when normal user inspects admin
    const winRateDisplay = isNormalUserInspectingAdmin ? 
        `<div style="font-size: 1.8rem; font-weight: bold; color: var(--warning);">???</div>` :
        `<div style="font-size: 1.8rem; font-weight: bold; color: var(--warning);">${winRate}%</div>`;
    
    modal.innerHTML = `
        <div class="modal-content user-profile-modal" style="max-width: 400px;">
            <button class="profile-close-btn" onclick="hideModal('userProfileInspectModal')" style="position: absolute; top: 15px; right: 15px; background: none; border: none; color: var(--text-secondary); font-size: 1.5rem; cursor: pointer;">
                <i class="fas fa-times"></i>
            </button>
            
            <div class="profile-header" style="text-align: center; margin-bottom: 20px;">
                <div class="profile-avatar-large" style="width: 100px; height: 100px; margin: 0 auto 15px; border-radius: 50%; overflow: hidden; border: 3px solid var(--primary);">
                    ${data.avatar 
                        ? `<img src="${data.avatar}" alt="${escapeHtml(data.username)}" style="width: 100%; height: 100%; object-fit: cover;">`
                        : `<div style="width: 100%; height: 100%; background: var(--bg-input); display: flex; align-items: center; justify-content: center; font-size: 3rem; font-weight: bold;">${data.username.charAt(0).toUpperCase()}</div>`
                    }
                </div>
                <h2 style="margin: 0; font-size: 1.5rem;">${escapeHtml(data.username)} ${data.isAdmin ? '<span style="color: var(--warning); font-size: 0.8rem;">[ADMIN]</span>' : ''}</h2>
                ${hiddenMessage}
            </div>
            
            <div class="profile-stats" style="background: var(--bg-input); padding: 20px; border-radius: 10px; margin-bottom: 15px;">
                <div class="stats-grid" style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 15px; text-align: center;">
                    <div class="stat-item">
                        <div style="font-size: 1.8rem; font-weight: bold; color: var(--success);">${data.stats.wins}</div>
                        <div style="font-size: 0.85rem; color: var(--text-secondary);">Wins</div>
                    </div>
                    <div class="stat-item">
                        <div style="font-size: 1.8rem; font-weight: bold; color: var(--error);">${data.stats.losses}</div>
                        <div style="font-size: 0.85rem; color: var(--text-secondary);">Losses</div>
                    </div>
                    <div class="stat-item">
                        <div style="font-size: 1.8rem; font-weight: bold; color: var(--info);">${data.stats.gamesPlayed}</div>
                        <div style="font-size: 0.85rem; color: var(--text-secondary);">Games</div>
                    </div>
                    <div class="stat-item">
                        ${winRateDisplay}
                        <div style="font-size: 0.85rem; color: var(--text-secondary);">Win Rate</div>
                    </div>
                </div>
            </div>
            
            <div class="profile-info" style="background: var(--bg-input); padding: 15px; border-radius: 10px; font-size: 0.9rem; color: var(--text-secondary);">
                <div style="display: flex; justify-content: space-between; margin-bottom: 8px;">
                    <span>First Login:</span>
                    <span style="color: var(--text-primary);">${firstLogin}</span>
                </div>
                <div style="display: flex; justify-content: space-between;">
                    <span>Last Seen:</span>
                    <span style="color: var(--text-primary);">${lastLogin}</span>
                </div>
            </div>
            
            ${adminButtons}
        </div>
    `;
    
    document.body.appendChild(modal);
    showModal('userProfileInspectModal');
}

// Admin: Clear all stats for a user
function adminClearUserStats(username) {
    if (!isAdmin()) return;
    
    if (!confirm(`Are you sure you want to CLEAR ALL STATS for "${username}"?\n\nThis will reset:\n- Wins to 0\n- Losses to 0\n- Games Played to 0\n\nThis action cannot be undone!`)) {
        return;
    }
    
    socket.emit('adminEditUserStats', { 
        username, 
        stats: { wins: 0, losses: 0, gamesPlayed: 0 } 
    });
    
    hideModal('userProfileInspectModal');
    showNotification(`All stats cleared for ${username}`, 'success');
}

// Admin: Edit stats for inspected user
function adminEditInspectedUser(username, currentWins, currentLosses, currentGames) {
    hideModal('userProfileInspectModal');
    showEditUserStatsModal(username, currentWins, currentLosses, currentGames);
}

function showClearChatModal() {
    if (!isAdmin()) return;

    const modal = document.createElement('div');
    modal.className = 'modal admin-modal';
    modal.id = 'adminClearChatModal';
    modal.innerHTML = `
        <div class="modal-content">
            <div class="modal-icon"><i class="fas fa-broom" style="color: var(--info);"></i></div>
            <h2>Clear Chat</h2>
            <p style="color: var(--text-secondary); margin-bottom: 20px;">Select which chat to clear:</p>
            <div class="modal-actions" style="flex-direction: column; gap: 10px;">
                <button type="button" class="btn btn-primary" onclick="adminClearChat('lobby')">
                    <i class="fas fa-comments"></i> Clear Lobby Chat
                </button>
                <button type="button" class="btn btn-primary" onclick="adminClearChat('current')">
                    <i class="fas fa-door-open"></i> Clear Current Room Chat
                </button>
                <button type="button" class="btn btn-secondary" onclick="hideModal('adminClearChatModal')">Cancel</button>
            </div>
        </div>
    `;

    document.body.appendChild(modal);
    showModal('adminClearChatModal');
}

function adminClearChat(type) {
    socket.emit('adminClearChat', { type });
    hideModal('adminClearChatModal');
}

function showBroadcastModal() {
    if (!isAdmin()) return;

    const modal = document.createElement('div');
    modal.className = 'modal admin-modal';
    modal.id = 'adminBroadcastModal';
    modal.innerHTML = `
        <div class="modal-content">
            <div class="modal-icon"><i class="fas fa-bullhorn" style="color: var(--warning);"></i></div>
            <h2>Broadcast Message</h2>
            <div class="form-group">
                <label>Message</label>
                <textarea id="adminBroadcastMessageInput" placeholder="Enter message to broadcast to all users..." rows="4" style="resize: vertical;"></textarea>
            </div>
            <div class="modal-actions">
                <button type="button" class="btn btn-secondary" onclick="hideModal('adminBroadcastModal')">Cancel</button>
                <button type="button" class="btn btn-warning" onclick="adminBroadcastMessage()">
                    <i class="fas fa-paper-plane"></i> Broadcast
                </button>
            </div>
        </div>
    `;

    document.body.appendChild(modal);
    showModal('adminBroadcastModal');
}

function adminBroadcastMessage() {
    const messageInput = document.getElementById('adminBroadcastMessageInput');
    const message = messageInput.value.trim();

    if (!message) {
        showNotification('Please enter a message', 'error');
        return;
    }

    socket.emit('adminBroadcast', { message });
    hideModal('adminBroadcastModal');
}

function refreshAllRooms() {
    if (!isAdmin()) return;
    socket.emit('getRooms');
    showNotification('Refreshing rooms list...', 'info');
    closeAdminPanel();
}

function requestServerInfo() {
    if (!isAdmin()) return;
    socket.emit('adminGetServerInfo');
}

function displayAdminServerInfo(data) {
    const modal = document.createElement('div');
    modal.className = 'modal admin-modal';
    modal.id = 'adminServerInfoModal';

    let roomsHtml = data.rooms.map(room => `
        <div class="admin-info-item">
            <strong>${escapeHtml(room.name)}</strong> (${room.mode})<br>
            <small>Players: ${room.players}/${room.maxPlayers} | Status: ${room.status} | Host: ${escapeHtml(room.host)}</small>
        </div>
    `).join('');

    let usersHtml = data.users.map(user => `
        <div class="admin-info-item">
            <strong>${escapeHtml(user.username)}</strong> ${user.isAdmin ? '<span style="color: var(--warning);">[ADMIN]</span>' : ''}<br>
            <small>Room: ${user.room ? 'In room' : 'Lobby'}</small>
        </div>
    `).join('');

    modal.innerHTML = `
        <div class="modal-content" style="max-width: 600px; max-height: 80vh; overflow-y: auto;">
            <div class="modal-icon"><i class="fas fa-server"></i></div>
            <h2>Server Information</h2>

            <div class="admin-info-section">
                <h4>Overview</h4>
                <div class="admin-info-item">
                    <strong>Online Users:</strong> ${data.onlineUsers}
                </div>
                <div class="admin-info-item">
                    <strong>Total Rooms:</strong> ${data.totalRooms}
                </div>
            </div>

            <div class="admin-info-section">
                <h4>Rooms (${data.rooms.length})</h4>
                ${roomsHtml || '<p style="color: var(--text-secondary);">No active rooms</p>'}
            </div>

            <div class="admin-info-section">
                <h4>Users (${data.users.length})</h4>
                ${usersHtml || '<p style="color: var(--text-secondary);">No online users</p>'}
            </div>

            <div class="modal-actions">
                <button type="button" class="btn btn-primary" onclick="hideModal('adminServerInfoModal')">Close</button>
            </div>
        </div>
    `;

    document.body.appendChild(modal);
    showModal('adminServerInfoModal');
}

// Admin chat command handler
function handleAdminCommand(message) {
    const parts = message.split(' ');
    const command = parts[0].toLowerCase();

    switch(command) {
        case '/kick':
            if (parts.length < 2) {
                showNotification('Usage: /kick <username> [reason]', 'error');
                return true;
            }
            const kickUsername = parts[1];
            const kickReason = parts.slice(2).join(' ') || 'Kicked by admin';
            socket.emit('adminKickPlayer', { username: kickUsername, reason: kickReason });
            return true;

        case '/deleteroom':
            if (parts.length < 2) {
                showNotification('Usage: /deleteroom <roomId or room name>', 'error');
                return true;
            }
            const roomIdOrName = parts[1];
            socket.emit('adminDeleteRoom', { roomIdOrName });
            return true;

        case '/adminpanel':
            showAdminPanel();
            return true;

        case '/broadcast':
            if (parts.length < 2) {
                showNotification('Usage: /broadcast <message>', 'error');
                return true;
            }
            const broadcastMessage = parts.slice(1).join(' ');
            socket.emit('adminBroadcast', { message: broadcastMessage });
            return true;

        case '/ban':
            if (parts.length < 2) {
                showNotification('Usage: /ban <username> [duration_hours] [reason]', 'error');
                return true;
            }
            const banUsername = parts[1];
            const banDuration = parseInt(parts[2]) || 24;
            const banReason = parts.slice(3).join(' ') || 'Banned by admin';
            socket.emit('adminBanPlayer', { username: banUsername, duration: banDuration, reason: banReason });
            return true;

        case '/clearchat':
            const clearType = parts[1] || 'lobby';
            socket.emit('adminClearChat', { type: clearType });
            return true;

        case '/serverinfo':
            requestServerInfo();
            return true;

        case '/help':
            showNotification('Admin commands: /kick, /ban, /deleteroom, /broadcast, /clearchat, /serverinfo, /adminpanel, /help', 'info');
            return true;

        default:
            return false;
    }
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
// STATS MANAGEMENT FUNCTIONS - SERVER DATABASE ONLY
// ═══════════════════════════════════════════════════════════════════════

// Stats are now loaded ONLY from server database
// No local cookie storage for stats

function setUserStats(stats) {
    userStats = {
        wins: stats.wins || 0,
        losses: stats.losses || 0,
        totalGames: stats.gamesPlayed || 0
    };
    displayUserStats();
}

function updateStats(result) {
    // Stats are updated on server automatically when games end
    // Just refresh the display
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
    // Use username instead of device ID for cross-device sync
    if (currentUser && currentUser.username) {
        return 'hangman_avatar_' + currentUser.username.toLowerCase();
    }
    // Fallback to device ID if no user logged in yet
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
        
        // Also save to server database
        if (socket && socket.connected) {
            socket.emit('updateAvatar', { avatar: base64Image });
        }
        
        showNotification('Avatar updated successfully!', 'success');
    });
}

// ═══════════════════════════════════════════════════════════════════════
// SHARED AVATAR HELPER
// ═══════════════════════════════════════════════════════════════════════

function buildAvatarHTML(avatar, username, size = 28, clickable = true) {
    const avatarId = `avatar-${Math.random().toString(36).substr(2, 9)}`;
    const clickHandler = clickable ? `onclick="inspectUserProfile('${escapeHtml(username)}')"` : '';
    
    if (avatar) {
        return `<img id="${avatarId}" src="${avatar}" alt="${escapeHtml(username)}" ${clickHandler} class="message-avatar" style="width:${size}px;height:${size}px;border-radius:50%;object-fit:cover;flex-shrink:0;${clickable ? 'cursor:pointer;' : ''}">`;
    }
    const initial = username.charAt(0).toUpperCase();
    return `<div id="${avatarId}" class="player-avatar message-avatar" ${clickHandler} style="width:${size}px;height:${size}px;font-size:${size * 0.4}px;margin:0;flex-shrink:0;${clickable ? 'cursor:pointer;' : ''}">${initial}</div>`;
}

// Inspect user profile when clicking on avatar
function inspectUserProfile(username) {
    if (!socket || !socket.connected) return;
    if (!currentUser) return;
    
    // Don't inspect yourself
    if (username === currentUser.username) return;
    
    socket.emit('inspectUserProfile', { username });
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

    // Avatar will be loaded from server after authentication
    // This ensures cross-device sync of profile pictures
    
    // FIX: Set default active state on hint count button
    document.querySelectorAll('.hint-count-btn').forEach(btn => {
        if (parseInt(btn.dataset.hintCount) === currentHintCount) {
            btn.classList.add('active');
        }
    });

    // Load build number and version from server
    loadBuildNumber();
    loadVersion();

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
// BUILD NUMBER & VERSION
// ═══════════════════════════════════════════════════════════════════════

async function loadBuildNumber() {
    try {
        const response = await fetch('/api/build');
        if (response.ok) {
            const buildInfo = await response.json();
            const buildNumberEl = document.getElementById('buildNumber');
            if (buildNumberEl) {
                buildNumberEl.textContent = buildInfo.buildNumber || 'dev';
            }
        }
    } catch (error) {
        log('Failed to load build number:', error);
        const buildNumberEl = document.getElementById('buildNumber');
        if (buildNumberEl) {
            buildNumberEl.textContent = 'dev';
        }
    }
}

// Load version from CHANGELOG.md
async function loadVersion() {
    try {
        const response = await fetch('https://raw.githubusercontent.com/shreyanroy/hungmen/main/CHANGELOG.md');
        if (response.ok) {
            const changelogText = await response.text();
            // Parse version from first header like "# v1.2.0" or "# Version 1.2.0"
            const versionMatch = changelogText.match(/^#\s*(v?\d+\.\d+\.\d+.*?)$/m);
            const versionNumberEl = document.getElementById('versionNumber');
            if (versionNumberEl && versionMatch) {
                versionNumberEl.textContent = versionMatch[1].trim();
            } else if (versionNumberEl) {
                versionNumberEl.textContent = 'v1.0.0';
            }
        }
    } catch (error) {
        log('Failed to load version:', error);
        const versionNumberEl = document.getElementById('versionNumber');
        if (versionNumberEl) {
            versionNumberEl.textContent = 'v1.0.0';
        }
    }
}

// Parse changelog and format with clean UI
function parseChangelogToHTML(text) {
    const lines = text.split('\n');
    let html = '';
    let currentVersion = null;
    let inVersion = false;
    let inCategory = false;
    let categoryType = '';
    
    const categoryColors = {
        'ADDED': '#4ade80',
        'CHANGED': '#fbbf24',
        'FIXED': '#60a5fa',
        'REMOVED': '#f87171',
        'FEATURES': '#a78bfa'
    };
    
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        
        // Version header (## v1.2.0)
        if (line.match(/^##\s+v?\d+\.\d+\.\d+/)) {
            if (inVersion) {
                html += '</div></div>'; // Close previous version
            }
            const version = line.replace(/^##\s+/, '');
            html += `<div class="changelog-version">`;
            html += `<h2 class="changelog-version-header">${version}</h2>`;
            html += `<div class="changelog-version-content">`;
            inVersion = true;
            inCategory = false;
            continue;
        }
        
        // Category header (**ADDED**)
        if (line.match(/^\*\*[A-Z]+\*\*$/)) {
            if (inCategory) {
                html += '</ul></div>';
            }
            categoryType = line.replace(/\*\*/g, '');
            const color = categoryColors[categoryType] || '#9ca3af';
            html += `<div class="changelog-category">`;
            html += `<span class="changelog-badge" style="background: ${color}20; color: ${color}; border: 1px solid ${color}40;">${categoryType}</span>`;
            html += `<ul class="changelog-list">`;
            inCategory = true;
            continue;
        }
        
        // Bullet point (• **Title** - Description)
        if (line.match(/^•\s+/)) {
            const content = line.replace(/^•\s+/, '');
            // Parse bold title
            const parsedContent = content
                .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
                .replace(/`(.*?)`/g, '<code>$1</code>');
            html += `<li class="changelog-item">${parsedContent}</li>`;
            continue;
        }
        
        // Regular bullet (- item)
        if (line.match(/^[-\*]\s+/)) {
            const content = line.replace(/^[-\*]\s+/, '');
            const parsedContent = content
                .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
                .replace(/`(.*?)`/g, '<code>$1</code>');
            html += `<li class="changelog-item">${parsedContent}</li>`;
            continue;
        }
        
        // Empty line - close category if needed
        if (line === '' && inCategory) {
            html += '</ul></div>';
            inCategory = false;
        }
    }
    
    // Close any open sections
    if (inCategory) html += '</ul></div>';
    if (inVersion) html += '</div></div>';
    
    return html;
}

// Show changelog modal
async function showChangelog() {
    try {
        const response = await fetch('https://raw.githubusercontent.com/shreyanroy/hungmen/main/CHANGELOG.md');
        let changelogText = '# Changelog\n\n## v1.0.0\n\n**ADDED**\n\n• Initial release\n\n---\n\nNo changelog available.';
        
        if (response.ok) {
            changelogText = await response.text();
        }
        
        // Parse changelog with clean UI
        const htmlContent = parseChangelogToHTML(changelogText);
        
        const modal = document.createElement('div');
        modal.className = 'modal';
        modal.id = 'changelogModal';
        modal.innerHTML = `
            <div class="modal-content changelog-modal-content">
                <div class="changelog-header">
                    <h2>Changelog</h2>
                    <button onclick="hideModal('changelogModal')" class="changelog-close-btn">
                        <i class="fas fa-times"></i>
                    </button>
                </div>
                <div class="changelog-body">
                    ${htmlContent}
                </div>
                <div class="changelog-footer">
                    <button onclick="hideModal('changelogModal')" class="btn btn-primary">Close</button>
                </div>
            </div>
        `;
        
        document.body.appendChild(modal);
        showModal('changelogModal');
    } catch (error) {
        log('Failed to show changelog:', error);
        showNotification('Failed to load changelog', 'error');
    }
}

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

function connectSocket(username, adminPassword = null) {
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
    
    setupSocketListeners(username, connectionTimeout, adminPassword);
}

function setupSocketListeners(username, connectionTimeout, adminPassword = null) {
    socket.on('connect', () => {
        clearTimeout(connectionTimeout);
        mySocketId = socket.id;
        log('Connected to server:', socket.id);
        socket.emit('authenticate', { username, adminPassword });
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

    // Admin response handlers
    socket.on('adminSuccess', (data) => {
        showNotification(data.message, 'success');
    });

    socket.on('adminError', (data) => {
        showNotification(data.message, 'error');
    });

    socket.on('adminServerInfo', (data) => {
        displayAdminServerInfo(data);
    });

    socket.on('adminBroadcast', (data) => {
        showNotification(`[ADMIN] ${data.from}: ${data.message}`, 'info', 5000);
    });

    socket.on('adminUserDatabase', (data) => {
        displayUserDatabase(data.users, data.total);
    });

    // Kicked handler
    socket.on('kicked', (data) => {
        showNotification(`You have been kicked by ${data.by}. Reason: ${data.reason}`, 'error', 5000);
        socket.disconnect();
        clearSession();
        setTimeout(() => location.reload(), 2000);
    });

    // Room deleted handler
    socket.on('roomDeleted', (data) => {
        showNotification(`Room "${data.roomName}" has been deleted by an admin`, 'error', 5000);
        if (currentRoom) {
            leaveRoom();
        }
    });

    // Banned handler
    socket.on('banned', (data) => {
        const durationText = data.duration === 0 ? 'permanently' : `for ${data.duration} hour(s)`;
        showNotification(`You have been banned ${durationText} by ${data.by}. Reason: ${data.reason}`, 'error', 8000);
        socket.disconnect();
        clearSession();
        setTimeout(() => location.reload(), 3000);
    });

    // User data deleted handler (when admin deletes specific user)
    socket.on('userDataDeleted', (data) => {
        showNotification(`${data.message} by ${data.by}. Your stats and avatar have been reset.`, 'error', 5000);
        
        // Clear local stats (server database deleted)
        userStats = { wins: 0, losses: 0, totalGames: 0 };
        
        // Clear local avatar
        userAvatar = null;
        saveUserAvatar(null);
        
        // Update UI
        displayUserStats();
        displayUserAvatar();
        
        // Disconnect and reload
        socket.disconnect();
        clearSession();
        setTimeout(() => location.reload(), 3000);
    });

    // All user data deleted handler (when admin deletes all users)
    socket.on('allUserDataDeleted', (data) => {
        showNotification(`${data.message} by ${data.by}. All user data has been reset.`, 'error', 5000);
        
        // Clear local stats (server database deleted)
        userStats = { wins: 0, losses: 0, totalGames: 0 };
        
        // Clear local avatar
        userAvatar = null;
        saveUserAvatar(null);
        
        // Update UI
        displayUserStats();
        displayUserAvatar();
        
        // Disconnect and reload
        socket.disconnect();
        clearSession();
        setTimeout(() => location.reload(), 3000);
    });

    // Stats updated handler (when admin edits user stats)
    socket.on('statsUpdated', (data) => {
        showNotification(`Your stats have been updated by ${data.by}`, 'info', 3000);
        
        // Update local stats from server
        if (data.stats) {
            setUserStats(data.stats);
        }
    });

    // Stats reloaded handler (when refreshing from database)
    socket.on('statsReloaded', (data) => {
        if (data.success && data.stats) {
            setUserStats(data.stats);
            log('Stats reloaded from database');
        }
    });

    // Maintenance mode status
    socket.on('maintenanceStatus', (data) => {
        const input = document.getElementById('maintenanceMessageInput');
        if (input && data.message) {
            input.value = data.message;
        }
        log('Maintenance mode:', data.enabled ? 'ENABLED' : 'disabled');
    });

    // Maintenance mode enabled notification
    socket.on('maintenanceModeEnabled', (data) => {
        showNotification(data.message, 'warning', 5000);
    });

    // Backup list
    socket.on('adminBackupList', (data) => {
        displayBackupList(data.backups);
    });

    // User profile inspection handler
    socket.on('userProfileData', (data) => {
        displayUserProfileModal(data);
    });

    socket.on('userProfileError', (data) => {
        showNotification(data.message, 'error');
    });

    // Chat cleared handler
    socket.on('lobbyChatCleared', (data) => {
        const lobbyChatMessages = document.getElementById('lobbyChatMessages');
        if (lobbyChatMessages) {
            lobbyChatMessages.innerHTML = '';
        }
        showNotification(`Lobby chat has been cleared by ${data.by}`, 'info', 3000);
    });

    socket.on('roomChatCleared', (data) => {
        const chatMessages = document.getElementById('chatMessages');
        const miniChatMessages = document.getElementById('miniChatMessages');
        if (chatMessages) chatMessages.innerHTML = '';
        if (miniChatMessages) miniChatMessages.innerHTML = '';
        showNotification(`Room chat has been cleared by ${data.by}`, 'info', 3000);
    });

    socket.on('authenticated', (data) => {
        log('Authenticated successfully');
        if (data && data.user) {
            currentUser = data.user;
            
            // Load avatar from server if available
            if (currentUser.avatar) {
                userAvatar = currentUser.avatar;
                saveUserAvatar(userAvatar);
                displayUserAvatar();
            }
            
            // Load stats from server ONLY (no local cookie storage)
            if (currentUser.stats) {
                setUserStats(currentUser.stats);
            }
        }
        saveSession(username);
        showGameScreen();
        loadLobby();
        socket.emit('getLobbyChat');

        // Show admin indicator if user is admin
        if (currentUser && currentUser.isAdmin) {
            showAdminIndicator();
        }
    });
    
    // Handle avatar update confirmation
    socket.on('avatarUpdated', (data) => {
        if (data.success) {
            log('Avatar saved to server database');
        }
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
        
        // Update transferred stats and avatar
        if (data.stats) {
            currentUser.stats = data.stats;
            setUserStats(data.stats);
            displayUserStats();
        }
        if (data.avatar) {
            currentUser.avatar = data.avatar;
            userAvatar = data.avatar;
            saveUserAvatar(data.avatar);
            displayUserAvatar();
        }
        
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
        
        showNotification('Username changed successfully! Your stats have been transferred.', 'success');
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
            currentRoom.hostId = mySocketId;
            updateRoomControls();
            showNotification('You are now the host!', 'info');
        } else {
            // Update the hostId in currentRoom
            currentRoom.hostId = data.newHostId;
        }

        // Update all player cards to show new host
        document.querySelectorAll('.player-card').forEach(card => {
            card.classList.remove('host');
        });

        const newHostCard = document.getElementById(`player-${data.newHostId}`);
        if (newHostCard) {
            newHostCard.classList.add('host');
        }
    });
    
    // Coin flip phase for custom word mode
    socket.on('coinFlipPhase', (data) => {
        showCoinFlipModal(data);
    });
    
    // Coin side selected
    socket.on('coinSideSelected', (data) => {
        // Store isTeamMode in coinFlipData if provided
        if (data.isTeamMode !== undefined && coinFlipData) {
            coinFlipData.isTeamMode = data.isTeamMode;
        }
        updateCoinFlipSelection(data);
    });
    
    // Coin flip result
    socket.on('coinFlipResult', (data) => {
        showCoinFlipResult(data);
    });
    
    // Coin flip error
    socket.on('coinFlipError', (data) => {
        showNotification(data.message, 'error');
    });
    
    // Word selection phase for custom word mode
    socket.on('wordSelectionPhase', (data) => {
        // Hide coin flip modal if it's still showing
        hideModal('coinFlipModal');
        
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

        // Store game data for after countdown
        const gameData = data;

        // Show countdown before starting game
        showCountdown(() => {
            startGameAfterCountdown(gameData);
        });
    });

    function startGameAfterCountdown(data) {
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
    }

    socket.on('guessResult', (data) => {
        updateGameState(data);
    });
    
    // Hint request received (for word setter)
    socket.on('hintRequested', (data) => {
        showHintRequestModal(data.requesterName, data.question);
    });

    // Hint provided (for all players)
    socket.on('hintProvided', (data) => {
        displayReceivedHint(data.hint, data.hintNumber, data.question);
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
    const usernameInput = document.getElementById('usernameInput');
    const adminPasswordGroup = document.getElementById('adminPasswordGroup');
    const adminPasswordInput = document.getElementById('adminPasswordInput');
    const joinButton = usernameForm?.querySelector('button[type="submit"]');
    
    if (usernameForm) {
        // Handle form submission
        usernameForm.addEventListener('submit', handleJoinGame);
        
        // Also handle button click directly for mobile
        if (joinButton) {
            joinButton.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                handleJoinGame(e);
            });
            
            // Handle touch events for mobile
            joinButton.addEventListener('touchend', (e) => {
                e.preventDefault();
                e.stopPropagation();
                handleJoinGame(e);
            }, { passive: false });
        }
        
        // Handle Enter key on input
        if (usernameInput) {
            usernameInput.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    handleJoinGame(e);
                }
            });
            
            // Auto-focus on mobile after a short delay
            setTimeout(() => {
                usernameInput.focus();
            }, 500);
        }
        
        // Handle Admin password field visibility
        if (usernameInput && adminPasswordGroup) {
            usernameInput.addEventListener('input', (e) => {
                const username = e.target.value.trim();
                const isAdmin = username.toLowerCase() === 'admin';
                
                if (isAdmin) {
                    adminPasswordGroup.classList.remove('hidden');
                    // Focus on password field after a short delay
                    setTimeout(() => {
                        adminPasswordInput?.focus();
                    }, 100);
                } else {
                    adminPasswordGroup.classList.add('hidden');
                    if (adminPasswordInput) {
                        adminPasswordInput.value = '';
                    }
                }
            });
        }
        
        // Handle Enter key on password input
        if (adminPasswordInput) {
            adminPasswordInput.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    handleJoinGame(e);
                }
            });
        }
    }
}

function handleJoinGame(e) {
    e.preventDefault();
    const usernameInput = document.getElementById('usernameInput');
    const adminPasswordInput = document.getElementById('adminPasswordInput');
    const username = usernameInput.value.trim();
    const adminPassword = adminPasswordInput?.value.trim() || '';
    
    // Check for banned usernames (excluding 'admin' which is handled separately)
    if (username.toLowerCase() !== 'admin') {
        const bannedVariations = ['shreyan', 'shreyn', 'shryn', 'shyn', 'sreyan', 'sreyn', 'sryan', 'sryn', 'shrayan', 'shrayn', 'shriyan', 'shriyn', 'shrian', 'shrien', 'shryen', 'shryan', 'shryon', 'shryun','samarth', 'samart', 'samarthh', 'samarath','samerth', 'samirth', 'somarth', 'sumarth', 'samurth','samrth', 'smarth', 'samarh', 'samath','samarat', 'samrat', 'samraat', 'samrath','samaryh', 'samaryth', 'samarht', 'samarthy','samrath', 'samarht', 'smaarth', 'saamarth','samrt', 'samr', 'samar','samarath', 'samarrth', 'samartht'];
        
        const usernameLower = username.toLowerCase();
        for (const variation of bannedVariations) {
            if (usernameLower.includes(variation)) {
                showAuthError('This username is not accepted');
                return;
            }
        }
    }
    
    if (!username) {
        showAuthError('Please enter a username');
        return;
    }
    
    // Admin account validation
    if (username.toLowerCase() === 'admin') {
        if (!adminPassword) {
            showAuthError('Password needed to login in the admin account');
            return;
        }
        // Store admin info for authentication
        currentUser = { username, isAdmin: true, adminPassword };
        connectSocket(username, adminPassword);
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
    
    // Stats are loaded from server on authentication, not from cookies
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
        playerCard.className = `player-card ${player.id === mySocketId ? 'me' : ''} ${currentRoom && player.id === currentRoom.hostId ? 'host' : ''} ${player.isAdmin ? 'admin' : ''}`;
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
    playerCard.className = `player-card ${player.isAdmin ? 'admin' : ''}`;
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

let coinFlipData = null;
let hasSelectedCoinSide = false;

function showCoinFlipModal(data) {
    coinFlipData = data;
    hasSelectedCoinSide = false;
    
    const modal = document.getElementById('coinFlipModal');
    const selectionDiv = document.getElementById('coinFlipSelection');
    const animationDiv = document.getElementById('coinFlipAnimation');
    const winnerDiv = document.getElementById('coinFlipWinner');
    const buttonsDiv = document.getElementById('coinFlipButtons');
    const statusDiv = document.getElementById('coinFlipStatus');
    
    // Reset display
    if (selectionDiv) selectionDiv.classList.remove('hidden');
    if (animationDiv) animationDiv.classList.add('hidden');
    if (winnerDiv) winnerDiv.classList.add('hidden');
    if (buttonsDiv) buttonsDiv.classList.remove('hidden');
    
    // Update player names
    const player1Name = document.getElementById('coinFlipPlayer1Name');
    const player2Name = document.getElementById('coinFlipPlayer2Name');
    const player1Choice = document.getElementById('coinFlipPlayer1Choice');
    const player2Choice = document.getElementById('coinFlipPlayer2Choice');
    
    if (data.isTeamMode) {
        if (player1Name) player1Name.innerHTML = 'Team 1 <small style="display: block; font-size: 0.7rem; color: var(--text-secondary);">(Team Leader)</small>';
        if (player2Name) player2Name.innerHTML = 'Team 2 <small style="display: block; font-size: 0.7rem; color: var(--text-secondary);">(Team Leader)</small>';
    } else {
        if (player1Name) player1Name.textContent = data.player1?.username || 'Player 1';
        if (player2Name) player2Name.textContent = data.player2?.username || 'Player 2';
    }
    
    if (player1Choice) {
        player1Choice.textContent = 'Waiting...';
        player1Choice.className = 'player-choice';
    }
    if (player2Choice) {
        player2Choice.textContent = 'Waiting...';
        player2Choice.className = 'player-choice';
    }
    
    // Check if current user is a participant (only team leaders can choose)
    const isPlayer1 = data.player1?.id === mySocketId;
    const isPlayer2 = data.player2?.id === mySocketId;
    const isParticipant = isPlayer1 || isPlayer2;
    
    if (buttonsDiv) {
        if (isParticipant) {
            buttonsDiv.style.display = 'flex';
        } else {
            buttonsDiv.style.display = 'none';
        }
    }
    
    if (statusDiv) {
        if (isParticipant) {
            statusDiv.innerHTML = data.isTeamMode 
                ? '<strong>You are the Team Leader!</strong><br>Choose Heads or Tails. The opposing team will automatically get the other side.' 
                : '<strong>Choose Heads or Tails</strong><br>Your opponent will automatically get the other side.';
        } else {
            statusDiv.textContent = data.isTeamMode ? 'Waiting for Team Leaders to choose...' : 'Waiting for players to choose...';
        }
    }
    
    showModal('coinFlipModal');
}

function selectCoinSide(side) {
    if (hasSelectedCoinSide) return;
    if (!coinFlipData) return;
    if (!currentRoom) return;
    
    hasSelectedCoinSide = true;
    
    // Disable buttons immediately
    const buttons = document.querySelectorAll('.coin-btn');
    buttons.forEach(btn => btn.disabled = true);
    
    const statusDiv = document.getElementById('coinFlipStatus');
    const isTeamMode = coinFlipData.isTeamMode;
    if (statusDiv) {
        statusDiv.textContent = isTeamMode 
            ? `You chose ${side}! Opposing team gets the other side automatically...` 
            : `You chose ${side}! Opponent gets the other side automatically...`;
    }
    
    socket.emit('selectCoinSide', {
        roomId: currentRoom.roomId,
        side: side
    });
}

function updateCoinFlipSelection(data) {
    const player1Choice = document.getElementById('coinFlipPlayer1Choice');
    const player2Choice = document.getElementById('coinFlipPlayer2Choice');
    const player1Div = document.getElementById('coinFlipPlayer1');
    const player2Div = document.getElementById('coinFlipPlayer2');
    const statusDiv = document.getElementById('coinFlipStatus');
    
    // Update both players' choices at once
    if (data.player1Choice && player1Choice) {
        player1Choice.textContent = data.player1Choice === 'heads' ? 'Heads' : 'Tails';
        player1Choice.className = `player-choice ${data.player1Choice}`;
        if (player1Div) player1Div.classList.add('chosen');
    }
    
    if (data.player2Choice && player2Choice) {
        player2Choice.textContent = data.player2Choice === 'heads' ? 'Heads' : 'Tails';
        player2Choice.className = `player-choice ${data.player2Choice}`;
        if (player2Div) player2Div.classList.add('chosen');
    }
    
    if (statusDiv && coinFlipData) {
        const p1Chosen = player1Div?.classList.contains('chosen');
        const p2Chosen = player2Div?.classList.contains('chosen');
        const isTeamMode = coinFlipData.isTeamMode;
        
        if (p1Chosen && p2Chosen) {
            statusDiv.textContent = isTeamMode ? 'Both Team Leaders chose! Flipping coin...' : 'Both players chose! Flipping coin...';
        }
    }
}

function showCoinFlipResult(data) {
    const selectionDiv = document.getElementById('coinFlipSelection');
    const animationDiv = document.getElementById('coinFlipAnimation');
    const winnerDiv = document.getElementById('coinFlipWinner');
    const resultDiv = document.getElementById('coinFlipResult');
    const counterDisplay = document.getElementById('coinCounterDisplay');
    
    if (selectionDiv) selectionDiv.classList.add('hidden');
    if (animationDiv) animationDiv.classList.remove('hidden');
    if (winnerDiv) winnerDiv.classList.add('hidden');
    if (resultDiv) resultDiv.textContent = '';
    
    // Countdown sequence: 3, 2, 1, then HEADS/TAILS
    const countdownNumbers = ['3', '2', '1'];
    let currentIndex = 0;
    
    function showNextCount() {
        if (currentIndex < countdownNumbers.length) {
            // Show countdown number with animation
            if (counterDisplay) {
                counterDisplay.classList.remove('counting', 'result');
                counterDisplay.textContent = countdownNumbers[currentIndex];
                // Force reflow to restart animation
                void counterDisplay.offsetWidth;
                counterDisplay.classList.add('counting');
            }
            currentIndex++;
            setTimeout(showNextCount, 1500); // 1.5 seconds between each number (slower)
        } else {
            // Show HEADS or TAILS result with slow reveal animation
            if (counterDisplay) {
                counterDisplay.classList.remove('counting');
                const resultText = data.result === 'heads' ? 'HEADS' : 'TAILS';
                counterDisplay.textContent = resultText;
                // Force reflow to restart animation
                void counterDisplay.offsetWidth;
                counterDisplay.classList.add('result');
            }
            
            if (resultDiv) {
                const resultText = data.result === 'heads' ? 'HEADS!' : 'TAILS!';
                resultDiv.textContent = resultText;
            }
            
            // Show winner after a delay
            setTimeout(() => {
                if (winnerDiv) {
                    winnerDiv.classList.remove('hidden');
                    const winnerText = document.getElementById('coinFlipWinnerText');
                    if (winnerText) {
                        const isTeamMode = coinFlipData?.isTeamMode;
                        if (isTeamMode) {
                            const winnerTeam = data.winner.team === 'team1' ? 'Team 1' : 'Team 2';
                            winnerText.textContent = `${winnerTeam} wins!`;
                        } else {
                            winnerText.textContent = `${data.winner.username} wins!`;
                        }
                    }
                }
                
                // Highlight winner
                const player1Div = document.getElementById('coinFlipPlayer1');
                const player2Div = document.getElementById('coinFlipPlayer2');
                
                if (player1Div && player2Div) {
                    if (data.winner.id === coinFlipData?.player1?.id) {
                        player1Div.classList.add('winner');
                    } else {
                        player2Div.classList.add('winner');
                    }
                }
            }, 2000);
        }
    }

    showNextCount();
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

    // Show the question modal instead of directly requesting
    const questionInput = document.getElementById('questionInput');
    if (questionInput) {
        questionInput.value = '';
    }
    showModal('askQuestionModal');
}

function submitQuestion() {
    const questionInput = document.getElementById('questionInput');
    const question = questionInput.value.trim();

    if (!question) {
        showNotification('Please enter a question', 'error');
        return;
    }

    if (!checkServerAndShowError()) return;

    // Disable the ask hint button while waiting for response
    const askHintBtn = document.getElementById('askHintBtn');
    if (askHintBtn) {
        askHintBtn.disabled = true;
        askHintBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Waiting for host...';
    }

    hideModal('askQuestionModal');

    socket.emit('requestHint', {
        roomId: currentRoom.roomId,
        question: question
    });
}

function showHintRequestModal(requesterName, question) {
    const modal = document.getElementById('hintRequestModal');
    const message = document.getElementById('hintRequestPlayer');
    const questionLabel = document.getElementById('playerQuestionLabel');
    const questionText = document.getElementById('playerQuestionText');
    const hintInput = document.getElementById('hintInput');

    if (message) {
        message.textContent = `${requesterName} has requested a hint!`;
    }

    if (questionLabel) {
        questionLabel.textContent = `${requesterName}'s Question:`;
    }

    if (questionText) {
        questionText.textContent = question || 'No question provided';
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

function displayReceivedHint(hint, hintNumber, question) {
    const receivedHints = document.getElementById('receivedHints');
    const hintsList = document.getElementById('hintsList');

    receivedHints.classList.remove('hidden');

    const hintItem = document.createElement('div');
    hintItem.className = 'hint-item';
    hintItem.innerHTML = `
        <div class="hint-header">
            <span class="hint-number">Hint #${hintNumber}</span>
        </div>
        ${question ? `<div class="hint-question"><strong>Q:</strong> ${escapeHtml(question)}</div>` : ''}
        <div class="hint-answer"><strong>A:</strong> ${escapeHtml(hint)}</div>
    `;

    hintsList.appendChild(hintItem);

    // Scroll to the new hint
    hintsList.scrollTop = hintsList.scrollHeight;
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
// COUNTDOWN
// ═══════════════════════════════════════════════════════════════════════

function showCountdown(callback) {
    // Create countdown overlay
    const overlay = document.createElement('div');
    overlay.id = 'countdownOverlay';
    overlay.className = 'countdown-overlay';
    overlay.innerHTML = `
        <div class="countdown-container">
            <div class="countdown-number" id="countdownNumber">3</div>
        </div>
    `;

    document.body.appendChild(overlay);

    const numberEl = document.getElementById('countdownNumber');
    let count = 3;

    const countdownInterval = setInterval(() => {
        count--;

        if (count > 0) {
            numberEl.textContent = count;
            numberEl.classList.remove('animate');
            void numberEl.offsetWidth; // Trigger reflow
            numberEl.classList.add('animate');
        } else if (count === 0) {
            numberEl.textContent = 'GO!';
            numberEl.classList.add('go');
        } else {
            clearInterval(countdownInterval);
            overlay.style.opacity = '0';
            setTimeout(() => {
                overlay.remove();
                if (callback) callback();
            }, 300);
        }
    }, 1000);

    // Initial animation
    setTimeout(() => {
        numberEl.classList.add('animate');
    }, 100);
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
        const adminBadge = player.isAdmin ? ' <span style="color: var(--warning); font-size: 0.7rem;">[ADMIN]</span>' : '';

        scoreItem.innerHTML = `
            <div class="score-player">
                ${buildAvatarHTML(avatarSrc, player.username, 30)}
                <span class="score-player-name">${escapeHtml(player.username)}${adminBadge}${isWordSetterPlayer ? ' 📝' : ''}</span>
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

    // Check for admin commands
    if (isAdmin() && message.startsWith('/')) {
        const handled = handleAdminCommand(message);
        if (handled) {
            input.value = '';
            return;
        }
    }

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

    // Check for admin commands
    if (isAdmin() && message.startsWith('/')) {
        const handled = handleAdminCommand(message);
        if (handled) {
            input.value = '';
            return;
        }
    }

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

    // Admin Panel Button
    const adminPanelBtn = document.getElementById('adminPanelBtn');
    if (adminPanelBtn) {
        adminPanelBtn.addEventListener('click', () => {
            showAdminPanel();
        });
    }

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

    // Ask Question modal handlers
    const askQuestionForm = document.getElementById('askQuestionForm');
    if (askQuestionForm) {
        askQuestionForm.addEventListener('submit', (e) => {
            e.preventDefault();
            submitQuestion();
        });
    }

    const cancelAskQuestionBtn = document.getElementById('cancelAskQuestion');
    if (cancelAskQuestionBtn) {
        cancelAskQuestionBtn.addEventListener('click', () => {
            hideModal('askQuestionModal');
        });
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
        // Admin panel shortcut (Ctrl+Shift+A)
        if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'a') {
            e.preventDefault();
            if (isAdmin()) {
                const existingPanel = document.getElementById('adminPanel');
                if (existingPanel) {
                    closeAdminPanel();
                } else {
                    showAdminPanel();
                }
            }
            return;
        }

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