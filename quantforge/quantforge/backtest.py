"""Event-ordered bar backtester.

Timing model (no look-ahead by construction):
  * the strategy decides a target position at the CLOSE of bar t
  * the order fills at the OPEN of bar t+1
  * overnight gaps are earned by whatever was held at the previous close
  * stop-losses trigger intrabar on the high/low; a gap through the stop fills at the open
  * fees + slippage are charged per unit of position changed (a long->short flip pays twice)

The browser engine in web/src/engine/backtest.js is a line-by-line port of this file.
"""
from __future__ import annotations

from dataclasses import dataclass, asdict

import numpy as np

from .metrics import compute_metrics
from .indicators import drawdown


@dataclass
class Config:
    initial_capital: float = 100_000.0
    fee_bps: float = 5.0
    slippage_bps: float = 5.0
    stop_loss_pct: float = 0.0  # 0 disables
    allow_short: bool = False
    periods_per_year: int = 252


def run(data: dict, signal: np.ndarray, config: Config | None = None) -> dict:
    cfg = config or Config()
    o, h, l, c = (np.asarray(data[k], dtype=float) for k in ("open", "high", "low", "close"))
    dates = list(data["date"])
    n = len(c)
    sig = np.asarray(signal, dtype=float)
    if len(sig) != n:
        raise ValueError("signal length must match data length")
    if n < 2:
        raise ValueError("need at least 2 bars")

    cost = (cfg.fee_bps + cfg.slippage_bps) / 10_000.0
    sl = cfg.stop_loss_pct / 100.0

    equity = np.empty(n)
    position = np.zeros(n)
    equity[0] = cfg.initial_capital
    eq = cfg.initial_capital
    cur = 0.0
    entry_px = 0.0
    entry_eq = 0.0
    entry_i = 0
    stopped_dir = 0.0
    trades: list[dict] = []

    def close_trade(i: int, px: float, reason: str):
        trades.append({
            "side": "long" if cur > 0 else "short",
            "entry_date": dates[entry_i], "entry_index": entry_i, "entry_price": entry_px,
            "exit_date": dates[i], "exit_index": i, "exit_price": px,
            "return": eq / entry_eq - 1.0, "bars": i - entry_i, "reason": reason,
        })

    for t in range(1, n):
        desired = sig[t - 1]
        if stopped_dir != 0.0:
            if desired == stopped_dir:
                desired = 0.0  # stay out until the signal itself changes
            else:
                stopped_dir = 0.0

        # overnight gap on the position carried from yesterday's close
        eq *= 1.0 + cur * (o[t] / c[t - 1] - 1.0)

        if desired != cur:
            units = abs(desired - cur)
            if cur != 0.0:
                eq *= 1.0 - cost * abs(cur)
                close_trade(t, o[t], "signal")
                units -= abs(cur)
            if desired != 0.0:
                entry_eq = eq
                eq *= 1.0 - cost * units
                entry_px, entry_i = o[t], t
            cur = desired

        stopped = False
        if cur != 0.0 and sl > 0.0:
            if cur > 0:
                stop = entry_px * (1.0 - sl)
                hit = l[t] <= stop
                exit_px = min(o[t], stop)
            else:
                stop = entry_px * (1.0 + sl)
                hit = h[t] >= stop
                exit_px = max(o[t], stop)
            if hit:
                eq *= 1.0 + cur * (exit_px / o[t] - 1.0)
                eq *= 1.0 - cost * abs(cur)
                close_trade(t, exit_px, "stop")
                stopped_dir = cur
                cur = 0.0
                stopped = True
        if not stopped:
            eq *= 1.0 + cur * (c[t] / o[t] - 1.0)

        equity[t] = eq
        position[t] = cur

    open_trade = None
    if cur != 0.0:
        open_trade = {
            "side": "long" if cur > 0 else "short",
            "entry_date": dates[entry_i], "entry_index": entry_i, "entry_price": entry_px,
            "exit_date": dates[-1], "exit_index": n - 1, "exit_price": c[-1],
            "return": eq / entry_eq - 1.0, "bars": n - 1 - entry_i, "reason": "open",
        }

    all_trades = trades + ([open_trade] if open_trade else [])
    metrics = compute_metrics(equity, position, all_trades, cfg.periods_per_year)
    return {
        "config": asdict(cfg),
        "equity": equity.tolist(),
        "drawdown": drawdown(equity).tolist(),
        "position": position.tolist(),
        "trades": all_trades,
        "metrics": metrics,
    }
