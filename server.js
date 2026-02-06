const express = require('express');
const app = express();

// --- UPTIME ROBOT CHECK ---
app.get('/', (req, res) => {
    res.send('Server is running! KTD');
});

const http = require('http').createServer(app);
const path = require('path');

const io = require('socket.io')(http, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

app.use(express.static(path.join(__dirname, 'public')));

// --- LOCATION DETECTION ---
// Render.com provides the region in process.env.RENDER_REGION
const regionMap = {
    'oregon': '🇺🇸 US West (Oregon)',
    'ohio': '🇺🇸 US East (Ohio)',
    'frankfurt': '🇩🇪 EU Central (Germany)',
    'singapore': '🇸🇬 Asia (Singapore)',
    'virginia': '🇺🇸 US East (Virginia)'
};

// Get the region or default to "Global"
const serverLocation = process.env.RENDER_REGION 
    ? (regionMap[process.env.RENDER_REGION] || `📍 ${process.env.RENDER_REGION}`) 
    : '🌍 Global (Online)';

let rooms = {};

io.on('connection', (socket) => {
    console.log('User connected:', socket.id);

    // 1. IMMEDIATELY SEND LOCATION TO CLIENT
    socket.emit('serverInfo', { location: serverLocation });

    // 2. Create Room
    socket.on('createRoom', (playerName) => {
        const roomId = Math.random().toString(36).substring(2, 6).toUpperCase();
        rooms[roomId] = {
            host: socket.id,
            players: [{ id: socket.id, name: playerName, role: 'host' }],
            gameStarted: false
        };
        socket.join(roomId);
        socket.emit('roomCreated', { roomId, players: rooms[roomId].players });
    });

    // 3. Join Room
    socket.on('joinRoom', ({ roomId, playerName }) => {
        const room = rooms[roomId];
        
        if (room) {
            if (room.players.length < 4 && !room.gameStarted) {
                room.players.push({ id: socket.id, name: playerName, role: 'joiner' });
                socket.join(roomId);
                
                // Notify everyone (including the new joiner)
                io.to(roomId).emit('playerJoined', room.players);
                
                // Send the current game state if needed (optional)
                socket.emit('roomJoined', { roomId, players: room.players });
            } else {
                socket.emit('errorMsg', room.gameStarted ? 'Game already started!' : 'Room is full!');
            }
        } else {
            socket.emit('errorMsg', 'Room not found!');
        }
    });

    // 4. Start Game
    socket.on('startGame', (roomId) => {
        if (rooms[roomId] && rooms[roomId].host === socket.id) {
            rooms[roomId].gameStarted = true;
            io.to(roomId).emit('forceStartWave'); 
        }
    });

    // 5. Game Actions (Relay to room)
    socket.on('gameAction', (data) => {
        // Broadcast to everyone in the room EXCEPT sender
        socket.to(data.roomId).emit('remoteAction', data);
    });

    // 6. Pause Sync
    socket.on('pauseGame', ({ roomId, state }) => {
        socket.to(roomId).emit('forcePause', state);
    });

    // Disconnect Handler
    socket.on('disconnect', () => {
        for (const id in rooms) {
            const r = rooms[id];
            const pIndex = r.players.findIndex(p => p.id === socket.id);
            
            if (pIndex !== -1) {
                r.players.splice(pIndex, 1);
                
                if (r.players.length === 0) {
                    delete rooms[id];
                }
                else if (r.host === socket.id) {
                    io.to(id).emit('hostLeft'); 
                    delete rooms[id];
                }
                else {
                    if (r.gameStarted) {
                        io.to(id).emit('playerLeft', socket.id);
                    } else {
                        io.to(id).emit('playerJoined', r.players);
                    }
                }
                break;
            }
        }
    });
});

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`Detected Location: ${serverLocation}`);
});
