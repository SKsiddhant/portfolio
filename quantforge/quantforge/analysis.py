"""Research tools on top of the backtester: parameter sweeps, walk-forward
validation and Monte Carlo resampling of trades."""
from __future__ import annotations

import math

import numpy as np

from . import strategies as strat
from .backtest import Config, run
from .metrics import compute_metrics

MASK = 0xFFFFFFFF


def mulberry32(seed: int):
    """Tiny seeded PRNG, identical to the JS version so both engines agree."""
    state = seed & MASK

    def rnd() -> float:
        nonlocal state
        state = (state + 0x6D2B79F5) & MASK
        t = state
        t = ((t ^ (t >> 15)) * (t | 1)) & MASK
        t = (((t + (((t ^ (t >> 7)) * (t | 61)) & MASK)) & MASK) ^ t) & MASK
        return ((t ^ (t >> 14)) & MASK) / 4294967296.0

    return rnd


def grid_values(param: strat.Param, max_points: int = 12) -> list[float]:
    count = int(math.floor((param.max - param.min) / param.step + 1e-9)) + 1
    if count <= max_points:
        idx = list(range(count))
    else:
        idx = [int(math.floor(i * (count - 1) / (max_points - 1) + 0.5)) for i in range(max_points)]
    return [param.min + i * param.step for i in idx]


def is_valid(strategy_key: str, params: dict) -> bool:
    if strategy_key in ("sma_cross", "macd_rsi"):
        return params["fast"] < params["slow"]
    return True


def _params_by_key(s: strat.Strategy) -> dict:
    return {p.key: p for p in s.params}


def sweep(data: dict, strategy_key: str, base_params: dict | None, config: Config, max_points: int = 12) -> dict:
    s = strat.get(strategy_key)
    if not s.params:
        raise ValueError("this strategy has no parameters to sweep")
    px, py = _params_by_key(s)[s.sweep[0]], _params_by_key(s)[s.sweep[1]]
    xs, ys = grid_values(px, max_points), grid_values(py, max_points)
    base = s.defaults()
    base.update(base_params or {})
    cells = []
    for yv in ys:
        row = []
        for xv in xs:
            p = dict(base, **{px.key: xv, py.key: yv})
            if not is_valid(s.key, p):
                row.append(None)
                continue
            m = run(data, s.signal(data, p, config.allow_short), config)["metrics"]
            row.append({k: m[k] for k in ("sharpe", "total_return", "max_drawdown", "trades", "cagr")})
        cells.append(row)
    return {"x": {"key": px.key, "label": px.label, "values": xs},
            "y": {"key": py.key, "label": py.label, "values": ys}, "cells": cells}


