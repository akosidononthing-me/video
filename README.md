# On-Tour Simple v6

Removed: PostgreSQL, database, client sign-up/sign-in, and tour scheduling. No client account is needed.

Retained: landing page, private Admin password, Admin-created rooms, multi-client WebRTC, webcam/video-file broadcast, chat, gallery/side-by-side/fullscreen.

## Render deployment

- Replace your repository files with the contents of this ZIP.
- Build command: `npm install`
- Start command: `npm start`
- Set **ADMIN_PASSWORD** in Render Environment (required).
- `SESSION_SECRET` is optional. Without it, sessions reset whenever the server restarts; set a stable secret if desired.
- **DATABASE_URL is not used** and can be removed from Render Environment.
- Public homepage `/`, client call `/call`, Admin login `/admin`, Admin room `/call?admin=1`.

No client accounts or bookings are saved. Room state and chat are temporary. TURN may be needed for some networks.

## Testing
JavaScript syntax and ZIP integrity verified; no live browser-to-browser or Render deployment test performed.

## v7 design update
Added matching premium navy-and-gold Admin Studio and Client Live Tour dashboards. Preserved existing API endpoints, element IDs, and video call JavaScript. No database, client registration, or scheduler. Admin password remains required.
