// Client-side view of a live session, built only from engine events.
// Replay (browser engine) and Kite (Python engine over SSE) emit the same events,
// so the dashboard renders both through this one reducer.
export const keyOf = (symbol, strategy) => `${symbol}|${strategy}`;

export class Book {
  constructor(symbols, names = {}, strategies = []) {
    this.symbols = symbols;
    this.names = names;
    this.strategies = strategies;
    this.candles = Object.fromEntries(symbols.map((s) => [s, []]));
    this.current = {};
    this.last = {};
    this.pos = {};
    this.realized = {};
    this.trades = [];
    this.signals = [];
    this.squared = false;
    this.status = "";
  }

  applySnapshot(snap) {
    if (!snap) return;
    for (const s of this.symbols) this.candles[s] = [...(snap.candles?.[s] || [])];
    this.current = { ...(snap.current || {}) };
    this.last = { ...(snap.last || {}) };
    for (const r of snap.runners || []) {
      const k = keyOf(r.symbol, r.strategy);
      this.realized[k] = r.realized;
      this.pos[k] = r.pos ? { side: r.pos, qty: r.qty, price: r.entry_price } : null;
    }
    this.trades = [...(snap.trades || [])];
    this.squared = !!snap.squared;
  }

  apply(e) {
    switch (e.type) {
      case "candle":
        if (e.final) {
          this.candles[e.symbol].push(e.candle);
          if (this.current[e.symbol]?.t === e.candle.t) delete this.current[e.symbol];
        } else this.current[e.symbol] = e.candle;
        this.last[e.symbol] = e.candle.close;
        break;
      case "signal":
        this.signals.push(e);
        break;
      case "fill":
        this.pos[keyOf(e.symbol, e.strategy)] = { side: e.side, qty: e.qty, price: e.price, t: e.t };
        break;
      case "trade": {
        const k = keyOf(e.symbol, e.strategy);
        this.trades.push(e);
        this.realized[k] = Math.round(((this.realized[k] || 0) + e.net) * 100) / 100;
        this.pos[k] = null;
        break;
      }
      case "squared_off":
        this.squared = true;
        break;
      case "status":
        this.status = e.status;
        break;
      default:
    }
  }

  dayOpen(s) {
    return this.candles[s][0]?.open ?? this.current[s]?.open;
  }

  open(symbol, strategy) {
    const p = this.pos[keyOf(symbol, strategy)];
    if (!p) return 0;
    return p.side * ((this.last[symbol] ?? p.price) - p.price) * p.qty;
  }

  pnl(symbol, strategy) {
    return (this.realized[keyOf(symbol, strategy)] || 0) + this.open(symbol, strategy);
  }

  totals() {
    let net = 0;
    let charges = 0;
    let gross = 0;
    for (const t of this.trades) {
      net += t.net;
      charges += t.charges;
      gross += t.gross;
    }
    let open = 0;
    for (const s of this.symbols) for (const k of this.strategies) open += this.open(s, k);
    return { net: net + open, realized: net, open, charges, gross, trades: this.trades.length };
  }

  leaderboard() {
    return this.strategies
      .map((k) => {
        const ts = this.trades.filter((t) => t.strategy === k);
        const wins = ts.filter((t) => t.net > 0).length;
        let open = 0;
        for (const s of this.symbols) open += this.open(s, k);
        const sum = (f) => ts.reduce((a, t) => a + t[f], 0);
        return { strategy: k, trades: ts.length, winRate: ts.length ? wins / ts.length : null, gross: sum("gross"), charges: sum("charges"), realized: sum("net"), open, net: sum("net") + open };
      })
      .sort((a, b) => b.net - a.net);
  }
}

export const clock = (t) => {
  if (t == null || !Number.isFinite(t)) return "--:--";
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
};
