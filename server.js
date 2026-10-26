const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);

app.use(express.static('public'));
app.use(express.json());

// In-memory room storage
const rooms = {}; 

// Admin Login Endpoint
app.post('/api/admin-login', (req, res) => {
    const { password } = req.body;
    if (password === (process.env.ADMIN_PASSWORD || 'admin123')) { 
        res.json({ success: true });
    } else {
        res.status(401).json({ success: false, message: 'Invalid password' });
    }
});

io.on('connection', (socket) => {
    console.log('User connected:', socket.id);

    // 1. Admin creates a room from dashboard
    socket.on('create-room', () => {
        const roomCode = Math.floor(1000 + Math.random() * 9000).toString();
        rooms[roomCode] = { admin: null, clients: [] }; 
        socket.emit('room-created', roomCode);
    });

    // 2. Admin opens live-tour.html and claims the room host role
    socket.on('host-room', (roomCode) => {
        if (rooms[roomCode]) {
            rooms[roomCode].admin = socket.id;
            socket.join(roomCode);
            
            rooms[roomCode].clients.forEach(clientId => {
                socket.emit('client-joined', { clientId: clientId, totalClients: rooms[roomCode].clients.length });
            });
        }
    });

    // 3. Client joins
    socket.on('join-room', (roomCode) => {
        const room = rooms[roomCode];
        
        if (!room) {
            socket.emit('join-error', 'Room does not exist. Please check the code.');
            return;
        }
        if (room.clients.length >= 4) {
            socket.emit('join-error', 'Room is full (Maximum 4 clients).');
            return;
        }

        room.clients.push(socket.id);
        socket.join(roomCode);
        socket.emit('join-success', roomCode);
        
        if (room.admin) {
            socket.to(room.admin).emit('client-joined', { clientId: socket.id, totalClients: room.clients.length });
        }
    });

    // 4. Manual room deletion from Admin Dashboard
    socket.on('delete-room', (roomCode) => {
        if (rooms[roomCode]) {
            io.to(roomCode).emit('room-closed');
            delete rooms[roomCode];
        }
    });

    // Chat Message Routing
    socket.on('chat-message', (data) => {
        io.to(data.roomCode).emit('chat-message', { sender: data.senderName, text: data.text });
    });

    // WebRTC Signaling
    socket.on('offer', (data) => socket.to(data.target).emit('offer', { offer: data.offer, sender: socket.id }));
    socket.on('answer', (data) => socket.to(data.target).emit('answer', { answer: data.answer, sender: socket.id }));
    socket.on('ice-candidate', (data) => socket.to(data.target).emit('ice-candidate', { candidate: data.candidate, sender: socket.id }));

    // Disconnect cleanup
    socket.on('disconnect', () => {
        for (const code in rooms) {
            const room = rooms[code];
            if (room.admin === socket.id) {
                io.to(code).emit('room-closed');
                delete rooms[code];
            } else {
                const index = room.clients.indexOf(socket.id);
                if (index !== -1) {
                    room.clients.splice(index, 1);
                    if (room.admin) {
                        io.to(room.admin).emit('client-left', { clientId: socket.id, totalClients: room.clients.length });
                    }
                }
            }
        }
    });
});

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => {
    console.log(`On-Tour Server running on port ${PORT}`);
});
