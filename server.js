'use strict';
const express=require('express'),http=require('http'),crypto=require('crypto');
const {Server}=require('socket.io');
const app=express(),server=http.createServer(app),io=new Server(server);
const SECRET=process.env.SESSION_SECRET||crypto.randomBytes(32).toString('hex');
const ADMIN_PASSWORD=process.env.ADMIN_PASSWORD;
if(!ADMIN_PASSWORD){console.error('ADMIN_PASSWORD environment variable is required');process.exit(1)}
const rooms=new Map(),MAX_CLIENTS=20,TTL=12*60*60*1000;
const fs=require('fs'),path=require('path');
const DB=process.env.DATA_FILE||path.join(__dirname,'ontour-data.json');
let db={users:[],requests:[]};try{db=JSON.parse(fs.readFileSync(DB,'utf8'))}catch{}
function save(){const tmp=DB+'.tmp';fs.writeFileSync(tmp,JSON.stringify(db,null,2));fs.renameSync(tmp,DB)}
function hash(p,salt){return crypto.scryptSync(p,salt,64).toString('hex')}
function userFrom(req){const token=cookie(req).client_session;if(!token)return null;const [id,exp,sig]=token.split('.');if(!id||!exp||!sig||Number(exp)<Date.now())return null;const want=crypto.createHmac('sha256',SECRET).update(id+'.'+exp).digest('hex');const a=Buffer.from(sig),b=Buffer.from(want);return a.length===b.length&&crypto.timingSafeEqual(a,b)?db.users.find(u=>u.id===id):null}
function setClientCookie(res,u){const exp=String(Date.now()+TTL);const sig=crypto.createHmac('sha256',SECRET).update(u.id+'.'+exp).digest('hex');res.setHeader('Set-Cookie',`client_session=${u.id}.${exp}.${sig}; HttpOnly; SameSite=Lax; Path=/; Max-Age=43200; ${res.req.secure||res.req.headers['x-forwarded-proto']==='https'?'Secure':''}`)}
function publicUser(u){return u?{id:u.id,name:u.name,email:u.email}:null}

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
app.get('/call',(req,res)=>res.sendFile(__dirname+'/public/call.html'));
app.get('/admin',(req,res)=>res.sendFile(__dirname+'/public/index.html'));
app.get('/api/auth',(req,res)=>res.json({admin:authed(req)}));
app.get('/api/client/me',(req,res)=>res.json({user:publicUser(userFrom(req))}));
app.post('/api/client/signup',(req,res)=>{
 const name=String(req.body?.name||'').trim().slice(0,100),email=String(req.body?.email||'').trim().toLowerCase(),password=String(req.body?.password||'');
 if(name.length<2||!/^\S+@\S+\.\S+$/.test(email)||password.length<10)return res.status(400).json({error:'Enter name, valid email and password of at least 10 characters'});
 if(db.users.some(u=>u.email===email))return res.status(409).json({error:'Email already registered'});
 const salt=crypto.randomBytes(16).toString('hex'),u={id:crypto.randomUUID(),name,email,salt,passwordHash:hash(password,salt)};
 db.users.push(u);save();setClientCookie(res,u);res.json({user:publicUser(u)});
});
app.post('/api/client/login',(req,res)=>{
 const email=String(req.body?.email||'').trim().toLowerCase(),password=String(req.body?.password||'');const u=db.users.find(u=>u.email===email);
 if(!u||hash(password,u.salt)!==u.passwordHash)return res.status(401).json({error:'Invalid credentials'});
 setClientCookie(res,u);res.json({user:publicUser(u)});
});
app.post('/api/client/logout',(req,res)=>{res.setHeader('Set-Cookie','client_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0');res.json({ok:true})});
app.get('/api/tours',(req,res)=>{const u=userFrom(req);if(!u&&!authed(req))return res.status(401).json({error:'Sign in required'});
 res.json({requests:db.requests.filter(r=>authed(req)||r.userId===u.id).map(r=>({...r,userId:undefined}))});
});
app.post('/api/tours',(req,res)=>{
 const u=userFrom(req);if(!u)return res.status(401).json({error:'Create an account or sign in to request a tour'});
 const apartment=String(req.body?.apartment||'').trim().slice(0,100),date=String(req.body?.date||''),time=String(req.body?.time||''),notes=String(req.body?.notes||'').trim().slice(0,1000);
 const when=new Date(date+'T'+time+':00');if(!apartment||!/^\d{4}-\d{2}-\d{2}$/.test(date)||!/^\d{2}:\d{2}$/.test(time)||!Number.isFinite(when.getTime())||when.getTime()<Date.now()+3600000)return res.status(400).json({error:'Select an apartment and a future date/time (at least one hour ahead)'});
 if(db.requests.some(r=>r.date===date&&r.time===time&&r.status==='approved'))return res.status(409).json({error:'That time is already booked. Choose another.'});
 const r={id:crypto.randomUUID(),userId:u.id,name:u.name,email:u.email,apartment,date,time,notes,status:'pending',createdAt:new Date().toISOString(),roomCode:null};db.requests.push(r);save();res.json({request:r});
});
app.patch('/api/tours/:id',(req,res)=>{
 if(!authed(req))return res.status(403).json({error:'Admin login required'});
 const r=db.requests.find(x=>x.id===req.params.id);if(!r)return res.status(404).json({error:'Not found'});
 const status=String(req.body?.status||'');if(!['approved','declined','completed'].includes(status))return res.status(400).json({error:'Invalid status'});
 if(status==='approved'&&db.requests.some(x=>x.id!==r.id&&x.date===r.date&&x.time===r.time&&x.status==='approved'))return res.status(409).json({error:'Another tour already approved for this slot'});
 r.status=status;save();res.json({request:r});
});

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
