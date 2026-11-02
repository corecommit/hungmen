require('dotenv').config();
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const { execSync } = require('child_process');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

function getEnvironmentCommit() {
    const commit =
        process.env.RENDER_GIT_COMMIT ||
        process.env.VERCEL_GIT_COMMIT_SHA ||
        process.env.GITHUB_SHA ||
        process.env.COMMIT_SHA ||
        process.env.GIT_COMMIT ||
        '';
    return commit.trim();
}

function getBuildInfo() {
    const environmentCommit = getEnvironmentCommit();
    try {
        let commitHash = environmentCommit ? environmentCommit.slice(0, 7) : null;

        if (!commitHash) {
            try {
                commitHash = execSync('git rev-parse --short HEAD', {
                    encoding: 'utf8',
                    cwd: __dirname,
                    stdio: ['pipe', 'pipe', 'ignore']
                }).trim();
            } catch (e) {
                commitHash = null;
            }
        }

        if (!commitHash || commitHash === 'unknown') {
            return {
                version: process.env.npm_package_version || '1.0.0',
                commit: 'unknown',
                date: new Date().toISOString(),
                branch: process.env.RENDER_GIT_BRANCH || 'main',
                buildNumber: 'unknown'
            };
        }

        let commitDate;
        try {
            commitDate = execSync('git log -1 --format=%cd --date=iso', {
                encoding: 'utf8',
                cwd: __dirname,
                stdio: ['pipe', 'pipe', 'ignore']
            }).trim();
        } catch (e) {
            commitDate = new Date().toISOString();
        }

        let branch;
        try {
            branch = execSync('git rev-parse --abbrev-ref HEAD', {
                encoding: 'utf8',
                cwd: __dirname,
                stdio: ['pipe', 'pipe', 'ignore']
            }).trim();
        } catch (e) {
            branch = 'main';
        }

        return {
            version: process.env.npm_package_version || '1.0.0',
            commit: environmentCommit || commitHash,
            date: commitDate || new Date().toISOString(),
            branch: process.env.RENDER_GIT_BRANCH || branch || 'main',
            buildNumber: commitHash
        };
    } catch (error) {
        return {
            version: process.env.npm_package_version || '1.0.0',
            commit: 'unknown',
            date: new Date().toISOString(),
            branch: process.env.RENDER_GIT_BRANCH || 'main',
            buildNumber: 'unknown'
        };
    }
}

const buildInfo = getBuildInfo();

async function getGitHubBuildInfo() {
    try {
        const githubUsername = 'corecommit';
        const repoName = 'hungmen';
        const branch = 'main';
        
        const response = await fetch(`https://api.github.com/repos/${githubUsername}/${repoName}/commits/${branch}`);
        
        if (!response.ok) {
            throw new Error('Failed to fetch from GitHub');
        }
        
        const commit = await response.json();
        const shortSha = commit.sha.substring(0, 7);
        
        return {
            version: process.env.npm_package_version || '1.0.0',
            commit: commit.sha,
            date: commit.commit.committer.date,
            branch: branch,
            buildNumber: shortSha,
            author: commit.commit.author.name,
            message: commit.commit.message.split('\n')[0]
        };
    } catch (error) {
        console.log('GitHub API fetch failed, using local build info:', error.message);
        return buildInfo;
    }
}

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));


const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || '';
const DEBUG = process.env.DEBUG === 'true' || false;

const log = {
    info: (msg, ...args) => DEBUG && console.log(msg, ...args),
    error: (msg, ...args) => console.error(msg, ...args),
    warn: (msg, ...args) => console.warn(msg, ...args)
};

const db = SUPABASE_URL && SUPABASE_SERVICE_KEY
    ? createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
        auth: { persistSession: false, autoRefreshToken: false }
      })
    : null;

let supabaseReady = false;

async function connectToSupabase() {
    if (!db) {
        log.error('[SUPABASE] SUPABASE_URL / SUPABASE_SERVICE_KEY not set - using in-memory storage (data will be lost on restart)');
        return false;
    }
    try {
        const { error } = await db.from('users').select('username').limit(1);
        if (error) throw error;
        supabaseReady = true;
        log.info('[SUPABASE] Connected to Supabase successfully!');
        return true;
    } catch (error) {
        supabaseReady = false;
        log.error('[SUPABASE] Connection check failed:', error.message);
        log.error('[SUPABASE] Falling back to in-memory storage (data will be lost on restart)');
        return false;
    }
}

function usingSupabase() {
    return supabaseReady && !!db;
}

function mapRow(row) {
    if (!row) return null;
    return {
        username: row.username,
        displayName: row.display_name || row.username,
        firstLogin: row.first_login,
        lastLogin: row.last_login,
        stats: {
            wins: row.wins || 0,
            losses: row.losses || 0,
            gamesPlayed: row.games_played || 0
        },
        avatar: row.avatar || null,
        totalPlayTime: row.total_play_time || 0,
        serverBan: !!row.server_ban,
        serverBanExpiry: row.server_ban_expiry || null,
        serverBanDuration: row.server_ban_duration || null,
        serverBanReason: row.server_ban_reason || null
    };
}

connectToSupabase();

let rooms = new Map();
let onlineUsers = new Map();
let lobbyMessages = [];
let inMemoryUsers = new Map();


let maintenanceMode = false;
let maintenanceMessage = 'Website is under maintenance. Please try again later.';

function isMaintenanceMode() {
    return maintenanceMode;
}

function setMaintenanceMode(enabled, message = null) {
    maintenanceMode = enabled;
    if (message) {
        maintenanceMessage = message;
    }
    log.info(`[MAINTENANCE] Maintenance mode ${enabled ? 'ENABLED' : 'DISABLED'}`);
    if (enabled) {
        log.info(`[MAINTENANCE] Message: ${maintenanceMessage}`);
    }
    return maintenanceMode;
}

function getMaintenanceMessage() {
    return maintenanceMessage;
}


function makeMemUser(username) {
    return {
        username: username.toLowerCase(),
        displayName: username,
        stats: { wins: 0, losses: 0, gamesPlayed: 0 },
        avatar: null,
        totalPlayTime: 0,
        serverBan: false,
        serverBanExpiry: null,
        serverBanDuration: null,
        serverBanReason: null,
        lastLogin: new Date(),
        firstLogin: new Date()
    };
}

async function getUserData(username) {
    const key = username.toLowerCase();
    try {
        if (!usingSupabase()) { throw new Error('Supabase unavailable'); }

        let { data: row, error } = await db.from('users').select('*').eq('username', key).maybeSingle();

        if (error) throw error;

        if (!row) {
            const { data: inserted, error: insertError } = await db.from('users')
                .upsert({ username: key, display_name: username, last_login: new Date().toISOString() }, { onConflict: 'username' })
                .select()
                .maybeSingle();
            if (insertError) throw insertError;
            return mapRow(inserted);
        }

        await db.from('users').update({ last_login: new Date().toISOString() }).eq('username', key);

        return mapRow(row);
    } catch (error) {
        console.error('[SUPABASE] Error in getUserData:', error.message);
        if (inMemoryUsers.has(key)) {
            const memUser = inMemoryUsers.get(key);
            memUser.lastLogin = new Date();
            return memUser;
        }

        const newMemUser = makeMemUser(username);
        inMemoryUsers.set(key, newMemUser);
        return newMemUser;
    }
}

async function reloadUserDatabaseFromFile() {
    log.info('[SUPABASE] Reload not needed - data is always current');
    return true;
}


const fs = require('fs');
const BACKUP_DIR = path.join(__dirname, 'backups');

function ensureBackupDir() {
    if (!fs.existsSync(BACKUP_DIR)) {
        fs.mkdirSync(BACKUP_DIR, { recursive: true });
        log.info('[BACKUP] Created backup directory');
    }
}

async function createDatabaseBackup() {
    try {
        ensureBackupDir();
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const backupFile = path.join(BACKUP_DIR, `user_database_backup_${timestamp}.json`);

        const { data: rows, error } = await db.from('users').select('*');
        if (error) throw error;
        const backupData = (rows || []).map(row => ({
            username: row.username,
            displayName: row.display_name,
            firstLogin: row.first_login,
            lastLogin: row.last_login,
            stats: { wins: row.wins, losses: row.losses, gamesPlayed: row.games_played },
            avatar: row.avatar,
            totalPlayTime: row.total_play_time,
            serverBan: row.server_ban,
            serverBanExpiry: row.server_ban_expiry,
            serverBanDuration: row.server_ban_duration,
            serverBanReason: row.server_ban_reason
        }));

        fs.writeFileSync(backupFile, JSON.stringify(backupData, null, 2));
        log.info(`[BACKUP] Database backup created: ${backupFile}`);
        return { success: true, file: backupFile, timestamp: timestamp };
    } catch (error) {
        console.error('[BACKUP] Error creating backup:', error);
        return { success: false, error: error.message };
    }
}

function getBackupList() {
    try {
        ensureBackupDir();
        const files = fs.readdirSync(BACKUP_DIR);
        const backups = files
            .filter(f => f.startsWith('user_database_backup_') && f.endsWith('.json'))
            .map(f => {
                const stat = fs.statSync(path.join(BACKUP_DIR, f));
                return {
                    filename: f,
                    created: stat.mtime,
                    size: stat.size
                };
            })
            .sort((a, b) => b.created - a.created);
        return backups;
    } catch (error) {
        console.error('[BACKUP] Error listing backups:', error);
        return [];
    }
}

async function restoreFromBackup(filename) {
    try {
        const backupPath = path.join(BACKUP_DIR, filename);
        if (!fs.existsSync(backupPath)) {
            return { success: false, message: 'Backup file not found' };
        }

        await createDatabaseBackup();

        const data = fs.readFileSync(backupPath, 'utf8');
        const backupData = JSON.parse(data);

        const { error: deleteError } = await db.from('users').delete().neq('username', '__impossible__');
        if (deleteError) throw deleteError;

        const rows = backupData.map(u => ({
            username: (u.username || '').toLowerCase(),
            display_name: u.displayName || u.username,
            first_login: u.firstLogin || new Date().toISOString(),
            last_login: u.lastLogin || new Date().toISOString(),
            wins: u.stats?.wins || 0,
            losses: u.stats?.losses || 0,
            games_played: u.stats?.gamesPlayed || 0,
            avatar: u.avatar || null,
            total_play_time: u.totalPlayTime || 0,
            server_ban: !!u.serverBan,
            server_ban_expiry: u.serverBanExpiry || null,
            server_ban_duration: u.serverBanDuration || null,
            server_ban_reason: u.serverBanReason || null
        })).filter(r => r.username);

        if (rows.length > 0) {
            const { error: insertError } = await db.from('users').upsert(rows, { onConflict: 'username' });
            if (insertError) throw insertError;
        }

        log.info(`[BACKUP] Database restored from: ${filename}`);
        return { success: true, message: `Database restored from ${filename}`, userCount: rows.length };
    } catch (error) {
        console.error('[BACKUP] Error restoring backup:', error);
        return { success: false, error: error.message };
    }
}

function deleteBackup(filename) {
    try {
        const backupPath = path.join(BACKUP_DIR, filename);
        if (!fs.existsSync(backupPath)) {
            return { success: false, message: 'Backup file not found' };
        }
        
        fs.unlinkSync(backupPath);
        log.info(`[BACKUP] Deleted backup: ${filename}`);
        return { success: true, message: `Backup ${filename} deleted` };
    } catch (error) {
        console.error('[BACKUP] Error deleting backup:', error);
        return { success: false, message: error.message };
    }
}

async function isUserBanned(username) {
    const key = username.toLowerCase();
    try {
        if (!usingSupabase()) { throw new Error('Supabase unavailable'); }
        const { data: row, error } = await db.from('users')
            .select('username, server_ban, server_ban_expiry, server_ban_reason')
            .eq('username', key)
            .maybeSingle();
        if (error) throw error;

        const memUser = inMemoryUsers.get(key);
        const userData = row || memUser;

        if (!userData) return { banned: false };

        const banned = row ? row.server_ban : userData.serverBan;
        const expiry = row ? row.server_ban_expiry : userData.serverBanExpiry;
        const reason = row ? row.server_ban_reason : userData.serverBanReason;

        if (!banned) return { banned: false };

        if (expiry) {
            const expiryDate = new Date(expiry);
            if (expiryDate <= new Date()) {
                if (row) {
                    await db.from('users').update({
                        server_ban: false,
                        server_ban_expiry: null,
                        server_ban_duration: null,
                        server_ban_reason: null
                    }).eq('username', key);
                }
                if (memUser) {
                    memUser.serverBan = false;
                    memUser.serverBanExpiry = null;
                    memUser.serverBanDuration = null;
                    memUser.serverBanReason = null;
                }
                return { banned: false };
            }
            return { banned: true, expiry: expiry, reason: reason, isPermanent: false };
        }

        return { banned: true, expiry: null, reason: reason, isPermanent: true };
    } catch (error) {
        console.error('[SUPABASE] Error in isUserBanned:', error.message);
        const memUser = inMemoryUsers.get(key);
        if (memUser && memUser.serverBan) {
            if (memUser.serverBanExpiry && new Date(memUser.serverBanExpiry) > new Date()) {
                return { banned: true, expiry: memUser.serverBanExpiry, reason: memUser.serverBanReason, isPermanent: false };
            } else if (!memUser.serverBanExpiry) {
                return { banned: true, expiry: null, reason: memUser.serverBanReason, isPermanent: true };
            }
        }
        return { banned: false };
    }
}

async function banUser(username, durationHours, reason) {
    const key = username.toLowerCase();

    const isPermanent = !durationHours || parseInt(durationHours) === 0;
    const expiryISO = isPermanent ? null : new Date(Date.now() + parseInt(durationHours) * 3600000).toISOString();

    try {
        if (!usingSupabase()) { throw new Error('Supabase unavailable'); }
        const { error } = await db.from('users').upsert({
            username: key,
            display_name: username,
            server_ban: true,
            server_ban_expiry: expiryISO,
            server_ban_duration: isPermanent ? 'permanent' : `${durationHours}h`,
            server_ban_reason: reason || 'Banned by admin'
        }, { onConflict: 'username' });
        if (error) throw error;
        return true;
    } catch (error) {
        console.error('[SUPABASE] Error in banUser:', error.message);
        const memUser = inMemoryUsers.get(key) || makeMemUser(username);
        memUser.serverBan = true;
        memUser.serverBanExpiry = isPermanent ? null : new Date(Date.now() + parseInt(durationHours) * 3600000);
        memUser.serverBanDuration = isPermanent ? 'permanent' : `${durationHours}h`;
        memUser.serverBanReason = reason || 'Banned by admin';
        inMemoryUsers.set(key, memUser);
        return true;
    }
}

