const socket = io();
const role = sessionStorage.getItem('role');
const roomCode = sessionStorage.getItem('roomCode');

if (!role || !roomCode) {
    window.location.href = '/'; 
}

document.getElementById('displayRoomCode').innerText = roomCode;

const mainVideo = document.getElementById('mainVideo');
const localVideo = document.getElementById('localVideo');
let localStream;
const peerConnections = {}; 

const config = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };

async function initCamera() {
    try {
        localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        localVideo.srcObject = localStream;
        
        if (role === 'admin') {
            mainVideo.srcObject = localStream;
            mainVideo.muted = true; 
            socket.emit('host-room', roomCode); 
        } else {
            socket.emit('join-room', roomCode);
        }
    } catch (e) {
        console.error("Camera error:", e);
        alert('Could not access camera/microphone.');
    }
}

// ADMIN LOGIC
socket.on('client-joined', async ({ clientId, totalClients }) => {
    if (role !== 'admin') return;
    
    document.getElementById('clientCount').innerText = `${totalClients} Clients Connected`;

    const pc = new RTCPeerConnection(config);
    peerConnections[clientId] = pc;

    localStream.getTracks().forEach(track => pc.addTrack(track, localStream));

    pc.onicecandidate = (event) => {
        if (event.candidate) {
            socket.emit('ice-candidate', { target: clientId, candidate: event.candidate });
        }
    };

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    socket.emit('offer', { target: clientId, offer });
});

// CLIENT LOGIC
socket.on('offer', async (data) => {
    if (role !== 'client') return;

    const pc = new RTCPeerConnection(config);
    peerConnections['admin'] = pc;

    pc.ontrack = (event) => {
        if (!mainVideo.srcObject) {
            mainVideo.srcObject = event.streams[0];
        }
    };

    pc.onicecandidate = (event) => {
        if (event.candidate) {
            socket.emit('ice-candidate', { target: data.sender, candidate: event.candidate });
        }
    };

    localStream.getTracks().forEach(track => pc.addTrack(track, localStream));

    await pc.setRemoteDescription(new RTCSessionDescription(data.offer));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    
    socket.emit('answer', { target: data.sender, answer });
});

// COMMON WEBRTC
socket.on('answer', async (data) => {
    const pc = role === 'admin' ? peerConnections[data.sender] : peerConnections['admin'];
    if (pc) await pc.setRemoteDescription(new RTCSessionDescription(data.answer));
});

socket.on('ice-candidate', async (data) => {
    const pc = role === 'admin' ? peerConnections[data.sender] : peerConnections['admin'];
    if (pc) await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
});

socket.on('client-left', ({ totalClients }) => {
    if (role === 'admin') {
        document.getElementById('clientCount').innerText = `${totalClients} Clients Connected`;
    }
});

socket.on('room-closed', () => {
    alert('This tour has ended.');
    sessionStorage.clear();
    window.location.href = '/';
});

// CHAT LOGIC
document.getElementById('sendBtn').addEventListener('click', () => {
    const input = document.getElementById('chatInput');
    if (input.value.trim()) {
        socket.emit('chat-message', { 
            roomCode, 
            senderName: role === 'admin' ? 'Admin' : 'Client', 
            text: input.value 
        });
        input.value = '';
    }
});

socket.on('chat-message', (data) => {
    const msgDiv = document.createElement('div');
    msgDiv.className = 'msg';
    msgDiv.innerHTML = `<div class="msg-sender">${data.sender}</div><div class="msg-bubble">${data.text}</div>`;
    document.getElementById('chatMessages').appendChild(msgDiv);
    document.getElementById('chatMessages').scrollTop = document.getElementById('chatMessages').scrollHeight;
});

// CONTROLS
document.getElementById('leaveBtn').addEventListener('click', () => {
    sessionStorage.clear();
    window.location.href = role === 'admin' ? 'admin.html' : 'index.html';
});

initCamera();
