import math

import numpy as np
import pytest

import quantforge as q
from quantforge import analysis, indicators as ind
from quantforge.backtest import Config, run
from quantforge.data import load_csv, synthetic
from quantforge.metrics import compute_metrics


def make(closes, opens=None, highs=None, lows=None):
    c = np.array(closes, dtype=float)
    o = np.array(opens if opens is not None else closes, dtype=float)
    h = np.array(highs if highs is not None else np.maximum(o, c), dtype=float)
    l = np.array(lows if lows is not None else np.minimum(o, c), dtype=float)
    return {"date": [f"d{i:04d}" for i in range(len(c))], "open": o, "high": h, "low": l,
            "close": c, "volume": np.ones(len(c))}


ZERO = Config(fee_bps=0, slippage_bps=0)


# ---------------------------------------------------------------- indicators

def test_sma_and_ema():
    x = np.arange(1, 11, dtype=float)
    s = ind.sma(x, 3)
    assert np.isnan(s[:2]).all()
    assert s[2] == pytest.approx(2.0) and s[-1] == pytest.approx(9.0)
    e = ind.ema(x, 3)
    assert e[2] == pytest.approx(2.0)  # seeded with SMA
    assert e[3] == pytest.approx(0.5 * 4 + 0.5 * 2.0)


def test_rsi_extremes():
    up = np.arange(1, 40, dtype=float)
    assert ind.rsi(up, 14)[-1] == pytest.approx(100.0)
    down = up[::-1].copy()
    assert ind.rsi(down, 14)[-1] == pytest.approx(0.0)
    r = ind.rsi(synthetic("choppy")["close"], 14)
    assert np.nanmin(r) >= 0 and np.nanmax(r) <= 100


def test_bollinger_and_vwap_shapes():
    d = synthetic("trending", 200)
    lo, mid, up = ind.bollinger(d["close"], 20, 2)
    ok = ~np.isnan(mid)
    assert (lo[ok] <= mid[ok]).all() and (mid[ok] <= up[ok]).all()
    v = ind.rolling_vwap(d["high"], d["low"], d["close"], d["volume"], 20)
    assert np.isnan(v[:19]).all() and not np.isnan(v[19:]).any()


# ---------------------------------------------------------------- execution model

def test_buy_and_hold_fills_next_open_and_pays_costs_once():
    d = make([100, 110, 121, 133.1], opens=[100, 105, 120, 130])
    cfg = Config(fee_bps=10, slippage_bps=0)
    r = run(d, np.ones(4), cfg)
    # signal at close 0 -> fill at open 1 (105), mark at close 3
    expected = 100_000 * (1 - 0.001) * 133.1 / 105
    assert r["equity"][-1] == pytest.approx(expected)
    assert r["equity"][0] == 100_000
    assert r["trades"][0]["entry_price"] == 105 and r["trades"][0]["reason"] == "open"


@pytest.mark.parametrize("key", [k for k in q.STRATEGIES])
def test_no_look_ahead(key):
    """Scrambling the future must not change a single past equity value."""
    d = synthetic("volatile", 600)
    s = q.get_strategy(key)
    base = run(d, s.signal(d, allow_short=True), Config(allow_short=True, stop_loss_pct=5))["equity"]
    k = 400
    d2 = {kk: (v.copy() if not isinstance(v, list) else list(v)) for kk, v in d.items()}
    rng = np.random.default_rng(0)
    shock = np.exp(rng.normal(0, 0.05, len(d2["close"]) - k))
    for f in ("open", "high", "low", "close"):
        d2[f][k:] = d2[f][k:] * shock
    d2["high"][k:] = np.maximum.reduce([d2["open"][k:], d2["close"][k:], d2["high"][k:]])
    d2["low"][k:] = np.minimum.reduce([d2["open"][k:], d2["close"][k:], d2["low"][k:]])
    changed = run(d2, s.signal(d2, allow_short=True), Config(allow_short=True, stop_loss_pct=5))["equity"]
    assert np.allclose(base[:k], changed[:k], rtol=0, atol=1e-9)


