// Line-by-line port of quantforge/live/engine.py: ticks -> 1-minute candles -> paper runners.
// A decision made at the close of minute t fills at the first tick (open) of minute t+1.
import { byKey, defaults, signal } from "../engine/strategies.js";
import { intradayCharges, r2 } from "./costs.js";

export const MARKET_OPEN = 9 * 3600 + 15 * 60;
export const SQUARE_OFF = 15 * 3600 + 20 * 60;
export const LIVE_STRATEGIES = ["sma_cross", "macd_rsi", "donchian", "rsi_reversion", "vwap_reversion", "bollinger_breakout"];
export const LIVE_PARAMS = { vwap_reversion: { window: 30, band: 0.5 } };
const FIELDS = ["t", "open", "high", "low", "close", "volume"];

export class CandleAggregator {
  constructor() {
    this.current = null;
    this.lastCum = null;
  }
  update(t, price, cum) {
    const minute = Math.floor(t / 60) * 60;
    let dv = 0;
    if (cum !== null && cum !== undefined) {
      if (this.lastCum !== null) dv = Math.max(0, cum - this.lastCum);
      this.lastCum = cum;
    }
    const cur = this.current;
    if (cur && minute < cur.t) return [null, null];
    if (cur && minute === cur.t) {
      cur.high = Math.max(cur.high, price);
      cur.low = Math.min(cur.low, price);
      cur.close = price;
      cur.volume += dv;
      return [null, null];
    }
    this.current = { t: minute, open: price, high: price, low: price, close: price, volume: dv };
    return [cur, this.current];
  }
  flush() {
    const c = this.current;
    this.current = null;
    return c;
  }
}

export class Runner {
  constructor(symbol, strategy, history, capital = 100000, allowShort = true, params = {}) {
    this.symbol = symbol;
    this.strategy = strategy;
    this.params = { ...defaults(strategy), ...(LIVE_PARAMS[strategy] || {}), ...params };
    this.capital = capital;
    this.allowShort = allowShort;
    this.hist = Object.fromEntries(FIELDS.map((k) => [k, [...(history[k] || [])]]));
    this.pos = 0;
    this.qty = 0;
    this.entryPrice = 0;
    this.entryT = 0;
    this.pending = null;
    this.doneForDay = false;
    this.trades = [];
    this.realized = 0;
    this.lastPrice = 0;
  }
  signalNow() {
    if (this.hist.close.length < 2) return 0;
    const sig = signal(this.strategy, this.hist, this.params, this.allowShort);
    return sig[sig.length - 1];
  }
  onClose(c, events) {
    for (const k of FIELDS) this.hist[k].push(c[k]);
    if (this.doneForDay || c.t + 60 >= SQUARE_OFF) return;
    const desired = this.signalNow();
    if (desired !== this.pos) {
      events.push({ type: "signal", symbol: this.symbol, strategy: this.strategy, t: c.t + 60, from: this.pos, to: desired, price: c.close });
    }
    this.pending = desired;
  }
  onOpen(t, price, events) {
    this.lastPrice = price;
    if (this.doneForDay) return;
    if (t >= SQUARE_OFF) return this.squareOff(t, price, events);
    if (this.pending !== null && this.pending !== this.pos) {
      if (this.pos !== 0) this.exit(t, price, "signal", events);
      if (this.pending !== 0) this.enter(t, price, this.pending, events);
    }
    this.pending = null;
  }
  squareOff(t, price, events) {
    if (this.pos !== 0) this.exit(t, price, "square-off", events);
    this.doneForDay = true;
    this.pending = null;
  }
  enter(t, price, side, events) {
    const qty = Math.floor(this.capital / price);
    if (qty <= 0) return;
    this.pos = side;
    this.qty = qty;
    this.entryPrice = price;
    this.entryT = t;
    events.push({ type: "fill", symbol: this.symbol, strategy: this.strategy, t, action: side > 0 ? "buy" : "sell short", side, qty, price });
  }
  exit(t, price, reason, events) {
    const [buyPx, sellPx] = this.pos > 0 ? [this.entryPrice, price] : [price, this.entryPrice];
    const gross = r2((sellPx - buyPx) * this.qty);
    const charges = intradayCharges(buyPx * this.qty, sellPx * this.qty).total;
    const net = r2(gross - charges);
    const trade = {
      type: "trade", symbol: this.symbol, strategy: this.strategy, side: this.pos > 0 ? "long" : "short", qty: this.qty,
      entry_t: this.entryT, entry_price: this.entryPrice, exit_t: t, exit_price: price, gross, charges, net, reason,
    };
    this.trades.push(trade);
    this.realized = r2(this.realized + net);
    events.push(trade);
    this.pos = 0;
    this.qty = 0;
  }
  unrealized(price = this.lastPrice) {
    return this.pos ? this.pos * (price - this.entryPrice) * this.qty : 0;
  }
}

export class Hub {
  constructor(warmup, { strategies = LIVE_STRATEGIES, capital = 100000, allowShort = true } = {}) {
    this.symbols = Object.keys(warmup);
    this.aggs = Object.fromEntries(this.symbols.map((s) => [s, new CandleAggregator()]));
    this.runners = Object.fromEntries(this.symbols.map((s) => [s, strategies.filter((k) => byKey[k]).map((k) => new Runner(s, k, warmup[s], capital, allowShort))]));
    this.candles = Object.fromEntries(this.symbols.map((s) => [s, []]));
    this.last = {};
    this.squared = false;
  }
  onTick(symbol, t, price, cum) {
    const events = [];
    if (!this.aggs[symbol]) return events;
    this.last[symbol] = price;
    const [closed, opened] = this.aggs[symbol].update(t, price, cum);
    if (closed) this.close(symbol, closed, events);
    if (opened) for (const r of this.runners[symbol]) r.onOpen(opened.t, opened.open, events);
    for (const r of this.runners[symbol]) r.lastPrice = price;
    const cur = this.aggs[symbol].current;
    if (cur) events.push({ type: "candle", symbol, candle: { ...cur }, final: false });
    return events;
  }
  close(symbol, c, events) {
    this.candles[symbol].push({ ...c });
    events.push({ type: "candle", symbol, candle: { ...c }, final: true });
    for (const r of this.runners[symbol]) r.onClose(c, events);
  }
  onClock(t) {
    const events = [];
    if (t < SQUARE_OFF || this.squared) return events;
    t = Math.floor(t);
    for (const s of this.symbols) for (const r of this.runners[s]) if (!r.doneForDay) r.squareOff(t, this.last[s] ?? r.lastPrice, events);
    this.squared = true;
    events.push({ type: "squared_off", t });
    return events;
  }
  endOfDay(t) {
    const events = this.onClock(Math.max(t, SQUARE_OFF));
    for (const s of this.symbols) {
      const c = this.aggs[s].flush();
      if (c) this.close(s, c, events);
    }
    return events;
  }
}

export function runSession(session, opts) {
  const order = Object.keys(session.symbols);
  const hub = new Hub(Object.fromEntries(order.map((s) => [s, session.symbols[s].warmup])), opts);
  const events = [];
  for (const [i, t, p, cum] of session.ticks) for (const e of hub.onTick(order[i], t, p, cum)) if (!(e.type === "candle" && !e.final)) events.push(e);
  const lastT = session.ticks.length ? session.ticks[session.ticks.length - 1][1] : SQUARE_OFF;
  events.push(...hub.endOfDay(lastT));
  return { hub, events };
}
