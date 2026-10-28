// Port of quantforge/strategies.py. Each fn returns a target position per bar (+1 / 0 / -1).
import * as ind from "./indicators.js";

const P = (key, label, min, max, step, def) => ({ key, label, min, max, step, default: def });

function side(longC, shortC, allowShort) {
  return longC.map((l, i) => (allowShort && shortC[i] ? -1 : l ? 1 : 0));
}

function stateful(entryL, exitL, entryS, exitS, valid, allowShort) {
  const sig = new Array(valid.length).fill(0);
  let pos = 0;
  for (let i = 0; i < valid.length; i++) {
    if (!valid[i]) pos = 0;
    else if (pos === 0) {
      if (entryL[i]) pos = 1;
      else if (allowShort && entryS[i]) pos = -1;
    } else if (pos === 1 && exitL[i]) pos = allowShort && entryS[i] ? -1 : 0;
    else if (pos === -1 && exitS[i]) pos = entryL[i] ? 1 : 0;
    sig[i] = pos;
  }
  return sig;
}

const isNum = (v) => !Number.isNaN(v);

const fns = {
  sma_cross(d, p, s) {
    const f = ind.sma(d.close, p.fast | 0);
    const sl = ind.sma(d.close, p.slow | 0);
    const sig = side(f.map((v, i) => v > sl[i]), f.map((v, i) => v < sl[i]), s);
    return sig.map((v, i) => (isNum(f[i]) && isNum(sl[i]) ? v : 0));
  },
  macd_rsi(d, p, s) {
    const [line, sl] = ind.macd(d.close, p.fast | 0, p.slow | 0, 9);
    const r = ind.rsi(d.close, 14);
    const floor = +p.rsi_floor;
    const sig = side(
      line.map((v, i) => v > sl[i] && r[i] > floor),
      line.map((v, i) => v < sl[i] && r[i] < 100 - floor),
      s,
    );
    return sig.map((v, i) => (isNum(line[i]) && isNum(sl[i]) && isNum(r[i]) ? v : 0));
  },
  donchian(d, p, s) {
    const nIn = p.entry | 0;
    const nOut = p.exit | 0;
    const { high: h, low: l, close: c } = d;
    const n = c.length;
    const hiIn = [], loIn = [], hiOut = [], loOut = [], valid = [];
    for (let i = 0; i < n; i++) {
      hiIn.push(i >= nIn ? Math.max(...h.slice(i - nIn, i)) : Infinity);
      loIn.push(i >= nIn ? Math.min(...l.slice(i - nIn, i)) : -Infinity);
      hiOut.push(i >= nOut ? Math.max(...h.slice(i - nOut, i)) : Infinity);
      loOut.push(i >= nOut ? Math.min(...l.slice(i - nOut, i)) : -Infinity);
      valid.push(i >= nIn && i >= nOut);
    }
    return stateful(
      c.map((v, i) => v > hiIn[i]), c.map((v, i) => v < loOut[i]),
      c.map((v, i) => v < loIn[i]), c.map((v, i) => v > hiOut[i]), valid, s,
    );
  },
  rsi_reversion(d, p, s) {
    const r = ind.rsi(d.close, p.period | 0);
    const lo = +p.lower;
    const ex = +p.exit;
    const rr = r.map((v) => (isNum(v) ? v : 50));
    return stateful(
      rr.map((v) => v < lo), rr.map((v) => v > ex),
      rr.map((v) => v > 100 - lo), rr.map((v) => v < 100 - ex), r.map(isNum), s,
    );
  },
  vwap_reversion(d, p, s) {
    const v = ind.rollingVwap(d.high, d.low, d.close, d.volume, p.window | 0);
    const band = p.band / 100;
    const c = d.close;
    const vv = v.map((x, i) => (isNum(x) ? x : c[i]));
    return stateful(
      c.map((x, i) => x < vv[i] * (1 - band)), c.map((x, i) => x >= vv[i]),
      c.map((x, i) => x > vv[i] * (1 + band)), c.map((x, i) => x <= vv[i]), v.map(isNum), s,
    );
  },
  bollinger_breakout(d, p, s) {
    const [lower, mid, upper] = ind.bollinger(d.close, p.period | 0, +p.k);
    const c = d.close;
    const valid = mid.map(isNum);
    const pick = (a, i) => (valid[i] ? a[i] : c[i]);
    return stateful(
      c.map((x, i) => x > pick(upper, i)), c.map((x, i) => x < pick(mid, i)),
      c.map((x, i) => x < pick(lower, i)), c.map((x, i) => x > pick(mid, i)), valid, s,
    );
  },
  buy_hold(d) {
    return d.close.map(() => 1);
  },
};

export const STRATEGIES = [
  {
    key: "sma_cross", name: "SMA Crossover", family: "Trend",
    description: "Long when the fast moving average is above the slow one. The classic trend filter.",
    params: [P("fast", "Fast SMA", 5, 60, 5, 20), P("slow", "Slow SMA", 20, 200, 10, 100)],
    sweep: ["fast", "slow"],
  },
  {
    key: "macd_rsi", name: "MACD × RSI", family: "Momentum",
    description: "MACD above its signal line, confirmed by RSI above a floor. Momentum with a quality check.",
    params: [P("fast", "MACD fast", 4, 20, 2, 12), P("slow", "MACD slow", 14, 58, 4, 26), P("rsi_floor", "RSI floor", 30, 70, 5, 50)],
    sweep: ["fast", "slow"],
  },
  {
    key: "donchian", name: "Donchian Breakout", family: "Trend",
    description: "Turtle-style: buy a new N-day high, exit on an M-day low.",
    params: [P("entry", "Entry channel", 10, 100, 10, 50), P("exit", "Exit channel", 5, 50, 5, 20)],
    sweep: ["entry", "exit"],
  },
  {
    key: "rsi_reversion", name: "RSI Mean Reversion", family: "Mean reversion",
    description: "Buy when RSI is oversold, sell once it recovers past the exit level.",
    params: [P("period", "RSI period", 2, 30, 2, 14), P("lower", "Oversold", 10, 40, 5, 30), P("exit", "Exit level", 45, 80, 5, 55)],
    sweep: ["period", "lower"],
  },
  {
    key: "vwap_reversion", name: "VWAP Reversion", family: "Mean reversion",
    description: "Buy when price stretches below rolling VWAP by a band, exit back at VWAP.",
    params: [P("window", "VWAP window", 5, 60, 5, 20), P("band", "Band %", 0.5, 6, 0.5, 2)],
    sweep: ["window", "band"],
  },
  {
    key: "bollinger_breakout", name: "Bollinger Breakout", family: "Volatility",
    description: "Enter on a close outside the band, exit on a return to the mid-line.",
    params: [P("period", "Period", 10, 60, 5, 20), P("k", "Std devs", 1, 3, 0.25, 2)],
    sweep: ["period", "k"],
  },
  {
    key: "buy_hold", name: "Buy & Hold", family: "Benchmark",
    description: "Fully invested the whole time. Every strategy is measured against this.",
    params: [], sweep: ["", ""],
  },
];

export const byKey = Object.fromEntries(STRATEGIES.map((s) => [s.key, s]));

export function defaults(key) {
  return Object.fromEntries(byKey[key].params.map((p) => [p.key, p.default]));
}

export function signal(key, data, params = {}, allowShort = false) {
  if (!fns[key]) throw new Error(`unknown strategy '${key}'`);
  const p = { ...defaults(key), ...params };
  return fns[key](data, p, allowShort).map((v) => (Number.isNaN(v) ? 0 : !allowShort && v < 0 ? 0 : v));
}
