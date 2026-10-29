"""Live intraday pipeline: ticks -> 1-minute candles -> strategy runners -> paper fills.

Timing rule is the same as the backtester: a decision made at the close of minute t
fills at the open of minute t+1 (the first tick of the next minute). Nothing ever
fills on the candle that produced the signal.

Times are seconds since midnight IST. web/src/live/engine.js is a line-by-line port,
and a parity test feeds both the same session and requires identical output.
"""
from __future__ import annotations

import math

import numpy as np

from .. import strategies as strat
from .costs import intraday_charges, r2

MARKET_OPEN = 9 * 3600 + 15 * 60
SQUARE_OFF = 15 * 3600 + 20 * 60
LIVE_STRATEGIES = ("sma_cross", "macd_rsi", "donchian", "rsi_reversion", "vwap_reversion", "bollinger_breakout")
FIELDS = ("t", "open", "high", "low", "close", "volume")
# daily defaults are too wide for 1-minute candles where moves are fractions of a percent
LIVE_PARAMS = {"vwap_reversion": {"window": 30, "band": 0.5}}


class CandleAggregator:
    """Builds 1-minute OHLCV candles from ticks. Kite reports volume as a running
    day total, so candle volume is the increase in that total within the minute."""

    def __init__(self):
        self.current: dict | None = None
        self.last_cum: float | None = None

    def update(self, t: float, price: float, cum_volume: float | None):
        minute = int(t // 60) * 60
        dv = 0.0
        if cum_volume is not None:
            if self.last_cum is not None:
                dv = max(0.0, cum_volume - self.last_cum)
            self.last_cum = cum_volume
        cur = self.current
        if cur is not None and minute < cur["t"]:
            return None, None  # late tick from a minute already closed: ignore
        if cur is not None and minute == cur["t"]:
            cur["high"] = max(cur["high"], price)
            cur["low"] = min(cur["low"], price)
            cur["close"] = price
            cur["volume"] += dv
            return None, None
        closed = cur
        self.current = {"t": minute, "open": price, "high": price, "low": price, "close": price, "volume": dv}
        return closed, self.current

    def flush(self):
        closed, self.current = self.current, None
        return closed


class Runner:
    """Paper-trades one strategy on one symbol."""

    def __init__(self, symbol: str, strategy: str, history: dict, capital: float = 100_000.0,
                 allow_short: bool = True, params: dict | None = None):
        self.symbol = symbol
        self.strategy = strategy
        self.s = strat.get(strategy)
        self.params = {**self.s.defaults(), **LIVE_PARAMS.get(strategy, {}), **(params or {})}
        self.capital = capital
        self.allow_short = allow_short
        self.hist = {k: list(history.get(k, [])) for k in FIELDS}
        self.pos = 0
        self.qty = 0
        self.entry_price = 0.0
        self.entry_t = 0
        self.pending: int | None = None
        self.done_for_day = False
        self.trades: list[dict] = []
        self.realized = 0.0
        self.last_price = 0.0

    def _signal(self) -> int:
        n = len(self.hist["close"])
        if n < 2:
            return 0
        data = {k: np.asarray(self.hist[k], dtype=float) for k in ("open", "high", "low", "close", "volume")}
        sig = self.s.signal(data, self.params, self.allow_short)
        return int(sig[-1])

    def on_close(self, candle: dict, events: list):
        for k in FIELDS:
            self.hist[k].append(candle[k])
        if self.done_for_day or candle["t"] + 60 >= SQUARE_OFF:
            return
        desired = self._signal()
        if desired != self.pos:
            events.append({"type": "signal", "symbol": self.symbol, "strategy": self.strategy,
                           "t": candle["t"] + 60, "from": self.pos, "to": desired, "price": candle["close"]})
        self.pending = desired

    def on_open(self, t: int, price: float, events: list):
        self.last_price = price
        if self.done_for_day:
            return
        if t >= SQUARE_OFF:
            self.square_off(t, price, events)
            return
        if self.pending is not None and self.pending != self.pos:
            if self.pos != 0:
                self._exit(t, price, "signal", events)
            if self.pending != 0:
                self._enter(t, price, self.pending, events)
        self.pending = None

    def square_off(self, t: int, price: float, events: list):
        if self.pos != 0:
            self._exit(t, price, "square-off", events)
        self.done_for_day = True
        self.pending = None

    def _enter(self, t, price, side, events):
        qty = int(math.floor(self.capital / price))
        if qty <= 0:
            return
        self.pos, self.qty, self.entry_price, self.entry_t = side, qty, price, t
        events.append({"type": "fill", "symbol": self.symbol, "strategy": self.strategy, "t": t,
                       "action": "buy" if side > 0 else "sell short", "side": side, "qty": qty, "price": price})

    def _exit(self, t, price, reason, events):
        buy_px, sell_px = (self.entry_price, price) if self.pos > 0 else (price, self.entry_price)
        gross = r2((sell_px - buy_px) * self.qty)
        ch = intraday_charges(buy_px * self.qty, sell_px * self.qty)
        net = r2(gross - ch["total"])
        trade = {"type": "trade", "symbol": self.symbol, "strategy": self.strategy,
                 "side": "long" if self.pos > 0 else "short", "qty": self.qty,
                 "entry_t": self.entry_t, "entry_price": self.entry_price, "exit_t": t, "exit_price": price,
                 "gross": gross, "charges": ch["total"], "net": net, "reason": reason}
        self.trades.append(trade)
        self.realized = r2(self.realized + net)
        events.append(trade)
        self.pos, self.qty = 0, 0

    def unrealized(self, price: float | None = None) -> float:
        px = self.last_price if price is None else price
        return self.pos * (px - self.entry_price) * self.qty if self.pos else 0.0

    def snapshot(self) -> dict:
        return {"symbol": self.symbol, "strategy": self.strategy, "pos": self.pos, "qty": self.qty,
                "entry_price": self.entry_price, "realized": self.realized,
                "unrealized": self.unrealized(), "trades": len(self.trades)}


class Hub:
    """Fans ticks out to one aggregator per symbol and one runner per (symbol, strategy)."""

    def __init__(self, warmup: dict[str, dict], strategies=LIVE_STRATEGIES, capital: float = 100_000.0,
                 allow_short: bool = True):
        self.aggs = {s: CandleAggregator() for s in warmup}
        self.runners = {s: [Runner(s, k, warmup[s], capital, allow_short) for k in strategies] for s in warmup}
        self.candles: dict[str, list] = {s: [] for s in warmup}
        self.last: dict[str, float] = {}
        self.squared = False

    def on_tick(self, symbol: str, t: float, price: float, cum_volume: float | None = None) -> list:
        events: list = []
        if symbol not in self.aggs:
            return events
        self.last[symbol] = price
        closed, opened = self.aggs[symbol].update(t, price, cum_volume)
        if closed:
            self._close(symbol, closed, events)
        if opened:
            for r in self.runners[symbol]:
                r.on_open(opened["t"], opened["open"], events)
        for r in self.runners[symbol]:
            r.last_price = price
        cur = self.aggs[symbol].current
        if cur is not None:
            events.append({"type": "candle", "symbol": symbol, "candle": dict(cur), "final": False})
        return events

    def _close(self, symbol, candle, events):
        self.candles[symbol].append(dict(candle))
        events.append({"type": "candle", "symbol": symbol, "candle": dict(candle), "final": True})
        for r in self.runners[symbol]:
            r.on_close(candle, events)

    def on_clock(self, t: float) -> list:
        """Timer safety net: after 15:20 any runner that was not squared off by a fresh
        candle (because its stock stopped ticking) is closed at the last traded price."""
        events: list = []
        if t < SQUARE_OFF or self.squared:
            return events
        t = int(t)
        for symbol in self.aggs:
            for r in self.runners[symbol]:
                if not r.done_for_day:
                    r.square_off(t, self.last.get(symbol, r.last_price), events)
        self.squared = True
        events.append({"type": "squared_off", "t": t})
        return events

    def end_of_day(self, t: float) -> list:
        events = self.on_clock(max(t, SQUARE_OFF))
        for symbol, agg in self.aggs.items():
            closed = agg.flush()
            if closed:
                self._close(symbol, closed, events)
        return events

    def snapshot(self) -> dict:
        trades = sorted((t for rs in self.runners.values() for r in rs for t in r.trades), key=lambda t: t["exit_t"])
        current = {s: a.current for s, a in self.aggs.items() if a.current}
        return {"runners": [r.snapshot() for rs in self.runners.values() for r in rs], "trades": trades,
                "candles": self.candles, "current": current, "last": self.last, "squared": self.squared}


def run_session(session: dict, **kw) -> tuple[Hub, list]:
    """Replay a recorded or simulated session through the live pipeline."""
    syms = session["symbols"]
    hub = Hub({s: syms[s]["warmup"] for s in syms}, **kw)
    order = list(syms)
    events: list = []
    for idx, t, price, cum in session["ticks"]:
        events += [e for e in hub.on_tick(order[idx], t, price, cum) if not (e["type"] == "candle" and not e["final"])]
    last_t = session["ticks"][-1][1] if session["ticks"] else SQUARE_OFF
    events += hub.end_of_day(last_t)
    return hub, events
