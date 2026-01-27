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

app.use(express.static(path.join(__dirname, 'public')));

let rooms = {};

io.on('connection', (socket) => {
    console.log('User:', socket.id);

    // 1. Create Room
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

    // 2. Join Room (UPDATED FOR 4 PLAYERS)
    socket.on('joinRoom', ({ roomId, playerName }) => {
        const room = rooms[roomId];
        // Allow up to 4 players
        if (room && !room.gameStarted && room.players.length < 4) {
            room.players.push({ id: socket.id, name: playerName, role: 'joiner' });
            socket.join(roomId);
            io.to(roomId).emit('playerJoined', room.players);
        } else {
            socket.emit('errorMsg', "Room full or not found!");
        }
    });

    // 3. Start Game (Updated for Host-First Logic)
    socket.on('requestStart', (data) => {
        const room = rooms[data.roomId];
        if (room && room.host === socket.id) {
            room.gameStarted = true;
            
            // USE THE SEED FROM THE HOST (Or generate one if missing)
            // This ensures Host and Joiners see the exact same map generation
            const finalSeed = data.seed || Math.floor(Math.random() * 100000);
            
            console.log(`Host started game in ${data.roomId}. Broadcasting to Joiners.`);

            // Send to EVERYONE ELSE (Joiners)
            // The Host has already started locally, so we don't need to send it back to them.
            socket.to(data.roomId).emit('gameStart', { ...data, seed: finalSeed });
        }
    });

    // 4. Relay Actions
    socket.on('gameAction', (data) => {
        if(data.roomId) socket.to(data.roomId).emit('remoteAction', data);
    });

    // 5. Wave / Pause / Restart Relays
    socket.on('requestWave', (id) => { if(rooms[id]?.host === socket.id) io.to(id).emit('forceStartWave'); });
    socket.on('requestPause', (d) => { if(rooms[d.roomId]?.host === socket.id) io.to(d.roomId).emit('forcePause', d.isPaused); });
    socket.on('requestRestart', (id) => { if(rooms[id]?.host === socket.id) io.to(id).emit('forceRestart'); });
    
    socket.on('gameStateUpdate', (d) => { if(d.roomId) socket.to(d.roomId).emit('forceGameState', d); });

    // Disconnect
    socket.on('disconnect', () => {
        for (const id in rooms) {
            const r = rooms[id];
            r.players = r.players.filter(p => p.id !== socket.id);
            if (r.players.length === 0) delete rooms[id];
            else if (r.host === socket.id) io.to(id).emit('errorMsg', "Host disconnected.");
            else io.to(id).emit('playerJoined', r.players); // Update list for others
        }
    });
});

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => console.log(`Server on ${PORT}`));




