"""Generate the simulated NSE-style intraday session used by the public replay demo.

    python scripts/make_session.py

Symbols are clearly fictional (SIM*). Each one has a different intraday character so
different strategies win on different stocks. For a real day, run Live mode with Kite:
it records every tick to sessions/<date>.json in this same format.
"""
import json
import math
import sys
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent.parent
OPEN, CLOSE = 9 * 3600 + 15 * 60, 15 * 3600 + 30 * 60

SYMBOLS = {
    #  name                           start   day drift  vol/min  pull  gap
    "SIMBANK":  ("Simulated private bank",  1642.0, 0.012, 0.0011, 0.00, 0.004),
    "SIMAUTO":  ("Simulated auto maker",    918.0, -0.015, 0.0013, 0.00, -0.006),
    "SIMTECH":  ("Simulated IT services",  3810.0, 0.000, 0.0009, 0.06, 0.000),
    "SIMPOWER": ("Simulated power utility", 286.4, 0.006, 0.0016, 0.02, 0.011),
    "SIMPHARMA": ("Simulated pharma",      1225.0, -0.004, 0.0012, 0.04, -0.002),
}


def tick_round(x):
    return round(round(x / 0.05) * 0.05, 2)


def u_shape(m, n=375):
    """Intraday volatility is highest at the open and close."""
    x = m / (n - 1)
    return 0.7 + 1.6 * (x - 0.5) ** 2 * 4 / 2


def minute_path(rng, start, drift, vol, pull, n=375):
    px = [start]
    anchor = start
    for m in range(1, n + 1):
        r = drift / n + pull * math.log(anchor / px[-1]) + rng.normal(0, vol * u_shape(m - 1))
        px.append(px[-1] * math.exp(r))
    return px


def main():
    rng = np.random.default_rng(2026)
    session = {"date": "2026-10-28", "source": "simulated",
               "label": "Simulated NSE session (fictional stocks, generated prices)", "symbols": {}, "ticks": []}
    ticks = []
    for idx, (sym, (name, start, drift, vol, pull, gap)) in enumerate(SYMBOLS.items()):
        # previous day: 1-minute candles for warm-up
        prev = minute_path(rng, start, rng.normal(0, 0.006), vol, 0.02)
        warm = {"t": [], "open": [], "high": [], "low": [], "close": [], "volume": []}
        for m in range(375):
            o, c = prev[m], prev[m + 1]
            wig = abs(rng.normal(0, vol * 0.6))
            warm["t"].append(OPEN + m * 60)
            warm["open"].append(tick_round(o))
            warm["close"].append(tick_round(c))
            warm["high"].append(tick_round(max(o, c) * (1 + wig)))
            warm["low"].append(tick_round(min(o, c) * (1 - wig)))
            warm["volume"].append(float(int(rng.lognormal(9, 0.5) * u_shape(m))))
        session["symbols"][sym] = {"name": name, "warmup": warm}

        # today: ticks every 4-20 seconds along a minute path, with an opening gap
        path = minute_path(rng, prev[-1] * (1 + gap), drift, vol, pull)
        cum = 0.0
        t = OPEN
        while t < CLOSE:
            m = min(int((t - OPEN) // 60), 374)
            frac = ((t - OPEN) % 60) / 60
            base = path[m] + (path[m + 1] - path[m]) * frac
            px = tick_round(base * (1 + rng.normal(0, vol * 0.25)))
            cum += float(int(rng.lognormal(6.5, 0.8) * u_shape(m)))
            ticks.append([idx, int(t), px, cum])
            t += int(rng.integers(4, 21))
    ticks.sort(key=lambda r: (r[1], r[0]))
    session["ticks"] = ticks
    out = ROOT / "web" / "public" / "data" / "session.json"
    out.write_text(json.dumps(session, separators=(",", ":")))
    print(f"wrote {out.relative_to(ROOT)}: {len(ticks)} ticks, {out.stat().st_size // 1024} KB")


if __name__ == "__main__":
    sys.exit(main())
