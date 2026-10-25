const $=id=>document.getElementById(id);
async function refresh(){try{const r=await fetch('/api/auth');const j=await r.json();$('loginPanel').hidden=!!j.admin;$('adminPanel').hidden=!j.admin}catch(e){$('loginError').textContent='Connection error: '+e.message}}
$('loginForm').onsubmit=async e=>{e.preventDefault();$('loginError').textContent='';try{const r=await fetch('/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:$('adminPassword').value})});if(!r.ok)throw Error('Incorrect Admin password');await refresh()}catch(e){$('loginError').textContent=e.message}};
$('signout').onclick=async()=>{await fetch('/api/logout',{method:'POST'});await refresh()};refresh();
