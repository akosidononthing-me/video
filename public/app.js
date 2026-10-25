const socket = io();
const localVideo = document.getElementById('localVideo');
const remoteVideo = document.getElementById('remoteVideo');
const startCallBtn = document.getElementById('startCallBtn');

let localStream;
let peerConnection;

// Public STUN servers to resolve public IP addresses for the connection
const configuration = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' }
    ]
};

// 1. Initialize local camera feed
async function startLocalVideo() {
    try {
        localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        localVideo.srcObject = localStream;
    } catch (error) {
        console.error('Error accessing camera feed. Make sure you are using localhost or HTTPS:', error);
        alert('Could not connect to camera. Check permissions and ensure HTTPS is used.');
    }
}

// 2. Setup the WebRTC Peer Connection
function createPeerConnection() {
    peerConnection = new RTCPeerConnection(configuration);

    // Add local tracks (camera/mic) to the connection
    localStream.getTracks().forEach(track => {
        peerConnection.addTrack(track, localStream);
    });

    // Listen for the remote camera feed
    peerConnection.ontrack = (event) => {
        if (!remoteVideo.srcObject) {
            remoteVideo.srcObject = event.streams[0];
        }
    };

    // Send network candidates to the other peer via Socket.io
    peerConnection.onicecandidate = (event) => {
        if (event.candidate) {
            socket.emit('ice-candidate', event.candidate);
        }
    };
}

// 3. Initiate the Call
startCallBtn.addEventListener('click', async () => {
    startCallBtn.style.display = 'none';
    createPeerConnection();

    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);
    socket.emit('offer', offer);
});

// 4. Handle Incoming Call Signaling
socket.on('offer', async (offer) => {
    startCallBtn.style.display = 'none';
    createPeerConnection();
    await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
    
    const answer = await peerConnection.createAnswer();
    await peerConnection.setLocalDescription(answer);
    socket.emit('answer', answer);
});

socket.on('answer', async (answer) => {
    await peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
});

socket.on('ice-candidate', async (candidate) => {
    if (peerConnection) {
        await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
    }
});

// Start the local camera feed immediately on load
startLocalVideo();