async function updateUserStats(username, result) {
    const key = username.toLowerCase();
    let newStats = null;
    try {
        if (!usingSupabase()) { throw new Error('Supabase unavailable'); }
        const { error } = await db.rpc('increment_stats', { p_username: key, p_result: result });
        if (error) throw error;

        const { data: row, error: selectError } = await db.from('users')
            .select('wins, losses, games_played').eq('username', key).maybeSingle();
        if (selectError) throw selectError;
        if (row) {
            newStats = { wins: row.wins, losses: row.losses, gamesPlayed: row.games_played };
        }
    } catch (error) {
        console.error('[SUPABASE] Error in updateUserStats:', error.message);
        const memUser = inMemoryUsers.get(key);
        if (memUser) {
            memUser.stats.gamesPlayed++;
            if (result === 'win') memUser.stats.wins++;
            else if (result === 'loss') memUser.stats.losses++;
            newStats = { ...memUser.stats };
        }
    }

    if (newStats) {
        broadcastStatsUpdate(key, newStats);
    }
}

function broadcastStatsUpdate(key, newStats) {
    for (const onlineUser of onlineUsers.values()) {
        if (onlineUser.username.toLowerCase() === key) {
            onlineUser.stats = { ...newStats };
            break;
        }
    }
    const onlineUsersList = Array.from(onlineUsers.values()).map(u => ({
        username: u.username,
        stats: u.stats || { wins: 0, losses: 0, gamesPlayed: 0 },
        avatar: u.avatar,
        isAdmin: u.isAdmin || false
    })).sort((a, b) => (b.stats.wins || 0) - (a.stats.wins || 0));
    io.emit('onlineUsersUpdate', { users: onlineUsersList });
}

async function setUserStats(username, stats) {
    const key = username.toLowerCase();
    const normalized = {
        wins: parseInt(stats.wins) || 0,
        losses: parseInt(stats.losses) || 0,
        games_played: parseInt(stats.gamesPlayed) || 0
    };
    try {
        if (!usingSupabase()) { throw new Error('Supabase unavailable'); }
        const { error } = await db.from('users').upsert({
            username: key,
            display_name: username,
            wins: normalized.wins,
            losses: normalized.losses,
            games_played: normalized.games_played
        }, { onConflict: 'username' });
        if (error) throw error;
        return true;
    } catch (error) {
        console.error('[SUPABASE] Error in setUserStats:', error.message);
        const memUser = inMemoryUsers.get(key);
        if (memUser) {
            memUser.stats = {
                wins: normalized.wins,
                losses: normalized.losses,
                gamesPlayed: normalized.games_played
            };
            return true;
        }
        return false;
    }
}

async function reloadUserStats(username) {
    const key = username.toLowerCase();
    try {
        if (!usingSupabase()) { throw new Error('Supabase unavailable'); }
        const { data: row, error } = await db.from('users')
            .select('wins, losses, games_played').eq('username', key).maybeSingle();
        if (error) throw error;
        if (row) return { wins: row.wins, losses: row.losses, gamesPlayed: row.games_played };

        const memUser = inMemoryUsers.get(key);
        if (memUser) return memUser.stats;
        return null;
    } catch (error) {
        console.error('[SUPABASE] Error in reloadUserStats:', error.message);
        const memUser = inMemoryUsers.get(key);
        if (memUser) return memUser.stats;
        return null;
    }
}

async function updateUserAvatar(username, avatarData) {
    const key = username.toLowerCase();
    try {
        if (!usingSupabase()) { throw new Error('Supabase unavailable'); }

        let avatarValue = avatarData;

        if (avatarData && typeof avatarData === 'string' && avatarData.startsWith('data:image')) {
            try {
                const base64 = avatarData.split(',')[1];
                const buffer = Buffer.from(base64, 'base64');
                const filePath = `${key}/${Date.now()}.jpg`;

                const { error: uploadError } = await db.storage
                    .from('avatars')
                    .upload(filePath, buffer, { contentType: 'image/jpeg', upsert: true });
                if (uploadError) throw uploadError;

                const { data: urlData } = db.storage.from('avatars').getPublicUrl(filePath);
                if (urlData && urlData.publicUrl) {
                    avatarValue = urlData.publicUrl;
                }
            } catch (storageError) {
                console.error('[SUPABASE] Avatar upload to Storage failed, storing inline:', storageError.message);
            }
        }

        const { error } = await db.from('users').upsert({
            username: key,
            display_name: username,
            avatar: avatarValue
        }, { onConflict: 'username' });
        if (error) throw error;
        return;
    } catch (error) {
        console.error('[SUPABASE] Error in updateUserAvatar:', error.message);
        const memUser = inMemoryUsers.get(key);
        if (memUser) memUser.avatar = avatarData;
    }
}

async function deleteUser(username) {
    const key = username.toLowerCase();
    try {
        if (!usingSupabase()) { throw new Error('Supabase unavailable'); }
        console.log(`[SUPABASE DELETE] Attempting to delete user: ${username}`);

        const { data, error } = await db.from('users').delete().eq('username', key).select('username');
        if (error) throw error;

        const deleted = Array.isArray(data) && data.length > 0;
        if (deleted) {
            console.log(`[SUPABASE DELETE] Successfully deleted user: ${username}`);
        }

        inMemoryUsers.delete(key);

        if (deleted) return true;

        if (inMemoryUsers.has(key)) {
            console.log(`[SUPABASE DELETE] Deleted from in-memory: ${username}`);
            return true;
        }

        console.log(`[SUPABASE DELETE] User not found: ${username}`);
        return false;
    } catch (error) {
        console.error('[SUPABASE] Error in deleteUser:', error.message);
        if (inMemoryUsers.has(key)) {
            inMemoryUsers.delete(key);
            return true;
        }
        return false;
    }
}

async function deleteAllUsers() {
    try {
        if (!usingSupabase()) { throw new Error('Supabase unavailable'); }
        const { error } = await db.from('users').delete().neq('username', '__impossible__');
        if (error) throw error;
        inMemoryUsers.clear();
        log.info('[SUPABASE] All users deleted');
        return true;
    } catch (error) {
        console.error('[SUPABASE] Error in deleteAllUsers:', error.message);
        inMemoryUsers.clear();
        return false;
    }
}

async function transferUserData(oldUsername, newUsername) {
    const oldKey = oldUsername.toLowerCase();
    const newKey = newUsername.toLowerCase();

    try {
        if (!usingSupabase()) { throw new Error('Supabase unavailable'); }
        log.info(`[TRANSFER] Transferring data from ${oldUsername} to ${newUsername}`);

        let { data: oldRow, error: oldError } = await db.from('users').select('*').eq('username', oldKey).maybeSingle();
        if (oldError) throw oldError;

        const oldMem = !oldRow ? inMemoryUsers.get(oldKey) : null;
        if (!oldRow && !oldMem) {
            log.info(`[TRANSFER] No data to transfer - old user ${oldUsername} not found`);
            return { success: true, message: 'No existing data to transfer' };
        }

        const { data: newRow, error: newError } = await db.from('users').select('*').eq('username', newKey).maybeSingle();
        if (newError) throw newError;

        const carryOver = oldRow ? {
            wins: oldRow.wins, losses: oldRow.losses, games_played: oldRow.games_played,
            avatar: oldRow.avatar, total_play_time: oldRow.total_play_time,
            server_ban: oldRow.server_ban, server_ban_expiry: oldRow.server_ban_expiry,
            server_ban_duration: oldRow.server_ban_duration, server_ban_reason: oldRow.server_ban_reason,
            first_login: oldRow.first_login
        } : {
            wins: oldMem.stats.wins, losses: oldMem.stats.losses, games_played: oldMem.stats.gamesPlayed,
            avatar: oldMem.avatar, total_play_time: oldMem.totalPlayTime,
            server_ban: oldMem.serverBan, server_ban_expiry: oldMem.serverBanExpiry,
            server_ban_duration: oldMem.serverBanDuration, server_ban_reason: oldMem.serverBanReason,
            first_login: oldMem.firstLogin
        };

        if (newRow) {
            const { error: updateError } = await db.from('users')
                .update({ ...carryOver, display_name: newUsername, last_login: new Date().toISOString() })
                .eq('username', newKey);
            if (updateError) throw updateError;

            if (oldRow) {
                const { error: delError } = await db.from('users').delete().eq('username', oldKey);
                if (delError) throw delError;
            }
            inMemoryUsers.delete(oldKey);

            log.info(`[TRANSFER] Data transferred and old user ${oldUsername} deleted`);
            return { success: true, message: 'Data transferred successfully' };
        }

        if (oldRow) {
            const { error: renameError } = await db.from('users')
                .update({ username: newKey, display_name: newUsername })
                .eq('username', oldKey);
            if (renameError) throw renameError;
        } else {
            inMemoryUsers.delete(oldKey);
            const renamed = { ...oldMem, username: newKey, displayName: newUsername };
            inMemoryUsers.set(newKey, renamed);
        }

        log.info(`[TRANSFER] User renamed successfully`);
        return { success: true, message: 'User renamed successfully' };
    } catch (error) {
        console.error('[TRANSFER] Error:', error.message);

        if (inMemoryUsers.has(oldKey)) {
            const oldUser = inMemoryUsers.get(oldKey);
            if (inMemoryUsers.has(newKey)) {
                const newUser = inMemoryUsers.get(newKey);
                newUser.stats = oldUser.stats;
                newUser.avatar = oldUser.avatar;
                newUser.totalPlayTime = oldUser.totalPlayTime;
                newUser.serverBan = oldUser.serverBan;
                newUser.serverBanExpiry = oldUser.serverBanExpiry;
                newUser.serverBanReason = oldUser.serverBanReason;
                newUser.firstLogin = oldUser.firstLogin;
            } else {
                oldUser.username = newKey;
                oldUser.displayName = newUsername;
            }
            inMemoryUsers.delete(oldKey);
            return { success: true, message: 'Data transferred (in-memory)' };
        }

        return { success: false, message: error.message };
    }
}

async function getAllUsersInDatabase() {
    const toAdminEntry = (key, displayName, firstLogin, lastLogin, stats, hasAvatar, isBanned, isPermanent, banExpiry, banReason) => ({
        key: key,
        username: displayName,
        firstLogin: firstLogin,
        lastLogin: lastLogin,
        stats: stats,
        hasAvatar: hasAvatar,
        banned: isBanned,
        isPermanent: isPermanent,
        banExpiry: banExpiry,
        banReason: banReason
    });

    try {
        if (!usingSupabase()) { throw new Error('Supabase unavailable'); }
        const { data: rows, error } = await db.from('users').select('*').order('last_login', { ascending: false });
        if (error) throw error;

        const dbUsers = (rows || []).map(row => {
            const isBanned = !!(row.server_ban && (!row.server_ban_expiry || new Date(row.server_ban_expiry) > new Date()));
            return toAdminEntry(
                row.username,
                row.display_name || row.username,
                row.first_login,
                row.last_login,
                { wins: row.wins, losses: row.losses, gamesPlayed: row.games_played },
                !!row.avatar,
                isBanned,
                isBanned ? !row.server_ban_expiry : false,
                isBanned ? row.server_ban_expiry : null,
                isBanned ? row.server_ban_reason : null
            );
        });

        const memUsers = Array.from(inMemoryUsers.values())
            .filter(mem => !dbUsers.some(u => u.key === mem.username))
            .map(user => {
                const isBanned = !!(user.serverBan && (!user.serverBanExpiry || new Date(user.serverBanExpiry) > new Date()));
                return toAdminEntry(
                    user.username,
                    user.displayName,
                    user.firstLogin,
                    user.lastLogin,
                    user.stats,
                    !!user.avatar,
                    isBanned,
                    isBanned ? !user.serverBanExpiry : false,
                    isBanned ? user.serverBanExpiry : null,
                    isBanned ? user.serverBanReason : null
                );
            });

        return [...dbUsers, ...memUsers];
    } catch (error) {
        console.error('[SUPABASE] Error getting all users:', error.message);
        return Array.from(inMemoryUsers.values()).map(user => {
            const isBanned = !!(user.serverBan && (!user.serverBanExpiry || new Date(user.serverBanExpiry) > new Date()));
            return toAdminEntry(
                user.username,
                user.displayName,
                user.firstLogin,
                user.lastLogin,
                user.stats,
                !!user.avatar,
                isBanned,
                isBanned ? !user.serverBanExpiry : false,
                isBanned ? user.serverBanExpiry : null,
                isBanned ? user.serverBanReason : null
            );
        });
    }
}

