import json
from pathlib import Path

import pytest

from quantforge.live import SQUARE_OFF, CandleAggregator, Hub, Runner, intraday_charges, run_session
from quantforge.live.kite import KiteGateway, LiveService, seconds_ist
from quantforge.server import create_app

SESSION = Path(__file__).resolve().parent.parent / "web" / "public" / "data" / "session.json"
T0 = 9 * 3600 + 15 * 60


def small_session(symbols=2, minutes=120):
    s = json.loads(SESSION.read_text())
    keep = list(s["symbols"])[:symbols]
    return {**s, "symbols": {k: s["symbols"][k] for k in keep},
            "ticks": [t for t in s["ticks"] if t[0] < symbols and t[1] < T0 + minutes * 60]}


# ---------------------------------------------------------------- charges

def test_charges_match_zerodha_rate_card_for_a_sample_trade():
    # buy 100 @ 1000, sell 100 @ 1010 intraday on NSE
    c = intraday_charges(100_000, 101_000)
    assert c["brokerage"] == 40.00        # min(0.03%, Rs 20) per order, two orders
    assert c["stt"] == 25.25              # 0.025% of sell value
    assert c["transaction"] == 6.17       # 0.00307% of 2.01 lakh turnover
    assert c["sebi"] == 0.20              # Rs 10 / crore
    assert c["stamp"] == 3.00             # 0.003% of buy value
    assert c["gst"] == 8.35               # 18% of (40 + 0.20 + 6.17 + 0) = 8.3466
    assert c["total"] == 82.97


def test_small_orders_pay_percentage_brokerage_not_flat_20():
    c = intraday_charges(10_000, 10_000)
    assert c["brokerage"] == 6.00


# ---------------------------------------------------------------- aggregator

def test_aggregator_builds_minute_candles_and_volume_from_running_total():
    a = CandleAggregator()
    assert a.update(T0 + 1, 100, 1_000) == (None, a.current)
    a.update(T0 + 20, 103, 1_500)
    a.update(T0 + 40, 99, 1_800)
    a.update(T0 + 59, 101, 2_000)
    closed, opened = a.update(T0 + 61, 102, 2_300)
    assert closed == {"t": T0, "open": 100, "high": 103, "low": 99, "close": 101, "volume": 1_000}
    assert opened["t"] == T0 + 60 and opened["open"] == 102 and opened["volume"] == 300


def test_aggregator_ignores_late_ticks_for_closed_minutes():
    a = CandleAggregator()
    a.update(T0, 100, None)
    a.update(T0 + 60, 101, None)
    assert a.update(T0 + 30, 50, None) == (None, None)
    assert a.current["low"] == 101


# ---------------------------------------------------------------- runner

def flat_history(n=200, px=100.0):
    return {"t": list(range(n)), "open": [px] * n, "high": [px] * n, "low": [px] * n, "close": [px] * n, "volume": [1.0] * n}


def candle(t, o, c):
    return {"t": t, "open": o, "high": max(o, c), "low": min(o, c), "close": c, "volume": 1.0}


def test_runner_fills_only_at_the_next_candles_open():
    r = Runner("X", "buy_hold", flat_history())
    ev = []
    r.on_open(T0, 100, ev)
    assert r.pos == 0                     # nothing decided yet
    r.on_close(candle(T0, 100, 105), ev)
    assert r.pos == 0 and r.pending == 1  # decided at the close, not filled
    r.on_open(T0 + 60, 107, ev)
    assert r.pos == 1 and r.entry_price == 107 and r.entry_t == T0 + 60


def test_runner_squares_off_at_1520_and_stays_out():
    r = Runner("X", "buy_hold", flat_history(), capital=10_000)
    ev = []
    r.on_close(candle(T0, 100, 100), ev)
    r.on_open(T0 + 60, 100, ev)
    r.on_close(candle(SQUARE_OFF - 120, 100, 110), ev)
    r.on_open(SQUARE_OFF, 110, ev)
    trade = [e for e in ev if e["type"] == "trade"][0]
    assert trade["reason"] == "square-off" and trade["exit_t"] == SQUARE_OFF and trade["exit_price"] == 110
    assert trade["qty"] == 100 and trade["gross"] == 1_000
    assert trade["net"] == round(1_000 - intraday_charges(10_000, 11_000)["total"], 2)
    r.on_close(candle(SQUARE_OFF, 110, 111), ev)
    r.on_open(SQUARE_OFF + 60, 111, ev)
    assert r.pos == 0 and len(r.trades) == 1


def test_no_new_signal_in_the_last_minute_before_square_off():
    r = Runner("X", "buy_hold", flat_history())
    ev = []
    r.on_close(candle(SQUARE_OFF - 60, 100, 100), ev)
    assert r.pending is None and not [e for e in ev if e["type"] == "signal"]


def test_hub_never_fills_on_the_candle_that_produced_the_signal():
    hub, ev = run_session(small_session())
    signals = {(e["symbol"], e["strategy"], e["t"]) for e in ev if e["type"] == "signal"}
    fills = [e for e in ev if e["type"] == "fill"]
    assert fills
    for f in fills:
        # every fill time is the start of a minute whose previous minute's close produced the signal
        assert f["t"] % 60 == 0
        assert (f["symbol"], f["strategy"], f["t"]) in signals


def test_clock_squares_off_a_stock_that_stopped_ticking():
    s = small_session(symbols=1, minutes=60)
    hub, ev = run_session(s)
    assert all(not r.pos for r in hub.runners["SIMBANK"])
    sq = [e for e in ev if e["type"] == "trade" and e["reason"] == "square-off"]
    assert all(e["exit_t"] >= SQUARE_OFF for e in sq)


