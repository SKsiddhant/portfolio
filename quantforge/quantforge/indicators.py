"""Technical indicators.

Every function takes plain numpy arrays and returns an array of the same length,
with NaN wherever the indicator does not have enough history yet. Definitions are
kept deliberately explicit because the browser engine (web/src/engine) mirrors
them line for line and the parity tests compare the two to 1e-9.
"""
from __future__ import annotations

import numpy as np


def sma(x: np.ndarray, n: int) -> np.ndarray:
    x = np.asarray(x, dtype=float)
    out = np.full(len(x), np.nan)
    if n <= 0 or len(x) < n:
        return out
    run = 0.0
    for i in range(len(x)):
        run += x[i]
        if i >= n:
            run -= x[i - n]
        if i >= n - 1:
            out[i] = run / n
    return out


def ema(x: np.ndarray, n: int) -> np.ndarray:
    """EMA seeded with the SMA of the first n valid values (NaNs at the start are skipped)."""
    x = np.asarray(x, dtype=float)
    out = np.full(len(x), np.nan)
    valid = np.flatnonzero(~np.isnan(x))
    if n <= 0 or len(valid) < n:
        return out
    start = valid[0]
    seed_end = start + n - 1
    out[seed_end] = float(np.mean(x[start : seed_end + 1]))
    alpha = 2.0 / (n + 1.0)
    for i in range(seed_end + 1, len(x)):
        out[i] = alpha * x[i] + (1.0 - alpha) * out[i - 1]
    return out


def rsi(close: np.ndarray, n: int = 14) -> np.ndarray:
    """Wilder's RSI."""
    c = np.asarray(close, dtype=float)
    out = np.full(len(c), np.nan)
    if n <= 0 or len(c) <= n:
        return out
    gains = np.zeros(len(c))
    losses = np.zeros(len(c))
    for i in range(1, len(c)):
        d = c[i] - c[i - 1]
        gains[i] = d if d > 0 else 0.0
        losses[i] = -d if d < 0 else 0.0
    avg_g = float(np.mean(gains[1 : n + 1]))
    avg_l = float(np.mean(losses[1 : n + 1]))
    out[n] = _rsi_value(avg_g, avg_l)
    for i in range(n + 1, len(c)):
        avg_g = (avg_g * (n - 1) + gains[i]) / n
        avg_l = (avg_l * (n - 1) + losses[i]) / n
        out[i] = _rsi_value(avg_g, avg_l)
    return out


def _rsi_value(avg_g: float, avg_l: float) -> float:
    if avg_l == 0.0:
        return 100.0 if avg_g > 0 else 50.0
    rs = avg_g / avg_l
    return 100.0 - 100.0 / (1.0 + rs)


def macd(close: np.ndarray, fast: int = 12, slow: int = 26, signal: int = 9):
    line = ema(close, fast) - ema(close, slow)
    sig = ema(line, signal)
    return line, sig, line - sig


def bollinger(close: np.ndarray, n: int = 20, k: float = 2.0):
    c = np.asarray(close, dtype=float)
    mid = sma(c, n)
    sd = np.full(len(c), np.nan)
    for i in range(n - 1, len(c)):
        w = c[i - n + 1 : i + 1]
        m = mid[i]
        sd[i] = float(np.sqrt(np.sum((w - m) ** 2) / n))
    return mid - k * sd, mid, mid + k * sd


def rolling_vwap(high, low, close, volume, n: int = 20) -> np.ndarray:
    h, l, c, v = (np.asarray(a, dtype=float) for a in (high, low, close, volume))
    tp = (h + l + c) / 3.0
    out = np.full(len(c), np.nan)
    pv = 0.0
    vv = 0.0
    for i in range(len(c)):
        pv += tp[i] * v[i]
        vv += v[i]
        if i >= n:
            pv -= tp[i - n] * v[i - n]
            vv -= v[i - n]
        if i >= n - 1 and vv > 0:
            out[i] = pv / vv
    return out


def drawdown(equity: np.ndarray) -> np.ndarray:
    e = np.asarray(equity, dtype=float)
    peak = np.maximum.accumulate(e)
    return e / peak - 1.0
