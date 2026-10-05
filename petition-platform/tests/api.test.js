import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../server/app.js';

async function boot() {
  const server = createApp({ allowedDomain: 'college.edu' }).listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  const j = (p, method = 'GET', body) => fetch(base + p, { method, headers: { 'Content-Type': 'application/json' }, body: body && JSON.stringify(body) });
  return { server, base, j };
}

test('create, edit and list petitions', async () => {
  const { server, j } = await boot();
  assert.equal((await j('/api/petitions', 'POST', { title: '', body: 'x' })).status, 400);
  const p = await (await j('/api/petitions', 'POST', { title: 'More buses', body: 'Please' })).json();
  assert.equal((await j('/api/petitions/' + p.id, 'PUT', { title: 'More buses!', body: 'Edited' })).status, 200);
  assert.equal((await j('/api/petitions/999', 'PUT', { title: 'a', body: 'b' })).status, 404);
  const list = await (await j('/api/petitions')).json();
  assert.equal(list[0].title, 'More buses!'); assert.equal(list[0].signatures, 0);
  server.close();
});

test('signing enforces domain and one signature per email', async () => {
  const { server, j } = await boot();
  const p = await (await j('/api/petitions', 'POST', { title: 'T', body: 'B' })).json();
  assert.equal((await j(`/api/petitions/${p.id}/sign`, 'POST', { name: 'A', email: 'a@gmail.com' })).status, 400);
  assert.equal((await j(`/api/petitions/${p.id}/sign`, 'POST', { name: 'A', email: 'A@College.edu' })).status, 201);
  assert.equal((await j(`/api/petitions/${p.id}/sign`, 'POST', { name: 'A', email: 'a@college.edu' })).status, 409);
  assert.equal((await j('/api/petitions/77/sign', 'POST', { name: 'A', email: 'b@college.edu' })).status, 404);
  assert.equal((await (await j('/api/petitions')).json())[0].signatures, 1);
  server.close();
});

test('live endpoint pushes the new count over SSE', async () => {
  const { server, base, j } = await boot();
  const p = await (await j('/api/petitions', 'POST', { title: 'T', body: 'B' })).json();
  const ctl = new AbortController();
  const res = await fetch(`${base}/api/petitions/${p.id}/live`, { signal: ctl.signal });
  const reader = res.body.getReader(); const dec = new TextDecoder();
  assert.match(dec.decode((await reader.read()).value), /"signatures":0/);
  await j(`/api/petitions/${p.id}/sign`, 'POST', { name: 'A', email: 'a@college.edu' });
  assert.match(dec.decode((await reader.read()).value), /"signatures":1/);
  ctl.abort(); server.closeAllConnections?.(); server.close();
});
