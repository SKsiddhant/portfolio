import { createApp } from './app.js';
import { openDb } from './db.js';
import express from 'express';
import { fileURLToPath } from 'node:url';

const app = createApp({ db: openDb(process.env.DB_PATH || 'inventory.db') });
app.use(express.static(fileURLToPath(new URL('../client/dist', import.meta.url))));
const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Lab inventory on http://localhost:${port}`));
