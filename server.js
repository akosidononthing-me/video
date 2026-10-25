'use strict';
const express=require('express'),http=require('http'),crypto=require('crypto');
const {Server}=require('socket.io');
const app=express(),server=http.createServer(app),io=new Server(server);
const SECRET=process.env.SESSION_SECRET;
if(!SECRET||SECRET.length<32){console.error('SESSION_SECRET (32+ characters) is required');process.exit(1)}
const ADMIN_PASSWORD=process.env.ADMIN_PASSWORD;
if(!ADMIN_PASSWORD){console.error('ADMIN_PASSWORD environment variable is required');process.exit(1)}
const rooms=new Map(),MAX_CLIENTS=20,TTL=12*60*60*1000;
const {Pool}=require('pg');
if(!process.env.DATABASE_URL){console.error('DATABASE_URL is required');process.exit(1)}
const pool=new Pool({connectionString:process.env.DATABASE_URL,ssl:process.env.PGSSLMODE==='require'?{rejectUnauthorized:false}:undefined});
async function initialize(){
 await pool.query(`CREATE TABLE IF NOT EXISTS clients (
 id uuid PRIMARY KEY, name varchar(100) NOT NULL,
 email varchar(320) NOT NULL UNIQUE, salt text NOT NULL,
 password_hash text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
 )`);
 await pool.query(`CREATE TABLE IF NOT EXISTS tour_requests (
 id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
 name varchar(100) NOT NULL, email varchar(320) NOT NULL,
 apartment varchar(100) NOT NULL, tour_date date NOT NULL,
 tour_time varchar(5) NOT NULL, notes varchar(1000) NOT NULL DEFAULT '',
 status varchar(16) NOT NULL DEFAULT 'pending'
 CHECK (status IN ('pending','approved','declined','completed')),
 created_at timestamptz NOT NULL DEFAULT now(), room_code varchar(16)
 )`);
 await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS unique_approved_tour_slot
 ON tour_requests(tour_date,tour_time) WHERE status='approved'`);
}
function hash(p,salt){return crypto.scryptSync(p,salt,64).toString('hex')}
function safeEq(a,b){const x=Buffer.from(a),y=Buffer.from(b);return x.length===y.length&&crypto.timingSafeEqual(x,y)}
async function userFrom(req){
 const token=cookie(req).client_session;if(!token)return null;
 const [id,exp,sig]=token.split('.');
 if(!id||!exp||!sig||Number(exp)<Date.now())return null;
 const want=crypto.createHmac('sha256',SECRET).update(id+'.'+exp).digest('hex');
 if(!safeEq(sig,want))return null;
 const {rows}=await pool.query('SELECT id,name,email FROM clients WHERE id=$1',[id]);
 return rows[0]||null;
}
function setClientCookie(res,u){
 const exp=String(Date.now()+TTL),sig=crypto.createHmac('sha256',SECRET).update(u.id+'.'+exp).digest('hex');
 res.setHeader('Set-Cookie',`client_session=${u.id}.${exp}.${sig}; HttpOnly; SameSite=Lax; Path=/; Max-Age=43200; ${res.req.secure||res.req.headers['x-forwarded-proto']==='https'?'Secure':''}`);
}
function publicUser(u){return u?{id:u.id,name:u.name,email:u.email}:null}
const route=fn=>(req,res,next)=>Promise.resolve(fn(req,res,next)).catch(next);
const tourFields=`id, user_id AS "userId", name,email,apartment,
to_char(tour_date,'YYYY-MM-DD') AS date,tour_time AS time,
notes,status,created_at AS "createdAt",room_code AS "roomCode"`;
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
app.get('/admin',(req,res)=>res.sendFile(__dirname+'/public/admin.html'));
app.get('/api/auth',(req,res)=>res.json({admin:authed(req)}));
app.get('/api/client/me',route(async(req,res)=>res.json({user:publicUser(await userFrom(req))})));
app.post('/api/client/signup',route(async(req,res)=>{
 const name=String(req.body?.name||'').trim().slice(0,100);
 const email=String(req.body?.email||'').trim().toLowerCase();
 const password=String(req.body?.password||'');
 if(name.length<2||email.length>320||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||password.length<10||password.length>256)
  return res.status(400).json({error:'Enter name, valid email and password of 10–256 characters'});
 const salt=crypto.randomBytes(16).toString('hex'),id=crypto.randomUUID();
 try{
  const {rows}=await pool.query(`INSERT INTO clients(id,name,email,salt,password_hash)
   VALUES($1,$2,$3,$4,$5) RETURNING id,name,email`,[id,name,email,salt,hash(password,salt)]);
  setClientCookie(res,rows[0]);res.json({user:publicUser(rows[0])});
 }catch(e){if(e.code==='23505')return res.status(409).json({error:'Email already registered'});throw e}
}));
app.post('/api/client/login',route(async(req,res)=>{
 const email=String(req.body?.email||'').trim().toLowerCase(),password=String(req.body?.password||'');
 const {rows}=await pool.query('SELECT id,name,email,salt,password_hash FROM clients WHERE email=$1',[email]);
 const u=rows[0];if(!u||!safeEq(hash(password,u.salt),u.password_hash))
  return res.status(401).json({error:'Invalid credentials'});
 setClientCookie(res,u);res.json({user:publicUser(u)});
}));
app.post('/api/client/logout',(req,res)=>{
 res.setHeader('Set-Cookie','client_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0');res.json({ok:true});
});
app.get('/api/tours',route(async(req,res)=>{
 const admin=authed(req),u=admin?null:await userFrom(req);
 if(!admin&&!u)return res.status(401).json({error:'Sign in required'});
 const {rows}=admin?await pool.query(`SELECT ${tourFields} FROM tour_requests ORDER BY created_at DESC`)
  :await pool.query(`SELECT ${tourFields} FROM tour_requests WHERE user_id=$1 ORDER BY created_at DESC`,[u.id]);
 res.json({requests:rows.map(({userId,...rest})=>rest)});
}));
app.post('/api/tours',route(async(req,res)=>{
 const u=await userFrom(req);
 if(!u)return res.status(401).json({error:'Create an account or sign in to request a tour'});
 const apartment=String(req.body?.apartment||'').trim().slice(0,100),
 date=String(req.body?.date||''),time=String(req.body?.time||''),
 notes=String(req.body?.notes||'').trim().slice(0,1000);
 const when=new Date(date+'T'+time+':00');
 if(!apartment||!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(date)||!/^(?:[01][0-9]|2[0-3]):[0-5][0-9]$/.test(time)||
 !Number.isFinite(when.getTime())||when.getTime()<Date.now()+3600000)
  return res.status(400).json({error:'Select an apartment and a future date/time (at least one hour ahead)'});
 const existing=await pool.query(`SELECT 1 FROM tour_requests WHERE tour_date=$1 AND tour_time=$2 AND status='approved' LIMIT 1`,[date,time]);
 if(existing.rowCount)return res.status(409).json({error:'That time is already booked. Choose another.'});
 const {rows}=await pool.query(`INSERT INTO tour_requests
 (id,user_id,name,email,apartment,tour_date,tour_time,notes)
 VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING ${tourFields}`,
 [crypto.randomUUID(),u.id,u.name,u.email,apartment,date,time,notes]);
 res.json({request:rows[0]});
}));
app.patch('/api/tours/:id',route(async(req,res)=>{
 if(!authed(req))return res.status(403).json({error:'Admin login required'});
 const status=String(req.body?.status||'');
 if(!['approved','declined','completed'].includes(status))return res.status(400).json({error:'Invalid status'});
 try{
  const {rows}=await pool.query(`UPDATE tour_requests SET status=$1 WHERE id=$2 RETURNING ${tourFields}`,[status,req.params.id]);
  if(!rows.length)return res.status(404).json({error:'Not found'});
  res.json({request:rows[0]});
 }catch(e){
  if(e.code==='23505')return res.status(409).json({error:'Another tour already approved for this slot'});
  throw e;
 }
}));
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
app.use((err,req,res,next)=>{console.error('Request error:',err);if(!res.headersSent)res.status(500).json({error:'Server error'});});
initialize().then(()=>server.listen(process.env.PORT||3000,'0.0.0.0',()=>console.log('On-Tour PostgreSQL server listening'))).catch(e=>{console.error('Database initialization failed:',e);process.exit(1)});
