// User Database Display with Ban Support
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
        const banStatus = isBanned ? 
            (user.isPermanent ? 'PERMANENT' : 'BANNED') : 
            'Active';
        const banColor = isBanned ? 'var(--error)' : 'var(--success)';
        const banReason = isBanned ? user.banReason || 'No reason' : '';
        
        return `
        <div class="user-db-item" style="background: var(--bg-secondary); padding: 15px; margin: 10px 0; border-radius: 8px; border-left: 4px solid ${isBanned ? 'var(--error)' : 'var(--primary)'};">
            <div style="display: flex; justify-content: space-between; align-items: start;">
                <div style="flex: 1;">
                    <strong>${user.username}</strong> ${user.hasAvatar ? '🖼️' : ''} 
                    <span style="font-size: 0.75rem; margin-left: 5px; color: ${banColor};">${banStatus}</span><br>
                    <small style="color: var(--text-secondary);">
                        Wins: ${user.stats.wins} | Losses: ${user.stats.losses} | Games: ${user.stats.gamesPlayed}<br>
                        ${isBanned ? `Reason: ${banReason}<br>` : ''}
                        First Login: ${new Date(user.firstLogin).toLocaleDateString()}
                    </small>
                </div>
                <div style="display: flex; gap: 5px; flex-wrap: wrap;">
                    ${isBanned ? 
                        `<button onclick="unbanUserFromDB('${user.username}')" class="btn btn-success" style="padding: 5px 10px; font-size: 0.8rem;"><i class="fas fa-unlock"></i></button>` :
                        `<button onclick="showBanUserModal('${user.username}')" class="btn btn-warning" style="padding: 5px 10px; font-size: 0.8rem;"><i class="fas fa-ban"></i></button>`
                    }
                    <button onclick="showEditUserStatsModal('${user.username}', ${user.stats.wins}, ${user.stats.losses}, ${user.stats.gamesPlayed})" class="btn btn-primary" style="padding: 5px 10px; font-size: 0.8rem;"><i class="fas fa-edit"></i></button>
                    <button onclick="deleteUserFromDatabase('${user.username}')" class="btn btn-danger" style="padding: 5px 10px; font-size: 0.8rem;"><i class="fas fa-trash"></i></button>
                </div>
            </div>
        </div>
    `}).join('');

    modal.innerHTML = `
        <div class="modal-content" style="max-width: 700px; max-height: 80vh; overflow-y: auto;">
            <div class="modal-icon"><i class="fas fa-database"></i></div>
            <h2>User Database (${total} users)</h2>
            <div style="max-height: 500px; overflow-y: auto; margin: 20px 0;">${usersHtml}</div>
            <div class="modal-actions">
                <button type="button" class="btn btn-secondary" onclick="hideModal('adminUserDatabaseModal')">Close</button>
                <button type="button" class="btn btn-info" onclick="socket.emit('adminReloadUserDatabase')">Reload</button>
                <button type="button" class="btn btn-primary" onclick="socket.emit('adminGetUserDatabase')">Refresh</button>
            </div>
        </div>
    `;

    document.body.appendChild(modal);
    showModal('adminUserDatabaseModal');
}