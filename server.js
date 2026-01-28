const express = require('express');
const app = express();
// --- ADD THIS TO FIX UPTIMEROBOT ---
app.get('/', (req, res) => {
    res.send('Server is running! KTD');
});
// -----------------------------------
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

    // 3. Start Game (OPRAVENÉ: Posiela signál VŠETKÝM, vrátane Hosta)
    socket.on('requestStart', (data) => {
        const room = rooms[data.roomId];
        if (room && room.host === socket.id) {
            room.gameStarted = true;
            
            // Generovanie seedu, ak chýba
            const finalSeed = data.seed || Math.floor(Math.random() * 100000);
            
            console.log(`Host started game in ${data.roomId}. Broadcasting to EVERYONE (including Host).`);

            // ZMENA: Používame 'io.to' namiesto 'socket.to'
            // Toto zabezpečí, že aj Host dostane event 'gameStart' a načíta mapu cez socket.on('gameStart')
            io.to(data.roomId).emit('gameStart', { ...data, seed: finalSeed });
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

    // Disconnect Handler
    socket.on('disconnect', () => {
        for (const id in rooms) {
            const r = rooms[id];
            const pIndex = r.players.findIndex(p => p.id === socket.id);
            
            if (pIndex !== -1) {
                // Remove the player from the list
                r.players.splice(pIndex, 1);
                
                // Scenario 1: Room is now empty -> Delete it
                if (r.players.length === 0) {
                    delete rooms[id];
                }
                // Scenario 2: Host Disconnected -> Nuke the room
                else if (r.host === socket.id) {
                    io.to(id).emit('hostLeft'); // Tell everyone to go to Main Menu
                    delete rooms[id];
                }
                // Scenario 3: Joiner Disconnected
                else {
                    if (r.gameStarted) {
                        // Game is running: Just notify (Don't switch screens!)
                        io.to(id).emit('playerLeft', socket.id);
                    } else {
                        // Still in Lobby: Update the player list UI
                        io.to(id).emit('playerJoined', r.players);
                    }
                }
                break; // Stop looking, we found the room
            }
        }
    });
});

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => console.log(`Server on ${PORT}`));







