import express from 'express';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { openDb } from './db.js';
import { parseCsv, toCsv } from './csv.js';

export function createApp({ db = openDb(), secret = process.env.JWT_SECRET || 'dev-only-secret' } = {}) {
  const app = express();
  app.use(express.json({ limit: '1mb' }));
  app.use(express.text({ type: 'text/csv', limit: '2mb' }));

  const bad = (res, msg, code = 400) => res.status(code).json({ error: msg });
  const posInt = (v) => Number.isInteger(v) && v >= 0;

  /* ---------- auth ---------- */
  app.post('/api/register', (req, res) => {
    const { username, password } = req.body ?? {};
    if (typeof username !== 'string' || username.trim().length < 3) return bad(res, 'Username must be at least 3 characters.');
    if (typeof password !== 'string' || password.length < 8) return bad(res, 'Password must be at least 8 characters.');
    try {
      const r = db.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)').run(username.trim(), bcrypt.hashSync(password, 10));
      res.status(201).json({ id: Number(r.lastInsertRowid), username: username.trim() });
    } catch { bad(res, 'That username is taken.', 409); }
  });

  app.post('/api/login', (req, res) => {
    const { username, password } = req.body ?? {};
    const u = db.prepare('SELECT * FROM users WHERE username = ?').get(String(username ?? ''));
    if (!u || !bcrypt.compareSync(String(password ?? ''), u.password_hash)) return bad(res, 'Wrong username or password.', 401);
    res.json({ token: jwt.sign({ sub: u.id, name: u.username }, secret, { expiresIn: '8h' }), username: u.username });
  });

  const auth = (req, res, next) => {
    const h = req.headers.authorization ?? '';
    try { req.user = jwt.verify(h.replace(/^Bearer /, ''), secret); next(); }
    catch { bad(res, 'Sign in to continue.', 401); }
  };
  app.use('/api/items', auth);
  app.use('/api/transactions', auth);

  /* ---------- items ---------- */
  const withLow = (r) => ({ ...r, low: r.quantity <= r.min_quantity });

  app.get('/api/items', (req, res) => {
    const q = `%${req.query.q ?? ''}%`, lab = req.query.lab ?? '';
    const rows = db.prepare(`SELECT * FROM items WHERE (name LIKE ? OR sku LIKE ?) AND (? = '' OR lab = ?) ORDER BY lab, name`).all(q, q, lab, lab);
    res.json(rows.map(withLow));
  });

  function readItem(b) {
    const item = { sku: String(b.sku ?? '').trim(), name: String(b.name ?? '').trim(), lab: String(b.lab ?? '').trim(), quantity: Number(b.quantity), min_quantity: Number(b.min_quantity ?? 0) };
    if (!item.sku || !item.name || !item.lab) return { error: 'SKU, name and lab are required.' };
    if (!posInt(item.quantity) || !posInt(item.min_quantity)) return { error: 'Quantities must be whole numbers, zero or more.' };
    return { item };
  }

  app.post('/api/items', (req, res) => {
    const { item, error } = readItem(req.body ?? {});
    if (error) return bad(res, error);
    try {
      const r = db.prepare('INSERT INTO items (sku,name,lab,quantity,min_quantity) VALUES (?,?,?,?,?)').run(item.sku, item.name, item.lab, item.quantity, item.min_quantity);
      res.status(201).json(withLow({ id: Number(r.lastInsertRowid), ...item }));
    } catch { bad(res, `SKU ${item.sku} already exists.`, 409); }
  });

  app.put('/api/items/:id', (req, res) => {
    const { item, error } = readItem(req.body ?? {});
    if (error) return bad(res, error);
    try {
      const r = db.prepare('UPDATE items SET sku=?,name=?,lab=?,quantity=?,min_quantity=? WHERE id=?').run(item.sku, item.name, item.lab, item.quantity, item.min_quantity, req.params.id);
      if (!r.changes) return bad(res, 'Item not found.', 404);
      res.json(withLow({ id: Number(req.params.id), ...item }));
    } catch { bad(res, `SKU ${item.sku} already exists.`, 409); }
  });

  app.delete('/api/items/:id', (req, res) => {
    try {
      const r = db.prepare('DELETE FROM items WHERE id=?').run(req.params.id);
      r.changes ? res.status(204).end() : bad(res, 'Item not found.', 404);
    } catch { bad(res, 'This item has transactions and cannot be deleted.', 409); }
  });

  app.get('/api/items-export.csv', auth, (req, res) => {
    const rows = db.prepare('SELECT sku,name,lab,quantity,min_quantity FROM items ORDER BY lab,name').all();
    res.type('text/csv').attachment('inventory.csv').send(toCsv([['sku', 'name', 'lab', 'quantity', 'min_quantity'], ...rows.map((r) => [r.sku, r.name, r.lab, r.quantity, r.min_quantity])]));
  });

  app.post('/api/items-import', auth, (req, res) => {
    if (typeof req.body !== 'string') return bad(res, 'Send the CSV as text/csv.');
    const [head, ...rows] = parseCsv(req.body);
    const cols = (head ?? []).map((h) => h.trim().toLowerCase());
    for (const need of ['sku', 'name', 'lab', 'quantity']) if (!cols.includes(need)) return bad(res, `Missing column: ${need}`);
    const upsert = db.prepare(`INSERT INTO items (sku,name,lab,quantity,min_quantity) VALUES (?,?,?,?,?)
      ON CONFLICT(sku) DO UPDATE SET name=excluded.name, lab=excluded.lab, quantity=excluded.quantity, min_quantity=excluded.min_quantity`);
    const errors = []; let imported = 0;
    db.exec('BEGIN');
    rows.forEach((r, i) => {
      const o = Object.fromEntries(cols.map((c, k) => [c, r[k]]));
      const { item, error } = readItem(o);
      if (error) return errors.push({ line: i + 2, error });
      upsert.run(item.sku, item.name, item.lab, item.quantity, item.min_quantity); imported++;
    });
    db.exec('COMMIT');
    res.json({ imported, errors });
  });

  /* ---------- transactions ---------- */
  app.post('/api/transactions', (req, res) => {
    const { itemId, student, qty, type } = req.body ?? {};
    if (!['issue', 'return'].includes(type)) return bad(res, 'Type must be issue or return.');
    if (typeof student !== 'string' || !student.trim()) return bad(res, 'Student name is required.');
    if (!Number.isInteger(qty) || qty < 1) return bad(res, 'Quantity must be a whole number of at least 1.');
    db.exec('BEGIN IMMEDIATE');
    try {
      const item = db.prepare('SELECT * FROM items WHERE id=?').get(itemId);
      if (!item) { db.exec('ROLLBACK'); return bad(res, 'Item not found.', 404); }
      if (type === 'issue' && item.quantity < qty) { db.exec('ROLLBACK'); return bad(res, `Only ${item.quantity} in stock.`, 409); }
      const next = item.quantity + (type === 'issue' ? -qty : qty);
      db.prepare('UPDATE items SET quantity=? WHERE id=?').run(next, itemId);
      db.prepare('INSERT INTO transactions (item_id,student,qty,type,user_id) VALUES (?,?,?,?,?)').run(itemId, student.trim(), qty, type, req.user.sub);
      db.exec('COMMIT');
      res.status(201).json({ itemId, quantity: next });
    } catch (e) { db.exec('ROLLBACK'); bad(res, 'Could not record the transaction.', 500); }
  });

  app.get('/api/transactions', (req, res) => {
    res.json(db.prepare(`SELECT t.id,t.student,t.qty,t.type,t.at,i.name AS item,i.sku FROM transactions t JOIN items i ON i.id=t.item_id ORDER BY t.id DESC LIMIT 100`).all());
  });

  return app;
}
