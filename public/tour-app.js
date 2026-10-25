const socket = io();
const role = sessionStorage.getItem('role');
const roomCode = sessionStorage.getItem('roomCode');

if (!role || !roomCode) {
    window.location.href = '/'; // Redirect if accessed directly
}

document.getElementById('displayRoomCode').innerText = roomCode;

const mainVideo = document.getElementById('mainVideo');
const localVideo = document.getElementById('localVideo');
let localStream;
const peerConnections = {}; // Stores up to 4 client connections for the Admin

const config = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };

async function initCamera() {
    try {
        localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        localVideo.srcObject = localStream;
        
        // If this user is the Admin, they are the main broadcast
        if (role === 'admin') {
            mainVideo.srcObject = localStream;
            mainVideo.muted = true; 
            // Inform server admin has joined the live page
            socket.emit('create-room'); // In a real app, update logic to 'rejoin' rather than create anew
        } else {
            // Client joining the room
            socket.emit('join-room', roomCode);
        }
    } catch (e) {
        console.error("Camera error:", e);
    }
}

// -----------------------------------------
// ADMIN LOGIC: Broadcasting to Clients
// -----------------------------------------
socket.on('client-joined', async ({ clientId, totalClients }) => {
    if (role !== 'admin') return;
    
    document.getElementById('clientCount').innerText = `${totalClients} Clients Connected`;

    const pc = new RTCPeerConnection(config);
    peerConnections[clientId] = pc;

    // Send Admin's camera to the new client
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

// -----------------------------------------
// CLIENT LOGIC: Receiving Admin's Broadcast
// -----------------------------------------
socket.on('offer', async (data) => {
    if (role !== 'client') return;

    const pc = new RTCPeerConnection(config);
    peerConnections['admin'] = pc;

    // Display Admin's feed in the large main window
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

    // Client sends their camera back (optional, for admin monitoring)
    localStream.getTracks().forEach(track => pc.addTrack(track, localStream));

    await pc.setRemoteDescription(new RTCSessionDescription(data.offer));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    
    socket.emit('answer', { target: data.sender, answer });
});

// -----------------------------------------
// COMMON LOGIC: Answers & Network Routing
// -----------------------------------------
socket.on('answer', async (data) => {
    const pc = role === 'admin' ? peerConnections[data.sender] : peerConnections['admin'];
    if (pc) await pc.setRemoteDescription(new RTCSessionDescription(data.answer));
});

socket.on('ice-candidate', async (data) => {
    const pc = role === 'admin' ? peerConnections[data.sender] : peerConnections['admin'];
    if (pc) await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
});

socket.on('client-left', ({ totalClients }) => {
    document.getElementById('clientCount').innerText = `${totalClients} Clients Connected`;
});

// Leave Tour Button
document.getElementById('leaveBtn').addEventListener('click', () => {
    sessionStorage.clear();
    window.location.href = role === 'admin' ? 'admin.html' : 'index.html';
});

// Start the camera and connection process
initCamera();
