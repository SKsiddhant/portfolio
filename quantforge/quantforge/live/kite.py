"""Zerodha Kite Connect gateway: login, instrument search, warm-up history and the
tick stream. Paper trading only: this module never places an order.

Keys are read from the environment or a git-ignored quantforge/.env file:
    KITE_API_KEY=...
    KITE_API_SECRET=...
"""
from __future__ import annotations

import json
import os
import threading
from datetime import datetime, timedelta, timezone
from pathlib import Path

from .engine import FIELDS

IST = timezone(timedelta(hours=5, minutes=30))
ROOT = Path(__file__).resolve().parents[2]
TOKEN_FILE = ROOT / ".kite_session.json"


def load_env(path: Path = ROOT / ".env") -> None:
    if not path.exists():
        return
    for line in path.read_text().splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, _, v = line.partition("=")
            os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


def seconds_ist(ts) -> int:
    if ts is None:
        ts = datetime.now(IST)
    elif ts.tzinfo is not None:
        ts = ts.astimezone(IST)
    return ts.hour * 3600 + ts.minute * 60 + ts.second


def _default_kite(api_key):
    from kiteconnect import KiteConnect
    return KiteConnect(api_key=api_key)


def _default_ticker(api_key, access_token):
    from kiteconnect import KiteTicker
    return KiteTicker(api_key, access_token)


class KiteGateway:
    def __init__(self, api_key: str | None = None, api_secret: str | None = None,
                 kite_factory=_default_kite, ticker_factory=_default_ticker, token_file: Path | None = TOKEN_FILE):
        load_env()
        self.api_key = api_key or os.environ.get("KITE_API_KEY", "")
        self.api_secret = api_secret or os.environ.get("KITE_API_SECRET", "")
        self.kite_factory = kite_factory
        self.ticker_factory = ticker_factory
        self.token_file = token_file
        self.kite = None
        self.access_token = ""
        self.user = ""
        self.ticker = None
        self._instruments: list[dict] | None = None
        self._restore()

    # ------------------------------------------------------------ auth
    @property
    def configured(self) -> bool:
        return bool(self.api_key and self.api_secret)

    @property
    def connected(self) -> bool:
        return bool(self.access_token)

    def _client(self):
        if self.kite is None:
            self.kite = self.kite_factory(self.api_key)
        return self.kite

    def login_url(self) -> str:
        return self._client().login_url()

    def complete_login(self, request_token: str) -> str:
        data = self._client().generate_session(request_token, api_secret=self.api_secret)
        self.access_token = data["access_token"]
        self.user = data.get("user_name") or data.get("user_id", "")
        self._client().set_access_token(self.access_token)
        if self.token_file:
            # Kite access tokens expire at ~6 am the next day; keep it only for today
            self.token_file.write_text(json.dumps({"access_token": self.access_token, "user": self.user,
                                                    "date": datetime.now(IST).date().isoformat()}))
        return self.user

    def _restore(self):
        if not (self.token_file and self.token_file.exists() and self.api_key):
            return
        try:
            saved = json.loads(self.token_file.read_text())
        except (OSError, ValueError):
            return
        if saved.get("date") == datetime.now(IST).date().isoformat():
            self.access_token, self.user = saved["access_token"], saved.get("user", "")
            self._client().set_access_token(self.access_token)

    # ------------------------------------------------------------ data
    def instruments(self) -> list[dict]:
        if self._instruments is None:
            rows = self._client().instruments("NSE")
            self._instruments = [
                {"token": r["instrument_token"], "symbol": r["tradingsymbol"], "name": r.get("name") or ""}
                for r in rows if r.get("instrument_type", "EQ") == "EQ" and r.get("segment", "NSE") == "NSE"
            ]
        return self._instruments

    def search(self, q: str, limit: int = 12) -> list[dict]:
        q = q.strip().upper()
        if not q:
            return []
        rows = self.instruments()
        starts = [r for r in rows if r["symbol"].startswith(q)]
        named = [r for r in rows if q in r["name"].upper() and r not in starts]
        return (sorted(starts, key=lambda r: len(r["symbol"])) + named)[:limit]

    def resolve(self, symbols: list[str]) -> dict[str, dict]:
        by_sym = {r["symbol"]: r for r in self.instruments()}
        missing = [s for s in symbols if s not in by_sym]
        if missing:
            raise ValueError(f"not an NSE equity symbol: {', '.join(missing)}")
        return {s: by_sym[s] for s in symbols}

    def warmup(self, token: int, days_back: int = 5) -> dict:
        """Previous session's 1-minute candles so slow indicators are ready at 9:15.
        Needs historical-data access on the Kite app; returns empty history without it."""
        empty = {k: [] for k in FIELDS}
        today = datetime.now(IST).date()
        try:
            rows = self._client().historical_data(token, today - timedelta(days=days_back), today - timedelta(days=1), "minute")
        except Exception:  # noqa: BLE001 - no historical access is a normal setup
            return empty
        if not rows:
            return empty
        last_day = rows[-1]["date"].date()
        rows = [r for r in rows if r["date"].date() == last_day]
        out = {k: [] for k in FIELDS}
        for r in rows:
            out["t"].append(seconds_ist(r["date"]))
            for k in ("open", "high", "low", "close", "volume"):
                out[k].append(float(r[k]))
        return out

    # ------------------------------------------------------------ stream
    def stream(self, instruments: dict[str, dict], on_tick, on_status=lambda msg: None):
        token_to_sym = {v["token"]: s for s, v in instruments.items()}
        tokens = list(token_to_sym)
        ticker = self.ticker_factory(self.api_key, self.access_token)

        def on_ticks(ws, ticks):
            for tk in ticks:
                sym = token_to_sym.get(tk.get("instrument_token"))
                if sym is None or tk.get("last_price") is None:
                    continue
                ts = tk.get("exchange_timestamp") or tk.get("last_trade_time")
                on_tick(sym, seconds_ist(ts), float(tk["last_price"]), tk.get("volume_traded"))

        def on_connect(ws, response):
            ws.subscribe(tokens)
            ws.set_mode(ws.MODE_FULL, tokens)
            on_status("connected")

        ticker.on_ticks = on_ticks
        ticker.on_connect = on_connect
        ticker.on_close = lambda ws, code, reason: on_status(f"closed: {reason}")
        ticker.on_error = lambda ws, code, reason: on_status(f"error: {reason}")
        self.ticker = ticker
        ticker.connect(threaded=True)
        return ticker

    def stop(self):
        if self.ticker is not None:
            try:
                self.ticker.close()
            except Exception:  # noqa: BLE001
                pass
            self.ticker = None


