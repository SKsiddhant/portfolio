// Port of quantforge/metrics.py.
const clean = (x) => (x === null || x === undefined || !Number.isFinite(x) ? null : x);
const mean = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0);

function stdSample(a) {
  if (a.length < 2) return 0;
  const m = mean(a);
  return Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / (a.length - 1));
}

export function computeMetrics(equity, position, trades, ppy = 252) {
  const e = equity;
  const n = e.length;
  const rets = [];
  for (let i = 1; i < n; i++) rets.push(e[i] / e[i - 1] - 1);
  const years = (n - 1) / ppy;

  const total = e[n - 1] / e[0] - 1;
  const cagr = years > 0 && e[n - 1] > 0 ? (e[n - 1] / e[0]) ** (1 / years) - 1 : NaN;
  const m = mean(rets);
  const sd = stdSample(rets);
  const vol = sd * Math.sqrt(ppy);
  const sharpe = sd > 0 ? (m / sd) * Math.sqrt(ppy) : 0;
  const ddDev = rets.length ? Math.sqrt(mean(rets.map((r) => Math.min(r, 0) ** 2))) : 0;
  const sortino = ddDev > 0 ? (m / ddDev) * Math.sqrt(ppy) : 0;

  let peak = -Infinity;
  let maxDd = 0;
  let longest = 0;
  let curRun = 0;
  for (const v of e) {
    peak = Math.max(peak, v);
    const dd = v / peak - 1;
    maxDd = Math.min(maxDd, dd);
    curRun = dd < 0 ? curRun + 1 : 0;
    longest = Math.max(longest, curRun);
  }
  const calmar = maxDd < 0 && Number.isFinite(cagr) ? cagr / Math.abs(maxDd) : 0;

  const closed = trades.filter((t) => t.reason !== "open");
  const tr = closed.map((t) => t.return);
  const wins = tr.filter((r) => r > 0);
  const losses = tr.filter((r) => r <= 0);
  const gw = wins.reduce((s, v) => s + v, 0);
  const gl = -losses.reduce((s, v) => s + v, 0);
  const pf = gl > 0 ? gw / gl : gw > 0 ? Infinity : 0;
  let exposed = 0;
  for (let i = 1; i < n; i++) if (position[i] !== 0) exposed++;

  return {
    total_return: clean(total),
    cagr: clean(cagr),
    volatility: clean(vol),
    sharpe: clean(sharpe),
    sortino: clean(sortino),
    max_drawdown: clean(maxDd),
    calmar: clean(calmar),
    longest_drawdown_bars: longest,
    exposure: n > 1 ? exposed / (n - 1) : 0,
    trades: closed.length,
    win_rate: tr.length ? wins.length / tr.length : null,
    avg_trade: tr.length ? clean(mean(tr)) : null,
    best_trade: tr.length ? Math.max(...tr) : null,
    worst_trade: tr.length ? Math.min(...tr) : null,
    profit_factor: Number.isFinite(pf) ? pf : null,
    avg_bars_held: closed.length ? mean(closed.map((t) => t.bars)) : null,
    final_equity: clean(e[n - 1]),
  };
}
