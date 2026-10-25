# On Thing Connect v3 — private admin + public clients

## Render deployment
1. Push the contents of this folder (including `server.js`, `package.json`, and `public`) to GitHub.
2. Render → New → Web Service → connect repository.
3. Build command: `npm install`; start command: `npm start`.
4. Set environment variables:
   - `ADMIN_PASSWORD`: a long, unique password of your choice (required).
   - `SESSION_SECRET`: a random, long secret, at least 32 characters (recommended).
5. Deploy.

## URLs
- **Private admin entry:** `https://YOUR-SERVICE.onrender.com/admin` (requires password).
- **Public client entry:** `https://YOUR-SERVICE.onrender.com/`.
The private URL is not a security boundary: the password and server-side room-creation checks protect Admin access. Keep the password secret.

## Features
- One Admin, up to 20 clients per room; Admin selects live camera or video file.
- Each client sees the Admin broadcast and can share their camera/mic.
- Admin sees client feeds in a gallery.
- Shared text chat, side-by-side layout, fullscreen monitor.
- Room codes are temporary; rooms are lost on service restart.

## Limitations / production requirements
- WebRTC peer-to-peer needs a TURN relay on restricted networks. Configure TURN credentials in `public/app.js` (the `ice` setting).
- The Admin uploads one stream per client; for large rooms use an SFU.
- Video file audio capture varies by browser and codec; test in Chrome/Edge.
- Login is a single environment-password session, not a multi-admin account system. Add rate limiting, CSRF protection, HTTPS-only cookie enforcement, logging, and durable session storage for high-security deployments.
- Room chat is ephemeral, not persisted. Anyone with the room code can join as a client.
- No automated real-device browser test was performed. Verify functionality before production use.

## On-Tour homepage and scheduler (v4)
- `/` is the public apartment-tour homepage, client sign-up/sign-in, tour request form and request history.
- `/admin` is the password-protected video-room interface; the homepage also displays Admin tour requests after Admin login.
- `/call` is the public room-code joining interface.
- Configure `ADMIN_PASSWORD` and `SESSION_SECRET` on Render as before.
- Tour requests and client accounts are stored in `ontour-data.json` by default. **Render's default filesystem is ephemeral**, so production requires a persistent disk and `DATA_FILE=/var/data/ontour-data.json`, or migration to PostgreSQL. The JSON file is suitable only for a single service instance.
- Tour times are preferred requests, not guaranteed available slots. Admin approves or declines them. No email confirmations or automatic room-code delivery yet.
- Passwords are salted and hashed. Add login rate limiting, password recovery, email verification, audit logs and CSRF protections before public production use.
- Photo URLs are illustrative Unsplash images, not actual apartment inventory.
