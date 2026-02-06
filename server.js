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

// ==================================================
// 📍 LOCATION DETECTION (ROBUST VERSION)
// ==================================================
const regionMap = {
    'oregon': '🇺🇸 US West (Oregon)',
    'ohio': '🇺🇸 US East (Ohio)',
    'virginia': '🇺🇸 US East (Virginia)',
    'frankfurt': '🇩🇪 EU Central (Frankfurt)',
    'singapore': '🇸🇬 Asia (Singapore)',
    'washington_dc': '🇺🇸 US East (Washington)' 
};

// Helper to normalize the region string
function getRegionName(rawRegion) {
    if (!rawRegion) return '🌍 Global (Online)';
    const key = rawRegion.toLowerCase().trim(); // Convert "Ohio" -> "ohio"
    return regionMap[key] || `📍 ${rawRegion}`; // Fallback: Just show the raw name if not in map
}

const serverLocation = getRegionName(process.env.RENDER_REGION);

// DEBUG: Print this to your Render Dashboard Logs to check what it finds
console.log("------------------------------------------------");
console.log("RAW REGION DETECTED:", process.env.RENDER_REGION);
console.log("FINAL LOCATION NAME:", serverLocation);
console.log("------------------------------------------------");
// ==================================================

let rooms = {};

io.on('connection', (socket) => {
    console.log('User:', socket.id);

    // 1. Send Location Immediately
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
        if (room && !room.gameStarted && room.players.length < 4) {
            room.players.push({ id: socket.id, name: playerName, role: 'joiner' });
            socket.join(roomId);
            io.to(roomId).emit('playerJoined', room.players);
        } else {
            socket.emit('errorMsg', "Room full or not found!");
        }
    });

    // 4. Start Game (YOUR ORIGINAL WORKING LOGIC)
    socket.on('requestStart', (data) => {
        const room = rooms[data.roomId];
        if (room && room.host === socket.id) {
            room.gameStarted = true;
            const finalSeed = data.seed || Math.floor(Math.random() * 100000);
            
            // Broadcast start
            io.to(data.roomId).emit('gameStart', { ...data, seed: finalSeed });
        }
    });

    // 5. Relay Actions
    socket.on('gameAction', (data) => { if(data.roomId) socket.to(data.roomId).emit('remoteAction', data); });
    socket.on('requestWave', (id) => { if(rooms[id]?.host === socket.id) io.to(id).emit('forceStartWave'); });
    socket.on('requestPause', (d) => { if(rooms[d.roomId]?.host === socket.id) io.to(d.roomId).emit('forcePause', d.isPaused); });
    socket.on('requestRestart', (id) => { if(rooms[id]?.host === socket.id) io.to(id).emit('forceRestart'); });
    socket.on('gameStateUpdate', (d) => { if(d.roomId) socket.to(d.roomId).emit('forceGameState', d); });

    socket.on('disconnect', () => {
        for (const id in rooms) {
            const r = rooms[id];
            const pIndex = r.players.findIndex(p => p.id === socket.id);
            if (pIndex !== -1) {
                r.players.splice(pIndex, 1);
                if (r.players.length === 0) delete rooms[id];
                else if (r.host === socket.id) { io.to(id).emit('hostLeft'); delete rooms[id]; }
                else { r.gameStarted ? io.to(id).emit('playerLeft', socket.id) : io.to(id).emit('playerJoined', r.players); }
                break;
            }
        }
    });
});

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => console.log(`Server running on port ${PORT}`));
