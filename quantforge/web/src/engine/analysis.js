// Port of quantforge/analysis.py: sweeps, walk-forward, Monte Carlo.
import { run } from "./backtest.js";
import { computeMetrics } from "./metrics.js";
import { byKey, defaults, signal } from "./strategies.js";

export function mulberry32(seed) {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function gridValues(p, maxPoints = 12) {
  const count = Math.floor((p.max - p.min) / p.step + 1e-9) + 1;
  const idx =
    count <= maxPoints
      ? [...Array(count).keys()]
      : [...Array(maxPoints).keys()].map((i) => Math.floor((i * (count - 1)) / (maxPoints - 1) + 0.5));
  return idx.map((i) => p.min + i * p.step);
}

export function isValid(key, p) {
  if (key === "sma_cross" || key === "macd_rsi") return p.fast < p.slow;
  return true;
}

function axes(key) {
  const s = byKey[key];
  if (!s.params.length) throw new Error("this strategy has no parameters to sweep");
  const pm = Object.fromEntries(s.params.map((p) => [p.key, p]));
  return [pm[s.sweep[0]], pm[s.sweep[1]]];
}

export function sweep(data, key, baseParams, config, maxPoints = 12) {
  const [px, py] = axes(key);
  const xs = gridValues(px, maxPoints);
  const ys = gridValues(py, maxPoints);
  const base = { ...defaults(key), ...baseParams };
  const cells = ys.map((yv) =>
    xs.map((xv) => {
      const p = { ...base, [px.key]: xv, [py.key]: yv };
      if (!isValid(key, p)) return null;
      const m = run(data, signal(key, data, p, config.allow_short), config).metrics;
      return { sharpe: m.sharpe, total_return: m.total_return, max_drawdown: m.max_drawdown, trades: m.trades, cagr: m.cagr };
    }),
  );
  return { x: { key: px.key, label: px.label, values: xs }, y: { key: py.key, label: py.label, values: ys }, cells };
}

function sharpeOf(r, ppy) {
  if (r.length < 2) return 0;
  const m = r.reduce((s, v) => s + v, 0) / r.length;
  const sd = Math.sqrt(r.reduce((s, v) => s + (v - m) ** 2, 0) / (r.length - 1));
  return sd > 0 ? (m / sd) * Math.sqrt(ppy) : 0;
}

export function walkForward(data, key, baseParams, config, folds = 5, trainRatio = 0.6, maxPoints = 6) {
  const [px, py] = axes(key);
  const n = data.close.length;
  const base = { ...defaults(key), ...baseParams };
  const candidates = [];
  for (const yv of gridValues(py, maxPoints)) {
    for (const xv of gridValues(px, maxPoints)) {
      const p = { ...base, [px.key]: xv, [py.key]: yv };
      if (!isValid(key, p)) continue;
      const eq = run(data, signal(key, data, p, config.allow_short), config).equity;
      const r = [];
      for (let i = 1; i < eq.length; i++) r.push(eq[i] / eq[i - 1] - 1);
      candidates.push([p, r]);
    }
  }
  if (!candidates.length) throw new Error("no valid parameter combinations");

  const testLen = Math.floor(((n - 1) * (1 - trainRatio)) / (folds * (1 - trainRatio) + trainRatio));
  const trainLen = Math.floor((testLen * trainRatio) / (1 - trainRatio));
  if (testLen < 5 || trainLen < 20) throw new Error("not enough data for walk-forward with these settings");

  const ppy = config.periods_per_year ?? 252;
  const rows = [];
  const oos = [];
  for (let f = 0; f < folds; f++) {
    const trS = f * testLen;
    const trE = trS + trainLen;
    const teE = Math.min(trE + testLen, n - 1);
    let best = null;
    let bestSh = -Infinity;
    for (const [p, r] of candidates) {
      const sh = sharpeOf(r.slice(trS, trE), ppy);
      if (sh > bestSh + 1e-12) {
        best = [p, r];
        bestSh = sh;
      }
    }
    const [p, r] = best;
    const seg = r.slice(trE, teE);
    oos.push(...seg);
    rows.push({
      fold: f + 1,
      train: [data.date[trS], data.date[trE]],
      test: [data.date[trE], data.date[teE]],
      test_index: [trE, teE],
      params: { [px.key]: p[px.key], [py.key]: p[py.key] },
      in_sample_sharpe: bestSh,
      oos_sharpe: sharpeOf(seg, ppy),
      oos_return: seg.reduce((acc, v) => acc * (1 + v), 1) - 1,
    });
  }
  const eq = [config.initial_capital ?? 100000];
  for (const r of oos) eq.push(eq[eq.length - 1] * (1 + r));
  const isMean = rows.reduce((s, r) => s + r.in_sample_sharpe, 0) / rows.length;
  const om = computeMetrics(eq, eq.map(() => 1), [], ppy);
  return {
    folds: rows,
    oos_equity: eq,
    oos_start_index: rows[0].test_index[0],
    oos_metrics: om,
    in_sample_sharpe: isMean,
    efficiency: isMean > 0 ? om.sharpe / isMean : null,
  };
}

export function percentile(sorted, q) {
  if (!sorted.length) return NaN;
  const pos = ((sorted.length - 1) * q) / 100;
  const lo = Math.floor(pos);
  const hi = Math.min(lo + 1, sorted.length - 1);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

export function monteCarlo(tradeReturns, sims = 1000, seed = 42, bins = 30, paths = 40) {
  const tr = tradeReturns;
  const k = tr.length;
  if (k < 3) return null;
  const rnd = mulberry32(seed);
  const finals = [];
  const dds = [];
  const samplePaths = [];
  for (let s = 0; s < sims; s++) {
    let eq = 1;
    let peak = 1;
    let mdd = 0;
    const path = [1];
    for (let i = 0; i < k; i++) {
      eq *= 1 + tr[Math.floor(rnd() * k)];
      peak = Math.max(peak, eq);
      mdd = Math.min(mdd, eq / peak - 1);
      if (s < paths) path.push(eq);
    }
    finals.push(eq - 1);
    dds.push(mdd);
    if (s < paths) samplePaths.push(path);
  }
  const fs = [...finals].sort((a, b) => a - b);
  const ds = [...dds].sort((a, b) => a - b);
  // bin on log growth: compounding makes the raw returns heavily right-skewed
  const logs = finals.map((v) => Math.log1p(v));
  const lo = Math.min(...logs);
  const hi = Math.max(...logs);
  const width = hi > lo ? (hi - lo) / bins : 1;
  const counts = new Array(bins).fill(0);
  for (const v of logs) counts[Math.min(Math.floor((v - lo) / width), bins - 1)]++;
  const qs = [5, 25, 50, 75, 95];
  return {
    sims,
    trades_per_sim: k,
    final_return: Object.fromEntries(qs.map((q) => [`p${q}`, percentile(fs, q)])),
    max_drawdown: Object.fromEntries(qs.map((q) => [`p${q}`, percentile(ds, q)])),
    prob_loss: finals.filter((v) => v < 0).length / sims,
    histogram: { start: lo, width, counts },
    paths: samplePaths,
  };
}

export function backtest(data, key, params = {}, config = {}, mcSims = 1000) {
  const p = { ...defaults(key), ...params };
  const result = run(data, signal(key, data, p, config.allow_short), config);
  const bench = run(data, signal("buy_hold", data), { ...config, stop_loss_pct: 0, allow_short: false });
  const closed = result.trades.filter((t) => t.reason !== "open").map((t) => t.return);
  return {
    ...result,
    strategy: key,
    params: p,
    benchmark: { equity: bench.equity, metrics: bench.metrics },
    monte_carlo: monteCarlo(closed, mcSims),
  };
}