class LiveService:
    """Owns the running hub, the tick recorder and the SSE subscribers."""

    def __init__(self, gateway: KiteGateway, sessions_dir: Path = ROOT / "sessions"):
        from .engine import Hub  # local import keeps module import light

        self._Hub = Hub
        self.gateway = gateway
        self.sessions_dir = sessions_dir
        self.lock = threading.Lock()
        self.hub = None
        self.symbols: list[str] = []
        self.subscribers: list = []
        self.recording: dict | None = None
        self.status = "idle"
        self._timer: threading.Timer | None = None

    def start(self, symbols: list[str], capital: float = 100_000.0, allow_short: bool = True):
        if not self.gateway.connected:
            raise ValueError("log in to Kite first")
        if not 1 <= len(symbols) <= 10:
            raise ValueError("watch between 1 and 10 symbols")
        self.stop()
        inst = self.gateway.resolve(symbols)
        warm = {s: self.gateway.warmup(inst[s]["token"]) for s in symbols}
        with self.lock:
            self.hub = self._Hub(warm, capital=capital, allow_short=allow_short)
            self.symbols = list(symbols)
            self.recording = {"date": datetime.now(IST).date().isoformat(), "source": "kite",
                              "label": f"Recorded live session, {datetime.now(IST):%d %b %Y}",
                              "symbols": {s: {"name": inst[s]["name"], "warmup": warm[s]} for s in symbols},
                              "ticks": []}
        self.status = "connecting"
        self.gateway.stream(inst, self.on_tick, self._on_status)
        self._schedule_clock()

    def _on_status(self, msg):
        self.status = msg
        self.publish([{"type": "status", "status": msg}])

    def on_tick(self, symbol, t, price, cum_volume):
        with self.lock:
            if self.hub is None:
                return
            events = self.hub.on_tick(symbol, t, price, cum_volume)
            self.recording["ticks"].append([self.symbols.index(symbol), t, price, cum_volume])
        self.publish(events)

    def _schedule_clock(self):
        def tick():
            with self.lock:
                if self.hub is None:
                    return
                events = self.hub.on_clock(seconds_ist(None) - 15)  # 15 s grace for late ticks
            self.publish(events)
            if events:
                self.save()
            else:
                self._schedule_clock()
        self._timer = threading.Timer(5.0, tick)
        self._timer.daemon = True
        self._timer.start()

    def stop(self):
        if self._timer:
            self._timer.cancel()
        self.gateway.stop()
        self.save()
        with self.lock:
            self.hub = None
        self.status = "idle"

    def save(self) -> Path | None:
        rec = self.recording
        if not rec or not rec["ticks"]:
            return None
        self.sessions_dir.mkdir(exist_ok=True)
        path = self.sessions_dir / f"{rec['date']}.json"
        path.write_text(json.dumps(rec, separators=(",", ":")))
        return path

    def snapshot(self) -> dict:
        with self.lock:
            snap = self.hub.snapshot() if self.hub else None
        return {"type": "snapshot", "symbols": self.symbols, "status": self.status, "state": snap}

    def publish(self, events):
        if not events:
            return
        for q in list(self.subscribers):
            for e in events:
                q.put(e)