const wordDatabase = {
    easy: [
        { word: 'CAT', hint: 'A common household pet that meows' },
        { word: 'DOG', hint: 'Man\'s best friend' },
        { word: 'SUN', hint: 'The star at the center of our solar system' },
        { word: 'BOOK', hint: 'You read this' },
        { word: 'TREE', hint: 'It has leaves and branches' },
        { word: 'FISH', hint: 'Lives in water and swims' },
        { word: 'MOON', hint: 'Earth\'s natural satellite' },
        { word: 'CAKE', hint: 'Sweet dessert for celebrations' },
        { word: 'BALL', hint: 'Round object used in many sports' },
        { word: 'BIRD', hint: 'Creature that can fly' },
        { word: 'DOOR', hint: 'You open this to enter a room' },
        { word: 'MILK', hint: 'White drink from cows' },
        { word: 'RAIN', hint: 'Water falling from clouds' },
        { word: 'FIRE', hint: 'Hot flames that burn' },
        { word: 'DESK', hint: 'Furniture for working' },
        { word: 'APPLE', hint: 'A round fruit, often red or green' },
        { word: 'BREAD', hint: 'Baked from dough, used for sandwiches' },
        { word: 'CHAIR', hint: 'You sit on it' },
        { word: 'CLOCK', hint: 'Shows the time' },
        { word: 'CLOUD', hint: 'White fluffy shape in the sky' },
        { word: 'DUCK', hint: 'Waddling bird that quacks' },
        { word: 'EGG', hint: 'Laid by hens, great for breakfast' },
        { word: 'FROG', hint: 'Green jumper that croaks' },
        { word: 'GOAT', hint: 'Farm animal with horns that loves climbing' },
        { word: 'HAND', hint: 'It has five fingers' },
        { word: 'HORSE', hint: 'You can ride this animal' },
        { word: 'HOUSE', hint: 'A place where people live' },
        { word: 'JUICE', hint: 'Drink squeezed from fruit' },
        { word: 'KITE', hint: 'Flies on a string in the wind' },
        { word: 'LAMP', hint: 'Gives light in a room' },
        { word: 'LEAF', hint: 'Green part of a plant that grows on branches' },
        { word: 'LION', hint: 'Big cat known as king of the jungle' },
        { word: 'NOSE', hint: 'You smell with it' },
        { word: 'PIZZA', hint: 'Round Italian dish with cheese on top' },
        { word: 'PLANE', hint: 'It flies passengers across the sky' },
        { word: 'RIVER', hint: 'Long stream of flowing water' },
        { word: 'SHOE', hint: 'You wear it on your foot' },
        { word: 'SNAKE', hint: 'Long reptile with no legs' },
        { word: 'SOCK', hint: 'Worn on your foot inside a shoe' },
        { word: 'STAR', hint: 'Twinkles in the night sky' },
        { word: 'TABLE', hint: 'Flat surface on legs for meals' },
        { word: 'TRAIN', hint: 'Runs on rails with many carriages' },
        { word: 'WATER', hint: 'Clear liquid you drink every day' },
        { word: 'WIND', hint: 'Moving air you can feel but not see' },
        { word: 'BEAR', hint: 'Large furry animal that hibernates' },
        { word: 'BOAT', hint: 'Floats and carries people across water' },
        { word: 'CORN', hint: 'Yellow kernels on a cob' },
        { word: 'CUP', hint: 'Holds your tea or coffee' },
        { word: 'FARM', hint: 'Place where crops and animals are raised' },
        { word: 'FORK', hint: 'Eating tool with prongs' },
        { word: 'GIFT', hint: 'Present wrapped for a birthday' },
        { word: 'HAT', hint: 'Worn on your head' },
        { word: 'KEY', hint: 'Unlocks a door' },
        { word: 'MAP', hint: 'Shows where places are' },
        { word: 'NEST', hint: 'A bird\'s home made of twigs' },
        { word: 'OWL', hint: 'Night bird with big eyes that hoots' },
        { word: 'PEN', hint: 'Writing tool with ink' },
        { word: 'PIG', hint: 'Pink farm animal that oinks' },
        { word: 'RING', hint: 'Jewelry worn on a finger' },
        { word: 'SAND', hint: 'Found on beaches and in deserts' },
        { word: 'SOUP', hint: 'Hot liquid meal eaten with a spoon' },
        { word: 'SPOON', hint: 'Used to stir or eat soup' },
        { word: 'TOWEL', hint: 'You dry yourself with it' },
        { word: 'WHEEL', hint: 'Round part that helps a car roll' },
        { word: 'ZEBRA', hint: 'Striped animal from Africa' },
        { word: 'SHEEP', hint: 'Woolly farm animal' },
        { word: 'SNOW', hint: 'Cold white flakes that fall in winter' },
        { word: 'SHIRT', hint: 'Clothing worn on your upper body' },
        { word: 'PENCIL', hint: 'Writing tool you can erase' },
        { word: 'BEACH', hint: 'Sandy place next to the sea' },
        { word: 'CANDY', hint: 'Sweet treat for kids' },
        { word: 'GRASS', hint: 'Green stuff that covers lawns' },
        { word: 'HONEY', hint: 'Sweet golden food made by bees' },
        { word: 'LEMON', hint: 'Sour yellow fruit' },
        { word: 'MOUSE', hint: 'Tiny rodent that squeaks' },
        { word: 'PAPER', hint: 'You write or print on it' },
        { word: 'QUEEN', hint: 'Female ruler of a kingdom' },
        { word: 'ROBOT', hint: 'Machine that can be programmed to move' },
        { word: 'SMILE', hint: 'Happy curve on your face' },
        { word: 'TIGER', hint: 'Striped big cat' },
        { word: 'WORM', hint: 'Wriggly creature found in soil' }
    ],

    medium: [
        { word: 'PYTHON', hint: 'A popular programming language' },
        { word: 'OCEAN', hint: 'Large body of salt water' },
        { word: 'GUITAR', hint: 'Musical instrument with strings' },
        { word: 'ROCKET', hint: 'Vehicle for space travel' },
        { word: 'CASTLE', hint: 'Medieval fortress home' },
        { word: 'DIAMOND', hint: 'Precious gemstone' },
        { word: 'PUZZLE', hint: 'Game that tests your brain' },
        { word: 'ISLAND', hint: 'Land surrounded by water' },
        { word: 'BRIDGE', hint: 'Structure to cross over water' },
        { word: 'GARDEN', hint: 'Area for growing plants' },
        { word: 'BICYCLE', hint: 'Two-wheeled ride powered by pedals' },
        { word: 'BLANKET', hint: 'Keeps you warm in bed' },
        { word: 'CAMERA', hint: 'Used to take photographs' },
        { word: 'CANDLE', hint: 'Wax stick that burns with a flame' },
        { word: 'COMPASS', hint: 'Points the way north' },
        { word: 'DRAGON', hint: 'Mythical fire-breathing creature' },
        { word: 'ELEPHANT', hint: 'Largest land animal with a trunk' },
        { word: 'FOREST', hint: 'Large area full of trees' },
        { word: 'GALAXY', hint: 'Huge system of stars like the Milky Way' },
        { word: 'HAMMER', hint: 'Tool for hitting nails' },
        { word: 'JUNGLE', hint: 'Dense tropical rainforest' },
        { word: 'KITCHEN', hint: 'Room where food is cooked' },
        { word: 'LANTERN', hint: 'Portable light you can carry' },
        { word: 'LIBRARY', hint: 'Building full of books to borrow' },
        { word: 'MAGNET', hint: 'Attracts iron and steel' },
        { word: 'MIRROR', hint: 'Reflects your image' },
        { word: 'MONKEY', hint: 'Playful primate that climbs trees' },
        { word: 'MOUNTAIN', hint: 'Very high landform with a peak' },
        { word: 'NOTEBOOK', hint: 'Bound pages for writing notes' },
        { word: 'PENGUIN', hint: 'Flightless bird that lives in cold places' },
        { word: 'PLANET', hint: 'Orbits a star, like Earth or Mars' },
        { word: 'PUMPKIN', hint: 'Orange vegetable carved at Halloween' },
        { word: 'RAINBOW', hint: 'Colorful arc after the rain' },
        { word: 'SANDWICH', hint: 'Filling between two slices of bread' },
        { word: 'SCISSORS', hint: 'Cut paper with these' },
        { word: 'THUNDER', hint: 'Loud rumble after lightning' },
        { word: 'TORNADO', hint: 'Spinning funnel of destructive wind' },
        { word: 'TREASURE', hint: 'Hidden riches pirates search for' },
        { word: 'UMBRELLA', hint: 'Keeps you dry in the rain' },
        { word: 'VIOLIN', hint: 'String instrument played with a bow' },
        { word: 'WINDOW', hint: 'Glass opening in a wall' },
        { word: 'WIZARD', hint: 'Magical person with a staff and hat' },
        { word: 'YOGURT', hint: 'Creamy dairy food made by fermenting milk' },
        { word: 'BALLOON', hint: 'Inflated rubber toy that floats at parties' },
        { word: 'CACTUS', hint: 'Prickly plant that lives in the desert' },
        { word: 'DOLPHIN', hint: 'Intelligent sea mammal that clicks and whistles' },
        { word: 'FEATHER', hint: 'Light part of a bird\'s wing' },
        { word: 'GIRAFFE', hint: 'Tallest animal with a very long neck' },
        { word: 'HELMET', hint: 'Protects your head while riding' },
        { word: 'LADDER', hint: 'Climb it to reach high places' },
        { word: 'LOBSTER', hint: 'Sea creature with big claws' },
        { word: 'MARKET', hint: 'Place to buy fresh food from stalls' },
        { word: 'OXYGEN', hint: 'Gas we breathe to stay alive' },
        { word: 'PARROT', hint: 'Colorful bird that can mimic speech' },
        { word: 'POCKET', hint: 'Small pouch sewn into clothing' },
        { word: 'SHADOW', hint: 'Dark shape made when light is blocked' },
        { word: 'TICKET', hint: 'Gets you into a movie or train' },
        { word: 'TUNNEL', hint: 'Passage dug through a hill or under a river' },
        { word: 'VILLAGE', hint: 'Small community smaller than a town' },
        { word: 'WALLET', hint: 'Holds your cash and cards' },
        { word: 'ANCHOR', hint: 'Heavy hook that keeps a ship in place' },
        { word: 'BASKET', hint: 'Woven container for carrying things' },
        { word: 'CIRCUS', hint: 'Show with clowns, acrobats and tents' },
        { word: 'DESERT', hint: 'Dry land with very little rain' },
        { word: 'ENGINE', hint: 'Makes a car or machine run' },
        { word: 'FOSSIL', hint: 'Ancient remains preserved in rock' },
        { word: 'GLACIER', hint: 'Slow-moving river of ice' },
        { word: 'HARBOR', hint: 'Sheltered place where ships dock' },
        { word: 'JOURNEY', hint: 'A long trip from one place to another' },
        { word: 'KEYBOARD', hint: 'Used to type on a computer' },
        { word: 'LEGEND', hint: 'Famous old story passed down through generations' },
        { word: 'MUSEUM', hint: 'Place that displays art and history' },
        { word: 'NEBULA', hint: 'Giant cloud of dust and gas in space' },
        { word: 'BUTTON', hint: 'Pressed to turn something on or sewn on a shirt' },
        { word: 'CHEESE', hint: 'Dairy food that can be melted or sliced' },
        { word: 'COOKIE', hint: 'Small sweet baked treat' },
        { word: 'FARMER', hint: 'Grows crops and raises animals' },
        { word: 'KETCHUP', hint: 'Red sauce for fries' },
        { word: 'SPIDER', hint: 'Eight-legged creature that spins webs' },
        { word: 'TURTLE', hint: 'Reptile that carries its home on its back' }
    ],

    hard: [
        { word: 'JAVASCRIPT', hint: 'Language of the web' },
        { word: 'ALGORITHM', hint: 'Step-by-step problem solving' },
        { word: 'ASTRONOMY', hint: 'Study of celestial objects' },
        { word: 'DINOSAUR', hint: 'Extinct prehistoric reptile' },
        { word: 'ECLIPSE', hint: 'When one celestial body blocks another' },
        { word: 'KANGAROO', hint: 'Australian marsupial that hops' },
        { word: 'VOLCANO', hint: 'Mountain that erupts lava' },
        { word: 'HURRICANE', hint: 'Powerful tropical storm' },
        { word: 'PYRAMID', hint: 'Ancient Egyptian tomb structure' },
        { word: 'SATELLITE', hint: 'Object orbiting a planet' },
        { word: 'ARCHAEOLOGY', hint: 'Study of human history through digging up artifacts' },
        { word: 'AQUARIUM', hint: 'Place where fish are kept for display' },
        { word: 'ARCHIPELAGO', hint: 'A chain or cluster of islands' },
        { word: 'AVALANCHE', hint: 'Mass of snow sliding down a mountain' },
        { word: 'BLIZZARD', hint: 'Severe snowstorm with strong winds' },
        { word: 'BOOMERANG', hint: 'Curved throwing tool that returns to you' },
        { word: 'CAPPUCCINO', hint: 'Italian coffee with frothy milk foam' },
        { word: 'CATERPILLAR', hint: 'Larva that becomes a butterfly' },
        { word: 'CHAMELEON', hint: 'Lizard that changes color' },
        { word: 'CHRONOMETER', hint: 'Very precise instrument for measuring time' },
        { word: 'CROCODILE', hint: 'Large reptile with powerful jaws living in rivers' },
        { word: 'CRYPTOGRAPHY', hint: 'The art of writing and solving codes' },
        { word: 'DANDELION', hint: 'Yellow weed that turns into a puffball' },
        { word: 'DEMOCRACY', hint: 'Government where citizens vote' },
        { word: 'ECOSYSTEM', hint: 'Community of living things and their environment' },
        { word: 'ENCYCLOPEDIA', hint: 'Reference work covering knowledge on many subjects' },
        { word: 'EQUILIBRIUM', hint: 'State of balance' },
        { word: 'ESPIONAGE', hint: 'The practice of spying' },
        { word: 'EXPEDITION', hint: 'Organized journey for exploration' },
        { word: 'FLAMINGO', hint: 'Pink bird that stands on one leg' },
        { word: 'FLUORESCENT', hint: 'Glowing under certain light, like some tubes' },
        { word: 'HEMISPHERE', hint: 'Half of a sphere, like half of Earth' },
        { word: 'HIEROGLYPHICS', hint: 'Ancient Egyptian picture writing' },
        { word: 'HORIZON', hint: 'Line where the sky meets the earth' },
        { word: 'HYPOTHESIS', hint: 'An educated guess to be tested' },
        { word: 'IMAGINATION', hint: 'Ability to picture things that are not real' },
        { word: 'INFRASTRUCTURE', hint: 'Roads, bridges and power networks of a country' },
        { word: 'ISTHMUS', hint: 'Narrow strip of land connecting two larger areas' },
        { word: 'JELLYFISH', hint: 'Transparent sea creature with stinging tentacles' },
        { word: 'JUXTAPOSITION', hint: 'Placing two things side by side for contrast' },
        { word: 'KALEIDOSCOPE', hint: 'Tube that makes changing colorful patterns' },
        { word: 'KNOWLEDGE', hint: 'What you gain through learning' },
        { word: 'LABYRINTH', hint: 'Complicated maze' },
        { word: 'LIGHTHOUSE', hint: 'Tower that guides ships with a beam' },
        { word: 'MAGNETISM', hint: 'Force that attracts iron' },
        { word: 'METAMORPHOSIS', hint: 'Dramatic change in form, like a tadpole becoming a frog' },
        { word: 'MICROSCOPE', hint: 'Lets you see tiny things up close' },
        { word: 'MYSTERIOUS', hint: 'Hard to explain or understand' },
        { word: 'NIGHTINGALE', hint: 'Small bird famous for its song at night' },
        { word: 'NOSTALGIA', hint: 'Sentimental longing for the past' },
        { word: 'OBSERVATORY', hint: 'Building with telescopes for watching the sky' },
        { word: 'OCTOPUS', hint: 'Sea creature with eight arms' },
        { word: 'PARACHUTE', hint: 'Slows a skydiver\'s fall' },
        { word: 'PHILOSOPHY', hint: 'Study of fundamental questions about existence' },
        { word: 'PHOTOSYNTHESIS', hint: 'How plants turn light into food' },
        { word: 'QUESTIONNAIRE', hint: 'Set of written questions for a survey' },
        { word: 'REFRIGERATOR', hint: 'Kitchen appliance that keeps food cold' },
        { word: 'RENAISSANCE', hint: 'European rebirth of art and learning' },
        { word: 'RHINOCEROS', hint: 'Large horned animal with thick skin' },
        { word: 'SCAFFOLDING', hint: 'Temporary frame used by builders' },
        { word: 'STALACTITE', hint: 'Cave formation hanging from the ceiling' },
        { word: 'SYMPHONY', hint: 'Long piece of music for a full orchestra' },
        { word: 'TARANTULA', hint: 'Large hairy spider' },
        { word: 'TEMPERATURE', hint: 'How hot or cold something is' },
        { word: 'THERMOMETER', hint: 'Measures how warm it is' },
        { word: 'TSUNAMI', hint: 'Giant wave caused by an undersea earthquake' },
        { word: 'UKULELE', hint: 'Small four-stringed Hawaiian instrument' },
        { word: 'UNIVERSE', hint: 'Everything that exists, including space' },
        { word: 'VAGABOND', hint: 'Person who wanders with no fixed home' },
        { word: 'VOCABULARY', hint: 'All the words a person knows' },
        { word: 'WATERFALL', hint: 'Water dropping from a cliff' },
        { word: 'WHIRLPOOL', hint: 'Spinning current of water' },
        { word: 'XYLOPHONE', hint: 'Instrument played with mallets on wooden bars' },
        { word: 'ZEPPELIN', hint: 'Large rigid airship' },
        { word: 'BUREAUCRACY', hint: 'System with lots of rules and paperwork' },
        { word: 'CORNUCOPIA', hint: 'Horn of plenty overflowing with food' },
        { word: 'ORCHESTRA', hint: 'Large group of musicians playing together' },
        { word: 'SUBMARINE', hint: 'Vessel that travels underwater' },
        { word: 'TELESCOPE', hint: 'Used to look at distant stars' },
        { word: 'BUTTERFLY', hint: 'Colorful insect with delicate wings' },
        { word: 'LABORATORY', hint: 'Place where scientists run experiments' },
        { word: 'PINEAPPLE', hint: 'Spiky tropical fruit with a leafy crown' },
        { word: 'SKYSCRAPER', hint: 'Extremely tall city building' },
        { word: 'ASTRONAUT', hint: 'Person trained to travel in space' },
        { word: 'MARATHON', hint: 'Very long running race of about 42 kilometers' }
    ]
};