# ---------------------------------------------------------------- Kite (mocked)

class FakeKite:
    def __init__(self, api_key):
        self.api_key, self.token, self.calls = api_key, None, []

    def login_url(self):
        return f"https://kite.zerodha.com/connect/login?v=3&api_key={self.api_key}"

    def generate_session(self, request_token, api_secret):
        self.calls.append((request_token, api_secret))
        return {"access_token": "tok-123", "user_name": "Test Trader"}

    def set_access_token(self, t):
        self.token = t

    def instruments(self, exchange):
        return [{"instrument_token": 11 + i, "tradingsymbol": s, "name": s.title(), "instrument_type": "EQ", "segment": "NSE"}
                for i, s in enumerate(["SIMBANK", "SIMAUTO", "SIMTECH", "SIMPOWER", "SIMPHARMA", "RELIANCE"])]

    def historical_data(self, *a, **k):
        raise RuntimeError("no historical access")


class FakeTicker:
    MODE_FULL = "full"
    last = None

    def __init__(self, api_key, token):
        self.subscribed, self.mode = [], None
        FakeTicker.last = self

    def subscribe(self, tokens):
        self.subscribed = tokens

    def set_mode(self, mode, tokens):
        self.mode = mode

    def connect(self, threaded=False):
        self.on_connect(self, {})

    def close(self):
        pass


@pytest.fixture()
def gateway(tmp_path):
    return KiteGateway("key", "secret", kite_factory=FakeKite, ticker_factory=FakeTicker, token_file=tmp_path / "tok.json")


def test_login_flow_exchanges_request_token_with_secret(gateway):
    client = create_app(gateway).test_client()
    assert client.get("/api/live/status").get_json()["connected"] is False
    r = client.get("/kite/login")
    assert r.status_code == 302 and "api_key=key" in r.headers["Location"]
    r = client.get("/kite/callback?request_token=req-9&action=login&status=success")
    assert r.status_code == 302 and r.headers["Location"].endswith("/#live")
    assert gateway.kite.calls == [("req-9", "secret")] and gateway.kite.token == "tok-123"
    st = client.get("/api/live/status").get_json()
    assert st["connected"] and st["user"] == "Test Trader"


def test_failed_login_and_missing_keys(tmp_path):
    g = KiteGateway("", "", kite_factory=FakeKite, ticker_factory=FakeTicker, token_file=None)
    client = create_app(g).test_client()
    assert client.get("/kite/login").status_code == 400
    assert "failed" in client.get("/kite/callback?status=cancelled").headers["Location"]
    assert client.get("/api/live/instruments?q=SIM").status_code == 400


def test_search_and_start_require_known_symbols(gateway):
    gateway.complete_login("r")
    client = create_app(gateway).test_client()
    assert [r["symbol"] for r in client.get("/api/live/instruments?q=sim").get_json()][:2] == ["SIMBANK", "SIMAUTO"]
    r = client.post("/api/live/start", json={"symbols": ["NOTREAL"]})
    assert r.status_code == 400 and "NOTREAL" in r.get_json()["error"]


def test_kite_stream_gives_the_same_result_as_replay(gateway, tmp_path):
    """Ticks arriving through the Kite websocket path must trade exactly like the replay."""
    from datetime import datetime, timedelta
    s = small_session(symbols=2, minutes=90)
    _, replay_events = run_session(s)
    replay_trades = [e for e in replay_events if e["type"] == "trade"]

    gateway.complete_login("r")
    svc = LiveService(gateway, sessions_dir=tmp_path)
    # same warm-up as the replay so both runs see identical history
    gateway.warmup = lambda token: s["symbols"]["SIMBANK" if token == 11 else "SIMAUTO"]["warmup"]
    svc.start(["SIMBANK", "SIMAUTO"])
    svc._timer.cancel()
    ticker = FakeTicker.last
    assert ticker.mode == "full" and sorted(ticker.subscribed) == [11, 12]
    day = datetime(2026, 10, 28)
    syms = ["SIMBANK", "SIMAUTO"]
    for idx, t, px, cum in s["ticks"]:
        ticker.on_ticks(ticker, [{"instrument_token": 11 + idx, "last_price": px, "volume_traded": cum,
                                  "exchange_timestamp": day + timedelta(seconds=t)}])
    live_events = svc.hub.end_of_day(s["ticks"][-1][1])
    live_trades = [e for r in svc.hub.runners.values() for x in r for e in x.trades]
    key = lambda e: (e["exit_t"], e["symbol"], e["strategy"])
    assert sorted(live_trades, key=key) == sorted(replay_trades, key=key)
    path = svc.save()
    rec = json.loads(path.read_text())
    assert len(rec["ticks"]) == len(s["ticks"]) and rec["source"] == "kite"
    assert syms == list(rec["symbols"])


def test_sse_stream_starts_with_a_snapshot(gateway):
    client = create_app(gateway).test_client()
    resp = client.get("/api/live/stream", buffered=False)
    first = next(resp.response).decode()
    resp.close()
    assert first.startswith("data: ") and json.loads(first[6:])["type"] == "snapshot"


def test_seconds_ist_converts_aware_timestamps():
    from datetime import datetime, timezone
    assert seconds_ist(datetime(2026, 10, 28, 4, 0, tzinfo=timezone.utc)) == 9 * 3600 + 30 * 60
