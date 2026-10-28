"""Performance and risk metrics computed from an equity curve and a trade list."""
from __future__ import annotations

import math

import numpy as np


def _clean(x: float) -> float | None:
    return None if x is None or not math.isfinite(x) else float(x)


def compute_metrics(equity, position, trades, periods_per_year: int = 252) -> dict:
    e = np.asarray(equity, dtype=float)
    pos = np.asarray(position, dtype=float)
    n = len(e)
    rets = e[1:] / e[:-1] - 1.0
    years = (n - 1) / periods_per_year

    total = e[-1] / e[0] - 1.0
    cagr = (e[-1] / e[0]) ** (1.0 / years) - 1.0 if years > 0 and e[-1] > 0 else float("nan")

    mean = float(np.mean(rets)) if len(rets) else 0.0
    sd = float(np.std(rets, ddof=1)) if len(rets) > 1 else 0.0
    vol = sd * math.sqrt(periods_per_year)
    sharpe = mean / sd * math.sqrt(periods_per_year) if sd > 0 else 0.0
    downside = np.minimum(rets, 0.0)
    dd_dev = float(np.sqrt(np.mean(downside**2))) if len(rets) else 0.0
    sortino = mean / dd_dev * math.sqrt(periods_per_year) if dd_dev > 0 else 0.0

    peak = np.maximum.accumulate(e)
    dd = e / peak - 1.0
    max_dd = float(dd.min())
    # longest stretch spent below a previous peak, in bars
    longest = cur = 0
    for v in dd:
        cur = cur + 1 if v < 0 else 0
        longest = max(longest, cur)
    calmar = cagr / abs(max_dd) if max_dd < 0 and math.isfinite(cagr) else 0.0

    closed = [t for t in trades if t["reason"] != "open"]
    tr = np.array([t["return"] for t in closed], dtype=float)
    wins = tr[tr > 0]
    losses = tr[tr <= 0]
    gross_win = float(wins.sum())
    gross_loss = float(-losses.sum())
    profit_factor = gross_win / gross_loss if gross_loss > 0 else (float("inf") if gross_win > 0 else 0.0)

    return {
        "total_return": _clean(total),
        "cagr": _clean(cagr),
        "volatility": _clean(vol),
        "sharpe": _clean(sharpe),
        "sortino": _clean(sortino),
        "max_drawdown": _clean(max_dd),
        "calmar": _clean(calmar),
        "longest_drawdown_bars": int(longest),
        "exposure": _clean(float(np.mean(pos[1:] != 0)) if n > 1 else 0.0),
        "trades": len(closed),
        "win_rate": _clean(len(wins) / len(tr)) if len(tr) else None,
        "avg_trade": _clean(float(tr.mean())) if len(tr) else None,
        "best_trade": _clean(float(tr.max())) if len(tr) else None,
        "worst_trade": _clean(float(tr.min())) if len(tr) else None,
        "profit_factor": None if not math.isfinite(profit_factor) else _clean(profit_factor),
        "avg_bars_held": _clean(float(np.mean([t["bars"] for t in closed]))) if closed else None,
        "final_equity": _clean(float(e[-1])),
    }