@pytest.mark.parametrize("key", [k for k in q.STRATEGIES if k != "buy_hold"])
def test_position_for_a_bar_is_decided_before_that_bar(key):
    """Changing bar k's own prices must not change the position held *during* bar k:
    that position had to be chosen at the close of bar k-1."""
    d = synthetic("volatile", 600)
    s = q.get_strategy(key)
    cfg = Config(allow_short=True)
    base = run(d, s.signal(d, allow_short=True), cfg)["position"]
    for k in range(150, 590, 7):
        d2 = {kk: (v.copy() if not isinstance(v, list) else list(v)) for kk, v in d.items()}
        for f in ("open", "high", "low", "close"):
            d2[f][k:] *= 0.8 if k % 2 else 1.25
        pos = run(d2, s.signal(d2, allow_short=True), cfg)["position"]
        assert pos[: k + 1] == base[: k + 1], f"position at bar {k} peeked at bar {k}'s prices"


def test_costs_only_ever_hurt():
    d = synthetic("choppy", 800)
    sig = q.get_strategy("rsi_reversion").signal(d, {"period": 4})
    finals = [run(d, sig, Config(fee_bps=f, slippage_bps=f))["equity"][-1] for f in (0, 5, 20, 50)]
    assert finals == sorted(finals, reverse=True)


def test_flip_pays_double_cost():
    d = make([100] * 6)
    sig = np.array([1, 1, -1, -1, -1, -1], dtype=float)
    r = run(d, sig, Config(fee_bps=10, slippage_bps=0, allow_short=True))
    assert r["equity"][-1] == pytest.approx(100_000 * 0.999 ** 3)
    assert [t["side"] for t in r["trades"]] == ["long", "short"]


def test_short_profits_in_a_falling_market():
    closes = [100 * 0.99 ** i for i in range(50)]
    r = run(make(closes), -np.ones(50), Config(fee_bps=0, slippage_bps=0, allow_short=True))
    assert r["metrics"]["total_return"] > 0.3


def test_shorts_are_dropped_when_not_allowed():
    sig = q.get_strategy("sma_cross").signal(synthetic("volatile", 400), allow_short=False)
    assert sig.min() >= 0


def test_stop_loss_exits_at_stop_price_and_waits_for_new_signal():
    # entry at open of bar 1 = 100, bar 2 trades down to 90 -> 5% stop fills at 95
    d = make([100, 100, 97, 98, 99, 100], opens=[100, 100, 99, 97, 98, 99],
             highs=[100, 101, 100, 98, 99, 100], lows=[100, 99, 90, 96, 97, 98])
    r = run(d, np.ones(6), Config(fee_bps=0, slippage_bps=0, stop_loss_pct=5))
    t = r["trades"][0]
    assert t["reason"] == "stop" and t["exit_price"] == pytest.approx(95)
    assert t["return"] == pytest.approx(-0.05)
    # signal never changed, so we must stay flat afterwards
    assert len(r["trades"]) == 1 and all(p == 0 for p in r["position"][3:])


def test_gap_through_stop_fills_at_open():
    d = make([100, 100, 80, 80], opens=[100, 100, 82, 80], highs=[100, 100, 85, 81], lows=[100, 100, 79, 79])
    r = run(d, np.ones(4), Config(fee_bps=0, slippage_bps=0, stop_loss_pct=5))
    assert r["trades"][0]["exit_price"] == pytest.approx(82)


def test_trade_returns_compound_to_equity():
    d = synthetic("trending", 1000)
    r = run(d, q.get_strategy("donchian").signal(d), Config())
    growth = np.prod([1 + t["return"] for t in r["trades"]])
    assert r["equity"][-1] / r["equity"][0] == pytest.approx(growth, rel=1e-9)


# ---------------------------------------------------------------- metrics

def test_metrics_on_known_curve():
    eq = np.array([100, 120, 90, 135], dtype=float)
    m = compute_metrics(eq, np.ones(4), [], periods_per_year=252)
    assert m["total_return"] == pytest.approx(0.35)
    assert m["max_drawdown"] == pytest.approx(-0.25)
    assert m["longest_drawdown_bars"] == 1


def test_profit_factor_and_win_rate():
    trades = [{"return": r, "reason": "signal", "bars": 1} for r in (0.10, -0.05, 0.02, -0.01)]
    m = compute_metrics(np.array([1.0, 1.1]), np.ones(2), trades)
    assert m["win_rate"] == pytest.approx(0.5)
    assert m["profit_factor"] == pytest.approx(0.12 / 0.06)


# ---------------------------------------------------------------- research tools

