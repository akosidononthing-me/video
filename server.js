const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);

app.use(express.static('public'));

io.on('connection', (socket) => {
    socket.on('join', (role) => {
        socket.role = role;
        socket.join(role); // Joins either 'admin' or 'client' room
        console.log(`A ${role} connected:`, socket.id);
        
        // Notify admin when a new client joins
        if (role === 'client') {
            io.to('admin').emit('client-connected', socket.id);
        }
    });

    socket.on('offer', (data) => {
        socket.to(data.target).emit('offer', { offer: data.offer, sender: socket.id });
    });

    socket.on('answer', (data) => {
        socket.to(data.target).emit('answer', { answer: data.answer, sender: socket.id });
    });

    socket.on('ice-candidate', (data) => {
        socket.to(data.target).emit('ice-candidate', { candidate: data.candidate, sender: socket.id });
    });
});

http.listen(3000, () => console.log('Server running on http://localhost:3000'));