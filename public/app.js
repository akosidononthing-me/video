'use strict';
const $=id=>document.getElementById(id),socket=io(),adminPath=new URLSearchParams(location.search).has('admin');
let role='',room='',camera=null,source=null,fileUrl=null,micMuted=false,side=false;
const peers=new Map(),pending=new Map(),ice={iceServers:[{urls:'stun:stun.l.google.com:19302'}]};
const status=s=>$('status').textContent=s,err=s=>$('entryError').textContent=s;
async function authUI(){
 $('entryTitle').textContent=adminPath?'Private Admin Access':'Join a video room';
 $('intro').textContent=adminPath?'Log in to create and control rooms.':'Enter the room code from the admin.';
 $('clientEntry').hidden=adminPath;
 if(adminPath){const r=await fetch('/api/auth');const j=await r.json();$('loginPanel').hidden=j.admin;$('adminEntry').hidden=!j.admin}
}
authUI().catch(e=>err(e.message));
$('login').onclick=async()=>{
 const r=await fetch('/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:$('password').value})});
 if(!r.ok)return err('Incorrect admin password');err('');await authUI();
};
$('logout').onclick=async()=>{await fetch('/api/logout',{method:'POST'});location.reload()};
function show(){
 $('entry').hidden=true;$('call').hidden=false;$('role').textContent=role==='admin'?'Admin':'Client';
 $('room').textContent=room;$('adminTools').hidden=role!=='admin';
 $('remoteLabel').textContent=role==='admin'?'Client camera':'Admin broadcast';
}
async function ensureCamera(){
 if(camera?.getTracks().some(t=>t.readyState==='live'))return camera;
 if(!navigator.mediaDevices?.getUserMedia)throw Error('Camera requires HTTPS or localhost');
 try{camera=await navigator.mediaDevices.getUserMedia({video:true,audio:true})}
 catch(e){
  if(['NotFoundError','NotReadableError','OverconstrainedError'].includes(e.name)){
   camera=await navigator.mediaDevices.getUserMedia({video:true,audio:false});
   status('Camera active (microphone unavailable).');
  }else throw e;
 }
 if(role==='client')source=camera;
 if(role==='client')$('local').srcObject=camera;
 return camera;
}
function clientFeed(id){
 let el=document.getElementById('feed-'+id);
 if(!el){
  el=document.createElement('div');el.className='feed';el.id='feed-'+id;
  const v=document.createElement('video');v.autoplay=true;v.playsInline=true;v.muted=true;v.setAttribute('muted','');
  const label=document.createElement('span');label.textContent='Client '+id.slice(0,6);
  el.append(v,label);$('videoGrid').append(el);
 }
 return el.querySelector('video');
}
function makePeer(id){
 if(peers.has(id))return peers.get(id);
 const pc=new RTCPeerConnection(ice);peers.set(id,pc);pending.set(id,[]);
 pc.oniceconnectionstatechange=()=>{
  if(['failed','disconnected'].includes(pc.iceConnectionState))
   status('Video connection '+pc.iceConnectionState+'. A TURN server may be required on these networks.');
 };
 pc.onicecandidate=e=>{if(e.candidate)socket.emit('signal',{to:id,candidate:e.candidate.toJSON()})};
 pc.ontrack=e=>{
  const video=role==='admin'?clientFeed(id):$('remote');
  if(e.streams[0])video.srcObject=e.streams[0];
  else{const stream=video.srcObject||new MediaStream();stream.addTrack(e.track);video.srcObject=stream}
  video.play().catch(()=>status('Client feed received. Click the video to play.'));
  if(role==='client')$('waiting').hidden=true;
 };
 pc.onconnectionstatechange=()=>status('Peer '+id.slice(0,6)+': '+pc.connectionState);
 for(const kind of ['video','audio']){
  const track=source?.getTracks().find(t=>t.kind===kind);
  pc.addTransceiver(track||kind,{direction:'sendrecv',streams:track&&source?[source]:[]});
 }
 return pc;
}
async function flush(id){
 const pc=peers.get(id),q=pending.get(id)||[];
 if(!pc?.remoteDescription)return;
 while(q.length){try{await pc.addIceCandidate(q.shift())}catch(e){console.warn(e)}}
}
async function offer(id){
 const pc=makePeer(id);await pc.setLocalDescription(await pc.createOffer());
 socket.emit('signal',{to:id,description:pc.localDescription});
}
async function switchSource(stream){
 source=stream;
 if(role==='admin')$('local').srcObject=stream;
 for(const pc of peers.values()){
  for(const kind of ['video','audio']){
   const sender=pc.getTransceivers().find(t=>t.receiver.track.kind===kind)?.sender;
   if(sender)await sender.replaceTrack(stream.getTracks().find(t=>t.kind===kind)||null);
  }
 }
}
$('create').onclick=()=>{
 socket.emit('create-room',{},async r=>{
  if(!r?.ok)return err(r?.error||'Room creation failed');
  role='admin';room=r.code;show();$('adminFeed').hidden=true;status('Share this code with clients.');
  try{await switchSource(await ensureCamera());status('Live camera ready. Share the room code.')}
  catch(e){status('Camera unavailable; select a video file. '+e.message)}
 });
};
$('join').onclick=()=>{
 socket.emit('join-room',$('code').value,async r=>{
  if(!r?.ok)return err(r?.error||'Unable to join');
  role='client';room=r.code;show();
  try{await ensureCamera();status('Camera ready. Waiting for Admin.')}
  catch(e){status('Camera unavailable: '+e.message+'. Allow camera access in browser settings, then press Enable camera.')}
 });
};
socket.on('client-joined',async ({id,count})=>{
 if(role!=='admin')return;$('count').textContent=count;
 try{await offer(id)}catch(e){status('Connection error: '+e.message)}
});
socket.on('client-left',({id,count})=>{
 peers.get(id)?.close();peers.delete(id);pending.delete(id);
 document.getElementById('feed-'+id)?.remove();$('count').textContent=count;
});
socket.on('room-count',n=>$('count').textContent=n);
socket.on('signal',async msg=>{
 if(!msg?.from)return;
 const id=msg.from;
 try{
  const pc=makePeer(id);
  if(msg.description){
   await pc.setRemoteDescription(msg.description);await flush(id);
   if(msg.description.type==='offer'){
    if(role==='client'&&!source){try{await ensureCamera()}catch(e){console.warn(e)}}
    for(const kind of ['video','audio']){
     const sender=pc.getTransceivers().find(t=>t.receiver.track.kind===kind)?.sender;
     if(sender)await sender.replaceTrack(source?.getTracks().find(t=>t.kind===kind)||null);
    }
    await pc.setLocalDescription(await pc.createAnswer());
    socket.emit('signal',{to:id,description:pc.localDescription});
   }
  }else if(msg.candidate){
   if(pc.remoteDescription)await pc.addIceCandidate(msg.candidate);
   else pending.get(id).push(msg.candidate);
  }
 }catch(e){status('WebRTC error: '+e.message);console.error(e)}
});
socket.on('room-closed',()=>{alert('Admin closed the room.');location.reload()});
socket.on('disconnect',()=>status('Server disconnected. Reload to reconnect.'));
socket.on('chat-message',msg=>{
 const d=document.createElement('div');d.className='msg';
 const b=document.createElement('b');b.textContent=msg.from;
 const t=document.createElement('time');t.textContent=new Date(msg.time).toLocaleTimeString();
 const body=document.createElement('div');body.textContent=msg.body;
 d.append(b,t,body);$('messages').append(d);$('messages').scrollTop=$('messages').scrollHeight;
});
$('chatForm').onsubmit=e=>{
 e.preventDefault();const v=$('chatInput').value.trim();if(!v)return;
 socket.emit('chat-message',v,r=>{if(!r?.ok)status(r?.error||'Chat failed')});
 $('chatInput').value='';
};
$('cam').onclick=async()=>{
 try{const s=await ensureCamera();if(role==='client')await switchSource(s);status('Camera enabled')}
 catch(e){status('Camera error: '+e.message)}
};
$('useCam').onclick=async()=>{
 try{$('filePreview').pause();await switchSource(await ensureCamera());status('Broadcasting live camera')}
 catch(e){status('Camera error: '+e.message)}
};
$('useFile').onclick=async()=>{
 const f=$('file').files[0];if(!f)return status('Select a video file first');
 const v=$('filePreview');
 try{
  if(fileUrl)URL.revokeObjectURL(fileUrl);fileUrl=URL.createObjectURL(f);v.src=fileUrl;v.loop=true;v.muted=false;
  await v.play();
  if(typeof v.captureStream!=='function')throw Error('Use a compatible Chrome or Edge browser');
  const stream=v.captureStream();
  for(let i=0;i<20&&!stream.getVideoTracks().length;i++)await new Promise(r=>setTimeout(r,100));
  if(!stream.getVideoTracks().length)throw Error('No video track captured');
  await switchSource(stream);status('Broadcasting video file. Audio support depends on browser.');
 }catch(e){status('File error: '+e.message)}
};
$('mic').onclick=()=>{
 micMuted=!micMuted;for(const t of camera?.getAudioTracks()||[])t.enabled=!micMuted;
 $('mic').textContent=micMuted?'Unmute mic':'Mute mic';
};
$('copy').onclick=()=>navigator.clipboard.writeText(room).then(()=>status('Room code copied')).catch(()=>status('Room code: '+room));
$('layout').onclick=()=>{
 side=!side;$('workspace').classList.toggle('side',side);$('layout').textContent=side?'Standard layout':'Side by side';
};
$('fullscreen').onclick=async()=>{
 try{if(document.fullscreenElement)await document.exitFullscreen();else await $('workspace').requestFullscreen()}
 catch(e){status('Fullscreen unavailable: '+e.message)}
};
$('end').onclick=()=>{socket.emit('leave-room');location.reload()};
