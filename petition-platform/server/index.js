import { DatabaseSync } from 'node:sqlite';
import { createApp } from './app.js';
const app = createApp({ db: new DatabaseSync(process.env.DB ?? 'petitions.db'), allowedDomain: process.env.DOMAIN ?? 'college.edu' });
app.listen(process.env.PORT ?? 3000, () => console.log('Petition platform on :' + (process.env.PORT ?? 3000)));