app.get('/api/rooms', (req, res) => {
    const roomList = Array.from(rooms.values()).map(room => ({
        id: room.id,
        name: room.name,
        mode: room.mode,
        players: room.players.length,
        maxPlayers: room.maxPlayers,
        status: room.status,
        hasPassword: !!room.password
    }));
    res.json(roomList);
});

app.get('/api/build', async (req, res) => {
    try {
        if (buildInfo.commit && buildInfo.commit !== 'unknown') {
            res.json(buildInfo);
            return;
        }
        const githubBuildInfo = await getGitHubBuildInfo();
        res.json(githubBuildInfo);
    } catch (error) {
        res.json(buildInfo);
    }
});

function isUsernameTaken(username) {
    for (const user of onlineUsers.values()) {
        if (user.username.toLowerCase() === username.toLowerCase()) {
            return true;
        }
    }
    return false;
}

function isRoomNameTaken(name) {
    const normalizedName = name.toLowerCase().trim();
    for (const room of rooms.values()) {
        if (room.name.toLowerCase().trim() === normalizedName) {
            return true;
        }
    }
    return false;
}

class Room {
    constructor(id, name, mode, maxPlayers, password = null, hostId) {
        this.id = id;
        this.name = name;
        this.mode = mode;
        this.maxPlayers = maxPlayers;
        this.password = password;
        this.hostId = hostId;
        this.players = [];
        this.status = 'waiting';
        this.gameState = null;
        this.messages = [];
        this.teams = { team1: [], team2: [] };
        this.selectedGameMode = 'medium';
        this.selectedHintCount = 5;
    }

    addPlayer(player) {
        if (this.players.length >= this.maxPlayers) {
            return false;
        }
        this.players.push(player);
        
        if (this.mode !== 'solo' && this.mode !== '1v1') {
            const team1Count = this.teams.team1.length;
            const team2Count = this.teams.team2.length;
            
            if (team1Count <= team2Count) {
                this.teams.team1.push(player.id);
                player.team = 'team1';
            } else {
                this.teams.team2.push(player.id);
                player.team = 'team2';
            }
        } else {
            player.team = null;
        }
        
        return true;
    }

    removePlayer(playerId) {
        this.players = this.players.filter(p => p.id !== playerId);
        this.teams.team1 = this.teams.team1.filter(id => id !== playerId);
        this.teams.team2 = this.teams.team2.filter(id => id !== playerId);
        
        if (this.players.length === 0) {
            rooms.delete(this.id);
        } else {
            if (this.hostId === playerId) {
                this.hostId = this.players[0].id;
            }

            if (this.status === 'playing' || this.status === 'coin_flip' || this.status === 'word_selection') {
                const needsBothSides = this.mode !== 'solo';

                if (this.players.length < (needsBothSides ? 2 : 1)) {
                    this.gameState = null;
                    this.status = 'waiting';
                } else if (this.gameState && this.gameState.isCustomWord) {
                    if (this.gameState.wordSetter === playerId) {
                        this.gameState = null;
                        this.status = 'waiting';
                    }
                }
            }
        }
    }

    getMaxPlayersPerTeam() {
        return this.maxPlayers / 2;
    }

    isTeamFull(team) {
        const maxPerTeam = this.getMaxPlayersPerTeam();
        if (team === 'team1') {
            return this.teams.team1.length >= maxPerTeam;
        } else if (team === 'team2') {
            return this.teams.team2.length >= maxPerTeam;
        }
        return false;
    }

    changeTeam(playerId, team) {
        if (this.isTeamFull(team)) {
            return { error: 'Team is full', player: null };
        }
        
        this.teams.team1 = this.teams.team1.filter(id => id !== playerId);
        this.teams.team2 = this.teams.team2.filter(id => id !== playerId);
        
        const player = this.players.find(p => p.id === playerId);
        if (player) {
            player.team = team;
            if (team === 'team1') {
                this.teams.team1.push(playerId);
            } else if (team === 'team2') {
                this.teams.team2.push(playerId);
            }
        }
        
        return { error: null, player: player };
    }

    startGame(gameMode = 'medium', hintCount = 5) {
        if (this.mode === 'solo') {
            const wordData = this.getRandomWord(gameMode);
            this.gameState = {
                word: wordData.word,
                hint: wordData.hint,
                guessedLetters: [],
                wrongLetters: [],
                currentTurn: 0,
                status: 'playing',
                gameMode: gameMode,
                scores: {},
                isCustomWord: false,
                hintsRemaining: 0,
                hints: [],
                wordSetter: null
            };
            
            this.players.forEach(player => {
                this.gameState.scores[player.id] = 0;
            });
            
            this.status = 'playing';
        } else if (gameMode === 'custom') {
            const isTeamMode = this.mode !== 'solo' && this.mode !== '1v1';
            
            this.gameState = {
                word: null,
                hint: null,
                guessedLetters: [],
                wrongLetters: [],
                currentTurn: 0,
                status: 'coin_flip',
                gameMode: gameMode,
                scores: {},
                isCustomWord: true,
                hintsRemaining: hintCount,
                hints: [],
                wordSetter: null,
                wordSetterTeam: null,
                hintCount: hintCount,
                isTeamMode: isTeamMode,
                coinFlip: {
                    player1Choice: null,
                    player2Choice: null,
                    player1Id: null,
                    player2Id: null,
                    result: null,
                    winner: null
                }
            };
            
            this.players.forEach(player => {
                this.gameState.scores[player.id] = 0;
            });
            
            this.status = 'coin_flip';
        } else {
            const wordData = this.getRandomWord(gameMode);
            this.gameState = {
                word: wordData.word,
                hint: wordData.hint,
                guessedLetters: [],
                wrongLetters: [],
                currentTurn: 0,
                status: 'playing',
                gameMode: gameMode,
                scores: {},
                isCustomWord: false,
                hintsRemaining: 0,
                hints: [],
                wordSetter: null
            };
            
            this.players.forEach(player => {
                this.gameState.scores[player.id] = 0;
            });
            
            this.status = 'playing';
        }
    }

    setCustomWord(wordData) {
        if (!this.gameState || this.gameState.status !== 'word_selection') {
            return false;
        }

        this.gameState.word = wordData.word.toUpperCase();
        this.gameState.status = 'playing';
        this.status = 'playing';
        
        this.gameState.currentTurn = this.getFirstValidTurn();
        
        return true;
    }

    getFirstValidTurn() {
        if (!this.gameState.isCustomWord) {
            return 0;
        }
        
        if (this.gameState.wordSetterTeam) {
            for (let i = 0; i < this.players.length; i++) {
                if (this.players[i].team !== this.gameState.wordSetterTeam) {
                    return i;
                }
            }
        } else {
            for (let i = 0; i < this.players.length; i++) {
                if (this.players[i].id !== this.gameState.wordSetter) {
                    return i;
                }
            }
        }
        
        return 0;
    }

    requestHint(playerId) {
        if (!this.gameState || this.gameState.hintsRemaining <= 0) {
            return { success: false, message: 'No hints available' };
        }

        if (this.gameState.wordSetterTeam) {
            const player = this.players.find(p => p.id === playerId);
            if (player && player.team === this.gameState.wordSetterTeam) {
                return { success: false, message: 'Your team is setting the word — you cannot request hints!' };
            }
        } else if (this.gameState.isCustomWord && this.gameState.wordSetter === playerId) {
            return { success: false, message: 'You are the word setter — you cannot request hints!' };
        }

        return {
            success: true,
            requesterId: playerId
        };
    }

    provideHint(hint, providerId) {
        if (!this.gameState) {
            return { success: false, message: 'Game not found' };
        }

        if (this.gameState.isCustomWord && providerId !== this.gameState.wordSetter) {
            return { success: false, message: 'Only the word setter can provide hints' };
        }

        if (typeof hint !== 'string' || hint.trim().length === 0) {
            return { success: false, message: 'Hint cannot be empty' };
        }

        this.gameState.hintsRemaining--;
        this.gameState.hints.push(hint.trim());

        return {
            success: true,
            hint: hint,
            hintNumber: this.gameState.hints.length,
            hintsRemaining: this.gameState.hintsRemaining
        };
    }

    getRandomWord(gameMode) {
        const words = wordDatabase[gameMode] || wordDatabase['medium'];
        return words[Math.floor(Math.random() * words.length)];
    }

    getMaskedWord() {
        if (!this.gameState || !this.gameState.word) return [];
        return this.gameState.word.split('').map(letter =>
            this.gameState.guessedLetters.includes(letter) ? letter : null
        );
    }

    checkGuess(letter) {
        if (typeof letter !== 'string' || !/^[A-Z]$/.test(letter)) {
            return { valid: false };
        }

        if (this.gameState.guessedLetters.includes(letter) || 
            this.gameState.wrongLetters.includes(letter)) {
            return { valid: false };
        }

        const isCorrect = this.gameState.word.includes(letter);
        
        if (isCorrect) {
            this.gameState.guessedLetters.push(letter);
        } else {
            this.gameState.wrongLetters.push(letter);
        }

        const wordLetters = [...new Set(this.gameState.word.split(''))];
        const isWin = wordLetters.every(l => this.gameState.guessedLetters.includes(l));
        const isLose = this.gameState.wrongLetters.length >= 6;

        return {
            valid: true,
            isCorrect,
            isWin,
            isLose,
            letter,
            word: this.gameState.word
        };
    }
    
    getNextTurn() {
        let nextTurn = (this.gameState.currentTurn + 1) % this.players.length;
        
        if (this.gameState.isCustomWord) {
            let attempts = 0;
            const maxAttempts = this.players.length;
            
            while (attempts < maxAttempts) {
                const currentPlayer = this.players[nextTurn];
                
                if (this.gameState.wordSetterTeam) {
                    if (currentPlayer && currentPlayer.team !== this.gameState.wordSetterTeam) {
                        return nextTurn;
                    }
                } else {
                    if (currentPlayer && currentPlayer.id !== this.gameState.wordSetter) {
                        return nextTurn;
                    }
                }
                
                nextTurn = (nextTurn + 1) % this.players.length;
                attempts++;
            }
            
            console.error('Could not find valid next turn - no players available to guess');
            return 0;
        }
        
        return nextTurn;
    }

    canPlayerGuess(playerId) {
        if (!this.gameState || !this.gameState.isCustomWord) {
            return true;
        }

        const player = this.players.find(p => p.id === playerId);
        if (!player) {
            return false;
        }

        if (this.gameState.wordSetterTeam) {
            if (player.team === this.gameState.wordSetterTeam) {
                return false;
            }
        } else {
            if (playerId === this.gameState.wordSetter) {
                return false;
            }
        }

        return true;
    }

    isPlayerTurn(playerId) {
        if (!this.gameState) {
            return false;
        }

        const currentPlayer = this.players[this.gameState.currentTurn];
        return currentPlayer && currentPlayer.id === playerId;
    }
}

