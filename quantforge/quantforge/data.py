"""Market data: CSV loading and a seeded synthetic-market generator.

The synthetic markets are regime-switching (bull / bear / sideways / crash) so every
strategy family has periods where it shines and periods where it bleeds. They are
labelled synthetic everywhere in the UI; for real data, load an OHLCV CSV.
"""
from __future__ import annotations

import csv
import io
from datetime import date, datetime, timedelta

import numpy as np

REQUIRED = ("date", "open", "high", "low", "close")

ALIASES = {
    "date": ("date", "datetime", "time", "timestamp", "day"),
    "open": ("open", "o"),
    "high": ("high", "h"),
    "low": ("low", "l"),
    "close": ("close", "c", "adj close", "adj_close", "ltp", "price"),
    "volume": ("volume", "vol", "v", "shares traded", "qty"),
}


def load_csv(text: str) -> dict:
    """Parse an OHLCV CSV (Yahoo, NSE bhavcopy-style, TradingView exports all work)."""
    rows = list(csv.reader(io.StringIO(text.strip())))
    if len(rows) < 3:
        raise ValueError("CSV needs a header row and at least 2 data rows")
    header = [h.strip().lower().replace("﻿", "") for h in rows[0]]
    col = {}
    for field, names in ALIASES.items():
        for name in names:  # aliases are in priority order: "close" beats "ltp"
            if name in header:
                col[field] = header.index(name)
                break
    missing = [f for f in REQUIRED if f not in col]
    if missing:
        raise ValueError(f"CSV is missing column(s): {', '.join(missing)}")

    out = {k: [] for k in ("date", "open", "high", "low", "close", "volume")}
    for r in rows[1:]:
        if not r or all(not x.strip() for x in r):
            continue
        try:
            vals = {f: float(r[col[f]].replace(",", "")) for f in ("open", "high", "low", "close")}
            vol = float(r[col["volume"]].replace(",", "")) if "volume" in col and r[col["volume"]].strip() else 1.0
        except (ValueError, IndexError):
            continue  # skip rows like "null" that Yahoo emits on holidays
        out["date"].append(r[col["date"]].strip())
        for f in ("open", "high", "low", "close"):
            out[f].append(vals[f])
        out["volume"].append(vol)
    if len(out["close"]) < 30:
        raise ValueError("need at least 30 valid rows of price data")
    # oldest first (NSE and many brokers export newest first)
    if date_key(out["date"][0]) > date_key(out["date"][-1]):
        for k in out:
            out[k].reverse()
    return {k: (v if k == "date" else np.array(v)) for k, v in out.items()}


DATE_FORMATS = ("%Y-%m-%d", "%d-%m-%Y", "%d/%m/%Y", "%d-%b-%Y", "%d %b %Y", "%Y/%m/%d", "%m/%d/%Y", "%b %d, %Y")


def date_key(s: str) -> str:
    """Sortable YYYY-MM-DD for the date formats Indian and US exports use."""
    head = s.strip().split(" ")[0] if s[:4].isdigit() else s.strip()
    for fmt in DATE_FORMATS:
        try:
            return datetime.strptime(head, fmt).strftime("%Y-%m-%d")
        except ValueError:
            continue
    return s


REGIMES = {
    #           daily drift, daily vol, mean-reversion pull
    "bull": (0.0013, 0.008, 0.00),
    "bear": (-0.0013, 0.012, 0.00),
    "range": (0.0000, 0.009, 0.12),
    "crash": (-0.0070, 0.028, 0.00),
}

MARKETS = {
    "trending": {
        "name": "Trending (synthetic)",
        "blurb": "Long bull runs with sharp corrections. Trend followers' home turf.",
        "seed": 2, "start": 1200.0, "lengths": (120, 380),
        "weights": {"bull": 0.55, "bear": 0.15, "range": 0.27, "crash": 0.03},
    },
    "choppy": {
        "name": "Range-bound (synthetic)",
        "blurb": "Goes nowhere for years. Mean reversion should beat breakouts here.",
        "seed": 1, "start": 480.0, "lengths": (40, 140),
        "weights": {"bull": 0.15, "bear": 0.15, "range": 0.68, "crash": 0.02},
    },
    "volatile": {
        "name": "Boom and bust (synthetic)",
        "blurb": "Violent regimes and crashes. A stress test for every strategy.",
        "seed": 16, "start": 2600.0, "lengths": (25, 110),
        "weights": {"bull": 0.38, "bear": 0.30, "range": 0.22, "crash": 0.10},
    },
}


def synthetic(market: str = "trending", bars: int = 1500) -> dict:
    spec = MARKETS[market]
    rng = np.random.default_rng(spec["seed"])
    names = list(spec["weights"])
    probs = np.array([spec["weights"][k] for k in names])

    closes, opens, highs, lows, vols, dates = [], [], [], [], [], []
    px = spec["start"]
    anchor = px
    regime, left = "range", 0
    d = date(2020, 1, 1)
    for _ in range(bars):
        if left <= 0:
            regime = names[rng.choice(len(names), p=probs)]
            left = int(rng.integers(8, 25) if regime == "crash" else rng.integers(*spec["lengths"]))
            anchor = px
        left -= 1
        drift, vol, pull = REGIMES[regime]
        while d.weekday() >= 5:
            d += timedelta(days=1)
        gap = rng.normal(0, vol * 0.35)
        o = px * np.exp(gap)
        # intraday path of 12 steps gives a realistic high/low around open->close
        ret = drift + pull * np.log(anchor / px) + rng.normal(0, vol)
        steps = rng.normal(ret / 12, vol * 0.9 / np.sqrt(12), 12)
        path = o * np.exp(np.cumsum(steps))
        c = float(path[-1])
        hi = float(max(o, path.max()) * (1 + abs(rng.normal(0, vol * 0.15))))
        lo = float(min(o, path.min()) * (1 - abs(rng.normal(0, vol * 0.15))))
        v = float(1e6 * (1 + 25 * abs(np.log(c / px))) * np.exp(rng.normal(0, 0.25)))
        dates.append(d.isoformat())
        opens.append(round(float(o), 2))
        highs.append(round(hi, 2))
        lows.append(round(lo, 2))
        closes.append(round(c, 2))
        vols.append(round(v))
        px = c
        d += timedelta(days=1)
    return {
        "date": dates, "open": np.array(opens), "high": np.array(highs),
        "low": np.array(lows), "close": np.array(closes), "volume": np.array(vols, dtype=float),
    }


def to_json(data: dict) -> dict:
    return {k: (list(v) if k == "date" else [float(x) for x in v]) for k, v in data.items()}


def from_json(obj: dict) -> dict:
    return {k: (list(v) if k == "date" else np.asarray(v, dtype=float)) for k, v in obj.items()}
