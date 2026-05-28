# epubReader

Self-hosted online EPUB reader with Google login and cross-device reading-position sync.

Stack: Node + Express + SQLite on the server; React + Vite + [foliate-js](https://github.com/johnfactotum/foliate-js) on the client.

## Setup (one-time, after cloning)

1. **Install dependencies** at the repo root:
   ```bash
   npm install
   ```

2. **Vendor foliate-js** into the client (it's not on npm and not committed):
   ```bash
   git clone --depth 1 https://github.com/johnfactotum/foliate-js.git client/public/foliate-js
   rm -rf client/public/foliate-js/.git
   ```

3. **Create a Google OAuth Web client** at <https://console.cloud.google.com/apis/credentials>:
   - Type: *Web application*.
   - Authorized JavaScript origins: `http://localhost:5173` and `http://localhost:3001` (add your HTTPS production URL when you deploy).
   - Copy the *Client ID* (the *Client Secret* is not needed).

4. **Configure env files**:
   ```bash
   cp server/.env.example server/.env
   cp client/.env.example client/.env
   ```
   Edit both:
   - `server/.env`: set `GOOGLE_CLIENT_ID` and generate a `JWT_SECRET`:
     ```bash
     node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
     ```
   - `client/.env`: set `VITE_GOOGLE_CLIENT_ID` to the **same** Client ID.

## Running in development

Two terminals:

```bash
npm run dev:server   # Express on :3001
```

```bash
npm run dev:client   # Vite on :5173, proxies /api to :3001
```

Open <http://localhost:5173>.

### Accessing from another device on your LAN

Vite is already configured with `host: true` and tolerant `allowedHosts`, so other devices on your network can hit `http://<your-mac-ip>:5173`. **However**, Google Sign-In refuses non-HTTPS origins other than `localhost`, so you need an HTTPS URL. The simplest options:

- **Cloudflare quick tunnel** (no account needed):
  ```bash
  cloudflared tunnel --url http://localhost:5173
  ```
  Add the resulting `https://*.trycloudflare.com` URL to *Authorized JavaScript origins* in Google Cloud Console.

- **Tailscale**, **ngrok**, or local TLS via **mkcert** are also fine.

## Production build

```bash
npm run build:client                  # generates client/dist/
NODE_ENV=production npm start         # Express serves /api and the SPA on $PORT
```

Put it behind Nginx/Caddy with TLS in a real deployment.

## Testing

```bash
npm test --workspaces                 # 33 server tests, 2 client tests
```

## Data

Everything lives under `server/data/` (gitignored):

- `library.db` — SQLite with `users`, `books`, `reading_progress`.
- `books/<userId>/<bookId>.epub` — uploaded files.
- `books/<userId>/<bookId>.<ext>` — extracted covers.

Back up `server/data/` to back up the app.

## Layout

```
server/                  Express API + SQLite
client/                  React + Vite + foliate-js
docs/superpowers/        Design spec and implementation plan
```

See `docs/superpowers/specs/` for the full design.