io.on('connection', (socket) => {
    log.info('New connection:', socket.id);

    const safeOn = (event, handler) => {
        socket.on(event, async (data) => {
            try {
                await handler(data);
            } catch (err) {
                console.error(`[SOCKET] Error in '${event}' handler:`, err.message);
                try {
                    socket.emit('serverError', { message: 'Invalid request' });
                } catch (_) {  }
            }
        });
    };

    safeOn('authenticate', async (data) => {
        const { username, adminPassword } = data || {};
        
        if (!username || username.trim().length === 0) {
            socket.emit('authError', { message: 'Username is required' });
            return;
        }
        
        const trimmedUsername = username.trim();
        const lowerUsername = trimmedUsername.toLowerCase();
        
        if (trimmedUsername === '/help') {
            socket.emit('authError', { 
                message: '📋 Available Commands:\n• /help - Show this message\n• EveryoneLogout - Logout all users (admin only)\n• AdminLogout - Logout only admins (admin only)',
                isHelp: true 
            });
            return;
        }

        if (lowerUsername === 'everyonelogout') {
            const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'Admin@007';
            
            if (!adminPassword || adminPassword !== ADMIN_PASSWORD) {
                socket.emit('authError', { message: 'Admin password required for this command' });
                return;
            }
            
            log.info(`[ADMIN COMMAND] EveryoneLogout executed by admin`);
            
            const sockets = await io.fetchSockets();
            sockets.forEach(s => {
                s.emit('forceLogout', { message: '🚨 You have been logged out by the server' });
                s.disconnect(true);
            });
            
            onlineUsers.clear();
            
            socket.emit('authError', { message: '✓ Everyone has been logged out successfully' });
            setTimeout(() => {
                socket.disconnect(true);
            }, 100);
            return;
        }

        if (lowerUsername === 'adminlogout') {
            const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'Admin@007';
            
            if (!adminPassword || adminPassword !== ADMIN_PASSWORD) {
                socket.emit('authError', { message: 'Admin password required for this command' });
                return;
            }
            
            log.info(`[ADMIN COMMAND] AdminLogout executed by admin`);
            
            let adminCount = 0;
            const sockets = await io.fetchSockets();
            
            for (const [socketId, userData] of onlineUsers.entries()) {
                if (userData.isAdmin) {
                    const adminSocket = sockets.find(s => s.id === socketId);
                    if (adminSocket) {
                        adminSocket.emit('forceLogout', { message: '👤 You have been logged out by an admin' });
                        adminSocket.disconnect(true);
                        adminCount++;
                    }
                    onlineUsers.delete(socketId);
                }
            }
            
            log.info(`[ADMIN COMMAND] Logged out ${adminCount} admin(s)`);
            
            socket.emit('authError', { message: `✓ ${adminCount} admin account(s) logged out successfully` });
            setTimeout(() => {
                socket.disconnect(true);
            }, 100);
            return;
        }

        if (lowerUsername !== 'admin' && lowerUsername.includes('admin')) {
            socket.emit('authError', { message: '❌ The username "admin" is reserved. You cannot use variations like admin67, admin69, etc.' });
            return;
        }

        const isAdminLogin = lowerUsername === 'admin';
        if (isMaintenanceMode() && !isAdminLogin) {
            socket.emit('authError', { 
                message: getMaintenanceMessage(),
                maintenance: true 
            });
            return;
        }
        
        log.info(`[AUTH] Checking ban status for: ${trimmedUsername}`);
        const banStatus = await isUserBanned(trimmedUsername);
        log.info(`[AUTH] Ban status for ${trimmedUsername}:`, banStatus);
        if (banStatus.banned) {
            log.info(`[AUTH] REJECTING banned user: ${trimmedUsername}`);
            if (banStatus.isPermanent) {
                socket.emit('authError', { 
                    message: `You are permanently banned from the server. Reason: ${banStatus.reason || 'No reason provided'}`,
                    banned: true,
                    permanent: true
                });
            } else {
                const expiryDate = new Date(banStatus.expiry);
                socket.emit('authError', { 
                    message: `You are banned from the server until ${expiryDate.toLocaleString()}. Reason: ${banStatus.reason || 'No reason provided'}`,
                    banned: true,
                    permanent: false,
                    expiry: banStatus.expiry
                });
            }
            return;
        }
        log.info(`[AUTH] User ${trimmedUsername} is not banned, proceeding with authentication`);
        
        if (trimmedUsername.toLowerCase() === 'admin') {
            const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'Admin@007';
            
            if (!adminPassword || adminPassword !== ADMIN_PASSWORD) {
                socket.emit('authError', { message: 'Password needed to login in the admin account' });
                return;
            }
            
            for (const user of onlineUsers.values()) {
                if (user.username.toLowerCase() === 'admin') {
                    socket.emit('authError', { message: 'Admin account is already in use' });
                    return;
                }
            }
        }
        
        if (isUsernameTaken(username)) {
            socket.emit('authError', { message: 'Username is already taken' });
            return;
        }
        
        const finalUsername = isAdminLogin ? 'Admin' : trimmedUsername;
        
        const userData = await getUserData(finalUsername);
        
        onlineUsers.set(socket.id, {
            id: socket.id,
            username: finalUsername,
            room: null,
            isAdmin: isAdminLogin,
            stats: userData.stats,
            avatar: userData.avatar
        });
        
        socket.emit('authenticated', { 
            success: true, 
            user: { 
                id: socket.id, 
                username: finalUsername,
                isAdmin: isAdminLogin,
                stats: userData.stats,
                avatar: userData.avatar
            } 
        });
        
        io.emit('onlineCount', onlineUsers.size);
        
        const onlineUsersList = Array.from(onlineUsers.values()).map(user => ({
            username: user.username,
            stats: user.stats || { wins: 0, losses: 0, gamesPlayed: 0 },
            avatar: user.avatar,
            isAdmin: user.isAdmin || false
        })).sort((a, b) => (b.stats.wins || 0) - (a.stats.wins || 0));
        io.emit('onlineUsersUpdate', { users: onlineUsersList });
        
        socket.emit('lobbyChatUpdate', { messages: lobbyMessages });
    });
    
    socket.on('getGlobalUsers', async () => {
        const users = await getAllUsersInDatabase();
        const globalUsersList = users.map(user => ({
            username: user.username,
            stats: user.stats || { wins: 0, losses: 0, gamesPlayed: 0 },
            avatar: user.avatar,
            isAdmin: user.username.toLowerCase() === 'admin'
        })).sort((a, b) => (b.stats.wins || 0) - (a.stats.wins || 0));
        
        socket.emit('globalUsersUpdate', { users: globalUsersList });
    });

    safeOn('changeUsername', async (data) => {
        const { newUsername } = data;
        const user = onlineUsers.get(socket.id);
        
        if (!user) {
            socket.emit('usernameChangeError', { message: 'User not found' });
            return;
        }
        
        if (user.isAdmin || user.username.toLowerCase() === 'admin') {
            socket.emit('usernameChangeError', { message: 'Admin users cannot change their username' });
            return;
        }
        
        if (!newUsername || newUsername.trim().length === 0) {
            socket.emit('usernameChangeError', { message: 'Username is required' });
            return;
        }
        
        const trimmedUsername = newUsername.trim();
        
        if (trimmedUsername.toLowerCase() === 'admin') {
            socket.emit('usernameChangeError', { message: 'This username is reserved and cannot be used' });
            return;
        }

        const reservedCommands = ['everyonelogout', 'adminlogout', '/help'];
        if (reservedCommands.includes(trimmedUsername.toLowerCase())) {
            socket.emit('usernameChangeError', { message: 'This username is reserved for system commands' });
            return;
        }

        if (trimmedUsername.toLowerCase() === user.username.toLowerCase()) {
            socket.emit('usernameChangeError', { message: 'New username must be different from current username' });
            return;
        }
        
        for (const [id, existingUser] of onlineUsers.entries()) {
            if (id !== socket.id && existingUser.username.toLowerCase() === trimmedUsername.toLowerCase()) {
                socket.emit('usernameChangeError', { message: 'Username already taken' });
                return;
            }
        }
        
        const oldUsername = user.username;
        
        const transferResult = await transferUserData(oldUsername, trimmedUsername);
        log.info(`[USERNAME CHANGE] ${oldUsername} -> ${trimmedUsername}:`, transferResult.message);
        
        const newUserData = await getUserData(trimmedUsername);
        user.stats = newUserData.stats;
        user.avatar = newUserData.avatar;
        
        user.username = trimmedUsername;
        
        if (user.room) {
            const room = rooms.get(user.room);
            if (room) {
                const player = room.players.find(p => p.id === socket.id);
                if (player) {
                    player.username = trimmedUsername;
                }
                
                io.to(user.room).emit('newMessage', {
                    type: 'system',
                    message: `${oldUsername} changed their username to ${trimmedUsername}`
                });

                io.to(user.room).emit('roomPlayersUpdate', {
                    players: room.players.map(p => ({
                        id: p.id,
                        username: p.username,
                        team: p.team,
                        avatar: p.avatar,
                        isAdmin: onlineUsers.get(p.id)?.isAdmin || false
                    }))
                });
            }
        }

        socket.emit('usernameChanged', { 
            success: true, 
            username: trimmedUsername,
            stats: user.stats,
            avatar: user.avatar
        });
        
        io.emit('lobbyChatUpdate', { messages: lobbyMessages });
    });

    safeOn('lobbyChatMessage', (data) => {
        const user = onlineUsers.get(socket.id);
        if (!user) return;

        const message = typeof data.message === 'string' ? data.message.slice(0, 500) : '';
        if (!message.trim()) return;

        const chatMessage = {
            id: uuidv4(),
            username: user.username,
            message: message,
            avatar: user.avatar || null,
            timestamp: new Date().toISOString()
        };
        
        lobbyMessages.push(chatMessage);
        
        if (lobbyMessages.length > 100) {
            lobbyMessages = lobbyMessages.slice(-100);
        }
        
        io.emit('lobbyChatUpdate', chatMessage);
    });

    socket.on('getLobbyChat', () => {
        socket.emit('lobbyChatUpdate', { messages: lobbyMessages });
    });

    safeOn('createRoom', (data) => {
        const { name, mode, password, username, difficulty, hintCount } = data;
        
        if (!name || name.trim().length === 0) {
            socket.emit('createRoomError', { message: 'Room name is required' });
            return;
        }
        
        if (isRoomNameTaken(name)) {
            socket.emit('createRoomError', { message: 'A room with this name already exists' });
            return;
        }
        
        const roomId = uuidv4();
        const maxPlayers = mode === 'solo' ? 1 :
                          mode === '1v1' ? 2 : 
                          mode === '2v2' ? 4 :
                          mode === '3v3' ? 6 : 8;
        
        const room = new Room(roomId, name, mode, maxPlayers, password, socket.id);
        
        room.selectedGameMode = difficulty || 'medium';
        room.selectedHintCount = hintCount || 5;
        
        rooms.set(roomId, room);
        
        socket.emit('roomCreated', { roomId, name });
        io.emit('roomList', Array.from(rooms.values()).map(r => ({
            id: r.id,
            name: r.name,
            mode: r.mode,
            players: r.players.length,
            maxPlayers: r.maxPlayers,
            status: r.status,
            hasPassword: !!r.password,
            selectedGameMode: r.selectedGameMode,
            selectedHintCount: r.selectedHintCount
        })));
    });

    safeOn('joinRoom', async (data) => {
        const { roomId, password, username, avatar } = data;
        const room = rooms.get(roomId);
        
        log.info(`[JOIN ROOM] Checking ban status for: ${username}`);
        const banStatus = await isUserBanned(username);
        log.info(`[JOIN ROOM] Ban status for ${username}:`, banStatus);
        if (banStatus.banned) {
            log.info(`[JOIN ROOM] REJECTING banned user from joining room: ${username}`);
            if (banStatus.isPermanent) {
                socket.emit('joinError', { 
                    message: `You are permanently banned from joining rooms. Reason: ${banStatus.reason || 'No reason provided'}` 
                });
            } else {
                const expiryDate = new Date(banStatus.expiry);
                socket.emit('joinError', { 
                    message: `You are banned from joining rooms until ${expiryDate.toLocaleString()}. Reason: ${banStatus.reason || 'No reason provided'}` 
                });
            }
            return;
        }
        
        if (!room) {
            socket.emit('joinError', { message: 'Room not found' });
            return;
        }
        
        if (room.password && room.password !== password) {
            socket.emit('joinError', { message: 'Invalid password' });
            return;
        }
        
        if (room.players.length >= room.maxPlayers) {
            socket.emit('joinError', { message: 'Room is full' });
            return;
        }

        if (room.players.some(p => p.id === socket.id)) {
            socket.emit('joinedRoom', {
                roomId,
                roomName: room.name,
                mode: room.mode,
                players: room.players.map(p => ({
                    id: p.id,
                    username: p.username,
                    team: p.team,
                    avatar: p.avatar,
                    isAdmin: onlineUsers.get(p.id)?.isAdmin || false
                })),
                isHost: room.hostId === socket.id,
                hostId: room.hostId,
                team: room.players.find(p => p.id === socket.id)?.team || null
            });
            return;
        }

        if (room.status !== 'waiting') {
            socket.emit('joinError', { message: 'Game already in progress' });
            return;
        }
        
        const player = {
            id: socket.id,
            username: username,
            avatar: avatar || null,
            socket: socket
        };
        
        room.addPlayer(player);
        socket.join(roomId);
        
        const user = onlineUsers.get(socket.id);
        if (user) {
            user.room = roomId;
        }
        
        socket.emit('joinedRoom', {
            roomId,
            roomName: room.name,
            mode: room.mode,
            players: room.players.map(p => ({
                id: p.id,
                username: p.username,
                team: p.team,
                avatar: p.avatar,
                isAdmin: onlineUsers.get(p.id)?.isAdmin || false
            })),
            isHost: room.hostId === socket.id,
            hostId: room.hostId,
            team: player.team
        });
        
        socket.to(roomId).emit('playerJoined', {
            id: socket.id,
            username: username,
            team: player.team,
            avatar: player.avatar,
            isAdmin: onlineUsers.get(socket.id)?.isAdmin || false
        });
        
        io.emit('roomList', Array.from(rooms.values()).map(r => ({
            id: r.id,
            name: r.name,
            mode: r.mode,
            players: r.players.length,
            maxPlayers: r.maxPlayers,
            status: r.status,
            hasPassword: !!r.password,
            selectedGameMode: r.selectedGameMode,
            selectedHintCount: r.selectedHintCount
        })));
    });

    socket.on('leaveRoom', () => {
        const user = onlineUsers.get(socket.id);
        if (user && user.room) {
            const room = rooms.get(user.room);
            if (room) {
                const wasPlaying = room.status === 'playing' || room.status === 'coin_flip' || room.status === 'word_selection';

                room.removePlayer(socket.id);
                socket.leave(user.room);
                socket.to(user.room).emit('playerLeft', { id: socket.id, username: user.username });

                io.to(user.room).emit('roomPlayersUpdate', {
                    players: room.players.map(p => ({
                        id: p.id,
                        username: p.username,
                        team: p.team,
                        avatar: p.avatar,
                        isAdmin: onlineUsers.get(p.id)?.isAdmin || false
                    }))
                });

                if (room.players.length > 0) {
                    io.to(user.room).emit('hostChanged', { newHostId: room.hostId });

                    if (wasPlaying && room.status === 'waiting' && room.gameState === null) {
                        io.to(user.room).emit('gameAborted', {
                            message: `${user.username} left the game. Waiting for the host to start a new game.`
                        });
                    }
                }

                io.emit('roomList', Array.from(rooms.values()).map(r => ({
                    id: r.id,
                    name: r.name,
                    mode: r.mode,
                    players: r.players.length,
                    maxPlayers: r.maxPlayers,
                    status: r.status,
                    hasPassword: !!r.password,
                    selectedGameMode: r.selectedGameMode,
                    selectedHintCount: r.selectedHintCount
                })));
            }
            user.room = null;
        }
    });

    safeOn('changeTeam', (data) => {
        const { roomId, team } = data;
        const room = rooms.get(roomId);
        
        if (!room || room.status !== 'waiting') {
            socket.emit('teamChangeError', { message: 'Cannot change team at this time' });
            return;
        }
        
        const result = room.changeTeam(socket.id, team);
        
        if (result.error) {
            socket.emit('teamChangeError', { message: result.error });
            return;
        }
        
        if (result.player) {
            io.to(roomId).emit('playerTeamChanged', {
                playerId: socket.id,
                team: team,
                players: room.players.map(p => ({
                    id: p.id,
                    username: p.username,
                    team: p.team,
                    avatar: p.avatar
                }))
            });
            
            socket.emit('teamChanged', { team });
        }
    });

    safeOn('startGame', (data) => {
        const { roomId } = data;
        const room = rooms.get(roomId);
        
        if (!room || room.hostId !== socket.id) {
            socket.emit('startGameError', { message: 'Only the host can start the game' });
            return;
        }
        
        const gameMode = room.selectedGameMode;
        const hintCount = room.selectedHintCount;
        
        room.startGame(gameMode, hintCount);
        
        if (gameMode === 'custom') {
            const isTeamMode = room.mode !== 'solo' && room.mode !== '1v1';
            
            let player1, player2;
            
            if (isTeamMode) {
                player1 = room.players.find(p => p.team === 'team1');
                player2 = room.players.find(p => p.team === 'team2');
            } else {
                player1 = room.players[0];
                player2 = room.players[1];
            }
            
            if (player1 && player2) {
                room.gameState.coinFlip.player1Id = player1.id;
                room.gameState.coinFlip.player2Id = player2.id;
            }
            
            io.to(roomId).emit('coinFlipPhase', {
                isTeamMode: isTeamMode,
                player1: player1 ? {
                    id: player1.id,
                    username: player1.username,
                    team: player1.team
                } : null,
                player2: player2 ? {
                    id: player2.id,
                    username: player2.username,
                    team: player2.team
                } : null,
                hintCount: room.gameState.hintCount
            });
        } else {
            io.to(roomId).emit('gameStarted', {
                gameState: {
                    word: null,
                    wordLength: room.gameState.word.length,
                    spaceIndices: [],
                    maskedWord: room.gameState.word.split('').map(() => null),
                    hint: room.gameState.hint,
                    guessedLetters: room.gameState.guessedLetters,
                    wrongLetters: room.gameState.wrongLetters,
                    currentTurn: room.gameState.currentTurn,
                    gameMode: room.gameState.gameMode,
                    scores: room.gameState.scores,
                    isCustomWord: false,
                    hintsRemaining: 0,
                    wordSetter: null
                },
                players: room.players.map((p, index) => ({ 
                    id: p.id, 
                    username: p.username, 
                    index: index,
                    team: p.team,
                    avatar: p.avatar,
                    isAdmin: onlineUsers.get(p.id)?.isAdmin || false
                })),
                mode: room.mode
            });
        }
    });

    safeOn('selectCoinSide', (data) => {
        const { roomId, side } = data;
        const room = rooms.get(roomId);
        
        if (!room || !room.gameState || room.gameState.status !== 'coin_flip') {
            socket.emit('coinFlipError', { message: 'Coin flip not available' });
            return;
        }
        
        const playerId = socket.id;
        const isPlayer1 = room.gameState.coinFlip.player1Id === playerId;
        const isPlayer2 = room.gameState.coinFlip.player2Id === playerId;
        
        if (!isPlayer1 && !isPlayer2) {
            const isTeamMode = room.gameState.isTeamMode;
            const errorMsg = isTeamMode 
                ? 'Only Team Leaders can choose Heads or Tails' 
                : 'You are not a participant in this coin flip';
            socket.emit('coinFlipError', { message: errorMsg });
            return;
        }
        
        if (room.gameState.coinFlip.player1Choice && room.gameState.coinFlip.player2Choice) {
            socket.emit('coinFlipError', { message: 'Coin flip is already in progress' });
            return;
        }
        
        if (isPlayer1 && room.gameState.coinFlip.player1Choice) {
            socket.emit('coinFlipError', { message: 'You already chose a side' });
            return;
        }
        if (!isPlayer1 && room.gameState.coinFlip.player2Choice) {
            socket.emit('coinFlipError', { message: 'You already chose a side' });
            return;
        }
        
        if (isPlayer1) {
            room.gameState.coinFlip.player1Choice = side;
            room.gameState.coinFlip.player2Choice = side === 'heads' ? 'tails' : 'heads';
        } else {
            room.gameState.coinFlip.player2Choice = side;
            room.gameState.coinFlip.player1Choice = side === 'heads' ? 'tails' : 'heads';
        }
        
        io.to(roomId).emit('coinSideSelected', {
            player1Choice: room.gameState.coinFlip.player1Choice,
            player2Choice: room.gameState.coinFlip.player2Choice,
            player1Id: room.gameState.coinFlip.player1Id,
            player2Id: room.gameState.coinFlip.player2Id,
            isTeamMode: room.gameState.isTeamMode
        });
        
        if (room.gameState.coinFlip.player1Choice && room.gameState.coinFlip.player2Choice) {
            
            setTimeout(() => {
                const result = Math.random() < 0.5 ? 'heads' : 'tails';
                room.gameState.coinFlip.result = result;
                
                let winnerId, winnerName, winnerTeam;
                if (room.gameState.coinFlip.player1Choice === result) {
                    winnerId = room.gameState.coinFlip.player1Id;
                    const winner = room.players.find(p => p.id === winnerId);
                    winnerName = winner ? winner.username : 'Player 1';
                    winnerTeam = winner ? winner.team : null;
                } else {
                    winnerId = room.gameState.coinFlip.player2Id;
                    const winner = room.players.find(p => p.id === winnerId);
                    winnerName = winner ? winner.username : 'Player 2';
                    winnerTeam = winner ? winner.team : null;
                }
                
                room.gameState.coinFlip.winner = winnerId;
                
                io.to(roomId).emit('coinFlipResult', {
                    result: result,
                    winner: {
                        id: winnerId,
                        username: winnerName,
                        team: winnerTeam
                    }
                });
                
                room.gameState.wordSetter = winnerId;
                room.gameState.wordSetterTeam = winnerTeam;
                
                setTimeout(() => {
                    room.gameState.status = 'word_selection';
                    const wordSetter = room.players.find(p => p.id === winnerId);
                    
                    io.to(roomId).emit('wordSelectionPhase', {
                        wordSetter: {
                            id: winnerId,
                            username: winnerName
                        },
                        hintCount: room.gameState.hintCount
                    });
                }, 8000);
            }, 2000);
        }
    });

    safeOn('submitCustomWord', (data) => {
        const { roomId, word } = data;
        const room = rooms.get(roomId);
        
        if (!room || room.gameState.wordSetter !== socket.id) {
            socket.emit('wordSubmitError', { message: 'You are not authorized to set the word' });
            return;
        }

        if (!word || word.trim().length < 3) {
            socket.emit('wordSubmitError', { message: 'Word must be at least 3 characters long' });
            return;
        }

        const wordRegex = /^[A-Za-z\s]+$/;
        if (!wordRegex.test(word.trim())) {
            socket.emit('wordSubmitError', { message: 'Word can only contain letters and spaces' });
            return;
        }

        const success = room.setCustomWord({
            word: word.trim()
        });

        if (success) {
            socket.emit('wordAccepted');
            
            const spaceIndices = [];
            const gameWord = room.gameState.word;
            for (let i = 0; i < gameWord.length; i++) {
                if (gameWord[i] === ' ') {
                    spaceIndices.push(i);
                }
            }
            
            spaceIndices.forEach(index => {
                if (!room.gameState.guessedLetters.includes(gameWord[index])) {
                    room.gameState.guessedLetters.push(gameWord[index]);
                }
            });
            
            io.to(roomId).emit('gameStarted', {
                gameState: {
                    word: null,
                    wordLength: room.gameState.word.length,
                    spaceIndices: spaceIndices,
                    maskedWord: room.getMaskedWord(),
                    hint: null,
                    guessedLetters: room.gameState.guessedLetters,
                    wrongLetters: room.gameState.wrongLetters,
                    currentTurn: room.gameState.currentTurn,
                    gameMode: room.gameState.gameMode,
                    scores: room.gameState.scores,
                    isCustomWord: true,
                    hintsRemaining: room.gameState.hintsRemaining,
                    wordSetter: room.gameState.wordSetter,
                    wordSetterTeam: room.gameState.wordSetterTeam
                },
                players: room.players.map((p, index) => ({ 
                    id: p.id, 
                    username: p.username, 
                    index: index,
                    team: p.team,
                    avatar: p.avatar,
                    isAdmin: onlineUsers.get(p.id)?.isAdmin || false
                })),
                mode: room.mode
            });
        } else {
            socket.emit('wordSubmitError', { message: 'Failed to set word' });
        }
    });

    safeOn('requestHint', (data) => {
        const { roomId, question } = data;
        const room = rooms.get(roomId);

        if (!room || !room.gameState) {
            socket.emit('hintError', { message: 'Game not found' });
            return;
        }

        if (room.status !== 'playing' || room.gameState.status !== 'playing') {
            socket.emit('hintError', { message: 'No game in progress' });
            return;
        }

        const result = room.requestHint(socket.id);

        if (result.success) {
            const requester = room.players.find(p => p.id === socket.id);
            const wordSetter = room.players.find(p => p.id === room.gameState.wordSetter);

            room.gameState.lastHintRequester = socket.id;
            room.gameState.lastQuestion = question || null;

            if (wordSetter) {
                io.to(wordSetter.id).emit('hintRequested', {
                    requesterId: socket.id,
                    requesterName: requester.username,
                    question: question || null
                });
            }
        } else {
            socket.emit('hintError', { message: result.message });
        }
    });

    safeOn('provideHint', (data) => {
        const { roomId, hint } = data;
        const room = rooms.get(roomId);

        if (!room || !room.gameState) {
            socket.emit('hintError', { message: 'Game not found' });
            return;
        }

        const result = room.provideHint(hint, socket.id);

        if (result.success) {
            io.to(roomId).emit('hintProvided', {
                hint: result.hint,
                hintNumber: result.hintNumber,
                hintsRemaining: result.hintsRemaining,
                requesterId: room.gameState.lastHintRequester || null,
                question: room.gameState.lastQuestion || null
            });

            room.gameState.lastQuestion = null;
        } else {
            socket.emit('hintError', { message: result.message });
        }
    });

    safeOn('dismissHint', (data) => {
        const { roomId } = data;
        const room = rooms.get(roomId);
        if (!room || !room.gameState) return;

        const requesterId = room.gameState.lastHintRequester || null;
        room.gameState.lastHintRequester = null;
        io.to(roomId).emit('hintDismissed', { requesterId });
    });

    safeOn('makeGuess', (data) => {
        const { roomId, letter } = data;
        const room = rooms.get(roomId);
        
        if (!room || room.status !== 'playing') return;
        
        if (!room.canPlayerGuess(socket.id)) {
            socket.emit('guessError', { message: 'Your team is setting the word — you cannot guess!' });
            return;
        }

        if (!room.isPlayerTurn(socket.id)) {
            socket.emit('guessError', { message: 'Wait for your turn!' });
            return;
        }
        
        const result = room.checkGuess(letter);
        
        if (result.valid) {
            if (result.isCorrect) {
                const isTeamMode = room.mode === '2v2' || room.mode === '3v3' || room.mode === '4v4';
                
                if (isTeamMode) {
                    const guesser = room.players.find(p => p.id === socket.id);
                    if (guesser && guesser.team) {
                        room.players.forEach(player => {
                            if (player.team === guesser.team) {
                                room.gameState.scores[player.id] += 10;
                            }
                        });
                    }
                } else {
                    room.gameState.scores[socket.id] += 10;
                }
            }
            
            room.gameState.currentTurn = room.getNextTurn();
            
            io.to(roomId).emit('guessResult', {
                letter: result.letter,
                isCorrect: result.isCorrect,
                guessedLetters: room.gameState.guessedLetters,
                wrongLetters: room.gameState.wrongLetters,
                currentTurn: room.gameState.currentTurn,
                scores: room.gameState.scores,
                maskedWord: room.getMaskedWord(),
                isWin: result.isWin,
                isLose: result.isLose
            });
            
            if (result.isWin || result.isLose) {
                room.status = 'finished';
                
                const winner = Object.entries(room.gameState.scores)
                    .sort((a, b) => b[1] - a[1])[0];
                
                io.to(roomId).emit('gameEnded', {
                    word: room.gameState.word,
                    winner: winner ? { id: winner[0], score: winner[1] } : null,
                    scores: room.gameState.scores,
                    isWin: result.isWin
                });
                
                const isSoloMode = room.mode === 'solo';
                room.players.forEach(player => {
                    const user = onlineUsers.get(player.id);
                    if (user && !user.isAdmin) {
                        const isWinner = isSoloMode
                            ? result.isWin
                            : !!(winner && winner[0] === player.id);
                        updateUserStats(user.username, isWinner ? 'win' : 'loss');
                    }
                });
                
                room.messages = [];
                io.to(roomId).emit('roomChatCleared');
                
                io.emit('roomList', Array.from(rooms.values()).map(r => ({
                    id: r.id,
                    name: r.name,
                    mode: r.mode,
                    players: r.players.length,
                    maxPlayers: r.maxPlayers,
                    status: r.status,
                    hasPassword: !!r.password,
                    selectedGameMode: r.selectedGameMode,
                    selectedHintCount: r.selectedHintCount
                })));
            }
        }
    });

    safeOn('chatMessage', (data) => {
        const user = onlineUsers.get(socket.id);
        const { roomId, chatType } = data;
        const room = rooms.get(roomId);
        
        if (!room || !user) return;

        const sender = room.players.find(p => p.id === socket.id);
        if (chatType === 'team' && !sender?.team) return;
        
        const message = typeof data.message === 'string' ? data.message.slice(0, 500) : '';
        if (!message.trim()) return;

        const chatMessage = {
            id: uuidv4(),
            username: user.username,
            message: message,
            avatar: user.avatar || null,
            timestamp: new Date().toISOString(),
            type: (chatType === 'team' && sender?.team) ? 'team' : 'global'
        };
        
        room.messages.push(chatMessage);
        
        if (room.messages.length > 100) {
            room.messages = room.messages.slice(-100);
        }
        
        if (chatMessage.type === 'team') {
            if (sender && sender.team) {
                room.players.forEach(player => {
                    if (player.team === sender.team) {
                        io.to(player.id).emit('newMessage', chatMessage);
                    }
                });
            }
        } else {
            io.to(roomId).emit('newMessage', chatMessage);
        }
    });

    safeOn('getRoomPlayers', (data) => {
        const { roomId } = data;
        const room = rooms.get(roomId);
        if (!room) return;

        socket.emit('roomPlayersUpdate', {
            players: room.players.map(p => ({
                id: p.id,
                username: p.username,
                team: p.team,
                avatar: p.avatar,
                isAdmin: onlineUsers.get(p.id)?.isAdmin || false
            }))
        });
    });

    socket.on('getRooms', () => {
        socket.emit('roomList', Array.from(rooms.values()).map(r => ({
            id: r.id,
            name: r.name,
            mode: r.mode,
            players: r.players.length,
            maxPlayers: r.maxPlayers,
            status: r.status,
            hasPassword: !!r.password,
            selectedGameMode: r.selectedGameMode
        })));
    });

    safeOn('setGameMode', (data) => {
        const { roomId, gameMode } = data;
        const room = rooms.get(roomId);
        
        if (!room || room.hostId !== socket.id) {
            return;
        }
        
        room.selectedGameMode = gameMode;
        
        io.emit('roomList', Array.from(rooms.values()).map(r => ({
            id: r.id,
            name: r.name,
            mode: r.mode,
            players: r.players.length,
            maxPlayers: r.maxPlayers,
            status: r.status,
            hasPassword: !!r.password,
            selectedGameMode: r.selectedGameMode,
            selectedHintCount: r.selectedHintCount
        })));
    });

    safeOn('setHintCount', (data) => {
        const { roomId, hintCount } = data;
        const room = rooms.get(roomId);
        
        if (!room || room.hostId !== socket.id) {
            return;
        }
        
        room.selectedHintCount = hintCount;
        
        io.emit('roomList', Array.from(rooms.values()).map(r => ({
            id: r.id,
            name: r.name,
            mode: r.mode,
            players: r.players.length,
            maxPlayers: r.maxPlayers,
            status: r.status,
            hasPassword: !!r.password,
            selectedGameMode: r.selectedGameMode,
            selectedHintCount: r.selectedHintCount
        })));
    });

    socket.on('disconnect', () => {
        log.info('Disconnection:', socket.id);
        const user = onlineUsers.get(socket.id);
        if (user && user.room) {
            const room = rooms.get(user.room);
            if (room) {
                const wasPlaying = room.status === 'playing' || room.status === 'coin_flip' || room.status === 'word_selection';

                room.removePlayer(socket.id);
                socket.to(user.room).emit('playerLeft', { id: socket.id, username: user.username });

                io.to(user.room).emit('roomPlayersUpdate', {
                    players: room.players.map(p => ({
                        id: p.id,
                        username: p.username,
                        team: p.team,
                        avatar: p.avatar,
                        isAdmin: onlineUsers.get(p.id)?.isAdmin || false
                    }))
                });

                if (room.players.length > 0) {
                    io.to(user.room).emit('hostChanged', { newHostId: room.hostId });

                    if (wasPlaying && room.status === 'waiting' && room.gameState === null) {
                        io.to(user.room).emit('gameAborted', {
                            message: `${user.username} left the game. Waiting for the host to start a new game.`
                        });
                    }
                }

                io.emit('roomList', Array.from(rooms.values()).map(r => ({
                    id: r.id,
                    name: r.name,
                    mode: r.mode,
                    players: r.players.length,
                    maxPlayers: r.maxPlayers,
                    status: r.status,
                    hasPassword: !!r.password
                })));
            }
        }

        onlineUsers.delete(socket.id);
        io.emit('onlineCount', onlineUsers.size);
        const onlineUsersList = Array.from(onlineUsers.values()).map(user => ({
            username: user.username,
            stats: user.stats || { wins: 0, losses: 0, gamesPlayed: 0 },
            avatar: user.avatar,
            isAdmin: user.isAdmin || false
        })).sort((a, b) => (b.stats.wins || 0) - (a.stats.wins || 0));
        io.emit('onlineUsersUpdate', { users: onlineUsersList });
    });


    function isAdmin(socketId) {
        const user = onlineUsers.get(socketId);
        return user && user.isAdmin;
    }

    safeOn('adminDeleteRoom', (data) => {
        if (!isAdmin(socket.id)) {
            socket.emit('adminError', { message: 'Unauthorized - Admin only' });
            return;
        }

        const { roomIdOrName } = data;
        let roomToDelete = null;
        let roomId = null;

        if (rooms.has(roomIdOrName)) {
            roomToDelete = rooms.get(roomIdOrName);
            roomId = roomIdOrName;
        } else {
            for (const [id, room] of rooms.entries()) {
                if (room.name.toLowerCase() === roomIdOrName.toLowerCase()) {
                    roomToDelete = room;
                    roomId = id;
                    break;
                }
            }
        }

        if (!roomToDelete) {
            socket.emit('adminError', { message: 'Room not found' });
            return;
        }

        io.to(roomId).emit('roomDeleted', { 
            message: 'Room has been deleted by an admin',
            roomName: roomToDelete.name 
        });

        roomToDelete.players.forEach(player => {
            const user = onlineUsers.get(player.id);
            if (user) {
                user.room = null;
            }
            player.socket.leave(roomId);
        });

        rooms.delete(roomId);

        io.emit('roomList', Array.from(rooms.values()).map(r => ({
            id: r.id,
            name: r.name,
            mode: r.mode,
            players: r.players.length,
            maxPlayers: r.maxPlayers,
            status: r.status,
            hasPassword: !!r.password,
            selectedGameMode: r.selectedGameMode,
            selectedHintCount: r.selectedHintCount
        })));

        socket.emit('adminSuccess', { message: `Room "${roomToDelete.name}" has been deleted` });
    });

    safeOn('adminKickPlayer', (data) => {
        if (!isAdmin(socket.id)) {
            socket.emit('adminError', { message: 'Unauthorized - Admin only' });
            return;
        }

        const { username, reason } = data;
        let targetSocketId = null;
        let targetUser = null;

        for (const [id, user] of onlineUsers.entries()) {
            if (user.username.toLowerCase() === username.toLowerCase()) {
                targetSocketId = id;
                targetUser = user;
                break;
            }
        }

        if (!targetSocketId) {
            socket.emit('adminError', { message: 'Player not found' });
            return;
        }

        if (targetUser.isAdmin) {
            socket.emit('adminError', { message: 'Cannot kick other admins' });
            return;
        }

        if (targetUser.room) {
            const room = rooms.get(targetUser.room);
            if (room) {
                room.removePlayer(targetSocketId);
                socket.to(targetUser.room).emit('playerLeft', { 
                    id: targetSocketId, 
                    username: targetUser.username 
                });
                
                io.to(targetUser.room).emit('roomPlayersUpdate', {
                    players: room.players.map(p => ({
                        id: p.id,
                        username: p.username,
                        team: p.team,
                        avatar: p.avatar,
                        isAdmin: onlineUsers.get(p.id)?.isAdmin || false
                    }))
                });
                
                if (room.players.length > 0) {
                    io.to(targetUser.room).emit('hostChanged', { newHostId: room.hostId });
                }
            }
        }

        io.to(targetSocketId).emit('kicked', { 
            reason: reason || 'Kicked by admin',
            by: onlineUsers.get(socket.id).username
        });

        const targetSocket = io.sockets.sockets.get(targetSocketId);
        if (targetSocket) {
            targetSocket.disconnect(true);
        }

        onlineUsers.delete(targetSocketId);
        io.emit('onlineCount', onlineUsers.size);
        const onlineUsersList1 = Array.from(onlineUsers.values()).map(user => ({
            username: user.username,
            stats: user.stats || { wins: 0, losses: 0, gamesPlayed: 0 },
            avatar: user.avatar,
            isAdmin: user.isAdmin || false
        })).sort((a, b) => (b.stats.wins || 0) - (a.stats.wins || 0));
        io.emit('onlineUsersUpdate', { users: onlineUsersList1 });

        socket.emit('adminSuccess', { message: `Player "${username}" has been kicked` });
    });

    socket.on('adminGetServerInfo', () => {
        if (!isAdmin(socket.id)) {
            socket.emit('adminError', { message: 'Unauthorized - Admin only' });
            return;
        }

        const serverInfo = {
            onlineUsers: onlineUsers.size,
            totalRooms: rooms.size,
            rooms: Array.from(rooms.values()).map(room => ({
                id: room.id,
                name: room.name,
                mode: room.mode,
                players: room.players.length,
                maxPlayers: room.maxPlayers,
                status: room.status,
                host: room.players.find(p => p.id === room.hostId)?.username || 'Unknown'
            })),
            users: Array.from(onlineUsers.values()).map(user => ({
                id: user.id,
                username: user.username,
                room: user.room,
                isAdmin: user.isAdmin
            }))
        };

        socket.emit('adminServerInfo', serverInfo);
    });

    safeOn('adminBroadcast', (data) => {
        if (!isAdmin(socket.id)) {
            socket.emit('adminError', { message: 'Unauthorized - Admin only' });
            return;
        }

        const { message } = data;
        const adminName = onlineUsers.get(socket.id).username;

        io.emit('adminBroadcast', {
            message: message,
            from: adminName,
            timestamp: new Date().toISOString()
        });

        socket.emit('adminSuccess', { message: 'Broadcast sent successfully' });
    });


    safeOn('serverKickPlayer', (data) => {
        if (!isAdmin(socket.id)) {
            socket.emit('adminError', { message: 'Unauthorized - Admin only' });
            return;
        }

        const { username, reason } = data;
        
        if (!username) {
            socket.emit('adminError', { message: 'Username is required' });
            return;
        }

        let targetSocketId = null;
        for (const [id, user] of onlineUsers.entries()) {
            if (user.username.toLowerCase() === username.toLowerCase()) {
                targetSocketId = id;
                break;
            }
        }

        if (!targetSocketId) {
            socket.emit('adminError', { message: `Player "${username}" is not online` });
            return;
        }

        const targetUser = onlineUsers.get(targetSocketId);
        if (targetUser.isAdmin) {
            socket.emit('adminError', { message: 'Cannot kick admin users' });
            return;
        }

        const targetSocket = io.sockets.sockets.get(targetSocketId);
        if (targetSocket) {
            targetSocket.emit('forceLogout', { 
                message: `🚫 You have been kicked from the server\nReason: ${reason || 'No reason provided'}` 
            });
            targetSocket.disconnect(true);
        }

        onlineUsers.delete(targetSocketId);
        io.emit('onlineCount', onlineUsers.size);
        
        const onlineUsersList = Array.from(onlineUsers.values()).map(user => ({
            username: user.username,
            stats: user.stats || { wins: 0, losses: 0, gamesPlayed: 0 },
            avatar: user.avatar,
            isAdmin: user.isAdmin || false
        })).sort((a, b) => (b.stats.wins || 0) - (a.stats.wins || 0));
        io.emit('onlineUsersUpdate', { users: onlineUsersList });

        socket.emit('adminSuccess', { message: `Player "${username}" has been kicked from the server` });
    });

    safeOn('serverBanPlayer', async (data) => {
        if (!isAdmin(socket.id)) {
            socket.emit('adminError', { message: 'Unauthorized - Admin only' });
            return;
        }

        const { username, duration, reason } = data;
        
        if (!username) {
            socket.emit('adminError', { message: 'Username is required' });
            return;
        }

        let expiryDate = null;
        let isPermanent = false;
        
        switch(duration) {
            case '1sec':
                expiryDate = new Date(Date.now() + 1000);
                break;
            case '1min':
                expiryDate = new Date(Date.now() + 60000);
                break;
            case '1hour':
                expiryDate = new Date(Date.now() + 3600000);
                break;
            case '1day':
                expiryDate = new Date(Date.now() + 86400000);
                break;
            case '1week':
                expiryDate = new Date(Date.now() + 604800000);
                break;
            case 'permanent':
                isPermanent = true;
                expiryDate = null;
                break;
            default:
                expiryDate = new Date(Date.now() + 3600000);
        }

        try {
            const { error } = await db.from('users').upsert({
                username: username.toLowerCase(),
                display_name: username,
                server_ban: true,
                server_ban_expiry: expiryDate ? expiryDate.toISOString() : null,
                server_ban_duration: duration,
                server_ban_reason: reason || 'Banned by server admin'
            }, { onConflict: 'username' });
            if (error) throw error;
        } catch (error) {
            console.error('[SERVER BAN] Error updating database:', error.message);
        }

        let targetSocketId = null;
        for (const [id, user] of onlineUsers.entries()) {
            if (user.username.toLowerCase() === username.toLowerCase()) {
                targetSocketId = id;
                break;
            }
        }

        if (targetSocketId) {
            const targetUser = onlineUsers.get(targetSocketId);
            
            if (targetUser.isAdmin) {
                socket.emit('adminError', { message: 'Cannot ban admin users' });
                return;
            }

            const targetSocket = io.sockets.sockets.get(targetSocketId);
            if (targetSocket) {
                const durationText = isPermanent ? 'permanently' : `for ${duration}`;
                targetSocket.emit('forceLogout', { 
                    message: `🚫 You have been banned from the server ${durationText}\nReason: ${reason || 'No reason provided'}` 
                });
                targetSocket.disconnect(true);
            }

            onlineUsers.delete(targetSocketId);
            io.emit('onlineCount', onlineUsers.size);
            
            const onlineUsersList = Array.from(onlineUsers.values()).map(user => ({
                username: user.username,
                stats: user.stats || { wins: 0, losses: 0, gamesPlayed: 0 },
                avatar: user.avatar,
                isAdmin: user.isAdmin || false
            })).sort((a, b) => (b.stats.wins || 0) - (a.stats.wins || 0));
            io.emit('onlineUsersUpdate', { users: onlineUsersList });
        }

        const durationText = isPermanent ? 'permanently' : `for ${duration}`;
        socket.emit('adminSuccess', { message: `Player "${username}" has been server banned ${durationText}` });
    });

    safeOn('serverUnbanPlayer', async (data) => {
        if (!isAdmin(socket.id)) {
            socket.emit('adminError', { message: 'Unauthorized - Admin only' });
            return;
        }

        const { username } = data;
        
        if (!username) {
            socket.emit('adminError', { message: 'Username is required' });
            return;
        }

        try {
            const { data, error } = await db.from('users').update({
                server_ban: false,
                server_ban_expiry: null,
                server_ban_duration: null,
                server_ban_reason: null
            }).eq('username', username.toLowerCase()).select('username');

            if (error) throw error;

            if (!data || data.length === 0) {
                socket.emit('adminError', { message: `User "${username}" not found in database` });
                return;
            }

            socket.emit('adminSuccess', { message: `Server ban removed for "${username}"` });
        } catch (error) {
            console.error('[SERVER UNBAN] Error updating database:', error.message);
            socket.emit('adminError', { message: 'Failed to remove server ban' });
        }
    });

    safeOn('adminClearChat', (data) => {
        if (!isAdmin(socket.id)) {
            socket.emit('adminError', { message: 'Unauthorized - Admin only' });
            return;
        }

        const { type } = data;
        const adminName = onlineUsers.get(socket.id).username;

        if (type === 'lobby') {
            lobbyMessages = [];
            io.emit('lobbyChatUpdate', { messages: [] });
            io.emit('lobbyChatCleared', { by: adminName });
            socket.emit('adminSuccess', { message: 'Lobby chat cleared' });
        } else if (type === 'current' || type === 'room') {
            const user = onlineUsers.get(socket.id);
            if (user && user.room) {
                const room = rooms.get(user.room);
                if (room) {
                    room.messages = [];
                    io.to(user.room).emit('roomChatCleared', { by: adminName });
                    socket.emit('adminSuccess', { message: 'Room chat cleared' });
                } else {
                    socket.emit('adminError', { message: 'You are not in a room' });
                }
            } else {
                socket.emit('adminError', { message: 'You are not in a room' });
            }
        } else {
            socket.emit('adminError', { message: 'Invalid chat type' });
        }
    });


    socket.on('adminGetUserDatabase', async () => {
        if (!isAdmin(socket.id)) {
            socket.emit('adminError', { message: 'Unauthorized - Admin only' });
            return;
        }

        await reloadUserDatabaseFromFile();

        const users = await getAllUsersInDatabase();
        socket.emit('adminUserDatabase', { 
            users: users, 
            total: users.length 
        });
    });

    socket.on('adminReloadUserDatabase', async () => {
        if (!isAdmin(socket.id)) {
            socket.emit('adminError', { message: 'Unauthorized - Admin only' });
            return;
        }

        const success = await reloadUserDatabaseFromFile();
        if (success) {
            socket.emit('adminSuccess', { message: 'User database reloaded from MongoDB' });
            
            const users = await getAllUsersInDatabase();
            socket.emit('adminUserDatabase', { 
                users: users, 
                total: users.length 
            });
        } else {
            socket.emit('adminError', { message: 'Failed to reload user database' });
        }
    });

    safeOn('adminDeleteUser', async (data) => {
        if (!isAdmin(socket.id)) {
            socket.emit('adminError', { message: 'Unauthorized - Admin only' });
            return;
        }

        const { username } = data;
        
        if (!username) {
            socket.emit('adminError', { message: 'Username is required' });
            return;
        }

        let targetSocketId = null;
        for (const [id, user] of onlineUsers.entries()) {
            if (user.username.toLowerCase() === username.toLowerCase()) {
                targetSocketId = id;
                break;
            }
        }

        const success = await deleteUser(username);
        
        if (success) {
            if (targetSocketId) {
                io.to(targetSocketId).emit('userDataDeleted', { 
                    message: 'Your account data has been deleted by an admin',
                    by: onlineUsers.get(socket.id).username
                });
            }
            
            socket.emit('adminSuccess', { message: `User "${username}" has been deleted from database` });
            
            const users = await getAllUsersInDatabase();
            socket.emit('adminUserDatabase', { 
                users: users, 
                total: users.length 
            });
        } else {
            socket.emit('adminError', { message: 'User not found in database' });
        }
    });

    safeOn('adminEditUserStats', async (data) => {
        if (!isAdmin(socket.id)) {
            socket.emit('adminError', { message: 'Unauthorized - Admin only' });
            return;
        }

        const { username, stats } = data;
        
        if (!username || !stats) {
            socket.emit('adminError', { message: 'Username and stats are required' });
            return;
        }

        const success = await setUserStats(username, stats);
        
        if (success) {
            let targetSocketId = null;
            for (const [id, user] of onlineUsers.entries()) {
                if (user.username.toLowerCase() === username.toLowerCase()) {
                    targetSocketId = id;
                    break;
                }
            }

            if (targetSocketId) {
                const user = onlineUsers.get(targetSocketId);
                user.stats = {
                    wins: parseInt(stats.wins) || 0,
                    losses: parseInt(stats.losses) || 0,
                    gamesPlayed: parseInt(stats.gamesPlayed) || 0
                };
                
                io.to(targetSocketId).emit('statsUpdated', { 
                    stats: user.stats,
                    by: onlineUsers.get(socket.id).username
                });
            }
            
            socket.emit('adminSuccess', { message: `Stats updated for "${username}"` });
            
            const users = await getAllUsersInDatabase();
            socket.emit('adminUserDatabase', { 
                users: users, 
                total: users.length 
            });
        } else {
            socket.emit('adminError', { message: 'User not found in database' });
        }
    });

    socket.on('adminDeleteAllUsers', async () => {
        if (!isAdmin(socket.id)) {
            socket.emit('adminError', { message: 'Unauthorized - Admin only' });
            return;
        }

        const adminName = onlineUsers.get(socket.id).username;
        
        onlineUsers.forEach((user, userSocketId) => {
            if (!user.isAdmin) {
                io.to(userSocketId).emit('allUserDataDeleted', { 
                    message: 'All user data has been deleted by an admin',
                    by: adminName
                });
            }
        });

        await deleteAllUsers();
        
        socket.emit('adminSuccess', { message: 'All users have been deleted from database' });
        
        const users = await getAllUsersInDatabase();
        socket.emit('adminUserDatabase', { 
            users: users, 
            total: users.length 
        });
    });

    safeOn('updateAvatar', async (data) => {
        const user = onlineUsers.get(socket.id);
        if (!user) return;

        const { avatar } = data;
        
        await updateUserAvatar(user.username, avatar);
        
        user.avatar = avatar;
        
        socket.emit('avatarUpdated', { success: true, avatar });
    });

    socket.on('reloadUserStats', async () => {
        const user = onlineUsers.get(socket.id);
        if (!user) return;

        const freshStats = await reloadUserStats(user.username);
        if (freshStats) {
            user.stats = freshStats;
            
            socket.emit('statsReloaded', { 
                success: true, 
                stats: freshStats 
            });
        }
    });

    safeOn('inspectUserProfile', async (data) => {
        const { username } = data;
        const inspector = onlineUsers.get(socket.id);
        
        if (!inspector || !username) return;
        
        const userData = await getUserData(username);
        if (!userData) {
            socket.emit('userProfileError', { message: 'User not found' });
            return;
        }
        
        const isTargetAdmin = username.toLowerCase() === 'admin';
        const isInspectorAdmin = inspector.isAdmin;
        
        const profileData = {
            username: userData.displayName || userData.username,
            avatar: userData.avatar,
            stats: userData.stats,
            firstLogin: userData.firstLogin,
            lastLogin: userData.lastLogin,
            isAdmin: isTargetAdmin,
            isInspectorAdmin: isInspectorAdmin
        };
        
        socket.emit('userProfileData', profileData);
    });
    
    safeOn('adminInspectUser', async (data) => {
        if (!isAdmin(socket.id)) {
            socket.emit('adminError', { message: 'Unauthorized - Admin only' });
            return;
        }
        
        const { username } = data;
        if (!username) return;
        
        const userData = await getUserData(username);
        
        socket.emit('userProfileData', {
            username: userData.displayName || userData.username || username,
            avatar: userData.avatar,
            stats: userData.stats,
            firstLogin: userData.firstLogin,
            lastLogin: userData.lastLogin,
            isAdmin: username.toLowerCase() === 'admin',
            isInspectorAdmin: true,
            banned: !!(userData.serverBan && (!userData.serverBanExpiry || new Date(userData.serverBanExpiry) > new Date())),
            banExpiry: userData.serverBanExpiry || null,
            banReason: userData.serverBanReason || null
        });
    });

    safeOn('adminBanUser', async (data) => {
        if (!isAdmin(socket.id)) {
            socket.emit('adminError', { message: 'Unauthorized - Admin only' });
            return;
        }

        const { username, duration, reason } = data;
        
        if (!username) {
            socket.emit('adminError', { message: 'Username is required' });
            return;
        }

        if (username.toLowerCase() === 'admin') {
            socket.emit('adminError', { message: 'Cannot ban other admins' });
            return;
        }

        const success = await banUser(username, duration, reason);
        
        if (success) {
            const banStatus = await isUserBanned(username);
            const durationText = banStatus.isPermanent ? 'permanently' : `for ${duration} hour(s)`;
            
            for (const [id, user] of onlineUsers.entries()) {
                if (user.username.toLowerCase() === username.toLowerCase()) {
                    io.to(id).emit('banned', { 
                        reason: reason || 'Banned by admin',
                        by: onlineUsers.get(socket.id).username,
                        duration: duration
                    });
                    
                    const targetSocket = io.sockets.sockets.get(id);
                    if (targetSocket) {
                        targetSocket.disconnect(true);
                    }
                    onlineUsers.delete(id);
                    break;
                }
            }
            
            socket.emit('adminSuccess', { message: `User "${username}" has been banned ${durationText}` });
            
            await reloadUserDatabaseFromFile();
            const users = await getAllUsersInDatabase();
            socket.emit('adminUserDatabase', { 
                users: users, 
                total: users.length 
            });
        } else {
            socket.emit('adminError', { message: 'User not found in database' });
        }
    });

    safeOn('adminUnbanUser', async (data) => {
        if (!isAdmin(socket.id)) {
            socket.emit('adminError', { message: 'Unauthorized - Admin only' });
            return;
        }

        const { username } = data;

        if (!username) {
            socket.emit('adminError', { message: 'Username is required' });
            return;
        }

        try {
            const { error } = await db.from('users').upsert({
                username: username.toLowerCase(),
                display_name: username,
                server_ban: false,
                server_ban_expiry: null,
                server_ban_duration: null,
                server_ban_reason: null
            }, { onConflict: 'username' });
            if (error) throw error;

            const memUser = inMemoryUsers.get(username.toLowerCase());
            if (memUser) {
                memUser.serverBan = false;
                memUser.serverBanExpiry = null;
                memUser.serverBanDuration = null;
                memUser.serverBanReason = null;
            }

            socket.emit('adminSuccess', { message: `User "${username}" has been unbanned` });

            const users = await getAllUsersInDatabase();
            socket.emit('adminUserDatabase', {
                users: users,
                total: users.length
            });
        } catch (error) {
            console.error('[ADMIN UNBAN] Error:', error.message);
            socket.emit('adminError', { message: 'Failed to unban user' });
        }
    });

    safeOn('adminToggleMaintenance', (data) => {
        if (!isAdmin(socket.id)) {
            socket.emit('adminError', { message: 'Unauthorized - Admin only' });
            return;
        }

        const { enabled, message } = data;
        const result = setMaintenanceMode(enabled, message);
        
        socket.emit('adminSuccess', { 
            message: `Maintenance mode ${result ? 'ENABLED' : 'DISABLED'}`,
            maintenanceMode: result,
            maintenanceMessage: getMaintenanceMessage()
        });
        
        if (result) {
            io.emit('maintenanceModeEnabled', { message: getMaintenanceMessage() });
        }
    });

    socket.on('adminGetMaintenanceStatus', () => {
        if (!isAdmin(socket.id)) {
            socket.emit('adminError', { message: 'Unauthorized - Admin only' });
            return;
        }

        socket.emit('maintenanceStatus', {
            enabled: isMaintenanceMode(),
            message: getMaintenanceMessage()
        });
    });

    socket.on('adminCreateBackup', async () => {
        if (!isAdmin(socket.id)) {
            socket.emit('adminError', { message: 'Unauthorized - Admin only' });
            return;
        }

        const result = await createDatabaseBackup();
        
        if (result.success) {
            socket.emit('adminSuccess', { 
                message: `Backup created successfully`,
                backup: {
                    filename: path.basename(result.file),
                    timestamp: result.timestamp
                }
            });
        } else {
            socket.emit('adminError', { message: `Failed to create backup: ${result.error}` });
        }
    });

    socket.on('adminListBackups', () => {
        if (!isAdmin(socket.id)) {
            socket.emit('adminError', { message: 'Unauthorized - Admin only' });
            return;
        }

        const backups = getBackupList();
        socket.emit('adminBackupList', { backups });
    });

    safeOn('adminRestoreBackup', async (data) => {
        if (!isAdmin(socket.id)) {
            socket.emit('adminError', { message: 'Unauthorized - Admin only' });
            return;
        }

        const { filename } = data;
        
        if (!filename) {
            socket.emit('adminError', { message: 'Backup filename is required' });
            return;
        }

        const result = await restoreFromBackup(filename);
        
        if (result.success) {
            socket.emit('adminSuccess', { 
                message: result.message,
                userCount: result.userCount
            });
            
            const users = await getAllUsersInDatabase();
            socket.emit('adminUserDatabase', { 
                users: users, 
                total: users.length 
            });
        } else {
            socket.emit('adminError', { message: result.message });
        }
    });

    safeOn('adminDeleteBackup', (data) => {
        if (!isAdmin(socket.id)) {
            socket.emit('adminError', { message: 'Unauthorized - Admin only' });
            return;
        }

        const { filename } = data;
        
        if (!filename) {
            socket.emit('adminError', { message: 'Backup filename is required' });
            return;
        }

        const result = deleteBackup(filename);
        
        if (result.success) {
            socket.emit('adminSuccess', { message: result.message });
            
            const backups = getBackupList();
            socket.emit('adminBackupList', { backups });
        } else {
            socket.emit('adminError', { message: result.message });
        }
    });
});

