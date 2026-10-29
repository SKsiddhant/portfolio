import { useEffect, useMemo, useRef, useState } from "react";
import { createChart, CrosshairMode, LineStyle } from "lightweight-charts";
import { Hub, LIVE_STRATEGIES, MARKET_OPEN } from "../live/engine.js";
import { Book, clock, keyOf } from "../live/book.js";
import { byKey } from "../engine/strategies.js";
import { pct, rupees, themeColors } from "../lib/format.js";

const SPEEDS = [1, 10, 60, 300];
const CLOSE = 15 * 3600 + 30 * 60;
const BASE = Date.UTC(2026, 0, 1) / 1000; // chart axis: IST seconds shown as clock time
const short = { sma_cross: "SMA", macd_rsi: "MACD×RSI", donchian: "Donchian", rsi_reversion: "RSI rev.", vwap_reversion: "VWAP rev.", bollinger_breakout: "Bollinger" };
const signed = (x) => (x == null ? "—" : `${x > 0 ? "+" : x < 0 ? "−" : ""}${rupees(Math.abs(x))}`);
const toneOf = (x) => (x > 0.005 ? "pos" : x < -0.005 ? "neg" : "");

/* ------------------------------------------------------------ data sources */

function makeReplay(session) {
  const order = Object.keys(session.symbols);
  const names = Object.fromEntries(order.map((s) => [s, session.symbols[s].name]));
  return {
    session,
    order,
    hub: new Hub(Object.fromEntries(order.map((s) => [s, session.symbols[s].warmup]))),
    book: new Book(order, names, LIVE_STRATEGIES),
    idx: 0,
    t: MARKET_OPEN - 1,
    done: false,
  };
}

function advance(rp, target, onEvents) {
  const ticks = rp.session.ticks;
  const batch = [];
  while (rp.idx < ticks.length && ticks[rp.idx][1] <= target) {
    const [i, t, p, cum] = ticks[rp.idx++];
    for (const e of rp.hub.onTick(rp.order[i], t, p, cum)) batch.push(e);
  }
  rp.t = Math.min(target, CLOSE);
  if (rp.idx >= ticks.length && !rp.done) {
    batch.push(...rp.hub.endOfDay(ticks.length ? ticks[ticks.length - 1][1] : CLOSE));
    rp.done = true;
    rp.t = CLOSE;
  }
  for (const e of batch) rp.book.apply(e);
  onEvents(batch);
}

/* ------------------------------------------------------------ chart */

function LiveChart({ book, symbol, strategy, version }) {
  const el = useRef(null);
  const api = useRef(null);
  useEffect(() => {
    const c = themeColors();
    const chart = createChart(el.current, {
      height: el.current.clientHeight,
      layout: { background: { color: "transparent" }, textColor: c.inkSoft, fontFamily: "Archivo, system-ui, sans-serif", fontSize: 11 },
      grid: { vertLines: { visible: false }, horzLines: { visible: false } },
      rightPriceScale: { borderColor: c.gridStrong },
      timeScale: { borderColor: c.gridStrong, timeVisible: true, secondsVisible: false, shiftVisibleRangeOnNewBar: false },
      crosshair: { mode: CrosshairMode.Normal },
      localization: { priceFormatter: (v) => v.toFixed(2) },
    });
    const candles = chart.addCandlestickSeries({
      upColor: c.gain, downColor: c.loss, borderUpColor: c.gain, borderDownColor: c.loss, wickUpColor: c.gain, wickDownColor: c.loss, priceLineVisible: true,
    });
    const vwap = chart.addLineSeries({ color: c.bench, lineWidth: 1, lineStyle: LineStyle.Dashed, priceLineVisible: false, lastValueVisible: false });
    const ro = new ResizeObserver(() => chart.applyOptions({ width: el.current.clientWidth, height: el.current.clientHeight }));
    ro.observe(el.current);
    api.current = { chart, candles, vwap, symbol: null };
    return () => {
      ro.disconnect();
      chart.remove();
    };
  }, []);

  useEffect(() => {
    const a = api.current;
    const c = themeColors();
    const bars = [...book.candles[symbol]];
    const cur = book.current[symbol];
    if (cur && (!bars.length || bars[bars.length - 1].t < cur.t)) bars.push(cur);
    a.candles.setData(bars.map((b) => ({ time: BASE + b.t, open: b.open, high: b.high, low: b.low, close: b.close })));
    // session VWAP, the line intraday traders watch
    let pv = 0;
    let vv = 0;
    a.vwap.setData(
      bars.map((b) => {
        pv += ((b.high + b.low + b.close) / 3) * (b.volume || 1);
        vv += b.volume || 1;
        return { time: BASE + b.t, value: pv / vv };
      }),
    );
    const markers = [];
    for (const t of book.trades) {
      if (t.symbol !== symbol || t.strategy !== strategy) continue;
      const long = t.side === "long";
      markers.push({ time: BASE + Math.floor(t.entry_t / 60) * 60, position: long ? "belowBar" : "aboveBar", color: long ? c.gain : c.loss, shape: long ? "arrowUp" : "arrowDown" });
      markers.push({ time: BASE + Math.floor(t.exit_t / 60) * 60, position: long ? "aboveBar" : "belowBar", color: t.net >= 0 ? c.gain : c.loss, shape: "circle", text: signed(t.net) });
    }
    const p = book.pos[keyOf(symbol, strategy)];
    if (p) markers.push({ time: BASE + Math.floor(p.t / 60) * 60, position: p.side > 0 ? "belowBar" : "aboveBar", color: p.side > 0 ? c.gain : c.loss, shape: p.side > 0 ? "arrowUp" : "arrowDown", text: "open" });
    markers.sort((x, y) => x.time - y.time);
    a.candles.setMarkers(markers);
    if (a.symbol !== symbol) {
      // the whole session, 09:15 to 15:30, fills in from left to right like a strip chart
      a.chart.timeScale().setVisibleLogicalRange({ from: -2, to: 377 });
      a.symbol = symbol;
    }
  }, [book, symbol, strategy, version]);

  return <div ref={el} className="chart-box graph-paper live-chart" />;
}

