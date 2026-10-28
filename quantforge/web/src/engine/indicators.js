// Line-by-line port of quantforge/indicators.py. Arrays use NaN for "not enough history".

const nanArr = (n) => new Array(n).fill(NaN);
const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length;

export function sma(x, n) {
  const out = nanArr(x.length);
  if (n <= 0 || x.length < n) return out;
  let run = 0;
  for (let i = 0; i < x.length; i++) {
    run += x[i];
    if (i >= n) run -= x[i - n];
    if (i >= n - 1) out[i] = run / n;
  }
  return out;
}

export function ema(x, n) {
  const out = nanArr(x.length);
  let start = x.findIndex((v) => !Number.isNaN(v));
  if (n <= 0 || start < 0 || x.length - start < n) return out;
  const seedEnd = start + n - 1;
  out[seedEnd] = mean(x.slice(start, seedEnd + 1));
  const alpha = 2 / (n + 1);
  for (let i = seedEnd + 1; i < x.length; i++) out[i] = alpha * x[i] + (1 - alpha) * out[i - 1];
  return out;
}

const rsiValue = (g, l) => (l === 0 ? (g > 0 ? 100 : 50) : 100 - 100 / (1 + g / l));

export function rsi(c, n = 14) {
  const out = nanArr(c.length);
  if (n <= 0 || c.length <= n) return out;
  const gains = new Array(c.length).fill(0);
  const losses = new Array(c.length).fill(0);
  for (let i = 1; i < c.length; i++) {
    const d = c[i] - c[i - 1];
    gains[i] = d > 0 ? d : 0;
    losses[i] = d < 0 ? -d : 0;
  }
  let g = mean(gains.slice(1, n + 1));
  let l = mean(losses.slice(1, n + 1));
  out[n] = rsiValue(g, l);
  for (let i = n + 1; i < c.length; i++) {
    g = (g * (n - 1) + gains[i]) / n;
    l = (l * (n - 1) + losses[i]) / n;
    out[i] = rsiValue(g, l);
  }
  return out;
}

export function macd(close, fast = 12, slow = 26, signal = 9) {
  const f = ema(close, fast);
  const s = ema(close, slow);
  const line = f.map((v, i) => v - s[i]);
  const sig = ema(line, signal);
  return [line, sig, line.map((v, i) => v - sig[i])];
}

export function bollinger(c, n = 20, k = 2) {
  const mid = sma(c, n);
  const sd = nanArr(c.length);
  for (let i = n - 1; i < c.length; i++) {
    let s = 0;
    for (let j = i - n + 1; j <= i; j++) s += (c[j] - mid[i]) ** 2;
    sd[i] = Math.sqrt(s / n);
  }
  return [mid.map((m, i) => m - k * sd[i]), mid, mid.map((m, i) => m + k * sd[i])];
}

export function rollingVwap(h, l, c, v, n = 20) {
  const out = nanArr(c.length);
  const tp = c.map((ci, i) => (h[i] + l[i] + ci) / 3);
  let pv = 0;
  let vv = 0;
  for (let i = 0; i < c.length; i++) {
    pv += tp[i] * v[i];
    vv += v[i];
    if (i >= n) {
      pv -= tp[i - n] * v[i - n];
      vv -= v[i - n];
    }
    if (i >= n - 1 && vv > 0) out[i] = pv / vv;
  }
  return out;
}

export function drawdown(eq) {
  let peak = -Infinity;
  return eq.map((e) => {
    peak = Math.max(peak, e);
    return e / peak - 1;
  });
}
