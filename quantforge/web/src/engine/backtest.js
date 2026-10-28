// Line-by-line port of quantforge/backtest.py. Same timing model:
// decide at close t, fill at open t+1, gaps earned by the carried position,
// intrabar stops on high/low (gap-through fills at the open), costs per unit traded.
import { computeMetrics } from "./metrics.js";
import { drawdown } from "./indicators.js";

export const DEFAULT_CONFIG = {
  initial_capital: 100000,
  fee_bps: 5,
  slippage_bps: 5,
  stop_loss_pct: 0,
  allow_short: false,
  periods_per_year: 252,
};

export function run(data, signal, config = {}) {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const { open: o, high: h, low: l, close: c, date: dates } = data;
  const n = c.length;
  if (signal.length !== n) throw new Error("signal length must match data length");
  if (n < 2) throw new Error("need at least 2 bars");

  const cost = (cfg.fee_bps + cfg.slippage_bps) / 10000;
  const sl = cfg.stop_loss_pct / 100;
  const equity = new Array(n);
  const position = new Array(n).fill(0);
  equity[0] = cfg.initial_capital;
  let eq = cfg.initial_capital;
  let cur = 0;
  let entryPx = 0;
  let entryEq = 0;
  let entryI = 0;
  let stoppedDir = 0;
  const trades = [];

  const closeTrade = (i, px, reason) =>
    trades.push({
      side: cur > 0 ? "long" : "short",
      entry_date: dates[entryI], entry_index: entryI, entry_price: entryPx,
      exit_date: dates[i], exit_index: i, exit_price: px,
      return: eq / entryEq - 1, bars: i - entryI, reason,
    });

  for (let t = 1; t < n; t++) {
    let desired = signal[t - 1];
    if (stoppedDir !== 0) {
      if (desired === stoppedDir) desired = 0;
      else stoppedDir = 0;
    }

    eq *= 1 + cur * (o[t] / c[t - 1] - 1);

    if (desired !== cur) {
      let units = Math.abs(desired - cur);
      if (cur !== 0) {
        eq *= 1 - cost * Math.abs(cur);
        closeTrade(t, o[t], "signal");
        units -= Math.abs(cur);
      }
      if (desired !== 0) {
        entryEq = eq;
        eq *= 1 - cost * units;
        entryPx = o[t];
        entryI = t;
      }
      cur = desired;
    }

    let stopped = false;
    if (cur !== 0 && sl > 0) {
      let hit, exitPx;
      if (cur > 0) {
        const stop = entryPx * (1 - sl);
        hit = l[t] <= stop;
        exitPx = Math.min(o[t], stop);
      } else {
        const stop = entryPx * (1 + sl);
        hit = h[t] >= stop;
        exitPx = Math.max(o[t], stop);
      }
      if (hit) {
        eq *= 1 + cur * (exitPx / o[t] - 1);
        eq *= 1 - cost * Math.abs(cur);
        closeTrade(t, exitPx, "stop");
        stoppedDir = cur;
        cur = 0;
        stopped = true;
      }
    }
    if (!stopped) eq *= 1 + cur * (c[t] / o[t] - 1);

    equity[t] = eq;
    position[t] = cur;
  }

  if (cur !== 0) {
    trades.push({
      side: cur > 0 ? "long" : "short",
      entry_date: dates[entryI], entry_index: entryI, entry_price: entryPx,
      exit_date: dates[n - 1], exit_index: n - 1, exit_price: c[n - 1],
      return: eq / entryEq - 1, bars: n - 1 - entryI, reason: "open",
    });
  }

  return {
    config: cfg,
    equity,
    drawdown: drawdown(equity),
    position,
    trades,
    metrics: computeMetrics(equity, position, trades, cfg.periods_per_year),
  };
}
