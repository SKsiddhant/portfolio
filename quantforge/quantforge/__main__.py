"""Command line interface.

    python -m quantforge strategies
    python -m quantforge run --strategy donchian --market trending
    python -m quantforge run --strategy rsi_reversion --csv RELIANCE.csv --param period=6 --stop 4
    python -m quantforge sweep --strategy sma_cross --market choppy
    python -m quantforge walkforward --strategy macd_rsi --market volatile
    python -m quantforge serve --port 5000
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from . import STRATEGIES, Config, analysis, backtest, data as qdata, get_strategy

RESET, DIM, BOLD, GREEN, RED, CYAN = "\033[0m", "\033[2m", "\033[1m", "\033[32m", "\033[31m", "\033[36m"


def _load(args) -> dict:
    if args.csv:
        return qdata.load_csv(Path(args.csv).read_text(encoding="utf-8-sig"))
    return qdata.synthetic(args.market, args.bars)


def _params(pairs: list[str]) -> dict:
    out = {}
    for pair in pairs or []:
        k, _, v = pair.partition("=")
        out[k.strip()] = float(v)
    return out


def _config(args) -> Config:
    return Config(initial_capital=args.capital, fee_bps=args.fee, slippage_bps=args.slippage,
                  stop_loss_pct=args.stop, allow_short=args.short)


def _pct(x):
    return "—" if x is None else f"{x * 100:+.2f}%"


def _num(x):
    return "—" if x is None else f"{x:.2f}"


def _color(x, s):
    if x is None:
        return s
    return f"{GREEN if x >= 0 else RED}{s}{RESET}"


def cmd_strategies(_args):
    for s in STRATEGIES.values():
        params = ", ".join(f"{p.key}={p.default:g}" for p in s.params) or "no parameters"
        print(f"{BOLD}{s.key:<20}{RESET}{CYAN}{s.family:<16}{RESET}{s.description}\n{'':<36}{DIM}{params}{RESET}")


def cmd_run(args):
    d = _load(args)
    r = backtest(d, args.strategy, _params(args.param), _config(args))
    m, b = r["metrics"], r["benchmark"]["metrics"]
    print(f"\n{BOLD}{get_strategy(args.strategy).name}{RESET}  {DIM}{d['date'][0]} → {d['date'][-1]} · {len(d['date'])} bars{RESET}")
    print(f"{DIM}params {json.dumps(r['params'])}{RESET}\n")
    rows = [
        ("Total return", _pct(m["total_return"]), _pct(b["total_return"]), m["total_return"]),
        ("CAGR", _pct(m["cagr"]), _pct(b["cagr"]), m["cagr"]),
        ("Sharpe", _num(m["sharpe"]), _num(b["sharpe"]), None),
        ("Sortino", _num(m["sortino"]), _num(b["sortino"]), None),
        ("Max drawdown", _pct(m["max_drawdown"]), _pct(b["max_drawdown"]), None),
        ("Exposure", _pct(m["exposure"]), _pct(b["exposure"]), None),
        ("Trades", str(m["trades"]), "", None),
        ("Win rate", _pct(m["win_rate"]), "", None),
        ("Profit factor", _num(m["profit_factor"]), "", None),
    ]
    print(f"  {'':<16}{'Strategy':>12}{'Buy & hold':>14}")
    for name, a, bb, c in rows:
        print(f"  {name:<16}{_color(c, f'{a:>12}') if c is not None else f'{a:>12}'}{DIM}{bb:>14}{RESET}")
    mc = r["monte_carlo"]
    if mc:
        fr = mc["final_return"]
        print(f"\n  {BOLD}Monte Carlo{RESET} {DIM}({mc['sims']} reshuffles of {mc['trades_per_sim']} trades){RESET}")
        print(f"  5th–95th pct return {_pct(fr['p5'])} … {_pct(fr['p95'])}   P(loss) {mc['prob_loss'] * 100:.1f}%")
    if args.json:
        Path(args.json).write_text(json.dumps(r))
        print(f"\n  {DIM}full result written to {args.json}{RESET}")
    print()


def cmd_sweep(args):
    d = _load(args)
    res = analysis.sweep(d, args.strategy, _params(args.param), _config(args))
    shades = " ░▒▓█"
    vals = [c["sharpe"] for row in res["cells"] for c in row if c]
    lo, hi = min(vals), max(vals)
    print(f"\n{BOLD}Sharpe heatmap{RESET}  {DIM}{res['y']['label']} (rows) × {res['x']['label']} (cols){RESET}\n")
    print("        " + "".join(f"{x:>7g}" for x in res["x"]["values"]))
    for yv, row in zip(res["y"]["values"], res["cells"]):
        line = ""
        for c in row:
            if c is None:
                line += f"{DIM}{'·':>7}{RESET}"
            else:
                k = int((c["sharpe"] - lo) / (hi - lo + 1e-12) * (len(shades) - 1))
                col = GREEN if c["sharpe"] > 0 else RED
                line += f"{col}{shades[k] * 2}{c['sharpe']:>5.2f}{RESET}"
        print(f"{yv:>7g} {line}")
    print()


def cmd_walkforward(args):
    d = _load(args)
    wf = analysis.walk_forward(d, args.strategy, _params(args.param), _config(args), folds=args.folds)
    print(f"\n{BOLD}Walk-forward{RESET} {DIM}({args.folds} folds){RESET}\n")
    for f in wf["folds"]:
        oos = _color(f["oos_sharpe"], "{:.2f}".format(f["oos_sharpe"]))
        print(f"  fold {f['fold']}  test {f['test'][0]}→{f['test'][1]}  params {json.dumps(f['params'])}"
              f"  IS sharpe {f['in_sample_sharpe']:.2f}  OOS sharpe {oos}")
    m = wf["oos_metrics"]
    eff = wf["efficiency"]
    print(f"\n  Out-of-sample: return {_pct(m['total_return'])}, sharpe {_num(m['sharpe'])}, "
          f"max DD {_pct(m['max_drawdown'])}, efficiency {('—' if eff is None else f'{eff:.0%}')}\n")


def cmd_serve(args):
    from .server import create_app
    create_app().run(host=args.host, port=args.port, debug=False)


def main(argv=None):
    ap = argparse.ArgumentParser(prog="quantforge", description="Backtest trading strategies without fooling yourself.")
    sub = ap.add_subparsers(dest="cmd", required=True)

    def common(p):
        p.add_argument("--strategy", "-s", default="sma_cross", choices=list(STRATEGIES))
        src = p.add_mutually_exclusive_group()
        src.add_argument("--market", "-m", default="trending", choices=list(qdata.MARKETS))
        src.add_argument("--csv", help="OHLCV CSV file (Date,Open,High,Low,Close,Volume)")
        p.add_argument("--bars", type=int, default=1500)
        p.add_argument("--param", "-p", action="append", metavar="KEY=VALUE")
        p.add_argument("--capital", type=float, default=100_000)
        p.add_argument("--fee", type=float, default=5.0, help="fee in basis points per side")
        p.add_argument("--slippage", type=float, default=5.0, help="slippage in basis points per side")
        p.add_argument("--stop", type=float, default=0.0, help="stop-loss %% (0 = off)")
        p.add_argument("--short", action="store_true", help="allow short positions")

    sub.add_parser("strategies").set_defaults(fn=cmd_strategies)
    p = sub.add_parser("run"); common(p); p.add_argument("--json"); p.set_defaults(fn=cmd_run)
    p = sub.add_parser("sweep"); common(p); p.set_defaults(fn=cmd_sweep)
    p = sub.add_parser("walkforward"); common(p); p.add_argument("--folds", type=int, default=5); p.set_defaults(fn=cmd_walkforward)
    p = sub.add_parser("serve"); p.add_argument("--host", default="127.0.0.1"); p.add_argument("--port", type=int, default=5000)
    p.set_defaults(fn=cmd_serve)

    args = ap.parse_args(argv)
    try:
        args.fn(args)
    except ValueError as e:
        print(f"{RED}error:{RESET} {e}", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
