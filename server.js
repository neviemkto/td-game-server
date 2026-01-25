const express = require('express');
const app = express();
const http = require('http').createServer(app);
const path = require('path');

// FIX 1: Allow Itch.io to connect (CORS)
const io = require('socket.io')(http, {
    cors: {
        origin: "*", // This means "Allow anyone to connect"
        methods: ["GET", "POST"]
    }
});

// Serve your HTML file
app.use(express.static(path.join(__dirname, 'public')));

let rooms = {}; // Stores active lobbies

io.on('connection', (socket) => {
    console.log('A user connected:', socket.id);

    // 1. Create a Room (Host)
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

    // 2. Join a Room
    socket.on('joinRoom', ({ roomId, playerName }) => {
        const room = rooms[roomId];
        if (room && !room.gameStarted && room.players.length < 2) {
            room.players.push({ id: socket.id, name: playerName, role: 'joiner' });
            socket.join(roomId);
            io.to(roomId).emit('playerJoined', room.players);
        } else {
            socket.emit('errorMsg', "Room not found or full!");
        }
    });

    // 3. Host Starts Game
    socket.on('requestStart', (data) => {
        const room = rooms[data.roomId];
        if (room && room.host === socket.id) {
            room.gameStarted = true;
            room.mapIndex = data.mapIndex;
            const mapSeed = Math.floor(Math.random() * 100000);
            io.to(data.roomId).emit('gameStart', { ...data, seed: mapSeed });
        }
    });

    // 4. Relay Game Actions
    socket.on('gameAction', (actionData) => {
        if(actionData.roomId) {
            socket.to(actionData.roomId).emit('remoteAction', actionData);
        }
    });

    // 5. Host Starts Wave
    socket.on('requestWave', (roomId) => {
        const room = rooms[roomId];
        if(room && room.host === socket.id) {
            io.to(roomId).emit('forceStartWave');
        }
    });

    // 6. Host Pause/Resume
    socket.on('requestPause', (data) => {
        const room = rooms[data.roomId];
        if(room && room.host === socket.id) {
            io.to(data.roomId).emit('forcePause', data.isPaused);
        }
    });

    // Relay Game Over / Victory
    socket.on('gameStateUpdate', (data) => {
        if(data.roomId) {
            socket.to(data.roomId).emit('forceGameState', data);
        }
    });

    // Relay Restart
    socket.on('requestRestart', (roomId) => {
        const room = rooms[roomId];
        if(room && room.host === socket.id) {
            io.to(roomId).emit('forceRestart');
        }
    });

    // Handle Disconnect
    socket.on('disconnect', () => {
        for (const roomId in rooms) {
            const room = rooms[roomId];
            if(room) { // Check if room exists
                room.players = room.players.filter(p => p.id !== socket.id);
                if (room.players.length === 0) {
                    delete rooms[roomId];
                } else if (room.host === socket.id) {
                    io.to(roomId).emit('errorMsg', "Host has disconnected.");
                }
            }
        }
    });
});

// FIX 2: Use the Dynamic Port provided by Render
const PORT = process.env.PORT || 3000;
http.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});