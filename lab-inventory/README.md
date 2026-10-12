# lab-inventory

Inventory tracker for college labs: items with low-stock flags, issue/return transactions per student, CSV import/export, and login. Express + SQLite (`node:sqlite`) API with a React (Vite) client. Demo data only.

Requires Node 22.13 or newer.

```bash
npm ci
npm run client:build                  # builds client/dist, which the server serves
JWT_SECRET=change-me npm start        # http://localhost:3000
npm test
```

| Variable | Purpose |
|---|---|
| `JWT_SECRET` | Signs login tokens. **Required when `NODE_ENV=production`.** Outside production a random one is generated per run, so logins end on restart. |
| `DB_PATH` | SQLite file (default `inventory.db`) |
| `PORT` | Port (default 3000) |

For client development run `npm run client:dev` alongside the server.
