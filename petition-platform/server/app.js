import express from 'express';
import { DatabaseSync } from 'node:sqlite';

export function createApp({ allowedDomain = 'college.edu', db = new DatabaseSync(':memory:') } = {}) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS petitions (id INTEGER PRIMARY KEY, title TEXT NOT NULL, body TEXT NOT NULL, created TEXT DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE IF NOT EXISTS signatures (petition_id INTEGER NOT NULL REFERENCES petitions(id), email TEXT NOT NULL, name TEXT NOT NULL, UNIQUE(petition_id, email));`);
  const app = express();
  app.use(express.json());
  const clients = new Map(); // petition id -> Set(res)
  const count = (id) => db.prepare('SELECT COUNT(*) c FROM signatures WHERE petition_id=?').get(id).c;
  const bad = (res, m, c = 400) => res.status(c).json({ error: m });

  app.get('/api/petitions', (_req, res) => res.json(db.prepare(
    'SELECT p.id,p.title,p.body,(SELECT COUNT(*) FROM signatures s WHERE s.petition_id=p.id) AS signatures FROM petitions p ORDER BY p.id DESC').all()));

  app.post('/api/petitions', (req, res) => {
    const { title, body } = req.body ?? {};
    if (!title?.trim() || !body?.trim()) return bad(res, 'Title and body are required.');
    const r = db.prepare('INSERT INTO petitions(title,body) VALUES (?,?)').run(title.trim(), body.trim());
    res.status(201).json({ id: Number(r.lastInsertRowid), title: title.trim(), body: body.trim(), signatures: 0 });
  });

  app.put('/api/petitions/:id', (req, res) => { // the editor autosaves through this
    const { title, body } = req.body ?? {};
    if (!title?.trim() || typeof body !== 'string') return bad(res, 'Title and body are required.');
    const r = db.prepare('UPDATE petitions SET title=?, body=? WHERE id=?').run(title.trim(), body, req.params.id);
    r.changes ? res.json({ ok: true }) : bad(res, 'Petition not found.', 404);
  });

  app.post('/api/petitions/:id/sign', (req, res) => {
    const id = Number(req.params.id);
    const { name, email } = req.body ?? {};
    const e = String(email ?? '').trim().toLowerCase();
    if (!name?.trim()) return bad(res, 'Name is required.');
    if (!/^[^@\s]+@[^@\s]+$/.test(e) || !e.endsWith('@' + allowedDomain)) return bad(res, `Use your @${allowedDomain} email.`);
    if (!db.prepare('SELECT 1 FROM petitions WHERE id=?').get(id)) return bad(res, 'Petition not found.', 404);
    try { db.prepare('INSERT INTO signatures VALUES (?,?,?)').run(id, e, name.trim()); }
    catch { return bad(res, 'You have already signed.', 409); }
    const n = count(id);
    for (const c of clients.get(id) ?? []) c.write(`data: ${JSON.stringify({ signatures: n })}\n\n`);
    res.status(201).json({ signatures: n });
  });

  app.get('/api/petitions/:id/live', (req, res) => { // server-sent events: live counter
    const id = Number(req.params.id);
    res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' }).flushHeaders();
    res.write(`data: ${JSON.stringify({ signatures: count(id) })}\n\n`);
    if (!clients.has(id)) clients.set(id, new Set());
    clients.get(id).add(res);
    req.on('close', () => clients.get(id).delete(res));
  });

  app.use(express.static(new URL('../public', import.meta.url).pathname));
  return app;
}
