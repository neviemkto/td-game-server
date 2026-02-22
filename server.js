const express = require('express');
const app = express();
const http = require('http').createServer(app);
const path = require('path');
const io = require('socket.io')(http, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

// --- 1. SETUP & CONFIGURATION ---
const PORT = process.env.PORT || 3000;

// Serve the game files
app.use(express.static(path.join(__dirname, 'public')));

// Uptime Check
app.get('/', (req, res) => {
    res.send(`Karlo's TD Server is Running! Identity: ${SERVER_NAME}`);
});

// --- 2. LOCATION & IDENTITY SYSTEM ---
const regionMap = {
    'oregon': '🇺🇸 US West (Oregon)',
    'ohio': '🇺🇸 US East (Ohio)',
    'virginia': '🇺🇸 US East (Virginia)',
    'frankfurt': '🇩🇪 EU Central (Frankfurt)',
    'singapore': '🇸🇬 Asia (Singapore)',
    'washington_dc': '🇺🇸 US East (Washington)'
};

const SERVER_NAME = process.env.SERVER_NAME || "Local Test Server";
const RAW_REGION = process.env.RENDER_REGION || "local";

function getPrettyLocation(raw) {
    if (!raw || raw === 'local') return '🏠 Localhost (Dev Mode)';
    const key = raw.toLowerCase().trim();
    return regionMap[key] || `📍 ${raw}`;
}

const PRETTY_LOCATION = getPrettyLocation(RAW_REGION);

console.log("==========================================");
console.log(`🚀 SERVER STARTED`);
console.log(`🆔 NAME:     ${SERVER_NAME}`);
console.log(`🌍 LOCATION: ${PRETTY_LOCATION}`);
console.log("==========================================");

// --- 3. GAME STATE ---
let rooms = {};

// ── Room Registry (for server browser) ──────────────────────────────────────
// IMPORTANT: This MUST be at module scope (outside the connection handler).
// If it were inside io.on('connection'), every socket would get its own
// fresh empty registry and rooms announced by one player would be invisible
// to everyone else's getRooms query.
const roomRegistry = {}; // { roomId: { roomId, hostName, isPrivate, playerCount, status, expiresAt } }

// Clean expired rooms every 20 seconds (also at module scope — runs once, forever)
setInterval(() => {
    const now = Date.now();
    for (const id in roomRegistry) {
        if (roomRegistry[id].expiresAt < now) {
            delete roomRegistry[id];
        }
    }
}, 20000);

// --- 4. SOCKET LOGIC ---
io.on('connection', (socket) => {
    console.log(`[${SERVER_NAME}] New Connection: ${socket.id}`);

    socket.on('ping', () => {
        socket.emit('pong');
    });

    // Tell the client who we are immediately
    socket.emit('serverInfo', {
        name: SERVER_NAME,
        location: PRETTY_LOCATION,
        region: RAW_REGION
    });

    // --- ROOM REGISTRY EVENTS (use shared module-scope roomRegistry) ---

    // Host announces their room (called every 15s by the client)
    socket.on('announceRoom', (data) => {
        const { roomId, hostName, isPrivate, playerCount, status } = data;
        if (!roomId) return;

        if (status === 'playing') {
            // Game started — remove from public list immediately
            delete roomRegistry[roomId];
        } else {
            roomRegistry[roomId] = {
                roomId,
                hostName:     hostName    || 'Host',
                hostSocketId: socket.id,   // track who owns this entry for disconnect cleanup
                isPrivate:    isPrivate   || false,
                playerCount:  playerCount || 1,
                status:       status      || 'waiting',
                expiresAt:    Date.now() + 40000  // expires in 40s if host goes silent
            };
        }
    });

    // Anyone can request the room list
    socket.on('getRooms', () => {
        const publicRooms = Object.values(roomRegistry)
            .filter(r => r.status !== 'playing');
        socket.emit('rooms', publicRooms);
    });

    // --- ROOM MANAGEMENT ---

    // Create Room
    socket.on('createRoom', (playerName) => {
        const roomId = Math.random().toString(36).substring(2, 6).toUpperCase();
        rooms[roomId] = {
            host: socket.id,
            players: [{ id: socket.id, name: playerName, role: 'host' }],
            gameStarted: false,
            createdAt: Date.now()
        };
        socket.join(roomId);
        socket.emit('roomCreated', { roomId, players: rooms[roomId].players });
        console.log(`Room Created: ${roomId} by ${playerName}`);
    });

    // Join Room
    socket.on('joinRoom', ({ roomId, playerName }) => {
        const room = rooms[roomId];
        if (room && !room.gameStarted && room.players.length < 4) {
            room.players.push({ id: socket.id, name: playerName, role: 'joiner' });
            socket.join(roomId);
            io.to(roomId).emit('playerJoined', room.players);
            console.log(`${playerName} joined room ${roomId}`);
        } else {
            socket.emit('errorMsg', "Room full, started, or does not exist!");
        }
    });

    // Start Game
    socket.on('requestStart', (data) => {
        const room = rooms[data.roomId];
        if (room && room.host === socket.id) {
            room.gameStarted = true;
            const finalSeed = data.seed || Math.floor(Math.random() * 100000);
            io.to(data.roomId).emit('gameStart', { ...data, seed: finalSeed });
        }
    });

    // --- GAMEPLAY RELAY ---
    socket.on('gameAction', (data) => {
        if (data.roomId) socket.to(data.roomId).emit('remoteAction', data);
    });

    socket.on('requestWave', (id) => {
        if (rooms[id]?.host === socket.id) io.to(id).emit('forceStartWave');
    });

    socket.on('requestPause', (d) => {
        if (rooms[d.roomId]?.host === socket.id) io.to(d.roomId).emit('forcePause', d.isPaused);
    });

    socket.on('requestRestart', (id) => {
        if (rooms[id]?.host === socket.id) io.to(id).emit('forceRestart');
    });

    socket.on('gameStateUpdate', (d) => {
        if (d.roomId) socket.to(d.roomId).emit('forceGameState', d);
    });

    // --- DISCONNECT LOGIC ---
    socket.on('disconnect', () => {
        // Clean up any room the socket was hosting from the registry
        for (const id in roomRegistry) {
            if (roomRegistry[id].hostSocketId === socket.id) {
                delete roomRegistry[id];
            }
        }

        for (const id in rooms) {
            const r = rooms[id];
            const pIndex = r.players.findIndex(p => p.id === socket.id);

            if (pIndex !== -1) {
                r.players.splice(pIndex, 1);

                if (r.players.length === 0) {
                    delete rooms[id];
                    delete roomRegistry[id]; // also clean registry
                } else if (r.host === socket.id) {
                    io.to(id).emit('hostLeft');
                    delete rooms[id];
                    delete roomRegistry[id]; // also clean registry
                } else {
                    io.to(id).emit('playerLeft', socket.id);
                    if (!r.gameStarted) io.to(id).emit('playerJoined', r.players);
                }
                break;
            }
        }
        console.log(`Disconnected: ${socket.id}`);
    });
});

// Start Server
http.listen(PORT, () => console.log(`Server running on port ${PORT}`));
