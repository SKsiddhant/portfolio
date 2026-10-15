# petition-platform

Campus petitions with a rich-text editor that autosaves, one signature per email address restricted to a college domain, and a live signature counter over server-sent events. Express + SQLite (`node:sqlite`). Demo data only.

Requires Node 22.13 or newer.

```bash
npm ci
npm start       # http://localhost:3000
npm test
```

| Variable | Default |
|---|---|
| `DOMAIN` | `college.edu` (only emails ending in this domain can sign) |
| `DB` | `petitions.db` |
| `PORT` | `3000` |

Note: this is a demo and has no user accounts. Anyone can create or edit petitions, so don't expose it publicly as is.
