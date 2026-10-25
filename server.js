'use strict';
const express=require('express'),http=require('http'),crypto=require('crypto');
const {Server}=require('socket.io');
const app=express(),server=http.createServer(app),io=new Server(server);
const SECRET=process.env.SESSION_SECRET||crypto.randomBytes(32).toString('hex');
const ADMIN_PASSWORD=process.env.ADMIN_PASSWORD;
if(!ADMIN_PASSWORD){console.error('ADMIN_PASSWORD environment variable is required');process.exit(1)}
const rooms=new Map(),MAX_CLIENTS=20,TTL=12*60*60*1000;
app.use(express.json({limit:'16kb'}));
app.use('/assets',express.static('public',{index:false}));
const cookie=(req)=>Object.fromEntries((req.headers.cookie||'').split(';').map(x=>x.trim().split('=').slice(0,2)).filter(x=>x.length===2));
function valid(token){
 if(!token)return false;
 const [exp,sig]=token.split('.');
 if(!exp||!sig||!(/^\d+$/.test(exp))||Number(exp)<Date.now())return false;
 const expected=crypto.createHmac('sha256',SECRET).update(exp).digest('hex');
 const a=Buffer.from(sig),b=Buffer.from(expected);
 return a.length===b.length&&crypto.timingSafeEqual(a,b);
}
function authed(req){return valid(cookie(req).admin_session)}
app.get('/',(req,res)=>res.sendFile(__dirname+'/public/index.html'));
app.get('/admin',(req,res)=>res.sendFile(__dirname+'/public/index.html'));
app.get('/api/auth',(req,res)=>res.json({admin:authed(req)}));
app.post('/api/login',(req,res)=>{
 const given=Buffer.from(String(req.body?.password||'')),want=Buffer.from(ADMIN_PASSWORD);
 if(given.length!==want.length||!crypto.timingSafeEqual(given,want))return res.status(401).json({error:'Incorrect admin password'});
 const exp=String(Date.now()+TTL),sig=crypto.createHmac('sha256',SECRET).update(exp).digest('hex');
 res.setHeader('Set-Cookie',`admin_session=${exp}.${sig}; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200; ${req.secure||req.headers['x-forwarded-proto']==='https'?'Secure; ':''}`);
 res.json({ok:true});
});
app.post('/api/logout',(req,res)=>{res.setHeader('Set-Cookie','admin_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');res.json({ok:true})});
const ack=(cb,obj)=>{if(typeof cb==='function')cb(obj)};
io.on('connection',socket=>{
 const isAdmin=()=>valid(cookie(socket.request).admin_session);
 socket.on('create-room',(_,cb)=>{
  if(!isAdmin())return ack(cb,{ok:false,error:'Admin login required'});
  if(socket.data.code)return ack(cb,{ok:false,error:'Already in a room'});
  let code;do{code=crypto.randomBytes(4).toString('hex').toUpperCase()}while(rooms.has(code));
  rooms.set(code,{admin:socket.id,clients:new Set()});
  socket.data={code,role:'admin'};socket.join(code);ack(cb,{ok:true,code});
 });
 socket.on('join-room',(raw,cb)=>{
  if(socket.data.code)return ack(cb,{ok:false,error:'Already in a room'});
  const code=String(raw||'').trim().toUpperCase(),r=rooms.get(code);
  if(!r)return ack(cb,{ok:false,error:'Room not found'});
  if(r.clients.size>=MAX_CLIENTS)return ack(cb,{ok:false,error:'Room is full'});
  r.clients.add(socket.id);socket.data={code,role:'client'};socket.join(code);
  ack(cb,{ok:true,code});io.to(r.admin).emit('client-joined',{id:socket.id,count:r.clients.size});
  io.to(code).emit('room-count',r.clients.size);
 });
 socket.on('signal',msg=>{
  const {code,role}=socket.data,r=rooms.get(code);if(!r||!msg||typeof msg!=='object')return;
  const to=String(msg.to||'');
  if(role==='admin'&&(!isAdmin()||!r.clients.has(to)))return;
  if(role==='client'&&to!==r.admin)return;
  if(msg.description&&['offer','answer'].includes(msg.description.type)&&typeof msg.description.sdp==='string'&&msg.description.sdp.length<100000)
   io.to(to).emit('signal',{from:socket.id,description:msg.description});
  else if(msg.candidate&&typeof msg.candidate.candidate==='string')
   io.to(to).emit('signal',{from:socket.id,candidate:msg.candidate});
 });
 socket.on('chat-message',(raw,cb)=>{
  const {code,role}=socket.data,r=rooms.get(code);
  if(!r||(role==='admin'&&(!isAdmin()||r.admin!==socket.id))||(role==='client'&&!r.clients.has(socket.id)))
   return ack(cb,{ok:false,error:'Not in room'});
  const body=String(raw||'').trim().slice(0,1500);
  if(!body)return ack(cb,{ok:false,error:'Empty message'});
  const msg={from:role==='admin'?'Admin':'Client '+socket.id.slice(0,6),senderId:socket.id,body,time:Date.now()};
  io.to(code).emit('chat-message',msg);ack(cb,{ok:true});
 });
 socket.on('leave-room',()=>leave(socket));
 socket.on('disconnect',()=>leave(socket));
});
function leave(socket){
 const {code,role}=socket.data,r=rooms.get(code);if(!r)return;
 if(role==='admin'&&r.admin===socket.id){io.to(code).emit('room-closed');rooms.delete(code)}
 else if(role==='client'&&r.clients.delete(socket.id)){
  io.to(r.admin).emit('client-left',{id:socket.id,count:r.clients.size});
  io.to(code).emit('room-count',r.clients.size);
 }
 socket.leave(code);socket.data={};
}
server.listen(process.env.PORT||3000,'0.0.0.0',()=>console.log('On Thing Connect v3 listening'));