const PORT = process.env.PORT || 12244;

app.get('/health', (req, res) => {
    res.status(200).json({
        status: 'ok',
        build: buildInfo.buildNumber,
        commit: buildInfo.commit,
        uptime: Math.floor(process.uptime()),
        onlineUsers: onlineUsers.size,
        rooms: rooms.size,
        mongodb: 'n/a (Supabase)',
        supabase: usingSupabase() ? 'connected' : 'disconnected',
        storage: 'supabase',
        timestamp: new Date().toISOString()
    });
});

const randInt = (lo, hi) => lo + Math.floor(Math.random() * (hi - lo + 1));

function startSelfPing() {
    const base = (process.env.SELF_URL || process.env.RENDER_EXTERNAL_URL || '').replace(/\/$/, '');
    if (!base) {
        console.log('[KEEPALIVE] No RENDER_EXTERNAL_URL / SELF_URL set - Render self-ping disabled (fine for local dev)');
        return;
    }
    const tick = async () => {
        try {
            const res = await fetch(`${base}/health`, { signal: AbortSignal.timeout(30000) });
            console.log(`[KEEPALIVE] Render self-ping -> HTTP ${res.status}`);
        } catch (err) {
            console.error('[KEEPALIVE] Render self-ping failed:', err.message);
        }
        schedule();
    };
    const schedule = () => {
        const secs = randInt(12 * 60, 14 * 60 + 50);
        console.log(`[KEEPALIVE] Next Render self-ping in ${Math.floor(secs / 60)}m${String(secs % 60).padStart(2, '0')}s`);
        setTimeout(tick, secs * 1000).unref();
    };
    schedule();
}

function startSupabasePing() {
    if (!db) {
        console.log('[KEEPALIVE] Supabase not configured - Supabase ping disabled');
        return;
    }
    const tick = async () => {
        try {
            const { error } = await db.from('users').select('username').limit(1);
            if (error) throw error;
            console.log('[KEEPALIVE] Supabase ping OK');
        } catch (err) {
            console.error('[KEEPALIVE] Supabase ping failed:', err.message);
        }
        schedule();
    };
    const schedule = () => {
        const secs = randInt(5 * 86400, 6 * 86400);
        console.log(`[KEEPALIVE] Next Supabase ping in ${(secs / 86400).toFixed(2)} days`);
        setTimeout(tick, secs * 1000).unref();
    };
    schedule();
}

server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`Online users: ${onlineUsers.size}`);
    startSelfPing();
    startSupabasePing();
});
