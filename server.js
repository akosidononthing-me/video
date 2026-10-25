io.on('connection', (socket) => {
    console.log('User connected:', socket.id);

    // 1. Admin creates a room from dashboard (reserves the code)
    socket.on('create-room', () => {
        const roomCode = Math.floor(1000 + Math.random() * 9000).toString();
        // Room is created, but video host (admin socket) is null until they open it
        rooms[roomCode] = { admin: null, clients: [] }; 
        socket.emit('room-created', roomCode);
        console.log(`Room ${roomCode} created on Dashboard.`);
    });

    // 2. Admin opens live-tour.html and claims the room host role
    socket.on('host-room', (roomCode) => {
        if (rooms[roomCode]) {
            rooms[roomCode].admin = socket.id;
            socket.join(roomCode);
            console.log(`Admin ${socket.id} is now hosting room ${roomCode}`);
            
            // Connect to any clients that joined while the admin was loading the page
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
        
        // If admin is already in the live room, notify them
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

    // WebRTC Signaling
    socket.on('offer', (data) => socket.to(data.target).emit('offer', { offer: data.offer, sender: socket.id }));
    socket.on('answer', (data) => socket.to(data.target).emit('answer', { answer: data.answer, sender: socket.id }));
    socket.on('ice-candidate', (data) => socket.to(data.target).emit('ice-candidate', { candidate: data.candidate, sender: socket.id }));

    // Disconnect cleanup
    socket.on('disconnect', () => {
        for (const code in rooms) {
            const room = rooms[code];
            if (room.admin === socket.id) {
                // Admin dropped from live call (you can choose to leave room alive or close it)
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
