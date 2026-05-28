# epubReader

Self-hosted online EPUB reader with Google login and cross-device reading-position sync.

## Quick start (dev)

1. `npm install` at the repo root.
2. Copy `server/.env.example` to `server/.env` and fill in `JWT_SECRET` and `GOOGLE_CLIENT_ID`.
3. Copy `client/.env.example` to `client/.env` and fill in `VITE_GOOGLE_CLIENT_ID`.
4. In one terminal: `npm run dev:server`.
5. In another terminal: `npm run dev:client`.
6. Open the URL Vite prints.

## Production

1. `npm run build:client`
2. `NODE_ENV=production npm start` — Express serves the built client and the API on `PORT`.

See `docs/superpowers/specs/` for the design and `docs/superpowers/plans/` for the implementation plan.
