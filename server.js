const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);

app.use(express.static('public'));
app.use(express.json());

// In-memory room storage
const rooms = {}; 

// Simple Admin Login Endpoint
app.post('/api/admin-login', (req, res) => {
    const { password } = req.body;
    // Uses the Render environment variable. Keep 'admin123' as a fallback for local testing.
    if (password === (process.env.ADMIN_PASSWORD || 'admin123')) { 
        res.json({ success: true });
    } else {
        res.status(401).json({ success: false, message: 'Invalid password' });
    }
});

io.on('connection', (socket) => {
    console.log('User connected:', socket.id);

    // Admin creates a new room
    socket.on('create-room', () => {
        const roomCode = Math.floor(1000 + Math.random() * 9000).toString();
        rooms[roomCode] = { admin: socket.id, clients: [] };
        socket.join(roomCode);
        socket.emit('room-created', roomCode);
        console.log(`Room ${roomCode} created by Admin ${socket.id}`);
    });

    // Client attempts to join a room
    socket.on('join-room', (roomCode) => {
        const room = rooms[roomCode];
        
        if (!room) {
            socket.emit('join-error', 'Room does not exist.');
            return;
        }
        
        if (room.clients.length >= 4) {
            socket.emit('join-error', 'Room is full (Maximum 4 clients).');
            return;
        }

        room.clients.push(socket.id);
        socket.join(roomCode);
        socket.emit('join-success', roomCode);
        
        // Notify admin that a client joined
        socket.to(room.admin).emit('client-joined', { clientId: socket.id, totalClients: room.clients.length });
    });

    // WebRTC Signaling within Rooms
    socket.on('offer', (data) => {
        socket.to(data.target).emit('offer', { offer: data.offer, sender: socket.id });
    });

    socket.on('answer', (data) => {
        socket.to(data.target).emit('answer', { answer: data.answer, sender: socket.id });
    });

    socket.on('ice-candidate', (data) => {
        socket.to(data.target).emit('ice-candidate', { candidate: data.candidate, sender: socket.id });
    });

    // Chat Message Routing
    socket.on('chat-message', (data) => {
        io.to(data.roomCode).emit('chat-message', { sender: data.senderName, text: data.text });
    });

    socket.on('disconnect', () => {
        // Handle cleanup when clients or admins drop
        for (const code in rooms) {
            const room = rooms[code];
            if (room.admin === socket.id) {
                io.to(code).emit('room-closed');
                delete rooms[code];
            } else {
                const index = room.clients.indexOf(socket.id);
                if (index !== -1) {
                    room.clients.splice(index, 1);
                    io.to(room.admin).emit('client-left', { clientId: socket.id, totalClients: room.clients.length });
                }
            }
        }
    });
});

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => console.log(`On-Tour Server running on port ${PORT}`));
