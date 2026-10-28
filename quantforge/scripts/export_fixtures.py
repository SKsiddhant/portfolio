"""Export the synthetic markets for the dashboard and Python reference results for
the JS parity tests.

    python scripts/export_fixtures.py
"""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

import quantforge as q  # noqa: E402
from quantforge import analysis, data as qdata  # noqa: E402
from quantforge.backtest import Config  # noqa: E402

WEB = ROOT / "web"


def main():
    markets = {}
    for key, spec in qdata.MARKETS.items():
        d = qdata.to_json(qdata.synthetic(key))
        markets[key] = {"name": spec["name"], "blurb": spec["blurb"], "data": d}
    out = WEB / "public" / "data" / "markets.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(markets, separators=(",", ":")))
    print(f"wrote {out.relative_to(ROOT)} ({out.stat().st_size // 1024} KB)")

    # parity fixture: a 700-bar slice keeps it small but covers every code path
    cases = []
    configs = [
        Config(),
        Config(fee_bps=12, slippage_bps=3, stop_loss_pct=4, allow_short=True),
    ]
    for mk in qdata.MARKETS:
        d = qdata.from_json({k: v[:700] for k, v in markets[mk]["data"].items()})
        for s in q.STRATEGIES:
            for cfg in configs:
                r = q.backtest(d, s, None, cfg, mc_sims=200)
                cases.append({
                    "market": mk, "strategy": s, "config": cfg.__dict__,
                    "equity": r["equity"], "position": r["position"],
                    "trades": r["trades"], "metrics": r["metrics"],
                    "monte_carlo": r["monte_carlo"] and {k: r["monte_carlo"][k] for k in ("final_return", "max_drawdown", "prob_loss", "histogram")},
                })
    d = qdata.from_json({k: v[:700] for k, v in markets["volatile"]["data"].items()})
    sweep = analysis.sweep(d, "donchian", None, Config(stop_loss_pct=6))
    wf = analysis.walk_forward(d, "sma_cross", None, Config(), folds=4)
    fixture = {"bars": 700, "cases": cases, "sweep": sweep,
               "strategies": [st.to_dict() for st in q.STRATEGIES.values()],
               "walk_forward": {k: wf[k] for k in ("folds", "oos_equity", "in_sample_sharpe", "efficiency")}}
    fx = WEB / "tests" / "fixtures" / "parity.json"
    fx.parent.mkdir(parents=True, exist_ok=True)
    fx.write_text(json.dumps(fixture, default=lambda o: None))
    print(f"wrote {fx.relative_to(ROOT)} ({fx.stat().st_size // 1024} KB, {len(cases)} cases)")


if __name__ == "__main__":
    main()
