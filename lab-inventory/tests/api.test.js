import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../server/app.js';

async function boot() {
  const server = createApp().listen(0);
  const base = `http://localhost:${server.address().port}`;
  const call = async (path, { method = 'GET', body, token, csv } = {}) => {
    const r = await fetch(base + path, {
      method,
      headers: { ...(csv ? { 'Content-Type': 'text/csv' } : body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: csv ?? (body ? JSON.stringify(body) : undefined),
    });
    const text = await r.text();
    let json; try { json = JSON.parse(text); } catch { json = text; }
    return { status: r.status, json };
  };
  await call('/api/register', { method: 'POST', body: { username: 'incharge', password: 'longenough1' } });
  const { json } = await call('/api/login', { method: 'POST', body: { username: 'incharge', password: 'longenough1' } });
  return { call, token: json.token, close: () => server.close() };
}

test('auth is required and bad logins are rejected', async () => {
  const { call, close } = await boot();
  assert.equal((await call('/api/items')).status, 401);
  assert.equal((await call('/api/login', { method: 'POST', body: { username: 'incharge', password: 'nope' } })).status, 401);
  assert.equal((await call('/api/register', { method: 'POST', body: { username: 'x', password: 'short' } })).status, 400);
  close();
});

test('item CRUD with validation and duplicate SKUs', async () => {
  const { call, token, close } = await boot();
  const item = { sku: 'R-10K', name: 'Resistor 10k', lab: 'Electronics', quantity: 50, min_quantity: 10 };
  const made = await call('/api/items', { method: 'POST', token, body: item });
  assert.equal(made.status, 201);
  assert.equal((await call('/api/items', { method: 'POST', token, body: item })).status, 409);
  assert.equal((await call('/api/items', { method: 'POST', token, body: { ...item, sku: 'Z', quantity: -1 } })).status, 400);
  const upd = await call(`/api/items/${made.json.id}`, { method: 'PUT', token, body: { ...item, quantity: 5 } });
  assert.equal(upd.json.low, true);
  const list = await call('/api/items?q=resistor', { token });
  assert.equal(list.json.length, 1);
  assert.equal((await call(`/api/items/${made.json.id}`, { method: 'DELETE', token })).status, 204);
  close();
});

test('issuing reduces stock, cannot overdraw, returns add back', async () => {
  const { call, token, close } = await boot();
  const { json: it } = await call('/api/items', { method: 'POST', token, body: { sku: 'A1', name: 'Arduino', lab: 'Embedded', quantity: 3, min_quantity: 1 } });
  assert.equal((await call('/api/transactions', { method: 'POST', token, body: { itemId: it.id, student: 'Asha', qty: 2, type: 'issue' } })).json.quantity, 1);
  assert.equal((await call('/api/transactions', { method: 'POST', token, body: { itemId: it.id, student: 'Ravi', qty: 2, type: 'issue' } })).status, 409);
  assert.equal((await call('/api/transactions', { method: 'POST', token, body: { itemId: it.id, student: 'Asha', qty: 2, type: 'return' } })).json.quantity, 3);
  assert.equal((await call('/api/transactions', { token })).json.length, 2);
  assert.equal((await call(`/api/items/${it.id}`, { method: 'DELETE', token })).status, 409);
  close();
});

test('CSV import upserts, reports bad rows, and export round-trips', async () => {
  const { call, token, close } = await boot();
  const csv = 'sku,name,lab,quantity,min_quantity\nM1,"Motor, 12V",Robotics,4,2\nM2,Servo,Robotics,x,1\nM1,"Motor, 12V",Robotics,9,2\n';
  const r = await call('/api/items-import', { method: 'POST', token, csv });
  assert.equal(r.json.imported, 2);
  assert.equal(r.json.errors.length, 1);
  assert.equal(r.json.errors[0].line, 3);
  const out = await call('/api/items-export.csv', { token });
  assert.match(out.json, /"Motor, 12V",Robotics,9,2/);
  assert.equal((await call('/api/items-import', { method: 'POST', token, csv: 'a,b\n1,2' })).status, 400);
  close();
});
