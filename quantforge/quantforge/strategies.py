"""Strategy library.

A strategy maps OHLCV data to a *target position* for every bar: +1 long, -1 short,
0 flat. The value at bar t is decided using information available at the close
of bar t only; the backtester fills it at the next bar's open.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Callable

import numpy as np

from . import indicators as ind


@dataclass(frozen=True)
class Param:
    key: str
    label: str
    min: float
    max: float
    step: float
    default: float


@dataclass(frozen=True)
class Strategy:
    key: str
    name: str
    family: str
    description: str
    params: tuple[Param, ...]
    sweep: tuple[str, str]
    fn: Callable = field(repr=False)

    def defaults(self) -> dict:
        return {p.key: p.default for p in self.params}

    def signal(self, data: dict, params: dict | None = None, allow_short: bool = False) -> np.ndarray:
        merged = self.defaults()
        merged.update(params or {})
        sig = np.asarray(self.fn(data, merged, allow_short), dtype=float)
        sig[np.isnan(sig)] = 0.0
        if not allow_short:
            sig[sig < 0] = 0.0
        return sig

    def to_dict(self) -> dict:
        return {
            "key": self.key,
            "name": self.name,
            "family": self.family,
            "description": self.description,
            "params": [p.__dict__ for p in self.params],
            "sweep": list(self.sweep),
        }


def _side(cond_long, cond_short, allow_short):
    out = np.where(cond_long, 1.0, 0.0)
    if allow_short:
        out = np.where(cond_short, -1.0, out)
    return out


def _sma_cross(d, p, allow_short):
    fast = ind.sma(d["close"], int(p["fast"]))
    slow = ind.sma(d["close"], int(p["slow"]))
    valid = ~np.isnan(fast) & ~np.isnan(slow)
    sig = _side(fast > slow, fast < slow, allow_short)
    sig[~valid] = 0.0
    return sig


def _stateful(entry_long, exit_long, entry_short, exit_short, valid, allow_short):
    """Latching signal: hold a side from its entry trigger until its exit trigger."""
    n = len(valid)
    sig = np.zeros(n)
    pos = 0.0
    for i in range(n):
        if not valid[i]:
            pos = 0.0
        elif pos == 0.0:
            if entry_long[i]:
                pos = 1.0
            elif allow_short and entry_short[i]:
                pos = -1.0
        elif pos == 1.0 and exit_long[i]:
            pos = -1.0 if (allow_short and entry_short[i]) else 0.0
        elif pos == -1.0 and exit_short[i]:
            pos = 1.0 if entry_long[i] else 0.0
        sig[i] = pos
    return sig


def _rsi_reversion(d, p, allow_short):
    r = ind.rsi(d["close"], int(p["period"]))
    lo, ex = float(p["lower"]), float(p["exit"])
    valid = ~np.isnan(r)
    rr = np.nan_to_num(r, nan=50.0)
    return _stateful(rr < lo, rr > ex, rr > 100 - lo, rr < 100 - ex, valid, allow_short)


def _macd_rsi(d, p, allow_short):
    line, sig_line, _ = ind.macd(d["close"], int(p["fast"]), int(p["slow"]), 9)
    r = ind.rsi(d["close"], 14)
    floor = float(p["rsi_floor"])
    valid = ~np.isnan(line) & ~np.isnan(sig_line) & ~np.isnan(r)
    long_c = (line > sig_line) & (r > floor)
    short_c = (line < sig_line) & (r < 100 - floor)
    sig = _side(long_c, short_c, allow_short)
    sig[~valid] = 0.0
    return sig


def _vwap_reversion(d, p, allow_short):
    v = ind.rolling_vwap(d["high"], d["low"], d["close"], d["volume"], int(p["window"]))
    band = float(p["band"]) / 100.0
    c = d["close"]
    valid = ~np.isnan(v)
    vv = np.where(valid, v, c)
    return _stateful(c < vv * (1 - band), c >= vv, c > vv * (1 + band), c <= vv, valid, allow_short)


def _bollinger_breakout(d, p, allow_short):
    lower, mid, upper = ind.bollinger(d["close"], int(p["period"]), float(p["k"]))
    c = d["close"]
    valid = ~np.isnan(mid)
    lo = np.where(valid, lower, c)
    mi = np.where(valid, mid, c)
    up = np.where(valid, upper, c)
    return _stateful(c > up, c < mi, c < lo, c > mi, valid, allow_short)


def _donchian(d, p, allow_short):
    n_in, n_out = int(p["entry"]), int(p["exit"])
    h, l, c = d["high"], d["low"], d["close"]
    n = len(c)
    hi_in = np.full(n, np.nan)
    lo_in = np.full(n, np.nan)
    hi_out = np.full(n, np.nan)
    lo_out = np.full(n, np.nan)
    for i in range(n):
        # channels use the *previous* n bars so a breakout is measurable at today's close
        if i >= n_in:
            hi_in[i] = np.max(h[i - n_in : i])
            lo_in[i] = np.min(l[i - n_in : i])
        if i >= n_out:
            hi_out[i] = np.max(h[i - n_out : i])
            lo_out[i] = np.min(l[i - n_out : i])
    valid = ~np.isnan(hi_in) & ~np.isnan(lo_out)
    hi_in, lo_in = np.nan_to_num(hi_in, nan=np.inf), np.nan_to_num(lo_in, nan=-np.inf)
    hi_out, lo_out = np.nan_to_num(hi_out, nan=np.inf), np.nan_to_num(lo_out, nan=-np.inf)
    return _stateful(c > hi_in, c < lo_out, c < lo_in, c > hi_out, valid, allow_short)


def _buy_hold(d, p, allow_short):
    return np.ones(len(d["close"]))


STRATEGIES: dict[str, Strategy] = {
    s.key: s
    for s in [
        Strategy(
            "sma_cross", "SMA Crossover", "Trend",
            "Long when the fast moving average is above the slow one. The classic trend filter.",
            (Param("fast", "Fast SMA", 5, 60, 5, 20), Param("slow", "Slow SMA", 20, 200, 10, 100)),
            ("fast", "slow"), _sma_cross,
        ),
        Strategy(
            "macd_rsi", "MACD × RSI", "Momentum",
            "MACD above its signal line, confirmed by RSI above a floor. Momentum with a quality check.",
            (Param("fast", "MACD fast", 4, 20, 2, 12), Param("slow", "MACD slow", 14, 58, 4, 26),
             Param("rsi_floor", "RSI floor", 30, 70, 5, 50)),
            ("fast", "slow"), _macd_rsi,
        ),
        Strategy(
            "donchian", "Donchian Breakout", "Trend",
            "Turtle-style: buy a new N-day high, exit on an M-day low.",
            (Param("entry", "Entry channel", 10, 100, 10, 50), Param("exit", "Exit channel", 5, 50, 5, 20)),
            ("entry", "exit"), _donchian,
        ),
        Strategy(
            "rsi_reversion", "RSI Mean Reversion", "Mean reversion",
            "Buy when RSI is oversold, sell once it recovers past the exit level.",
            (Param("period", "RSI period", 2, 30, 2, 14), Param("lower", "Oversold", 10, 40, 5, 30),
             Param("exit", "Exit level", 45, 80, 5, 55)),
            ("period", "lower"), _rsi_reversion,
        ),
        Strategy(
            "vwap_reversion", "VWAP Reversion", "Mean reversion",
            "Buy when price stretches below rolling VWAP by a band, exit back at VWAP.",
            (Param("window", "VWAP window", 5, 60, 5, 20), Param("band", "Band %", 0.5, 6, 0.5, 2)),
            ("window", "band"), _vwap_reversion,
        ),
        Strategy(
            "bollinger_breakout", "Bollinger Breakout", "Volatility",
            "Enter on a close outside the band, exit on a return to the mid-line.",
            (Param("period", "Period", 10, 60, 5, 20), Param("k", "Std devs", 1, 3, 0.25, 2)),
            ("period", "k"), _bollinger_breakout,
        ),
        Strategy(
            "buy_hold", "Buy & Hold", "Benchmark",
            "Fully invested the whole time. Every strategy is measured against this.",
            (), ("", ""), _buy_hold,
        ),
    ]
}


def get(key: str) -> Strategy:
    try:
        return STRATEGIES[key]
    except KeyError:
        raise ValueError(f"unknown strategy '{key}'. choose from: {', '.join(STRATEGIES)}") from None
