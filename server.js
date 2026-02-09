const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const { execSync } = require('child_process');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

// Get build info from Git
function getBuildInfo() {
    try {
        // Get the latest commit hash (short version)
        let commitHash;
        try {
            commitHash = execSync('git rev-parse --short HEAD', { 
                encoding: 'utf8', 
                cwd: __dirname,
                stdio: ['pipe', 'pipe', 'ignore']
            }).trim();
        } catch (e) {
            commitHash = null;
        }
        
        // If no commit hash, return dev build
        if (!commitHash || commitHash === 'unknown') {
            return {
                version: process.env.npm_package_version || '1.0.0',
                commit: 'unknown',
                date: new Date().toISOString(),
                branch: 'main',
                buildNumber: 'dev'
            };
        }
        
        // Get the commit date
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
        
        // Get the branch name
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
            commit: commitHash,
            date: commitDate || new Date().toISOString(),
            branch: branch || 'main',
            buildNumber: commitHash
        };
    } catch (error) {
        // Fallback if git is not available
        return {
            version: process.env.npm_package_version || '1.0.0',
            commit: 'unknown',
            date: new Date().toISOString(),
            branch: 'main',
            buildNumber: 'dev'
        };
    }
}

const buildInfo = getBuildInfo();

// Function to fetch latest commit from GitHub
async function getGitHubBuildInfo() {
    try {
        // Replace with your actual GitHub username and repo name
        const githubUsername = 'werheq';
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
            message: commit.commit.message.split('\n')[0] // First line only
        };
    } catch (error) {
        console.log('GitHub API fetch failed, using local build info:', error.message);
        // Fallback to local build info
        return buildInfo;
    }
}

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

let rooms = new Map();
let onlineUsers = new Map();
let lobbyMessages = [];

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
        { word: 'DESK', hint: 'Furniture for working' }
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
        { word: 'GARDEN', hint: 'Area for growing plants' }
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
        { word: 'SATELLITE', hint: 'Object orbiting a planet' }
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