/* ------------------------------------------------------------ Kite panel (local server only) */

function KitePanel({ status, onStarted, refresh }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState([]);
  const [watch, setWatch] = useState(["RELIANCE", "HDFCBANK", "INFY", "TATAMOTORS", "SBIN"]);
  const [capital, setCapital] = useState(100000);
  const [err, setErr] = useState("");

  useEffect(() => {
    if (!status?.connected || q.trim().length < 2) return setResults([]);
    const ctl = new AbortController();
    fetch(`api/live/instruments?q=${encodeURIComponent(q)}`, { signal: ctl.signal })
      .then((r) => r.json())
      .then((j) => setResults(Array.isArray(j) ? j : []))
      .catch(() => {});
    return () => ctl.abort();
  }, [q, status?.connected]);

  if (!status?.available) {
    return <p className="note-text">Install the Kite client on the server: <code>pip install kiteconnect</code>, then restart.</p>;
  }
  if (!status.configured) {
    return (
      <p className="note-text">
        Add your Kite Connect keys to <code>quantforge/.env</code> as <code>KITE_API_KEY</code> and <code>KITE_API_SECRET</code>, then restart the server.
      </p>
    );
  }
  if (!status.connected) {
    return (
      <a className="btn primary" href="kite/login">
        Log in with Kite
      </a>
    );
  }
  const start = () => {
    setErr("");
    fetch("api/live/start", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ symbols: watch, capital }) })
      .then((r) => r.json())
      .then((j) => (j.error ? setErr(j.error) : (onStarted(), refresh())))
      .catch((e) => setErr(e.message));
  };
  return (
    <div>
      <p className="note-text">Logged in as {status.user}. Paper trading only: no orders are sent to Zerodha.</p>
      <div className="field">
        <label htmlFor="sym-search">Add an NSE stock</label>
        <input id="sym-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search, e.g. TCS" autoComplete="off" />
      </div>
      {results.length > 0 && (
        <ul className="results">
          {results.map((r) => (
            <li key={r.token}>
              <button onClick={() => (watch.includes(r.symbol) || watch.length >= 10 ? null : setWatch([...watch, r.symbol]), setQ(""))}>
                <b>{r.symbol}</b> {r.name}
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="chips">
        {watch.map((s) => (
          <button key={s} className="chip" onClick={() => setWatch(watch.filter((x) => x !== s))} aria-label={`Remove ${s}`}>
            {s} ×
          </button>
        ))}
      </div>
      <div className="field">
        <label htmlFor="live-cap">Paper capital per strategy (₹)</label>
        <input id="live-cap" type="number" min="1000" step="10000" value={capital} onChange={(e) => setCapital(Number(e.target.value) || 100000)} />
      </div>
      <button className="btn primary" disabled={!watch.length} onClick={start}>
        {status.running ? "Restart with this watchlist" : "Start paper trading"}
      </button>
      {err && <p className="error" role="alert">{err}</p>}
    </div>
  );
}

/* ------------------------------------------------------------ view */

export default function LiveView({ modeSwitch }) {
  const [source, setSource] = useState("replay");
  const [session, setSession] = useState(null);
  const [loadErr, setLoadErr] = useState("");
  const [speed, setSpeed] = useState(60);
  const [playing, setPlaying] = useState(true);
  const [version, setVersion] = useState(0);
  const [sel, setSel] = useState({ symbol: null, strategy: "donchian" });
  const [tab, setTab] = useState("board");
  const [toasts, setToasts] = useState([]);
  const [notify, setNotify] = useState(false);
  const [kite, setKite] = useState(null);
  const rp = useRef(null);
  const liveBook = useRef(null);
  const selRef = useRef(sel);
  selRef.current = sel;
  const notifyRef = useRef(notify);
  notifyRef.current = notify;

  // load the shipped simulated session
  useEffect(() => {
    fetch("data/session.json")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then(setSession)
      .catch((e) => setLoadErr(`Could not load the replay session (${e.message}).`));
  }, []);

  // is the local Python server with Kite support around?
  const refreshKite = () =>
    fetch("api/live/status")
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => j && setKite(j))
      .catch(() => {});
  useEffect(() => {
    if (location.hostname.endsWith("github.io")) return;
    refreshKite();
    if (location.hash.includes("login=failed")) setLoadErr("Kite login was cancelled or failed. Try again.");
  }, []);
  useEffect(() => {
    if (kite?.connected && source === "replay" && location.hash.startsWith("#live")) setSource("kite");
  }, [kite?.connected]); // eslint-disable-line react-hooks/exhaustive-deps

  const onEvents = (events) => {
    const s = selRef.current.symbol;
    const fresh = events.filter((e) => (e.type === "fill" || e.type === "trade") && e.symbol === s);
    if (!fresh.length) return;
    const msgs = fresh.slice(-3).map((e) => ({
      id: Math.random(),
      tone: e.type === "trade" ? toneOf(e.net) : e.side > 0 ? "pos" : "neg",
      text: e.type === "fill"
        ? `${clock(e.t)} ${short[e.strategy]} ${e.action === "buy" ? "bought" : "sold short"} ${e.qty} ${e.symbol} at ${e.price.toFixed(2)}`
        : `${clock(e.exit_t)} ${short[e.strategy]} closed ${e.symbol}${e.reason === "square-off" ? " at 15:20 square-off" : ""}: ${signed(e.net)} after charges`,
    }));
    setToasts((t) => [...t, ...msgs].slice(-3));
    msgs.forEach((m) => setTimeout(() => setToasts((t) => t.filter((x) => x.id !== m.id)), 4500));
    if (notifyRef.current && document.hidden && "Notification" in window && Notification.permission === "granted") {
      new Notification("QuantForge", { body: msgs[msgs.length - 1].text });
    }
  };

  // replay engine
  useEffect(() => {
    if (source !== "replay" || !session) return;
    rp.current = makeReplay(session);
    setSel((s) => ({ ...s, symbol: rp.current.order[0] }));
    setPlaying(true);
    setVersion((v) => v + 1);
  }, [session, source]);

  useEffect(() => {
    if (source !== "replay" || !playing || !rp.current) return;
    let last = performance.now();
    const id = setInterval(() => {
      const now = performance.now();
      const r = rp.current;
      advance(r, r.t + ((now - last) / 1000) * speed, onEvents);
      last = now;
      if (r.done) setPlaying(false);
      setVersion((v) => v + 1);
    }, 120);
    return () => clearInterval(id);
  }, [source, playing, speed, session]); // eslint-disable-line react-hooks/exhaustive-deps

  // Kite stream (Python engine, same events)
  useEffect(() => {
    if (source !== "kite" || !kite?.running) return;
    const es = new EventSource("api/live/stream");
    es.onmessage = (m) => {
      const e = JSON.parse(m.data);
      if (e.type === "snapshot") {
        const b = new Book(e.symbols, {}, LIVE_STRATEGIES);
        b.applySnapshot(e.state);
        b.status = e.status;
        liveBook.current = b;
        setSel((s) => ({ ...s, symbol: e.symbols.includes(s.symbol) ? s.symbol : e.symbols[0] }));
      } else if (liveBook.current) {
        liveBook.current.apply(e);
        onEvents([e]);
      }
      setVersion((v) => v + 1);
    };
    es.onerror = () => liveBook.current && (liveBook.current.status = "reconnecting…");
    return () => es.close();
  }, [source, kite?.running]); // eslint-disable-line react-hooks/exhaustive-deps

  const loadRecording = async (ev) => {
    const f = ev.target.files?.[0];
    ev.target.value = "";
    if (!f) return;
    try {
      const s = JSON.parse(await f.text());
      if (!s.symbols || !Array.isArray(s.ticks)) throw new Error("not a QuantForge session file");
      setLoadErr("");
      setSource("replay");
      setSession(s);
    } catch (e) {
      setLoadErr(`${f.name}: ${e.message}`);
    }
  };

  const book = source === "replay" ? rp.current?.book : liveBook.current;
  const now = source === "replay" ? rp.current?.t : (() => {
    const d = new Date(Date.now() + 5.5 * 3600e3);
    return d.getUTCHours() * 3600 + d.getUTCMinutes() * 60 + d.getUTCSeconds();
  })();
  const totals = useMemo(() => book?.totals(), [book, version]); // eslint-disable-line react-hooks/exhaustive-deps
  const board = useMemo(() => book?.leaderboard(), [book, version]); // eslint-disable-line react-hooks/exhaustive-deps
  const symbol = sel.symbol && book?.symbols.includes(sel.symbol) ? sel.symbol : book?.symbols[0];

  const rail = (
    <aside className="rail" aria-label="Live session settings">
      {modeSwitch}
      <p className="tagline">Every strategy paper-trades every stock on 1-minute candles, with Zerodha's real intraday charges and a 15:20 square-off.</p>

      <fieldset className="group" style={{ border: 0, padding: 0 }}>
        <h2>Price feed</h2>
        <label className={`choice ${source === "replay" ? "is-on" : ""}`}>
          <input type="radio" name="src" checked={source === "replay"} onChange={() => setSource("replay")} />
          <span className="name">Replay a trading day</span>
          <span className="note">{session?.label || "Loading…"}</span>
        </label>
        <label className={`choice ${source === "kite" ? "is-on" : ""}`}>
          <input type="radio" name="src" checked={source === "kite"} onChange={() => setSource("kite")} />
          <span className="name">Live from Zerodha Kite</span>
          <span className="note">{kite ? (kite.connected ? `Connected as ${kite.user}` : "Needs your Kite Connect app") : "Runs on the local server, not on this website"}</span>
        </label>
      </fieldset>

      {source === "replay" && (
        <div className="group">
          <h2>Replay</h2>
          <div className="row-btns">
            <button className="btn primary" onClick={() => (rp.current?.done ? (rp.current = makeReplay(session), setPlaying(true), setVersion((v) => v + 1)) : setPlaying(!playing))}>
              {rp.current?.done ? "Replay again" : playing ? "Pause" : "Play"}
            </button>
            <button className="btn" disabled={!rp.current || rp.current.done} onClick={() => { advance(rp.current, CLOSE + 1, () => {}); setPlaying(false); setVersion((v) => v + 1); }}>
              Skip to close
            </button>
          </div>
          <div className="segmented" role="group" aria-label="Replay speed">
            {SPEEDS.map((s) => (
              <button key={s} aria-pressed={speed === s} onClick={() => setSpeed(s)}>
                {s}×
              </button>
            ))}
          </div>
          <label className="upload">
            <input type="file" accept=".json,application/json" onChange={loadRecording} />
            Replay a day you recorded with Kite (sessions/*.json)
          </label>
        </div>
      )}

      {source === "kite" && (
        <div className="group">
          <h2>Kite</h2>
          {kite ? (
            <KitePanel status={kite} refresh={refreshKite} onStarted={() => setVersion((v) => v + 1)} />
          ) : (
            <p className="note-text">
              Live mode needs the Python server on your computer, because the Kite API secret must never sit in a public web page. Run{" "}
              <code>python -m quantforge serve</code> and open it there. Setup is in the README.
            </p>
          )}
        </div>
      )}

      <div className="group">
        <h2>Alerts</h2>
        <label className="toggle">
          <input
            type="checkbox"
            checked={notify}
            onChange={(e) => {
              const on = e.target.checked;
              if (on && "Notification" in window && Notification.permission === "default") Notification.requestPermission();
              setNotify(on);
            }}
          />
          Desktop notifications when the tab is hidden
        </label>
        <p className="note-text">Alerts follow the stock selected in the scanner.</p>
      </div>
    </aside>
  );

  if (!book) {
    return (
      <div className="shell">
        {rail}
        <main className="main">
          {loadErr ? <p className="error">{loadErr}</p> : source === "kite" ? <p className="busy">Start paper trading from the panel to stream live prices.</p> : <p className="busy">Loading the session…</p>}
        </main>
      </div>
    );
  }

  const selKey = keyOf(symbol, sel.strategy);
  const selPos = book.pos[selKey];
  const charges = totals.charges;
  const tradesNewest = [...book.trades].reverse();
  const signalsNewest = book.signals.slice(-200).reverse();

  return (
    <div className="shell">
      {rail}
      <main className="main">
        <div className="topbar">
          <span className={`badge ${source === "kite" ? "live" : ""}`}>
            {source === "kite" ? `Live · ${book.status || "connected"}` : session?.source === "kite" ? "Replay of a recorded Kite session" : "Replay · simulated prices"}
          </span>
          {loadErr && <span className="error">{loadErr}</span>}
        </div>

        <section className="verdict live-verdict" aria-live="off">
          <p className="headline">
            <span className="clock">{clock(Math.max(now ?? 0, MARKET_OPEN))}</span>
            {book.squared || (now ?? 0) >= 15 * 3600 + 20 * 60 ? " Squared off. " : " "}
            {LIVE_STRATEGIES.length * book.symbols.length} paper strategies are{" "}
            <span className={`amt ${totals.net >= 0 ? "up" : "down"}`}>{signed(totals.net)}</span> net.
          </p>
          <p className="sub">
            {totals.trades} round trips so far paid {rupees(charges)} in brokerage, STT, exchange fees, GST and stamp duty
            {totals.gross > 0 ? `, ${pct(charges / totals.gross, 0)} of the gross profit` : ""}. Open positions are worth {signed(totals.open)} at the last price.
          </p>
        </section>

        <div className="scanner-wrap">
          <table className="scanner">
            <thead>
              <tr>
                <th scope="col">Stock</th>
                <th scope="col">Last</th>
                <th scope="col">Day</th>
                {LIVE_STRATEGIES.map((k) => (
                  <th key={k} scope="col" title={byKey[k].description}>{short[k]}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {book.symbols.map((s) => {
                const last = book.last[s];
                const chg = last && book.dayOpen(s) ? last / book.dayOpen(s) - 1 : null;
                return (
                  <tr key={s} className={s === symbol ? "is-sel" : ""}>
                    <th scope="row">
                      <button className="sym" onClick={() => setSel({ ...sel, symbol: s })}>
                        {s}
                        <small>{book.names[s] || ""}</small>
                      </button>
                    </th>
                    <td>{last ? last.toFixed(2) : "—"}</td>
                    <td className={toneOf(chg)}>{pct(chg, 2, true)}</td>
                    {LIVE_STRATEGIES.map((k) => {
                      const p = book.pos[keyOf(s, k)];
                      const v = book.pnl(s, k);
                      const on = s === symbol && k === sel.strategy;
                      return (
                        <td key={k} className="cell-td">
                          <button
                            className={`cell ${p ? (p.side > 0 ? "long" : "short") : "flat"} ${on ? "on" : ""}`}
                            onClick={() => setSel({ symbol: s, strategy: k })}
                            aria-label={`${s} ${byKey[k].name}: ${p ? (p.side > 0 ? "long" : "short") : "flat"}, ${signed(v)}`}
                          >
                            <span key={`${p?.t ?? "f"}`} className="state">{p ? (p.side > 0 ? "▲ Long" : "▼ Short") : "Flat"}</span>
                            <span className={`v ${toneOf(v)}`}>{signed(Math.round(v))}</span>
                          </button>
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="charts live-charts">
          <div className="chart-label">
            <span>
              <b>{symbol}</b> with {byKey[sel.strategy].name}:{" "}
              {selPos ? `${selPos.side > 0 ? "long" : "short"} ${selPos.qty} from ${selPos.price.toFixed(2)}, ${signed(book.open(symbol, sel.strategy))} open` : "flat"}
              , day {signed(book.pnl(symbol, sel.strategy))}
            </span>
            <span className="key"><span className="swatch" style={{ background: "var(--bench)" }} />session VWAP</span>
          </div>
          <LiveChart book={book} symbol={symbol} strategy={sel.strategy} version={version} />
        </div>

        <div className="tabs" role="tablist" aria-label="Session detail">
          {[["board", "Strategy leaderboard"], ["trades", `Trades (${book.trades.length})`], ["alerts", `Signals (${book.signals.length})`]].map(([k, label]) => (
            <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}>
              {label}
            </button>
          ))}
        </div>
        <section className="panel" role="tabpanel">
          {tab === "board" && (
            <table className="grid-table">
              <thead>
                <tr><th>Strategy</th><th>Round trips</th><th>Win rate</th><th>Gross</th><th>Charges</th><th>Open</th><th>Net</th></tr>
              </thead>
              <tbody>
                {board.map((r) => (
                  <tr key={r.strategy}>
                    <td>{byKey[r.strategy].name}</td>
                    <td>{r.trades}</td>
                    <td>{pct(r.winRate, 0)}</td>
                    <td className={toneOf(r.gross)}>{signed(r.gross)}</td>
                    <td className="neg">{r.charges ? `−${rupees(r.charges)}` : "—"}</td>
                    <td className={toneOf(r.open)}>{signed(r.open)}</td>
                    <td className={toneOf(r.net)}><b>{signed(r.net)}</b></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {tab === "trades" && (
            tradesNewest.length ? (
              <div className="table-scroll">
                <table className="grid-table">
                  <thead><tr><th>Closed</th><th>Stock</th><th>Strategy</th><th>Side</th><th>Qty</th><th>Entry</th><th>Exit</th><th>Gross</th><th>Charges</th><th>Net</th></tr></thead>
                  <tbody>
                    {tradesNewest.slice(0, 300).map((t, i) => (
                      <tr key={i}>
                        <td>{clock(t.exit_t)}{t.reason === "square-off" && <span className="tag stop"> 15:20</span>}</td>
                        <td>{t.symbol}</td>
                        <td>{short[t.strategy]}</td>
                        <td><span className={`tag ${t.side === "short" ? "short" : ""}`}>{t.side}</span></td>
                        <td>{t.qty}</td>
                        <td>{t.entry_price.toFixed(2)}</td>
                        <td>{t.exit_price.toFixed(2)}</td>
                        <td className={toneOf(t.gross)}>{signed(t.gross)}</td>
                        <td>{rupees(t.charges)}</td>
                        <td className={toneOf(t.net)}>{signed(t.net)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : <p className="panel-intro">No round trips yet. Strategies fill at the open of the minute after they signal.</p>
          )}
          {tab === "alerts" && (
            signalsNewest.length ? (
              <div className="table-scroll">
                <table className="grid-table">
                  <thead><tr><th>Time</th><th>Stock</th><th>Strategy</th><th>Signal</th><th>Price at signal</th></tr></thead>
                  <tbody>
                    {signalsNewest.map((e, i) => (
                      <tr key={i}>
                        <td>{clock(e.t)}</td>
                        <td>{e.symbol}</td>
                        <td>{short[e.strategy]}</td>
                        <td>{e.to > 0 ? "Go long" : e.to < 0 ? "Go short" : "Exit"}</td>
                        <td>{e.price.toFixed(2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : <p className="panel-intro">No signals yet.</p>
          )}
        </section>

        <p className="footer">
          Paper trading only: QuantForge never places orders. Charges follow Zerodha's NSE equity intraday rate card. Each signal fills at the open of the
          following minute, never on the candle that produced it. The public replay uses fictional stocks with generated prices; run Live mode with your
          own Kite Connect app to trade real NSE prices on paper and record the day for replay.
        </p>
      </main>
      <div className="toasts" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.tone}`}>{t.text}</div>
        ))}
      </div>
    </div>
  );
}