def test_sweep_grid_matches_single_runs():
    d = synthetic("choppy", 600)
    res = analysis.sweep(d, "sma_cross", None, Config())
    assert res["x"]["values"][0] == 5 and len(res["x"]["values"]) == 12
    xs, ys = res["x"]["values"], res["y"]["values"]
    j, i = 2, 3
    cell = res["cells"][i][j]
    p = {"fast": xs[j], "slow": ys[i]}
    direct = run(d, q.get_strategy("sma_cross").signal(d, p), Config())["metrics"]["sharpe"]
    assert cell["sharpe"] == pytest.approx(direct)
    # fast >= slow is invalid
    assert res["cells"][0][-1] is None


def test_grid_values_subsample_endpoints():
    p = q.get_strategy("sma_cross").params[1]  # 20..200 step 10 -> 19 values
    vals = analysis.grid_values(p, 12)
    assert len(vals) == 12 and vals[0] == 20 and vals[-1] == 200


def test_walk_forward_windows_are_out_of_sample():
    d = synthetic("volatile", 1200)
    wf = analysis.walk_forward(d, "sma_cross", None, Config(), folds=4)
    assert len(wf["folds"]) == 4
    prev_end = None
    for f in wf["folds"]:
        assert f["train"][1] == f["test"][0]  # test starts exactly where training ends
        if prev_end:
            assert f["test"][0] == prev_end
        prev_end = f["test"][1]
    assert len(wf["oos_equity"]) == wf["folds"][-1]["test_index"][1] - wf["folds"][0]["test_index"][0] + 1


def test_mulberry32_matches_reference():
    # reference values from the canonical JavaScript implementation
    rnd = analysis.mulberry32(42)
    assert [round(rnd(), 10) for _ in range(3)] == [0.6011037519, 0.4482905590, 0.8524657935]


def test_monte_carlo_is_deterministic_and_ordered():
    tr = [0.05, -0.02, 0.03, -0.04, 0.01, 0.06, -0.01]
    a = analysis.monte_carlo(tr, sims=500, seed=7)
    b = analysis.monte_carlo(tr, sims=500, seed=7)
    assert a == b
    fr = a["final_return"]
    assert fr["p5"] <= fr["p25"] <= fr["p50"] <= fr["p75"] <= fr["p95"]
    assert sum(a["histogram"]["counts"]) == 500
    assert analysis.monte_carlo([0.1], sims=10) is None


def test_percentile_matches_numpy():
    vals = sorted(np.random.default_rng(1).normal(size=101).tolist())
    for qq in (5, 25, 50, 75, 95):
        assert analysis.percentile(vals, qq) == pytest.approx(np.percentile(vals, qq))


# ---------------------------------------------------------------- data

def test_csv_loader_handles_yahoo_style_and_nulls():
    rows = ["Date,Open,High,Low,Close,Adj Close,Volume"]
    for i in range(40):
        rows.append(f"2024-01-{i + 1:02d},{100 + i},{101 + i},{99 + i},{100.5 + i},{100.5 + i},1000")
    rows.insert(5, "2024-01-04,null,null,null,null,null,null")
    d = load_csv("\n".join(rows))
    assert len(d["close"]) == 40 and d["close"][0] == 100.5


def test_csv_loader_reverses_newest_first_and_rejects_bad_files():
    from datetime import date, timedelta
    days = [date(2024, 1, 1) + timedelta(days=i) for i in range(35)]
    rows = ["date,open,high,low,close"] + [f"{d.isoformat()},1,2,0.5,1.5" for d in reversed(days)]
    d = load_csv("\n".join(rows))
    assert d["date"][0] < d["date"][-1]
    with pytest.raises(ValueError, match="missing"):
        load_csv("a,b\n1,2\n3,4")


def test_synthetic_markets_are_reproducible_and_valid():
    a, b = synthetic("trending", 300), synthetic("trending", 300)
    assert np.array_equal(a["close"], b["close"])
    assert (a["high"] >= np.maximum(a["open"], a["close"])).all()
    assert (a["low"] <= np.minimum(a["open"], a["close"])).all()


def test_one_call_backtest_includes_benchmark_and_monte_carlo():
    r = q.backtest(synthetic("trending"), "donchian")
    assert r["benchmark"]["metrics"]["exposure"] == pytest.approx(1.0)
    assert r["monte_carlo"]["sims"] == 1000
    assert math.isfinite(r["metrics"]["sharpe"])
