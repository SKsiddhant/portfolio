"""QuantForge: a no-look-ahead backtesting engine with walk-forward and Monte Carlo analysis."""
from .backtest import Config, run
from .strategies import STRATEGIES, get as get_strategy
from . import analysis, data, indicators, metrics

__version__ = "1.0.0"


def backtest(data_: dict, strategy: str, params: dict | None = None, config: Config | None = None,
             mc_sims: int = 1000) -> dict:
    """One-call API: run a strategy, its buy-and-hold benchmark, and a Monte Carlo on its trades."""
    cfg = config or Config()
    s = get_strategy(strategy)
    p = s.defaults()
    p.update(params or {})
    result = run(data_, s.signal(data_, p, cfg.allow_short), cfg)
    bench_cfg = Config(**{**cfg.__dict__, "stop_loss_pct": 0.0, "allow_short": False})
    bench = run(data_, get_strategy("buy_hold").signal(data_), bench_cfg)
    closed = [t["return"] for t in result["trades"] if t["reason"] != "open"]
    result.update({
        "strategy": strategy,
        "params": p,
        "benchmark": {"equity": bench["equity"], "metrics": bench["metrics"]},
        "monte_carlo": analysis.monte_carlo(closed, sims=mc_sims),
    })
    return result


__all__ = ["Config", "run", "backtest", "STRATEGIES", "get_strategy", "analysis", "data", "indicators", "metrics"]
