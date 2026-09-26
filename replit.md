# Great Light Centre

Great Light Centre is a single-page church website served by the small Node.js server in `server.js`.

## Run

Use `node server.js` to serve the site on port 5000. The server serves the static website and exposes:

- `GET /api/health` — lightweight health check
- `POST /api/contact` — validates and stores prayer/contact messages in `data/messages.json`
- `GET /api/events` — public upcoming event feed
- `/admin` — password-protected event editor for the church team

The admin editor uses the `ADMIN_PASSWORD` secret for sign-in and `SESSION_SECRET` to sign sessions. Published events are stored in `data/events.json` and appear automatically on the homepage.

Images are supplied by the project in `attached_assets/`. The app intentionally has no package dependencies or build step.

The homepage also includes a local worship player for the supplied “No Longer Slaves” MP3 and a YouTube search button labeled “Great light Centre Langata.”

## Vercel

`vercel.json` routes the public site, `/admin`, and `/api/*` requests through the Node handler in `server.js`. Add both `ADMIN_PASSWORD` and `SESSION_SECRET` as Vercel environment variables before signing in to the admin panel, then redeploy.