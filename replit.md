# Great Light Centre

Great Light Centre is a single-page church website served by the small Node.js server in `server.js`.

## Run

Use `node server.js` to serve the site on port 5000. The server serves the static website and exposes:

- `GET /api/health` — lightweight health check
- `POST /api/contact` — validates and stores prayer/contact messages in `data/messages.json`

Images are supplied by the project in `attached_assets/`. The app intentionally has no package dependencies or build step.