// API endpoint to get build info
app.get('/api/build', async (req, res) => {
    try {
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
        this.selectedGameMode = 'medium'; // Default game mode selected by host
        this.selectedHintCount = 5; // Default hint count for custom mode
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
        } else if (this.hostId === playerId && this.players.length > 0) {
            this.hostId = this.players[0].id;
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
        // For solo mode, use random word from database
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
            // For custom word mode, the HOST is always the word setter
            const hostTeam = this.players.find(p => p.id === this.hostId)?.team;

            this.gameState = {
                word: null,
                hint: null,
                guessedLetters: [],
                wrongLetters: [],
                currentTurn: 0, // Will be updated when game actually starts
                status: 'word_selection',
                gameMode: gameMode,
                scores: {},
                isCustomWord: true,
                hintsRemaining: hintCount,
                hints: [],
                wordSetter: this.hostId,
                wordSetterTeam: hostTeam,
                hintCount: hintCount
            };
            
            this.players.forEach(player => {
                this.gameState.scores[player.id] = 0;
            });
            
            this.status = 'word_selection';
        } else {
            // For other modes (easy, medium, hard), use random word
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
        
        // FIX: Set the first turn to the first player NOT on the word setter's team
        this.gameState.currentTurn = this.getFirstValidTurn();
        
        return true;
    }

    // FIX: Get the first valid turn (not on word setter's team, or not the word setter in 1v1)
    getFirstValidTurn() {
        if (!this.gameState.isCustomWord) {
            return 0;
        }
        
        if (this.gameState.wordSetterTeam) {
            // Team mode: find first player NOT on word setter's team
            for (let i = 0; i < this.players.length; i++) {
                if (this.players[i].team !== this.gameState.wordSetterTeam) {
                    return i;
                }
            }
        } else {
            // 1v1 mode: find first player who is NOT the word setter
            for (let i = 0; i < this.players.length; i++) {
                if (this.players[i].id !== this.gameState.wordSetter) {
                    return i;
                }
            }
        }
        
        return 0; // Fallback (shouldn't happen in a valid game)
    }

    requestHint(playerId) {
        if (!this.gameState || this.gameState.hintsRemaining <= 0) {
            return { success: false, message: 'No hints available' };
        }

        // Block word setter or their team from requesting hints
        if (this.gameState.wordSetterTeam) {
            // Team mode: block the entire word setter's team
            const player = this.players.find(p => p.id === playerId);
            if (player && player.team === this.gameState.wordSetterTeam) {
                return { success: false, message: 'Your team is setting the word — you cannot request hints!' };
            }
        } else if (this.gameState.isCustomWord && this.gameState.wordSetter === playerId) {
            // 1v1 mode: block only the word setter
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

        // Only the host can provide hints in custom word mode
        if (this.gameState.isCustomWord && providerId !== this.hostId) {
            return { success: false, message: 'Only the host can provide hints' };
        }

        this.gameState.hintsRemaining--;
        this.gameState.hints.push(hint);

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

    checkGuess(letter) {
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
    
    // FIX: Improved turn management that properly skips word setter's team
    getNextTurn() {
        let nextTurn = (this.gameState.currentTurn + 1) % this.players.length;
        
        // In custom word mode, skip word setter or their team
        if (this.gameState.isCustomWord) {
            let attempts = 0;
            const maxAttempts = this.players.length;
            
            while (attempts < maxAttempts) {
                const currentPlayer = this.players[nextTurn];
                
                if (this.gameState.wordSetterTeam) {
                    // Team mode: skip ALL players on the word setter's team
                    if (currentPlayer && currentPlayer.team !== this.gameState.wordSetterTeam) {
                        return nextTurn;
                    }
                } else {
                    // 1v1 mode: skip only the word setter
                    if (currentPlayer && currentPlayer.id !== this.gameState.wordSetter) {
                        return nextTurn;
                    }
                }
                
                // Move to next player
                nextTurn = (nextTurn + 1) % this.players.length;
                attempts++;
            }
            
            // If we've looped through all players, something is wrong
            // Return 0 as fallback (shouldn't happen in a valid game)
            console.error('Could not find valid next turn - no players available to guess');
            return 0;
        }
        
        return nextTurn;
    }

    // FIX: Validate if a player can make a guess
    canPlayerGuess(playerId) {
        if (!this.gameState || !this.gameState.isCustomWord) {
            return true; // In non-custom mode, everyone can guess
        }

        const player = this.players.find(p => p.id === playerId);
        if (!player) {
            return false;
        }

        // In 1v1 mode (no teams), only block the word setter
        // In team modes (2v2, 3v3, 4v4), block the entire word setter's team
        if (this.gameState.wordSetterTeam) {
            // Team mode: block the entire word setter's team
            if (player.team === this.gameState.wordSetterTeam) {
                return false;
            }
        } else {
            // 1v1 mode: only block the word setter themselves
            if (playerId === this.gameState.wordSetter) {
                return false;
            }
        }

        return true;
    }

    // FIX: Check if it's a specific player's turn (considering team exclusions)
    isPlayerTurn(playerId) {
        if (!this.gameState) {
            return false;
        }

        const currentPlayer = this.players[this.gameState.currentTurn];
        return currentPlayer && currentPlayer.id === playerId;
    }
}

io.on('connection', (socket) => {
    console.log('New connection:', socket.id);

    socket.on('authenticate', (data) => {
        const { username, adminPassword } = data;
        
        if (!username || username.trim().length === 0) {
            socket.emit('authError', { message: 'Username is required' });
            return;
        }
        
        const trimmedUsername = username.trim();
        
        // Admin account authentication
        if (trimmedUsername.toLowerCase() === 'admin') {
            // Set your admin password here - you can change this to any secure password
            const ADMIN_PASSWORD = 'supersecretadminpassword';
            
            if (!adminPassword || adminPassword !== ADMIN_PASSWORD) {
                socket.emit('authError', { message: 'Password needed to login in the admin account' });
                return;
            }
            
            // Check if admin is already logged in
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
        
        onlineUsers.set(socket.id, {
            id: socket.id,
            username: trimmedUsername,
            room: null,
            isAdmin: trimmedUsername.toLowerCase() === 'admin'
        });
        
        socket.emit('authenticated', { 
            success: true, 
            user: { 
                id: socket.id, 
                username: trimmedUsername,
                isAdmin: trimmedUsername.toLowerCase() === 'admin'
            } 
        });
        
        io.emit('onlineCount', onlineUsers.size);
        
        socket.emit('lobbyChatUpdate', { messages: lobbyMessages });
    });

    // Handle username change
    socket.on('changeUsername', (data) => {
        const { newUsername } = data;
        const user = onlineUsers.get(socket.id);
        
        if (!user) {
            socket.emit('usernameChangeError', { message: 'User not found' });
            return;
        }
        
        if (!newUsername || newUsername.trim().length === 0) {
            socket.emit('usernameChangeError', { message: 'Username is required' });
            return;
        }
        
        const trimmedUsername = newUsername.trim();
        
        // Check if username is the same as current
        if (trimmedUsername.toLowerCase() === user.username.toLowerCase()) {
            socket.emit('usernameChangeError', { message: 'New username must be different from current username' });
            return;
        }
        
        // Check if username is taken by another user
        for (const [id, existingUser] of onlineUsers.entries()) {
            if (id !== socket.id && existingUser.username.toLowerCase() === trimmedUsername.toLowerCase()) {
                socket.emit('usernameChangeError', { message: 'Username already taken' });
                return;
            }
        }
        
        const oldUsername = user.username;
        user.username = trimmedUsername;
        
        // Update username in room if user is in a room
        if (user.room) {
            const room = rooms.get(user.room);
            if (room) {
                const player = room.players.find(p => p.id === socket.id);
                if (player) {
                    player.username = trimmedUsername;
                }
                
                // Notify room of username change
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

        // Update session
        socket.emit('usernameChanged', { 
            success: true, 
            username: trimmedUsername 
        });
        
        // Update lobby chat display name for future messages
        io.emit('lobbyChatUpdate', { messages: lobbyMessages });
    });

    socket.on('lobbyChatMessage', (data) => {
        const { message, username, avatar } = data;

        const chatMessage = {
            id: uuidv4(),
            username: username,
            message: message,
            avatar: avatar || null,
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

    socket.on('createRoom', (data) => {
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
        
        // Store selected difficulty and hint count
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

    socket.on('joinRoom', (data) => {
        const { roomId, password, username, avatar } = data;
        const room = rooms.get(roomId);
        
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

    socket.on('changeTeam', (data) => {
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

    socket.on('startGame', (data) => {
        const { roomId } = data;
        const room = rooms.get(roomId);
        
        if (!room || room.hostId !== socket.id) {
            socket.emit('startGameError', { message: 'Only the host can start the game' });
            return;
        }
        
        // Use stored difficulty and hint count from room creation
        const gameMode = room.selectedGameMode;
        const hintCount = room.selectedHintCount;
        
        room.startGame(gameMode, hintCount);
        
        if (gameMode === 'custom') {
            const wordSetter = room.players.find(p => p.id === room.gameState.wordSetter);
            
            io.to(roomId).emit('wordSelectionPhase', {
                wordSetter: {
                    id: wordSetter.id,
                    username: wordSetter.username
                },
                hintCount: room.gameState.hintCount
            });
        } else {
            // Regular game starts immediately
            io.to(roomId).emit('gameStarted', {
                gameState: {
                    word: room.gameState.word,
                    wordLength: room.gameState.word.length,
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

    socket.on('submitCustomWord', (data) => {
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

        const wordRegex = /^[A-Za-z]+$/;
        if (!wordRegex.test(word.trim())) {
            socket.emit('wordSubmitError', { message: 'Word can only contain letters' });
            return;
        }

        const success = room.setCustomWord({
            word: word.trim()
        });

        if (success) {
            socket.emit('wordAccepted');
            
            // Start the game for all players
            io.to(roomId).emit('gameStarted', {
                gameState: {
                    word: null, // Don't send actual word to clients
                    wordLength: room.gameState.word.length,
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

    socket.on('requestHint', (data) => {
        const { roomId, question } = data;
        const room = rooms.get(roomId);

        if (!room || !room.gameState) {
            socket.emit('hintError', { message: 'Game not found' });
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

    socket.on('provideHint', (data) => {
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

            // Clear the stored question after sending
            room.gameState.lastQuestion = null;
        } else {
            socket.emit('hintError', { message: result.message });
        }
    });

    socket.on('dismissHint', (data) => {
        const { roomId } = data;
        const room = rooms.get(roomId);
        if (!room || !room.gameState) return;

        const requesterId = room.gameState.lastHintRequester || null;
        room.gameState.lastHintRequester = null;
        io.to(roomId).emit('hintDismissed', { requesterId });
    });

    socket.on('makeGuess', (data) => {
        const { roomId, letter } = data;
        const room = rooms.get(roomId);
        
        if (!room || room.status !== 'playing') return;
        
        // FIX: Use the new validation methods
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
                    // Award points to all players on the same team
                    const guesser = room.players.find(p => p.id === socket.id);
                    if (guesser && guesser.team) {
                        room.players.forEach(player => {
                            if (player.team === guesser.team) {
                                room.gameState.scores[player.id] += 10;
                            }
                        });
                    }
                } else {
                    // Individual scoring for solo and 1v1
                    room.gameState.scores[socket.id] += 10;
                }
            }
            
            // Get next turn (automatically skips word setter's team if custom word mode)
            room.gameState.currentTurn = room.getNextTurn();
            
            // FIX: Always send the word in the response so client can update display
            io.to(roomId).emit('guessResult', {
                letter: result.letter,
                isCorrect: result.isCorrect,
                guessedLetters: room.gameState.guessedLetters,
                wrongLetters: room.gameState.wrongLetters,
                currentTurn: room.gameState.currentTurn,
                scores: room.gameState.scores,
                word: result.word, // Send full word so client can update display
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

    socket.on('chatMessage', (data) => {
        const { roomId, message, username, chatType, avatar } = data;
        const room = rooms.get(roomId);
        
        if (!room) return;
        
        const chatMessage = {
            id: uuidv4(),
            username: username,
            message: message,
            avatar: avatar || null,
            timestamp: new Date().toISOString(),
            type: chatType || 'global'
        };
        
        room.messages.push(chatMessage);
        
        if (room.messages.length > 100) {
            room.messages = room.messages.slice(-100);
        }
        
        if (chatType === 'team') {
            const sender = room.players.find(p => p.id === socket.id);
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

    socket.on('getRoomPlayers', (data) => {
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

    // Handle host changing the game mode
    socket.on('setGameMode', (data) => {
        const { roomId, gameMode } = data;
        const room = rooms.get(roomId);
        
        if (!room || room.hostId !== socket.id) {
            return;
        }
        
        room.selectedGameMode = gameMode;
        
        // Broadcast updated room list to all clients
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

    // Handle host changing the hint count
    socket.on('setHintCount', (data) => {
        const { roomId, hintCount } = data;
        const room = rooms.get(roomId);
        
        if (!room || room.hostId !== socket.id) {
            return;
        }
        
        room.selectedHintCount = hintCount;
        
        // Broadcast updated room list to all clients
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
        console.log('Disconnection:', socket.id);
        const user = onlineUsers.get(socket.id);
        if (user && user.room) {
            const room = rooms.get(user.room);
            if (room) {
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
    });

    // ═══════════════════════════════════════════════════════════════════════
    // ADMIN COMMANDS
    // ═══════════════════════════════════════════════════════════════════════

    // Helper function to check if user is admin
    function isAdmin(socketId) {
        const user = onlineUsers.get(socketId);
        return user && user.isAdmin;
    }

    // Delete room (admin only)
    socket.on('adminDeleteRoom', (data) => {
        if (!isAdmin(socket.id)) {
            socket.emit('adminError', { message: 'Unauthorized - Admin only' });
            return;
        }

        const { roomIdOrName } = data;
        let roomToDelete = null;
        let roomId = null;

        // Try to find by ID first
        if (rooms.has(roomIdOrName)) {
            roomToDelete = rooms.get(roomIdOrName);
            roomId = roomIdOrName;
        } else {
            // Try to find by name
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

        // Notify all players in the room
        io.to(roomId).emit('roomDeleted', { 
            message: 'Room has been deleted by an admin',
            roomName: roomToDelete.name 
        });

        // Remove all players from the room
        roomToDelete.players.forEach(player => {
            const user = onlineUsers.get(player.id);
            if (user) {
                user.room = null;
            }
            player.socket.leave(roomId);
        });

        // Delete the room
        rooms.delete(roomId);

        // Update room list for everyone
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

    // Kick player (admin only)
    socket.on('adminKickPlayer', (data) => {
        if (!isAdmin(socket.id)) {
            socket.emit('adminError', { message: 'Unauthorized - Admin only' });
            return;
        }

        const { username, reason } = data;
        let targetSocketId = null;
        let targetUser = null;

        // Find player by username
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

        // Can't kick other admins
        if (targetUser.isAdmin) {
            socket.emit('adminError', { message: 'Cannot kick other admins' });
            return;
        }

        // If player is in a room, remove them
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

        // Notify the kicked player
        io.to(targetSocketId).emit('kicked', { 
            reason: reason || 'Kicked by admin',
            by: onlineUsers.get(socket.id).username
        });

        // Disconnect the player
        const targetSocket = io.sockets.sockets.get(targetSocketId);
        if (targetSocket) {
            targetSocket.disconnect(true);
        }

        // Remove from online users
        onlineUsers.delete(targetSocketId);
        io.emit('onlineCount', onlineUsers.size);

        socket.emit('adminSuccess', { message: `Player "${username}" has been kicked` });
    });

    // Get server info (admin only)
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

    // Broadcast message (admin only)
    socket.on('adminBroadcast', (data) => {
        if (!isAdmin(socket.id)) {
            socket.emit('adminError', { message: 'Unauthorized - Admin only' });
            return;
        }

        const { message } = data;
        const adminName = onlineUsers.get(socket.id).username;

        // Broadcast to all connected clients
        io.emit('adminBroadcast', {
            message: message,
            from: adminName,
            timestamp: new Date().toISOString()
        });

        socket.emit('adminSuccess', { message: 'Broadcast sent successfully' });
    });

    // Ban player (admin only)
    socket.on('adminBanPlayer', (data) => {
        if (!isAdmin(socket.id)) {
            socket.emit('adminError', { message: 'Unauthorized - Admin only' });
            return;
        }

        const { username, duration, reason } = data;
        let targetSocketId = null;
        let targetUser = null;

        // Find player by username
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

        // Can't ban other admins
        if (targetUser.isAdmin) {
            socket.emit('adminError', { message: 'Cannot ban other admins' });
            return;
        }

        // If player is in a room, remove them
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

        // Notify the banned player
        io.to(targetSocketId).emit('banned', { 
            reason: reason || 'Banned by admin',
            by: onlineUsers.get(socket.id).username,
            duration: duration
        });

        // Disconnect the player
        const targetSocket = io.sockets.sockets.get(targetSocketId);
        if (targetSocket) {
            targetSocket.disconnect(true);
        }

        // Remove from online users
        onlineUsers.delete(targetSocketId);
        io.emit('onlineCount', onlineUsers.size);

        const durationText = duration === 0 ? 'permanently' : `for ${duration} hour(s)`;
        socket.emit('adminSuccess', { message: `Player "${username}" has been banned ${durationText}` });
    });

    // Clear chat (admin only)
    socket.on('adminClearChat', (data) => {
        if (!isAdmin(socket.id)) {
            socket.emit('adminError', { message: 'Unauthorized - Admin only' });
            return;
        }

        const { type } = data;
        const adminName = onlineUsers.get(socket.id).username;

        if (type === 'lobby') {
            // Clear lobby chat
            lobbyMessages = [];
            io.emit('lobbyChatUpdate', { messages: [] });
            io.emit('lobbyChatCleared', { by: adminName });
            socket.emit('adminSuccess', { message: 'Lobby chat cleared' });
        } else if (type === 'current' || type === 'room') {
            // Clear current room chat
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
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`Online users: ${onlineUsers.size}`);
});