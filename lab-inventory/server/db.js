import { DatabaseSync } from 'node:sqlite';

export function openDb(path = ':memory:') {
  const db = new DatabaseSync(path);
  db.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY, username TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS items (
      id INTEGER PRIMARY KEY, sku TEXT UNIQUE NOT NULL, name TEXT NOT NULL, lab TEXT NOT NULL,
      quantity INTEGER NOT NULL CHECK (quantity >= 0), min_quantity INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS transactions (
      id INTEGER PRIMARY KEY, item_id INTEGER NOT NULL REFERENCES items(id),
      student TEXT NOT NULL, qty INTEGER NOT NULL CHECK (qty > 0),
      type TEXT NOT NULL CHECK (type IN ('issue','return')),
      at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, user_id INTEGER NOT NULL REFERENCES users(id)
    );
  `);
  return db;
}