def walk_forward(data: dict, strategy_key: str, base_params: dict | None, config: Config,
                 folds: int = 5, train_ratio: float = 0.6, max_points: int = 6) -> dict:
    """Rolling walk-forward: pick the best-Sharpe parameters on each in-sample window,
    then record how that choice performed on the following unseen window."""
    s = strat.get(strategy_key)
    if not s.params:
        raise ValueError("this strategy has no parameters to optimise")
    n = len(data["close"])
    pmap = _params_by_key(s)
    px, py = pmap[s.sweep[0]], pmap[s.sweep[1]]
    base = s.defaults()
    base.update(base_params or {})

    candidates = []
    for yv in grid_values(py, max_points):
        for xv in grid_values(px, max_points):
            p = dict(base, **{px.key: xv, py.key: yv})
            if is_valid(s.key, p):
                eq = np.asarray(run(data, s.signal(data, p, config.allow_short), config)["equity"])
                candidates.append((p, eq[1:] / eq[:-1] - 1.0))
    if not candidates:
        raise ValueError("no valid parameter combinations")

    # window layout: each fold = train + test, sliding by the test length
    test_len = int(math.floor((n - 1) * (1 - train_ratio) / (folds * (1 - train_ratio) + train_ratio)))
    train_len = int(math.floor(test_len * train_ratio / (1 - train_ratio)))
    if test_len < 5 or train_len < 20:
        raise ValueError("not enough data for walk-forward with these settings")

    ppy = config.periods_per_year
    fold_rows = []
    oos_returns: list[float] = []
    for f in range(folds):
        tr_s = f * test_len
        tr_e = tr_s + train_len
        te_e = min(tr_e + test_len, n - 1)
        best, best_sh = None, -math.inf
        for p, r in candidates:
            sh = _sharpe(r[tr_s:tr_e], ppy)
            if sh > best_sh + 1e-12:
                best, best_sh = (p, r), sh
        p, r = best
        seg = r[tr_e:te_e]
        oos_returns.extend(seg.tolist())
        fold_rows.append({
            "fold": f + 1,
            "train": [data["date"][tr_s], data["date"][tr_e]],
            "test": [data["date"][tr_e], data["date"][te_e]],
            "test_index": [tr_e, te_e],
            "params": {px.key: p[px.key], py.key: p[py.key]},
            "in_sample_sharpe": best_sh,
            "oos_sharpe": _sharpe(seg, ppy),
            "oos_return": float(np.prod(1 + seg) - 1),
        })

    eq = [config.initial_capital]
    for r in oos_returns:
        eq.append(eq[-1] * (1 + r))
    is_mean = float(np.mean([fr["in_sample_sharpe"] for fr in fold_rows]))
    oos_m = compute_metrics(np.array(eq), np.ones(len(eq)), [], ppy)
    return {
        "folds": fold_rows,
        "oos_equity": eq,
        "oos_start_index": fold_rows[0]["test_index"][0],
        "oos_metrics": oos_m,
        "in_sample_sharpe": is_mean,
        "efficiency": (oos_m["sharpe"] / is_mean) if is_mean > 0 else None,
    }


def _sharpe(r: np.ndarray, ppy: int) -> float:
    if len(r) < 2:
        return 0.0
    sd = float(np.std(r, ddof=1))
    return float(np.mean(r)) / sd * math.sqrt(ppy) if sd > 0 else 0.0


def percentile(sorted_vals: list[float], q: float) -> float:
    """Linear interpolation, same as numpy's default."""
    if not sorted_vals:
        return float("nan")
    pos = (len(sorted_vals) - 1) * q / 100.0
    lo = int(math.floor(pos))
    hi = min(lo + 1, len(sorted_vals) - 1)
    return sorted_vals[lo] + (sorted_vals[hi] - sorted_vals[lo]) * (pos - lo)


def monte_carlo(trade_returns: list[float], sims: int = 1000, seed: int = 42,
                bins: int = 30, paths: int = 40) -> dict | None:
    """Bootstrap the realised trades into alternative histories to see how much of
    the result was the order of the trades rather than the edge."""
    tr = [float(x) for x in trade_returns]
    k = len(tr)
    if k < 3:
        return None
    rnd = mulberry32(seed)
    finals, dds, sample_paths = [], [], []
    for s in range(sims):
        eq, peak, mdd = 1.0, 1.0, 0.0
        path = [1.0]
        for _ in range(k):
            eq *= 1.0 + tr[int(math.floor(rnd() * k))]
            peak = max(peak, eq)
            mdd = min(mdd, eq / peak - 1.0)
            if s < paths:
                path.append(eq)
        finals.append(eq - 1.0)
        dds.append(mdd)
        if s < paths:
            sample_paths.append(path)

    fs, ds = sorted(finals), sorted(dds)
    # bin on log growth: compounding makes the raw returns heavily right-skewed
    logs = [math.log1p(v) for v in finals]
    lo, hi = min(logs), max(logs)
    width = (hi - lo) / bins if hi > lo else 1.0
    counts = [0] * bins
    for v in logs:
        counts[min(int((v - lo) / width), bins - 1)] += 1
    qs = (5, 25, 50, 75, 95)
    return {
        "sims": sims,
        "trades_per_sim": k,
        "final_return": {f"p{q}": percentile(fs, q) for q in qs},
        "max_drawdown": {f"p{q}": percentile(ds, q) for q in qs},
        "prob_loss": sum(1 for v in finals if v < 0) / sims,
        "histogram": {"start": lo, "width": width, "counts": counts},
        "paths": sample_paths,
    }
