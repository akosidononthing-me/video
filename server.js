const express=require('express');const http=require('http');const {Server}=require('socket.io');const crypto=require('crypto');
const app=express(),server=http.createServer(app),io=new Server(server);app.use(express.static('public'));
const rooms=new Map();
io.on('connection',socket=>{
 socket.on('create-room',(_,cb)=>{let code;do{code=crypto.randomBytes(3).toString('hex').toUpperCase()}while(rooms.has(code));rooms.set(code,{admin:socket.id,client:null});socket.join(code);socket.data={code,role:'admin'};cb({ok:true,code})});
 socket.on('join-room',(code,cb)=>{code=String(code||'').trim().toUpperCase();const r=rooms.get(code);if(!r)return cb({ok:false,error:'Room not found'});if(r.client)return cb({ok:false,error:'Room is full'});r.client=socket.id;socket.join(code);socket.data={code,role:'client'};cb({ok:true});io.to(r.admin).emit('peer-joined')});
 socket.on('signal',payload=>{const {code,role}=socket.data||{},r=rooms.get(code);if(!r||!payload||typeof payload!=='object')return;const target=role==='admin'?r.client:role==='client'?r.admin:null;if(target)io.to(target).emit('signal',payload)});
 socket.on('disconnect',()=>{const {code,role}=socket.data||{},r=rooms.get(code);if(!r)return;if(role==='admin'){if(r.client)io.to(r.client).emit('room-closed');rooms.delete(code)}else if(role==='client'){r.client=null;io.to(r.admin).emit('peer-left')}});
});server.listen(process.env.PORT||3000,()=>console.log('On Thing Connect ready'));
