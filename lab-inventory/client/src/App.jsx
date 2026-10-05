import React, { useEffect, useState, useCallback } from 'react';

const api = (token) => async (path, opts = {}) => {
  const res = await fetch('/api' + path, {
    ...opts,
    headers: { ...(opts.json ? { 'Content-Type': 'application/json' } : {}), ...(opts.type ? { 'Content-Type': opts.type } : {}), ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: opts.json ? JSON.stringify(opts.json) : opts.body,
  });
  if (res.status === 204) return null;
  const ct = res.headers.get('content-type') || '';
  const data = ct.includes('json') ? await res.json() : await res.text();
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
};

function Login({ onLogin }) {
  const [mode, setMode] = useState('login');
  const [f, setF] = useState({ username: '', password: '' });
  const [msg, setMsg] = useState('');
  const submit = async (e) => {
    e.preventDefault(); setMsg('');
    try {
      if (mode === 'register') { await api()('/register', { method: 'POST', json: f }); setMode('login'); setMsg('Registered. Log in now.'); return; }
      onLogin(await api()('/login', { method: 'POST', json: f }));
    } catch (er) { setMsg(er.message); }
  };
  return (
    <main><form className="card row" onSubmit={submit} style={{ maxWidth: 420, margin: '60px auto' }}>
      <h2 style={{ width: '100%' }}>{mode === 'login' ? 'Staff login' : 'Create account'}</h2>
      <input placeholder="Username" value={f.username} onChange={(e) => setF({ ...f, username: e.target.value })} />
      <input type="password" placeholder="Password (8+ chars)" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} />
      <button>{mode === 'login' ? 'Log in' : 'Register'}</button>
      <button type="button" className="alt" onClick={() => setMode(mode === 'login' ? 'register' : 'login')}>{mode === 'login' ? 'Need an account?' : 'Back'}</button>
      {msg && <p className="err" style={{ width: '100%' }}>{msg}</p>}
    </form></main>
  );
}

export default function App() {
  const [auth, setAuth] = useState(null);
  const [items, setItems] = useState([]);
  const [txs, setTxs] = useState([]);
  const [q, setQ] = useState('');
  const [lab, setLab] = useState('');
  const [msg, setMsg] = useState({ text: '', ok: true });
  const call = api(auth?.token);
  const say = (text, ok = true) => setMsg({ text, ok });

  const load = useCallback(async () => {
    try { setItems(await call('/items')); setTxs(await call('/transactions')); }
    catch (e) { say(e.message, false); }
  }, [auth]);
  useEffect(() => { if (auth) load(); }, [auth]);

  if (!auth) return <Login onLogin={setAuth} />;

  const labs = [...new Set(items.map((i) => i.lab))].sort();
  const shown = items.filter((i) => (!lab || i.lab === lab) && (i.name + i.sku).toLowerCase().includes(q.toLowerCase()));

  const addItem = async (e) => {
    e.preventDefault(); const d = Object.fromEntries(new FormData(e.target));
    try { await call('/items', { method: 'POST', json: { ...d, quantity: +d.quantity, min_quantity: +d.min_quantity } }); e.target.reset(); say('Item added.'); load(); }
    catch (er) { say(er.message, false); }
  };
  const move = async (e) => {
    e.preventDefault(); const d = Object.fromEntries(new FormData(e.target));
    try { await call('/transactions', { method: 'POST', json: { itemId: +d.itemId, student: d.student, qty: +d.qty, type: d.type } }); e.target.reset(); say('Recorded.'); load(); }
    catch (er) { say(er.message, false); }
  };
  const remove = async (id) => { try { await call('/items/' + id, { method: 'DELETE' }); load(); } catch (er) { say(er.message, false); } };
  const exportCsv = async () => {
    const text = await call('/items-export.csv');
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type: 'text/csv' })); a.download = 'inventory.csv'; a.click();
  };
  const importCsv = async (e) => {
    const file = e.target.files[0]; if (!file) return;
    try {
      const r = await call('/items-import', { method: 'POST', type: 'text/csv', body: await file.text() });
      say(`Imported ${r.imported} rows` + (r.errors.length ? `; ${r.errors.length} skipped: ` + r.errors.map((x) => `line ${x.line} ${x.error}`).join('; ') : '.'), !r.errors.length);
      load();
    } catch (er) { say(er.message, false); }
    e.target.value = '';
  };

  return (<>
    <header><strong>Lab Inventory</strong><span>{auth.username} <button className="alt" onClick={() => setAuth(null)}>Log out</button></span></header>
    <main>
      {msg.text && <div className={'card ' + (msg.ok ? 'ok' : 'err')}>{msg.text}</div>}
      <section className="card">
        <div className="row"><input placeholder="Search name or SKU" value={q} onChange={(e) => setQ(e.target.value)} />
          <select value={lab} onChange={(e) => setLab(e.target.value)}><option value="">All labs</option>{labs.map((l) => <option key={l}>{l}</option>)}</select>
          <button onClick={exportCsv}>Export CSV</button>
          <label className="row">Import CSV <input type="file" accept=".csv,text/csv" onChange={importCsv} /></label></div>
        <table><thead><tr><th>SKU</th><th>Name</th><th>Lab</th><th>Qty</th><th>Min</th><th /></tr></thead>
          <tbody>{shown.map((i) => <tr key={i.id} className={i.low ? 'low' : ''}>
            <td>{i.sku}</td><td>{i.name}</td><td>{i.lab}</td><td>{i.quantity} {i.low && <span className="badge">low</span>}</td><td>{i.min_quantity}</td>
            <td><button className="del" onClick={() => remove(i.id)}>Delete</button></td></tr>)}
            {!shown.length && <tr><td colSpan="6">No items.</td></tr>}</tbody></table>
      </section>
      <section className="card"><h3>Add item</h3><form className="row" onSubmit={addItem}>
        <input name="sku" placeholder="SKU" required /><input name="name" placeholder="Name" required /><input name="lab" placeholder="Lab" required />
        <input name="quantity" type="number" min="0" placeholder="Qty" required /><input name="min_quantity" type="number" min="0" placeholder="Min" defaultValue="0" /><button>Add</button></form></section>
      <section className="card"><h3>Issue / return</h3><form className="row" onSubmit={move}>
        <select name="itemId" required>{items.map((i) => <option key={i.id} value={i.id}>{i.name} ({i.quantity})</option>)}</select>
        <input name="student" placeholder="Student" required /><input name="qty" type="number" min="1" defaultValue="1" />
        <select name="type"><option>issue</option><option>return</option></select><button>Record</button></form></section>
      <section className="card"><h3>Recent transactions</h3><table><tbody>{txs.map((t) => <tr key={t.id}><td>{t.at}</td><td>{t.type}</td><td>{t.qty} × {t.item}</td><td>{t.student}</td></tr>)}</tbody></table></section>
    </main></>);
}
